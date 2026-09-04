/**
 * Shared Sarah dispatch functions.
 *
 * Extracted here so both the message route and retry endpoints call
 * the identical dispatch logic — no drift between paths.
 */

import {
  db,
  conversationsTable,
  messagesTable,
  sarahJobsTable,
  uploadsTable,
  topicMasteryTable,
  practiceAttemptsTable,
  practiceQuestionsTable,
  studyPlansTable,
} from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { sarah } from "./index";
import { logger } from "../logger";
import { generateSignedUploadUrl, getPublicBaseUrl } from "../uploads-signing";
import {
  recordInferenceSuccess,
  recordInferenceFailure,
  isBillingError,
  isProviderError,
} from "./inferenceStatus";
import { buildSarahRecentMessages } from "./contextGuidance";
import { buildExcerpt } from "../textExtraction";

// ---------------------------------------------------------------------------
// Bounded job timeout
//
// If a job has been queued/processing longer than this threshold it is almost
// certainly stale (e.g. the server crashed between persisting the job row and
// completing dispatch).  We fail it immediately rather than firing a request
// that will time out anyway.
// ---------------------------------------------------------------------------
const JOB_MAX_AGE_MS = (() => {
  const timeoutMs  = parseInt(process.env.SARAH_TIMEOUT_MS  || "120000", 10);
  const maxRetries = parseInt(process.env.SARAH_MAX_RETRIES || "3",      10);
  return timeoutMs * maxRetries + 60_000; // total max dispatch window + 1 min grace
})();

// ---------------------------------------------------------------------------
// Attachment type used by dispatchSarahMessage
// ---------------------------------------------------------------------------
export interface AttachmentRef {
  id: string;
  originalFilename: string;
  mimeType: string;
  storagePath: string | null;
  status: string;
  /** Text pulled from the file at upload time; null when none could be read. */
  extractedText?: string | null;
}

// ---------------------------------------------------------------------------
// Input for dispatchSarahMessage
// ---------------------------------------------------------------------------
export interface DispatchMessageInput {
  jobId: string;
  correlationId: string;
  userId: string;
  conversationId: string;
  mode: string;
  certificationId: string | null;
  certName: string | null;
  examDate: string | null;
  messageId: string;
  content: string;
  recentMessages: Array<{ role: string; content: string }>;
  attachments?: AttachmentRef[];
  /** When this dispatch was initiated — used for bounded-timeout enforcement. */
  jobCreatedAt?: Date;
}

// ---------------------------------------------------------------------------
// dispatchSarahMessage
//
// Sends a user message to Sarah via the configured provider and persists the
// response (or an error notice) to the database.  Always updates the job row
// to a terminal state (completed | failed).
// ---------------------------------------------------------------------------
/**
 * Extract the HTTP status code from a "Sarah service error: NNN" message,
 * if present.  Returns undefined for non-HTTP errors (timeouts, parse errors).
 */
