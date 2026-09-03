import { Router } from "express";
import { db, sarahJobsTable, conversationsTable, messagesTable, certificationsTable, userCertificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sarah } from "../lib/sarah";
import { GetSarahJobParams, RetrySarahJobParams } from "@workspace/api-zod";
import { v4 as uuidv4 } from "uuid";
import { dispatchSarahMessage } from "../lib/sarah/dispatch";
import { logger } from "../lib/logger";
import { getInferenceStatus } from "../lib/sarah/inferenceStatus";

// Stale job timeout: same budget as the dispatch function uses.
// Jobs stuck in queued/processing beyond this threshold are transitioned to
// failed when the client polls GET /sarah/jobs/:id, so the frontend can stop
// spinning and show a retryable error instead of polling forever.
const JOB_MAX_AGE_MS = (() => {
  const timeoutMs  = parseInt(process.env.SARAH_TIMEOUT_MS  || "120000", 10);
  const maxRetries = parseInt(process.env.SARAH_MAX_RETRIES || "3",      10);
  return timeoutMs * maxRetries + 60_000;
})();

const router = Router();

// ---------------------------------------------------------------------------
// GET /sarah/health
//
// Returns Sarah / Hermes reachability status.
// Requires authentication: avoids leaking provider configuration to
// unauthenticated callers and discourages probing the upstream tunnel.
// ---------------------------------------------------------------------------
router.get("/sarah/health", requireAuth, async (_req, res): Promise<void> => {
  const [tunnelResult, inferenceSnapshot] = await Promise.all([
    sarah.health(),
    Promise.resolve(getInferenceStatus()),
  ]);
  const provider = process.env.SARAH_PROVIDER || "mock";

  // Compute the composite status:
  //   "unavailable"   — Hermes/tunnel unreachable
  //   "degraded"      — Hermes up but LLM inference failing (billing error, provider error)
  //   "healthy"       — Hermes up AND last inference succeeded (or not yet attempted)
  let compositeStatus = tunnelResult.status; // "healthy" | "degraded" | "unavailable"
  if (compositeStatus === "healthy" && !inferenceSnapshot.ok) {
    compositeStatus = "degraded";
  }

  res.json({
    status: compositeStatus,
    latencyMs: tunnelResult.latencyMs,
    provider,
    // Inference sub-status — present so the frontend / ops can distinguish
    // "Hermes is down" from "Hermes is up but LLM credits exhausted".
    inference: {
      status: inferenceSnapshot.code,
      lastSuccessAt: inferenceSnapshot.lastSuccessAt,
      lastFailureAt: inferenceSnapshot.lastFailureAt,
      ...(inferenceSnapshot.detail ? { detail: inferenceSnapshot.detail } : {}),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /sarah/jobs/:id
// ---------------------------------------------------------------------------
router.get("/sarah/jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetSarahJobParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [job] = await db.select()
    .from(sarahJobsTable)
    .where(and(eq(sarahJobsTable.id, params.data.id), eq(sarahJobsTable.userId, req.userId!)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // ── Stale job termination ─────────────────────────────────────────────────
  // If a job is still in a non-terminal state and has exceeded the max age,
  // the server likely crashed mid-dispatch.  Transition it to failed here so
  // the frontend poller stops and the user sees a retryable error.
  let currentStatus = job.status;
  if ((currentStatus === "queued" || currentStatus === "processing") && job.createdAt) {
    const ageMs = Date.now() - new Date(job.createdAt).getTime();
    if (ageMs > JOB_MAX_AGE_MS) {
      logger.info({ jobId: job.id, ageMs, maxAgeMs: JOB_MAX_AGE_MS }, "sarah.job.timed_out");

      await db.update(sarahJobsTable)
        .set({ status: "failed", completedAt: new Date(), errorMessage: "Job timed out" })
        .where(eq(sarahJobsTable.id, job.id));

      if (job.conversationId) {
        await db.insert(messagesTable).values({
          conversationId: job.conversationId,
          role: "assistant",
          messageType: "error",
          content: `Sarah took too long to respond. Please try again. (ref: ${job.id.slice(-8)})`,
          status: "delivered",
          sarahJobId: job.id,
        });
      }

      currentStatus = "failed";
    }
  }

  res.json({
    id: job.id,
    userId: job.userId,
    conversationId: job.conversationId,
    requestType: job.requestType,
    status: currentStatus,
    attemptCount: job.attemptCount,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  });
});

// ---------------------------------------------------------------------------
// POST /sarah/jobs/:id/retry
//
// Re-dispatches a failed job to Sarah.  Marks the job as queued, increments
// the attempt counter, then immediately fires the dispatch in the background.
// ---------------------------------------------------------------------------
router.post("/sarah/jobs/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = RetrySarahJobParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [job] = await db.select()
    .from(sarahJobsTable)
    .where(and(eq(sarahJobsTable.id, params.data.id), eq(sarahJobsTable.userId, req.userId!)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "failed") {
    res.status(400).json({ error: "Only failed jobs can be retried" });
    return;
  }

  if (!job.conversationId) {
    res.status(400).json({ error: "Job has no associated conversation" });
    return;
  }

  // Extract original message info from job payload
  const payload = (job.inputPayload as { messageId?: string; content?: string } | null) ?? {};
  const messageId = payload.messageId;
  const content = payload.content;

  if (!messageId || !content) {
    res.status(400).json({ error: "Job payload is missing message data — cannot retry" });
    return;
  }

  // Verify conversation still belongs to this user
  const [conv] = await db.select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, job.conversationId),
      eq(conversationsTable.userId, req.userId!),
    ))
    .limit(1);

  if (!conv) {
    res.status(403).json({ error: "Conversation not found or unauthorized" });
    return;
  }

  // Resolve certification context
  let certName: string | null = null;
  let examDate: string | null = null;
  if (conv.certificationId) {
    const [cert] = await db.select({ name: certificationsTable.name })
      .from(certificationsTable)
      .where(eq(certificationsTable.id, conv.certificationId))
      .limit(1);
    certName = cert?.name || null;

    const [uc] = await db.select({ examDate: userCertificationsTable.examDate })
      .from(userCertificationsTable)
      .where(and(
        eq(userCertificationsTable.userId, req.userId!),
        eq(userCertificationsTable.certificationId, conv.certificationId),
      ))
      .limit(1);
    examDate = uc?.examDate || null;
  }

  const recentMessages = await db.select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id))
    .orderBy(desc(messagesTable.createdAt))
    .limit(10);

  // Mark job as re-queued and increment attempt counter
  const [updated] = await db.update(sarahJobsTable)
    .set({ status: "queued", errorMessage: null, attemptCount: job.attemptCount + 1 })
    .where(eq(sarahJobsTable.id, job.id))
    .returning();

  const correlationId = uuidv4();

  // Respond immediately
  res.json({
    id: updated.id,
    userId: updated.userId,
    conversationId: updated.conversationId,
    requestType: updated.requestType,
    status: updated.status,
    attemptCount: updated.attemptCount,
    errorMessage: updated.errorMessage,
    startedAt: updated.startedAt,
    completedAt: updated.completedAt,
    createdAt: updated.createdAt,
  });

  // ── Re-dispatch to Sarah in background ───────────────────────────────────
  dispatchSarahMessage({
    jobId: job.id,
    correlationId,
    userId: req.userId!,
    conversationId: conv.id,
    mode: conv.mode,
    certificationId: conv.certificationId,
    certName,
    examDate,
    messageId,
    content,
    recentMessages: recentMessages.reverse().map(m => ({ role: m.role, content: m.content })),
    attachments: [],
    jobCreatedAt: new Date(), // retry resets the timeout clock
  }).catch(err => {
    logger.error({ err, jobId: job.id }, "Unhandled error in dispatchSarahMessage (job retry)");
  });
});

export default router;
