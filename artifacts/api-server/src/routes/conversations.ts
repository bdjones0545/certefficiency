import { Router } from "express";
import { db, conversationsTable, messagesTable, certificationsTable } from "@workspace/db";
import { uploadsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateConversationBody, UpdateConversationBody, UpdateConversationParams,
  GetConversationParams, DeleteConversationParams,
  SendMessageBody, SendMessageParams, ListMessagesParams,
  RetryMessageParams,
} from "@workspace/api-zod";
import { v4 as uuidv4 } from "uuid";
import { sarahJobsTable, userCertificationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import type { Logger } from "pino";
import { dispatchSarahMessage, initSarahConversation } from "../lib/sarah/dispatch";

const router = Router();

// ---------------------------------------------------------------------------
// GET /conversations
// ---------------------------------------------------------------------------
router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const convs = await db.select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.userId, req.userId!),
      eq(conversationsTable.isArchived, false),
    ))
    .orderBy(desc(conversationsTable.updatedAt));

  const result = await Promise.all(convs.map(async (c) => {
    let certName: string | null = null;
    if (c.certificationId) {
      const [cert] = await db.select({ name: certificationsTable.name })
        .from(certificationsTable)
        .where(eq(certificationsTable.id, c.certificationId))
        .limit(1);
      certName = cert?.name || null;
    }
    return { ...c, certificationName: certName };
  }));

  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /conversations
//
// Flow:
//   1. Validate request body
//   2. Persist local conversation to DB
//   3. Respond 201 immediately — the conversation is usable NOW
//   4. Background: attempt Sarah opening-message init (best-effort, non-blocking)
//      Success → store opening message, update messageCount
//      Failure → log and move on; user can still chat normally
// ---------------------------------------------------------------------------
router.post("/conversations", requireAuth, async (req, res): Promise<void> => {
  const reqLog = req.log as Logger;

  reqLog.info({ userId: req.userId }, "conversation_route_entered");

  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  reqLog.info({ userId: req.userId, mode: parsed.data.mode }, "conversation_validated");

  // Resolve cert name once (used in response and in background Sarah call)
  let certName: string | null = null;
  if (parsed.data.certificationId) {
    const [cert] = await db.select({ name: certificationsTable.name })
      .from(certificationsTable)
      .where(eq(certificationsTable.id, parsed.data.certificationId))
      .limit(1);
    certName = cert?.name || null;
  }

  // Persist local conversation — must succeed before we respond
  const [conv] = await db.insert(conversationsTable).values({
    userId: req.userId!,
    title: parsed.data.title || "New Conversation",
    mode: (parsed.data.mode as "learn" | "practice" | "review" | "mock_exam" | "study_plan") || "learn",
    certificationId: parsed.data.certificationId || null,
    isArchived: false,
    messageCount: 0,
  }).returning();

  reqLog.info({ userId: req.userId, conversationId: conv.id }, "conversation_saved");

  // ── Respond immediately ───────────────────────────────────────────────────
  // Canonical response shape — frontend normalizes via: result.conversation ?? result
  res.status(201).json({ conversation: { ...conv, certificationName: certName } });

  reqLog.info({ userId: req.userId, conversationId: conv.id }, "conversation_response_sent");

  // ── Background: Sarah opening-message init ────────────────────────────────
  const initCorrelationId = uuidv4();
  void initSarahConversation({
    userId: req.userId!,
    conversationId: conv.id,
    certificationId: conv.certificationId,
    certName,
    mode: conv.mode,
    correlationId: initCorrelationId,
  });
});

// ---------------------------------------------------------------------------
// GET /conversations/:id
// ---------------------------------------------------------------------------
router.get("/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetConversationParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [conv] = await db.select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, req.userId!)))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  let certName: string | null = null;
  if (conv.certificationId) {
    const [cert] = await db.select({ name: certificationsTable.name })
      .from(certificationsTable)
      .where(eq(certificationsTable.id, conv.certificationId))
      .limit(1);
    certName = cert?.name || null;
  }

  res.json({ ...conv, certificationName: certName });
});