function extractHttpStatus(errorMsg: string): number | undefined {
  const m = errorMsg.match(/Sarah service error: (\d{3})/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Map a raw error to a short safe error code for structured logging and
 * user-facing messages.  Never includes secrets, PII, or full stack traces.
 */
function safeErrorCode(errorMsg: string, httpStatus: number | undefined): string {
  if (httpStatus === 530) return "tunnel_down";
  if (httpStatus === 529) return "rate_limited_upstream";
  if (httpStatus === 503) return "service_unavailable";
  if (httpStatus === 504) return "gateway_timeout";
  if (httpStatus && httpStatus >= 500) return "upstream_server_error";
  if (httpStatus === 429) return "rate_limited";
  if (errorMsg.includes("timed out") || errorMsg.includes("timeout")) return "request_timeout";
  if (errorMsg.includes("credentials are not configured")) return "misconfigured";
  if (errorMsg.includes("sarah.response.invalid")) return "invalid_response";
  return "unknown";
}

/**
 * Loads the learner state Sarah needs to behave like a tutor who remembers.
 *
 * These three fields have existed on SarahContext since the contract was
 * written, and were sent as `[] / [] / null` on every dispatch — so Sarah could
 * never know which domains a learner is weak in, what they got wrong, or what
 * plan she had already given them.  The underlying tables are real and
 * maintained: practice.ts updates topic mastery on every answered question.
 *
 * Best-effort by design.  A learner with no practice history and no plan simply
 * yields empty values, and a query failure must never cost the learner their
 * reply — Sarah is still useful without this context, just not continuous.
 */
async function loadLearnerContext(
  userId: string,
  certificationId: string | null,
): Promise<{
  topicMastery: Array<{ domain: string; masteryScore: number }>;
  recentAnswers: Array<{ correct: boolean; domain: string }>;
  studyPlan: unknown | null;
}> {
  const empty = { topicMastery: [], recentAnswers: [], studyPlan: null };
  if (!certificationId) return empty;

  try {
    const [topicMastery, recentAnswers, studyPlan] = await Promise.all([
      db.select({
        domain: topicMasteryTable.domain,
        masteryScore: topicMasteryTable.masteryScore,
      })
        .from(topicMasteryTable)
        .where(and(
          eq(topicMasteryTable.userId, userId),
          eq(topicMasteryTable.certificationId, certificationId),
        )),

      // Weakest-signal-first is the point: Sarah should revisit what was missed,
      // so the domain has to travel with the attempt (it lives on the question).
      db.select({
        correct: practiceAttemptsTable.correct,
        domain: practiceQuestionsTable.domain,
      })
        .from(practiceAttemptsTable)
        .innerJoin(
          practiceQuestionsTable,
          eq(practiceAttemptsTable.questionId, practiceQuestionsTable.id),
        )
        .where(and(
          eq(practiceAttemptsTable.userId, userId),
          eq(practiceQuestionsTable.certificationId, certificationId),
        ))
        .orderBy(desc(practiceAttemptsTable.createdAt))
        .limit(20),

      db.select({
        examDate: studyPlansTable.examDate,
        weeklyHoursAvailable: studyPlansTable.weeklyHoursAvailable,
        weakDomains: studyPlansTable.weakDomains,
        strongDomains: studyPlansTable.strongDomains,
        milestones: studyPlansTable.milestones,
        updatedAt: studyPlansTable.updatedAt,
      })
        .from(studyPlansTable)
        .where(and(
          eq(studyPlansTable.userId, userId),
          eq(studyPlansTable.certificationId, certificationId),
          eq(studyPlansTable.status, "active"),
        ))
        .orderBy(desc(studyPlansTable.updatedAt))
        .limit(1),
    ]);

    return {
      topicMastery,
      // Oldest-to-newest reads as a progression rather than a stack.
      recentAnswers: recentAnswers.reverse(),
      studyPlan: studyPlan[0] ?? null,
    };
  } catch (err) {
    logger.warn(
      { err, userId, certificationId },
      "sarah_learner_context_load_failed",
    );
    return empty;
  }
}

export async function dispatchSarahMessage(input: DispatchMessageInput): Promise<void> {
  const log = logger.child({ jobId: input.jobId, correlationId: input.correlationId });
  const startMs = Date.now();

  // ── Bounded timeout: fail stale jobs immediately ────────────────────────
  // A job is stale when it has been waiting longer than the maximum time the
  // dispatch could possibly take (retries × per-call timeout + grace period).
  // This happens when the server crashes between persisting the job row and
  // completing the background dispatch, leaving the job stuck in queued /
  // processing.  Failing it now lets the frontend stop polling.
  if (input.jobCreatedAt) {
    const ageMs = Date.now() - input.jobCreatedAt.getTime();
    if (ageMs > JOB_MAX_AGE_MS) {
      log.warn({ ageMs, maxAgeMs: JOB_MAX_AGE_MS }, "sarah.job.timed_out");

      const supportRef = input.jobId.slice(-8);
      await db.update(sarahJobsTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Job timed out: maximum age exceeded",
        })
        .where(eq(sarahJobsTable.id, input.jobId));

      await db.insert(messagesTable).values({
        conversationId: input.conversationId,
        role: "assistant",
        messageType: "error",
        content: `Sarah took too long to respond. Please try again. (ref: ${supportRef})`,
        status: "delivered",
        sarahJobId: input.jobId,
      });
      return;
    }
  }

  await db.update(sarahJobsTable)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(sarahJobsTable.id, input.jobId));

  log.info(
    { userId: input.userId, conversationId: input.conversationId, messageId: input.messageId },
    "sarah.dispatch.started",
  );

  try {
    const publicBase = getPublicBaseUrl();
    const signingSecret = process.env.SESSION_SECRET || "";
    const uploadedResources = (input.attachments ?? []).map((a) => {
      const url = generateSignedUploadUrl(a.id, publicBase, signingSecret);
      log.info({ attachmentId: a.id, mimeType: a.mimeType }, "sarah_attachment_url_created");
      return {
        id: a.id,
        filename: a.originalFilename,
        // Derived, not hardcoded: this was pinned to "image" back when the
        // picker only accepted images.  A candidate handbook announced to Sarah
        // as an image is a resource she cannot reason about correctly.
        type: a.mimeType.startsWith("image/") ? "image" : "document",
        mimeType: a.mimeType,
        url,
        // The signed URL alone is useless to Sarah: she has no file reader.
        // The excerpt is the only way an uploaded document reaches the model.
        ...(a.extractedText
          ? { textExcerpt: buildExcerpt(a.extractedText) }
          : {}),
      };
    });

    log.info(
      { attachmentCount: uploadedResources.length },
      "sarah_attachment_dispatch_started",
    );

    const learnerContext = await loadLearnerContext(input.userId, input.certificationId);

    log.info(
      {
        conversationId: input.conversationId,
        topicMasteryCount: learnerContext.topicMastery.length,
        recentAnswerCount: learnerContext.recentAnswers.length,
        hasStudyPlan: learnerContext.studyPlan !== null,
      },
      "sarah_learner_context_loaded",
    );

    const result = await sarah.sendMessage({
      requestId: input.jobId,
      userId: input.userId,
      certificationId: input.certificationId,
      certificationName: input.certName,
      examDate: input.examDate,
      conversationId: input.conversationId,
      mode: input.mode,
      message: { id: input.messageId, content: input.content },
      context: {
        recentMessages: buildSarahRecentMessages(input.recentMessages),
        ...learnerContext,
        uploadedResources,
      },
    });

    log.info(
      {
        responseCount: result.responseMessages.length,
        elapsedMs: Date.now() - startMs,
        degraded: result.degraded ?? false,
      },
      "sarah.dispatch.completed",
    );

    // ── Degraded responses are never presented as teaching ────────────────────
    // When Sarah's own runtime fails (LLM provider error, or a timeout) her API
    // still answers HTTP 200, carrying a deterministic canned reply and
    // metadata.degraded = true.  That canned reply reads like tutoring but
    // teaches nothing — it announces what it will explain and then asks the
    // learner what to study.  Persisting it as a normal assistant turn tells the
    // learner their tutor answered when it did not.
    //
    // So a degraded response is stored as an `error` message instead: the UI
    // renders those distinctly, and POST /messages/:id/retry lets the learner
    // try again.  An honest failure they can retry beats a convincing non-answer.
    if (result.degraded) {
      const supportRef = input.jobId.slice(-8);

      recordInferenceFailure(
        "provider_error",
        "Sarah returned a degraded response (runtime reported provider failure or timeout)",
      );

      await db.insert(messagesTable).values({
        conversationId: input.conversationId,
        role: "assistant",
        messageType: "error",
        content:
          "Sarah could not reach her reasoning engine for that message, so there is no answer to give you yet. " +
          `Please try again. (ref: ${supportRef})`,
        structuredData: result.responseMessages[0]?.structuredData as any,
        status: "delivered",
        sarahJobId: input.jobId,
      });

      await db.update(conversationsTable)
        .set({
          messageCount: sql`${conversationsTable.messageCount} + 1`,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, input.conversationId));

      await db.update(sarahJobsTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          errorMessage: "degraded_response",
          outputPayload: result as any,
        })
        .where(eq(sarahJobsTable.id, input.jobId));

      log.warn(
        { conversationId: input.conversationId, elapsedMs: Date.now() - startMs },
        "sarah.response.degraded_suppressed",
      );
      return;
    }

    // ── Inference status tracking ─────────────────────────────────────────────
    // Hermes wraps LLM provider errors in HTTP 200 responses, so we inspect
    // the content of each response message to detect billing / provider errors.
    for (const msg of result.responseMessages) {
      if (isBillingError(msg.content)) {
        recordInferenceFailure("credits_exhausted", "LLM provider returned permission-denied (credits exhausted)");
        log.warn({ conversationId: input.conversationId }, "sarah_inference_billing_error_detected");
      } else if (isProviderError(msg.content)) {
        recordInferenceFailure("provider_error", `LLM provider error in response: ${msg.content.slice(0, 120)}`);
        log.warn({ conversationId: input.conversationId }, "sarah_inference_provider_error_detected");
      } else if (msg.content && !msg.content.startsWith("HTTP ")) {
        // Non-empty, non-error content → real AI response received.
        recordInferenceSuccess();
      }
    }

    for (const msg of result.responseMessages) {
      await db.insert(messagesTable).values({
        conversationId: input.conversationId,
        role: "assistant",
        messageType: msg.messageType as any,
        content: msg.content,
        structuredData: msg.structuredData as any,
        status: "delivered",
        sarahJobId: input.jobId,
      });

      // §sarah.assistant.persisted — one event per persisted assistant message
      log.info(
        { conversationId: input.conversationId, degraded: result.degraded ?? false },
        "sarah.assistant.persisted",
      );
    }

    await db.update(conversationsTable)
      .set({
        messageCount: sql`${conversationsTable.messageCount} + ${result.responseMessages.length}`,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, input.conversationId));

    await db.update(sarahJobsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        outputPayload: result as any,
      })
      .where(eq(sarahJobsTable.id, input.jobId));

    // §sarah.job.completed — terminal success event; safe fields only
    log.info(
      {
        conversationId: input.conversationId,
        elapsedMs: Date.now() - startMs,
        degraded: result.degraded ?? false,
      },
      "sarah.job.completed",
    );

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const elapsedMs = Date.now() - startMs;
    const httpStatus = extractHttpStatus(errorMsg);
    const errCode = safeErrorCode(errorMsg, httpStatus);

    // §sarah.job.failed — terminal failure event; never log raw upstream body
    log.error(
      {
        failureStage: "dispatch",
        safeErrorCode: errCode,
        httpStatus,
        elapsedMs,
        errorMsg,
      },
      "sarah.job.failed",
    );

    // Include the jobId as an opaque support reference in the user-facing error
    // notice.  This lets support correlate the specific failure from logs.
    const supportRef = input.jobId.slice(-8);
    const userNotice = errCode === "tunnel_down"
      ? `Sarah is temporarily unavailable. Please try again in a few minutes. (ref: ${supportRef})`
      : `Sarah couldn't complete this response. Please try again. (ref: ${supportRef})`;

    await db.insert(messagesTable).values({
      conversationId: input.conversationId,
      role: "assistant",
      messageType: "error",
      content: userNotice,
      status: "delivered",
      sarahJobId: input.jobId,
    });

    await db.update(sarahJobsTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: errorMsg })
      .where(eq(sarahJobsTable.id, input.jobId));
  }
}

