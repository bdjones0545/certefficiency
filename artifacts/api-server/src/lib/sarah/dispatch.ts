/**
 * Shared Sarah dispatch functions.
 *
 * Extracted here so both the message route and retry endpoints call
 * the identical dispatch logic — no drift between paths.
 */

import { db, conversationsTable, messagesTable, sarahJobsTable, uploadsTable } from "@workspace/db";
import { eq, desc, inArray, sql } from "drizzle-orm";
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
      log.info({ attachmentId: a.id }, "sarah_attachment_url_created");
      return {
        id: a.id,
        filename: a.originalFilename,
        type: "image",
        mimeType: a.mimeType,
        url,
      };
    });

    log.info({ attachmentCount: uploadedResources.length }, "sarah_image_dispatch_started");

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
        recentMessages: input.recentMessages,
        topicMastery: [],
        recentAnswers: [],
        studyPlan: null,
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

    await db.insert(messagesTable).values({
      conversationId: input.conversationId,
      role: "assistant",
      messageType: openingResult.openingMessage.messageType as any,
      content: openingResult.openingMessage.content,
      structuredData: openingResult.openingMessage.structuredData as any,
      status: "delivered",
    });

    await db.update(conversationsTable)
      .set({ messageCount: sql`${conversationsTable.messageCount} + 1`, lastMessageAt: new Date() })
      .where(eq(conversationsTable.id, input.conversationId));

    log.info("sarah_initialization_completed");
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