// ---------------------------------------------------------------------------
// PATCH /conversations/:id
// ---------------------------------------------------------------------------
router.patch("/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateConversationParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Ownership check first
  const [existing] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, req.userId!)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Include userId in the WHERE clause to eliminate any TOCTOU window
  const [updated] = await db.update(conversationsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(
      eq(conversationsTable.id, params.data.id),
      eq(conversationsTable.userId, req.userId!),
    ))
    .returning();

  res.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /conversations/:id
// ---------------------------------------------------------------------------
router.delete("/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteConversationParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  // Ownership check before entering the transaction
  const [existing] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, params.data.id),
      eq(conversationsTable.userId, req.userId!),
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Delete sarah_jobs first (no FK cascade), then the conversation
  // (which cascades messages via the existing FK).
  await db.transaction(async (tx) => {
    await tx.delete(sarahJobsTable)
      .where(eq(sarahJobsTable.conversationId, params.data.id));

    await tx.delete(conversationsTable)
      .where(and(
        eq(conversationsTable.id, params.data.id),
        eq(conversationsTable.userId, req.userId!),
      ));
  });

  logger.info(
    { userId: req.userId, conversationId: params.data.id },
    "conversation.deleted",
  );

  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// GET /conversations/:id/messages
// ---------------------------------------------------------------------------
router.get("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListMessagesParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [conv] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, req.userId!)))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const messages = await db.select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, params.data.id))
    .orderBy(messagesTable.createdAt);

  res.json(messages);
});

// ---------------------------------------------------------------------------
// POST /conversations/:id/messages
// ---------------------------------------------------------------------------
router.post("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SendMessageParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // §2 — correlationId generated here so every subsequent log stage is traceable
  const correlationId = uuidv4();

  req.log.info(
    { correlationId, userId: req.userId, conversationId: params.data.id },
    "sarah.message.requested",
  );
  // sarah.auth.completed is implicit here — requireAuth middleware already ran
  req.log.info({ correlationId, userId: req.userId }, "sarah.auth.completed");

  const [conv] = await db.select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, params.data.id), eq(conversationsTable.userId, req.userId!)))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  req.log.info(
    { correlationId, userId: req.userId, conversationId: conv.id },
    "sarah.conversation.authorized",
  );

  const recentMessages = await db.select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id))
    .orderBy(desc(messagesTable.createdAt))
    .limit(10);

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

  // ── Optional: validate and resolve attachment IDs ────────────────────────
  const rawAttachmentIds: string[] | undefined = (() => {
    const val = req.body?.attachmentIds;
    if (!val) return undefined;
    if (!Array.isArray(val) || val.length > 5) return undefined;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!val.every((v: unknown) => typeof v === "string" && UUID_RE.test(v))) return undefined;
    return val as string[];
  })();

  let resolvedAttachments: typeof uploadsTable.$inferSelect[] = [];
  if (rawAttachmentIds?.length) {
    const uploads = await db.select()
      .from(uploadsTable)
      .where(and(
        inArray(uploadsTable.id, rawAttachmentIds),
        eq(uploadsTable.userId, req.userId!),
      ));

    // Enforce ownership and ready status
    for (const id of rawAttachmentIds) {
      const record = uploads.find((u) => u.id === id);
      if (!record) {
        res.status(400).json({ error: `Attachment ${id} not found or does not belong to you.` });
        return;
      }
      if (record.status !== "ready") {
        res.status(400).json({ error: `Attachment ${id} is not ready yet (status: ${record.status}).` });
        return;
      }
    }
    resolvedAttachments = uploads;

    req.log.info(
      { userId: req.userId, conversationId: conv.id, attachmentCount: resolvedAttachments.length },
      "message_attachment_linked",
    );
  }

  const attachmentIds = resolvedAttachments.map((a) => a.id);

  const userMessageId = uuidv4();
  const [userMessage] = await db.insert(messagesTable).values({
    id: userMessageId,
    conversationId: conv.id,
    role: "user",
    messageType: "text",
    content: parsed.data.content,
    status: "delivered",
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  }).returning();

  req.log.info(
    { correlationId, userId: req.userId, conversationId: conv.id, messageId: userMessageId },
    "sarah.persistence.started",
  );

  const jobId = uuidv4();
  const idempotencyKey = uuidv4();

  await db.insert(sarahJobsTable).values({
    id: jobId,
    userId: req.userId!,
    conversationId: conv.id,
    requestType: "message.received",
    status: "queued",
    idempotencyKey,
    correlationId,
    inputPayload: {
      messageId: userMessageId,
      content: parsed.data.content,
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
    } as any,
  });

  req.log.info(
    {
      correlationId,
      userId: req.userId,
      conversationId: conv.id,
      messageId: userMessageId,
      jobId,
      // Last 8 chars of the idempotency key as an opaque fingerprint — safe to log
      idempotencyKeyFingerprint: idempotencyKey.slice(-8),
    },
    "sarah.job.created",
  );

  await db.update(conversationsTable)
    .set({ messageCount: sql`${conversationsTable.messageCount} + 1`, lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));

  // Respond before dispatching to Sarah
  res.status(201).json({ userMessage, jobId, sarahMessage: null });

  // Background message dispatch
  dispatchSarahMessage({
    jobId,
    correlationId,
    userId: req.userId!,
    conversationId: conv.id,
    mode: conv.mode,
    certificationId: conv.certificationId,
    certName,
    examDate,
    messageId: userMessageId,
    content: parsed.data.content,
    recentMessages: recentMessages.reverse().map(m => ({ role: m.role, content: m.content })),
    attachments: resolvedAttachments,
    jobCreatedAt: new Date(), // bounded-timeout clock starts now
  }).catch(err => {
    logger.error({ err, jobId }, "Unhandled error in dispatchSarahMessage");
  });
});