// ---------------------------------------------------------------------------
// initSarahConversation
//
// Fires a createConversation call to Sarah and stores the opening message.
// Called in the background after a conversation row is persisted.
// Errors are non-fatal — the conversation is usable even if the opening
// message fails.
//
// The opening message is a greeting that asks the learner what they are
// studying.  Because this runs in the background it races the learner's first
// message: a learner who types immediately gets their answer stored first, and
// the greeting then lands *underneath* it asking for facts they just supplied.
// So the insert is conditional — the greeting is only stored while the
// conversation is still empty, and the check and the insert share one
// transaction.  When the learner got there first their message IS the opening,
// and Sarah answers it on the normal dispatch path.
// ---------------------------------------------------------------------------
export async function initSarahConversation(input: {
  userId: string;
  conversationId: string;
  certificationId: string | null;
  certName: string | null;
  mode: string;
  correlationId: string;
}): Promise<void> {
  const log = logger.child({
    conversationId: input.conversationId,
    userId: input.userId,
    correlationId: input.correlationId,
  });

  log.info("sarah_initialization_started");

  try {
    const openingResult = await sarah.createConversation({
      userId: input.userId,
      conversationId: input.conversationId,
      certificationId: input.certificationId,
      certificationName: input.certName,
      mode: input.mode,
    });

    const stored = await db.transaction(async (tx) => {
      const [firstMessage] = await tx.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, input.conversationId))
        .limit(1);

      // The learner already spoke — their message is the opening.  Storing a
      // greeting now would appear below it and ask what they just answered.
      if (firstMessage) return false;

      await tx.insert(messagesTable).values({
        conversationId: input.conversationId,
        role: "assistant",
        messageType: openingResult.openingMessage.messageType as any,
        content: openingResult.openingMessage.content,
        structuredData: openingResult.openingMessage.structuredData as any,
        status: "delivered",
      });

      await tx.update(conversationsTable)
        .set({ messageCount: sql`${conversationsTable.messageCount} + 1`, lastMessageAt: new Date() })
        .where(eq(conversationsTable.id, input.conversationId));

      return true;
    });

    if (stored) {
      log.info("sarah_initialization_completed");
    } else {
      log.info("sarah_initialization_skipped_learner_first");
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.warn({ errorMsg }, "sarah_initialization_failed");
    // Non-fatal — the 201 response has already been sent and the conversation
    // row is persisted.  The user can send messages normally.
  }
}

// ---------------------------------------------------------------------------
// buildDispatchContext
//
// Loads the context required to dispatch a message.  Called from retry
// endpoints that need to reconstruct context from DB state.
// ---------------------------------------------------------------------------
export async function buildDispatchContext(input: {
  jobId: string;
  correlationId: string;
  userId: string;
  conversationId: string;
  mode: string;
  certificationId: string | null;
  certName: string | null;
  examDate: string | null;
  messageId: string;
  content: string;
  attachmentIds?: string[];
}): Promise<DispatchMessageInput> {
  const recentMessages = await db
    .select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, input.conversationId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(10);

  let attachments: AttachmentRef[] = [];
  if (input.attachmentIds?.length) {
    attachments = await db
      .select()
      .from(uploadsTable)
      .where(inArray(uploadsTable.id, input.attachmentIds));
  }

  return {
    jobId: input.jobId,
    correlationId: input.correlationId,
    userId: input.userId,
    conversationId: input.conversationId,
    mode: input.mode,
    certificationId: input.certificationId,
    certName: input.certName,
    examDate: input.examDate,
    messageId: input.messageId,
    content: input.content,
    recentMessages: recentMessages.reverse().map((m) => ({ role: m.role, content: m.content })),
    attachments,
    jobCreatedAt: new Date(), // fresh dispatch — age clock starts now
  };
}