// ---------------------------------------------------------------------------
// POST /messages/:id/retry
//
// Retries sending a user message to Sarah.  Looks up the conversation context
// and dispatches a new job — does NOT duplicate the user message row.
// ---------------------------------------------------------------------------
router.post("/messages/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = RetryMessageParams.safeParse({ id: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [message] = await db.select()
    .from(messagesTable)
    .where(eq(messagesTable.id, params.data.id))
    .limit(1);

  if (!message) { res.status(404).json({ error: "Message not found" }); return; }

  // Ownership: verify conversation belongs to this user
  const [conv] = await db.select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, message.conversationId),
      eq(conversationsTable.userId, req.userId!),
    ))
    .limit(1);

  if (!conv) { res.status(403).json({ error: "Unauthorized" }); return; }

  // Only user messages can be retried (retrying an assistant message makes no sense)
  if (message.role !== "user") {
    res.status(400).json({ error: "Only user messages can be retried" });
    return;
  }

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

  // Resolve any attachments that were on the original message.
  // Cast needed because drizzle jsonb typing may not include the field
  // in the select type until the next schema codegen cycle.
  const originalAttachmentIds =
    ((message as Record<string, unknown>).attachmentIds as string[] | null) ?? [];
  let attachments: typeof uploadsTable.$inferSelect[] = [];
  if (originalAttachmentIds.length) {
    attachments = await db.select()
      .from(uploadsTable)
      .where(and(
        inArray(uploadsTable.id, originalAttachmentIds),
        eq(uploadsTable.userId, req.userId!),
      ));
  }

  const jobId = uuidv4();
  const correlationId = uuidv4();

  await db.insert(sarahJobsTable).values({
    id: jobId,
    userId: req.userId!,
    conversationId: conv.id,
    requestType: "message.retry",
    status: "queued",
    idempotencyKey: uuidv4(),
    correlationId,
    inputPayload: { messageId: message.id, content: message.content } as any,
  });

  // Respond immediately — dispatch happens in background
  res.json({ userMessage: message, jobId, sarahMessage: null });

  // ── Dispatch to Sarah in background ──────────────────────────────────────
  dispatchSarahMessage({
    jobId,
    correlationId,
    userId: req.userId!,
    conversationId: conv.id,
    mode: conv.mode,
    certificationId: conv.certificationId,
    certName,
    examDate,
    messageId: message.id,
    content: message.content,
    recentMessages: recentMessages.reverse().map(m => ({ role: m.role, content: m.content })),
    attachments,
    jobCreatedAt: new Date(), // bounded-timeout clock starts now
  }).catch(err => {
    logger.error({ err, jobId }, "Unhandled error in dispatchSarahMessage (retry)");
  });
});

export default router;
