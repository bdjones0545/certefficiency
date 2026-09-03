/**
 * Sarah / Hermes integration test suite — 36 requirements from Phase 21 of the
 * production-readiness audit, plus additional security invariant checks.
 *
 * All DB calls, the Sarah provider, and drizzle-orm helpers are mocked.
 * No live tunnel, database, or Cloudflare credentials are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { signToken } from "../lib/auth.js";
import {
  resetForTesting as resetInferenceStatus,
  recordInferenceSuccess,
  recordInferenceFailure,
  isBillingError,
  isProviderError,
  getInferenceStatus,
} from "../lib/sarah/inferenceStatus.js";

// ── Mock drizzle-orm first — routes import eq/and/desc/sql/inArray from it  ──
// Drizzle functions access column metadata internally; mocking prevents throws
// when our fake table objects (plain key/value records) are passed.

vi.mock("drizzle-orm", () => {
  const noop = vi.fn(() => ({}));
  const tag = vi.fn(() => ({})); // tagged template stub
  return {
    eq: noop, and: noop, or: noop, not: noop,
    desc: noop, asc: noop,
    inArray: noop, notInArray: noop,
    isNull: noop, isNotNull: noop,
    gt: noop, gte: noop, lt: noop, lte: noop, ne: noop,
    like: noop, ilike: noop, between: noop,
    sql: tag,
    count: noop, sum: noop, avg: noop, min: noop, max: noop,
  };
});

// ── Shared mock state ─────────────────────────────────────────────────────────

let dbCallQueue: unknown[][] = [];
let dbCallIdx = 0;

// Chain that handles all common drizzle select patterns.
// Each node is a "thenable" — it's a resolved Promise with extra chain methods
// attached, so BOTH `await node` and `await node.limit(n)` work correctly.
function makeSelectChain(data: unknown[]) {
  function thenable(extra: Record<string, unknown>) {
    // Promise.resolve(data) plus the chain methods on the same object
    const p = Promise.resolve(data);
    return Object.assign(p, extra);
  }

  const limit = vi.fn(() => Promise.resolve(data));
  const returning = vi.fn(() => Promise.resolve(data));
  const orderBy = vi.fn(() =>
    thenable({ limit, where: vi.fn(() => thenable({ limit, orderBy: vi.fn(() => thenable({ limit })) })) }),
  );
  const where = vi.fn(() => thenable({ limit, orderBy, returning }));
  const from = vi.fn(() => thenable({ where, orderBy, limit }));
  return { from };
}

// Full query chain: .set().where().returning() | .where().returning()
function makeUpdateChain() {
  const returning = vi.fn(async () => []);
  const where = vi.fn(() => ({ returning, execute: vi.fn(async () => []) }));
  const set = vi.fn(() => ({ where }));
  return { set };
}

// Full delete chain: .where().returning()
function makeDeleteChain() {
  const returning = vi.fn(async () => []);
  const where = vi.fn(() => ({ returning, execute: vi.fn(async () => []) }));
  return { where };
}

const mockInsertValues = vi.fn();
const mockUpdateChain = { set: vi.fn() };
const mockDeleteChain = { where: vi.fn() };

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain(dbCallQueue[dbCallIdx++] ?? [])),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => mockUpdateChain),
    delete: vi.fn(() => mockDeleteChain),
  },
  // Minimal table stubs — column names are strings so the mocked drizzle
  // helpers receive them without accessing real drizzle column metadata.
  conversationsTable: {
    id: "id", userId: "userId", certificationId: "certificationId",
    messageCount: "messageCount", isArchived: "isArchived",
    updatedAt: "updatedAt", lastMessageAt: "lastMessageAt", mode: "mode",
  },
  messagesTable: {
    id: "id", conversationId: "conversationId", createdAt: "createdAt",
    role: "role", content: "content",
  },
  certificationsTable: { id: "id", name: "name" },
  sarahJobsTable: {
    id: "id", userId: "userId", conversationId: "conversationId",
    status: "status", idempotencyKey: "idempotencyKey",
    inputPayload: "inputPayload", attemptCount: "attemptCount",
  },
  uploadsTable: { id: "id", userId: "userId", status: "status" },
  userCertificationsTable: { userId: "userId", certificationId: "certificationId", examDate: "examDate" },
}));

// ── Sarah service mock ────────────────────────────────────────────────────────

const mockSarahHealth = vi.fn();

vi.mock("../lib/sarah/index.js", () => ({
  sarah: {
    createConversation: vi.fn(async () => ({
      conversationId: "remote-conv-id",
      openingMessage: { messageType: "text", content: "Hi!", structuredData: null },
    })),
    sendMessage: vi.fn(async () => ({
      responseMessages: [{ messageType: "text", content: "Response", structuredData: null }],
      jobCompleted: true,
    })),
    health: (...a: unknown[]) => mockSarahHealth(...a),
  },
}));

// ── Dispatch mock ─────────────────────────────────────────────────────────────

const mockDispatch = vi.fn().mockResolvedValue(undefined);
const mockInitConversation = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/sarah/dispatch.js", () => ({
  dispatchSarahMessage: (...a: unknown[]) => mockDispatch(...a),
  initSarahConversation: (...a: unknown[]) => mockInitConversation(...a),
}));

// ── Infrastructure mocks ──────────────────────────────────────────────────────

vi.mock("../lib/r2Storage.js", () => ({
  r2Storage: { getSignedPlaybackUrl: vi.fn() },
  getR2Config: vi.fn(() => ({})),
  validateR2Config: vi.fn(() => true),
  validateObjectKey: vi.fn(),
  R2ObjectKeyError: class extends Error {},
}));
vi.mock("../lib/objectStorage.js", () => ({
  objectStorageClient: {},
  ObjectNotFoundError: class extends Error {},
}));
vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(async () => ({})),
  getStripeSync: vi.fn(),
}));
vi.mock("stripe-replit-sync", () => ({ runMigrations: vi.fn(async () => {}) }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const CONV_ID = "aaaa0000-0000-0000-0000-000000000000";
const MSG_ID = "bbbb0000-0000-0000-0000-000000000000";
const JOB_ID = "cccc0000-0000-0000-0000-000000000000";

// Set SESSION_SECRET before auth module is loaded (auth.ts reads it at module init)
process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long-for-jwt!!";

function tok(userId = USER_ID): string {
  return signToken({ userId, email: "test@example.com" });
}

function makeConv(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID, userId: USER_ID, title: "Test", mode: "learn",
    certificationId: null, isArchived: false, messageCount: 2,
    lastMessageAt: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MSG_ID, conversationId: CONV_ID, role: "user", messageType: "text",
    content: "Hello Sarah", status: "delivered", sarahJobId: null,
    structuredData: null, attachmentIds: null, createdAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID, userId: USER_ID, conversationId: CONV_ID,
    requestType: "message.received", status: "failed", idempotencyKey: "ik-1",
    correlationId: "corr-1", attemptCount: 1,
    inputPayload: { messageId: MSG_ID, content: "Hello Sarah" },
    outputPayload: null, errorCode: null, errorMessage: "Timeout",
    startedAt: new Date(), completedAt: new Date(), createdAt: new Date(),
    ...overrides,
  };
}

// ── App builder ───────────────────────────────────────────────────────────────

let app: Express;

/** Minimal pino-like logger stub so req.log.info/error/warn never throws */
const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, child: () => stubLog };

async function buildApp(): Promise<Express> {
  const a = express();
  a.use(express.json());

  // Inject req.log so routes that call req.log.info() don't throw on undefined
  a.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).log = stubLog;
    next();
  });

  const { default: conv } = await import("../routes/conversations.js");
  const { default: sarah } = await import("../routes/sarah.js");
  a.use("/api", conv);
  a.use("/api", sarah);

  // Catch-all error handler so unhandled errors return a controlled 500 JSON
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : "Internal error";
    res.status(500).json({ error: msg });
  });

  return a;
}

// ── Helpers to reset mocked DB chains ────────────────────────────────────────

function setupUpdateChain(rows: unknown[] = []) {
  const returning = vi.fn(async () => rows);
  const where = vi.fn(() => ({ returning, execute: vi.fn(async () => rows) }));
  mockUpdateChain.set.mockReturnValue({ where });
}

function setupDeleteChain(rows: unknown[] = []) {
  const returning = vi.fn(async () => rows);
  mockDeleteChain.where.mockResolvedValue(rows);
  // Also support .returning() after .where()
  mockDeleteChain.where.mockReturnValue({ returning, execute: vi.fn(async () => rows) });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Sarah integration — Phase 21 requirements", () => {
  beforeEach(async () => {
    dbCallIdx = 0;
    dbCallQueue = [];
    vi.clearAllMocks();

    // Re-set implementations after clearAllMocks (clearAllMocks only clears
    // call history, not implementations — but mock chains are rebuilt here
    // to make each test self-contained).
    mockDispatch.mockResolvedValue(undefined);
    mockInitConversation.mockResolvedValue(undefined);
    mockSarahHealth.mockResolvedValue({ status: "healthy", latencyMs: 30 });
    resetInferenceStatus();

    // Default: insert returns a conversation row
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeConv()]) });

    // Default update and delete chains
    setupUpdateChain([]);
    setupDeleteChain([{ id: CONV_ID }]);

    app = await buildApp();
  });

  // ── REQ 1: Tunnel configuration error → async failure, not sync 500 ────────

  it("REQ-1: tunnel dispatch failure after message send does not prevent 201 response", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("Sarah tunnel credentials are not configured"));
    dbCallQueue = [[makeConv()], []];
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeMessage()]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeJob()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Hello" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("jobId");
  });

  // ── REQ 2: Health endpoint reports unavailable ─────────────────────────────

  it("REQ-2: health endpoint returns unavailable when Hermes is unreachable", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "unavailable", message: "Cannot reach tunnel" });

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("unavailable");
  });

  // ── REQ 3: Health requires auth ───────────────────────────────────────────

  it("REQ-3: health endpoint requires authentication", async () => {
    const res = await request(app).get("/api/sarah/health");
    expect(res.status).toBe(401);
  });

  // ── REQ 4: No auth token → 401 ────────────────────────────────────────────

  it("REQ-4: sending a message without Bearer token returns 401", async () => {
    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .send({ content: "Hello" });
    expect(res.status).toBe(401);
  });

  // ── REQ 5: Expired / invalid JWT ─────────────────────────────────────────

  it("REQ-5: expired or garbage JWT is rejected with 401", async () => {
    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", "Bearer this.is.invalid")
      .send({ content: "Hello" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  // ── REQ 6: Missing Bearer scheme ─────────────────────────────────────────

  it("REQ-6: auth header without Bearer scheme returns 401", async () => {
    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", tok()); // no "Bearer " prefix
    expect(res.status).toBe(401);
  });

  // ── REQ 7: Successful conversation creation ───────────────────────────────

  it("REQ-7: POST /conversations returns 201 with conversation object", async () => {
    const newConv = makeConv({ id: "new-conv-1234" });
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [newConv]) });

    const res = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ mode: "learn", title: "Study Session" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("conversation");
    expect(res.body.conversation).toHaveProperty("id", "new-conv-1234");
  });

  // ── REQ 8: Duplicate conversation requests create separate rows ────────────

  it("REQ-8: two POST /conversations calls produce distinct IDs", async () => {
    const conv1 = makeConv({ id: "conv-aaa" });
    const conv2 = makeConv({ id: "conv-bbb" });
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [conv1]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [conv2]) });

    const r1 = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ mode: "learn" });
    const r2 = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ mode: "learn" });

    expect(r1.body.conversation.id).not.toBe(r2.body.conversation.id);
  });

  // ── REQ 9: Successful first-message flow ─────────────────────────────────

  it("REQ-9: POST /conversations/:id/messages returns 201 with userMessage and jobId", async () => {
    dbCallQueue = [[makeConv()], []];
    const userMsg = makeMessage();
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [userMsg]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeJob()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Hello Sarah" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("userMessage");
    expect(res.body).toHaveProperty("jobId");
    expect(res.body.sarahMessage).toBeNull();
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  // ── REQ 10: Failed dispatch preserves user message in response ────────────

  it("REQ-10: user message is included in response even when Sarah dispatch will fail", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("Hermes timeout"));
    dbCallQueue = [[makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Test" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("userMessage");
    expect(res.body.userMessage).toHaveProperty("content");
  });

  // ── REQ 11: Dispatch called with correct arguments ─────────────────────────

  it("REQ-11: dispatchSarahMessage receives userId, conversationId, and content", async () => {
    dbCallQueue = [[makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage({ content: "Test message" })]) });

    await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Test message" });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        conversationId: CONV_ID,
        content: "Test message",
      }),
    );
  });

  // ── REQ 12: Each message creates a separate job ───────────────────────────

  it("REQ-12: two separate messages create distinct jobIds", async () => {
    dbCallQueue = [[makeConv()], [], [makeConv()], []];
    const msg1 = makeMessage({ id: "msg-1" });
    const msg2 = makeMessage({ id: "msg-2" });
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [msg1]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeJob({ id: "job-1" })]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [msg2]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeJob({ id: "job-2" })]) });

    const r1 = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "First" });
    const r2 = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Second" });

    expect(r1.body.jobId).not.toBe(r2.body.jobId);
  });

  // ── REQ 13: Health distinguishes degraded from unavailable ────────────────

  it("REQ-13: health endpoint returns degraded when Hermes is slow", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "degraded", latencyMs: 7000, message: "HTTP 429" });

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("degraded");
    expect(res.body).toHaveProperty("latencyMs");
  });

  // ── REQ 14: POST /messages/:id/retry creates job and dispatches ──────────

  it("REQ-14: POST /messages/:id/retry returns 200 and triggers dispatch", async () => {
    dbCallQueue = [
      [makeMessage({ role: "user" })],  // load message
      [makeConv()],                      // verify ownership
      [], [],                            // cert / exam queries
      [],                                // recentMessages
      [],                                // attachments
    ];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeJob()]) });

    const res = await request(app)
      .post(`/api/messages/${MSG_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("jobId");
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  // ── REQ 15: Retry reuses original messageId, not a new message ───────────

  it("REQ-15: retry dispatch receives the original messageId, not a new one", async () => {
    dbCallQueue = [
      [makeMessage({ role: "user", id: MSG_ID })],
      [makeConv()],
      [], [],
      [],
      [],
    ];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeJob()]) });

    await request(app)
      .post(`/api/messages/${MSG_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: MSG_ID }),
    );
  });

  // ── REQ 16: Dispatch called even for simple messages ─────────────────────

  it("REQ-16: dispatchSarahMessage is always called for a valid message", async () => {
    dbCallQueue = [[makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Any message" });

    expect(res.status).toBe(201);
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  // ── REQ 17: Empty content rejected before dispatch ─────────────────────────

  it("REQ-17: empty message content is rejected with 4xx before dispatch", async () => {
    dbCallQueue = [[makeConv()]];
    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "" });

    expect([400, 422]).toContain(res.status);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── REQ 18: Health endpoint always includes provider field ─────────────────

  it("REQ-18: health response includes provider field", async () => {
    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body).toHaveProperty("provider");
    expect(typeof res.body.provider).toBe("string");
  });

  // ── REQ 19: Retry of non-failed job returns 400 ───────────────────────────

  it("REQ-19: job retry returns 400 when job is not in failed state", async () => {
    dbCallQueue = [[makeJob({ status: "completed" })]];

    const res = await request(app)
      .post(`/api/sarah/jobs/${JOB_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failed/i);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── REQ 20: Job with missing payload returns 400 ──────────────────────────

  it("REQ-20: job retry with missing message payload returns 400", async () => {
    dbCallQueue = [[makeJob({ status: "failed", inputPayload: null })]];

    const res = await request(app)
      .post(`/api/sarah/jobs/${JOB_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payload/i);
  });

  // ── REQ 21: Cannot access another user's conversation messages ────────────

  it("REQ-21: GET /conversations/:id/messages returns 404 for wrong userId", async () => {
    dbCallQueue = [[]]; // conv not found for this user

    const res = await request(app)
      .get(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`);

    expect([403, 404]).toContain(res.status);
  });

  // ── REQ 22: Cannot send message to another user's conversation ────────────

  it("REQ-22: POST /conversations/:id/messages returns 404 for wrong userId", async () => {
    dbCallQueue = [[]]; // conv not found for this user

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`)
      .send({ content: "Hack" });

    expect([403, 404]).toContain(res.status);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── REQ 23: New conversation creation succeeds after prior failure ─────────

  it("REQ-23: POST /conversations works regardless of prior dispatch failures", async () => {
    mockDispatch.mockRejectedValue(new Error("Sarah down"));
    const fresh = makeConv({ id: "after-failure-id" });
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [fresh]) });

    const res = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ mode: "learn" });

    expect(res.status).toBe(201);
    expect(res.body.conversation.id).toBe("after-failure-id");
  });

  // ── REQ 24: GET /conversations requires auth ──────────────────────────────

  it("REQ-24: GET /conversations requires authentication", async () => {
    const res = await request(app).get("/api/conversations");
    expect(res.status).toBe(401);
  });

  // ── REQ 25: Attachment with wrong userId rejected ─────────────────────────

  it("REQ-25: attachment IDs not belonging to this user are rejected", async () => {
    dbCallQueue = [
      [makeConv()], // fetch conversation
      [],            // recentMessages
      [],            // attachment lookup — empty (not found for this user)
    ];

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        content: "See my image",
        attachmentIds: ["ffffffff-ffff-ffff-ffff-ffffffffffff"],
      });

    // Attachment not found for this user → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found|does not belong/i);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── REQ 26: Non-UUID attachment IDs stripped silently ─────────────────────

  it("REQ-26: malformed (non-UUID) attachment IDs are stripped, message proceeds", async () => {
    dbCallQueue = [[makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Test", attachmentIds: ["../../etc/passwd"] });

    // Non-UUID values are silently ignored; message proceeds without attachments
    expect(res.status).toBe(201);
  });

  // ── REQ 27: More than 5 attachment IDs silently capped ────────────────────

  it("REQ-27: more than 5 attachment IDs are silently stripped", async () => {
    dbCallQueue = [[makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage()]) });

    const makeUUID = (n: number) =>
      `${n.toString().padStart(8, "0")}-0000-0000-0000-000000000000`;

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Too many", attachmentIds: [1, 2, 3, 4, 5, 6].map(makeUUID) });

    // 6 IDs exceeds limit of 5 → stripped, message still processes
    expect(res.status).toBe(201);
  });

  // ── REQ 28: Unauthenticated requests get 401, not 429 ────────────────────

  it("REQ-28: unauthenticated requests return 401", async () => {
    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .send({ content: "No auth" });
    expect(res.status).toBe(401);
  });

  // ── REQ 29: Degraded health state reported correctly ─────────────────────

  it("REQ-29: health returns degraded when Hermes is responding slowly", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "degraded", latencyMs: 8500, message: "HTTP 503" });

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("degraded");
  });

  // ── REQ 30: Healthy state reported after recovery ─────────────────────────

  it("REQ-30: health returns healthy when Hermes is reachable", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "healthy", latencyMs: 45 });

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("healthy");
    expect(res.body.latencyMs).toBe(45);
  });

  // ── REQ 31: Startup validation — health is auth-gated ────────────────────

  it("REQ-31: health endpoint is gated behind authentication", async () => {
    const res = await request(app).get("/api/sarah/health");
    expect(res.status).toBe(401);
  });

  // ── REQ 32: No secrets in error responses ────────────────────────────────

  it("REQ-32: error responses do not expose secrets or stack traces", async () => {
    dbCallQueue = [[]]; // conv not found

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Test" });

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/SARAH_API_KEY|SARAH_SIGNING_SECRET|SESSION_SECRET/);
    expect(body).not.toMatch(/at Object\.|at async |at Module\./);
  });

  // ── REQ 33: Each dispatch call has a unique jobId ─────────────────────────

  it("REQ-33: two message sends produce distinct jobIds in dispatch calls", async () => {
    dbCallQueue = [[makeConv()], [], [makeConv()], []];
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [makeMessage()]) });

    await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "First" });
    await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Second" });

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    const job1 = (mockDispatch.mock.calls[0][0] as { jobId: string }).jobId;
    const job2 = (mockDispatch.mock.calls[1][0] as { jobId: string }).jobId;
    expect(job1).not.toBe(job2);
  });

  // ── REQ 34: Not found returns 404, not 500 ───────────────────────────────

  it("REQ-34: GET /conversations/:id/messages returns 404 when conv not found", async () => {
    dbCallQueue = [[]];

    const res = await request(app)
      .get(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(404);
  });

  // ── REQ 35: initSarahConversation called on creation ─────────────────────

  it("REQ-35: initSarahConversation is called with userId and mode on creation", async () => {
    const newConv = makeConv({ mode: "practice" });
    mockInsertValues.mockReturnValue({ returning: vi.fn(async () => [newConv]) });

    await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ mode: "practice" });

    expect(mockInitConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        mode: "practice",
      }),
    );
  });

  // ── REQ 36: PATCH is tenant-isolated ─────────────────────────────────────

  it("REQ-36: PATCH /conversations/:id returns 404 for another user's conversation", async () => {
    dbCallQueue = [[]]; // empty → not found for this user

    const res = await request(app)
      .patch(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`)
      .send({ title: "New title" });

    expect(res.status).toBe(404);
  });

  // ── Additional security invariants ────────────────────────────────────────

  it("SEC-1: job retry returns 404 when job belongs to another user", async () => {
    dbCallQueue = [[]]; // no job found

    const res = await request(app)
      .post(`/api/sarah/jobs/${JOB_ID}/retry`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`);

    expect(res.status).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("SEC-2: GET /sarah/jobs/:id requires authentication", async () => {
    const res = await request(app).get(`/api/sarah/jobs/${JOB_ID}`);
    expect(res.status).toBe(401);
  });

  it("SEC-3: GET /sarah/jobs/:id scoped by userId", async () => {
    dbCallQueue = [[]]; // not found for this user

    const res = await request(app)
      .get(`/api/sarah/jobs/${JOB_ID}`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`);

    expect(res.status).toBe(404);
  });

  it("SEC-4: retrying an assistant message is rejected", async () => {
    dbCallQueue = [
      [makeMessage({ role: "assistant" })],
      [makeConv()],
    ];

    const res = await request(app)
      .post(`/api/messages/${MSG_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user messages/i);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("SEC-5: DELETE /conversations/:id scoped by userId", async () => {
    // delete chain returns empty (0 rows deleted — wrong userId in WHERE)
    setupDeleteChain([]);

    const res = await request(app)
      .delete(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`);

    expect(res.status).toBe(404);
  });

  it("SEC-6: job retry without conversationId returns 400", async () => {
    dbCallQueue = [[makeJob({ status: "failed", conversationId: null })]];

    const res = await request(app)
      .post(`/api/sarah/jobs/${JOB_ID}/retry`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("SEC-7: message retry returns 403 when conversation belongs to another user", async () => {
    dbCallQueue = [
      [makeMessage({ role: "user" })], // message found
      [],                               // conv NOT found for this user
    ];

    const res = await request(app)
      .post(`/api/messages/${MSG_ID}/retry`)
      .set("Authorization", `Bearer ${tok(OTHER_USER_ID)}`);

    expect(res.status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── Cloudflare Tunnel 530 regression ─────────────────────────────────────
  // These tests guard against the production failure mode where the Hermes
  // cloudflared tunnel (Cloudflare error code 1033) is offline and every call
  // returns HTTP 530.  Dispatch must be async (201 before Hermes is contacted),
  // the job row must still be created, and unauthenticated requests must be
  // blocked before dispatch is attempted.

  it("530-REG-1: Cloudflare 530 → message route still returns 201 (dispatch is async)", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("Sarah service error: 530"));
    dbCallQueue = [[makeConv()], []];
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeMessage()]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeJob()]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Hello" });

    // Route should still 201 — dispatch is fire-and-forget
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("jobId");
    expect(res.body.sarahMessage).toBeNull();
  });

  it("530-REG-2: dispatch error does not prevent job row creation", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("Sarah service error: 530"));
    dbCallQueue = [[makeConv()], []];

    const jobRow = makeJob({ errorMessage: "Sarah service error: 530", status: "failed" });
    mockInsertValues
      .mockReturnValueOnce({ returning: vi.fn(async () => [makeMessage()]) })
      .mockReturnValueOnce({ returning: vi.fn(async () => [jobRow]) });

    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ content: "Test" });

    // Job ID returned so frontend can poll for status
    expect(res.status).toBe(201);
    const { jobId } = res.body;
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
  });

  it("530-REG-3: unauthenticated request is rejected before dispatch is attempted", async () => {
    const res = await request(app)
      .post(`/api/conversations/${CONV_ID}/messages`)
      .send({ content: "Hello" });
    // 401 before any dispatch
    expect(res.status).toBe(401);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ── Inference status unit tests ───────────────────────────────────────────────

describe("inferenceStatus — unit", () => {
  beforeEach(() => {
    resetInferenceStatus();
  });

  it("IS-1: fresh state returns unknown code, no timestamps", () => {
    const s = getInferenceStatus();
    expect(s.ok).toBe(true);
    expect(s.code).toBe("unknown");
    expect(s.lastSuccessAt).toBeNull();
    expect(s.lastFailureAt).toBeNull();
  });

  it("IS-2: after recordInferenceSuccess, status is ok", () => {
    recordInferenceSuccess();
    const s = getInferenceStatus();
    expect(s.ok).toBe(true);
    expect(s.code).toBe("ok");
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.lastFailureAt).toBeNull();
  });

  it("IS-3: after recordInferenceFailure credits_exhausted, status is degraded", () => {
    recordInferenceFailure("credits_exhausted", "LLM provider returned 403");
    const s = getInferenceStatus();
    expect(s.ok).toBe(false);
    expect(s.code).toBe("credits_exhausted");
    expect(s.lastFailureAt).not.toBeNull();
    expect(s.detail).toContain("403");
  });

  it("IS-4: after recordInferenceFailure provider_error, status is degraded", () => {
    recordInferenceFailure("provider_error", "Upstream returned HTTP 500");
    const s = getInferenceStatus();
    expect(s.ok).toBe(false);
    expect(s.code).toBe("provider_error");
  });

  it("IS-5: success after failure clears degraded state", () => {
    recordInferenceFailure("credits_exhausted", "billing");
    recordInferenceSuccess();
    const s = getInferenceStatus();
    expect(s.ok).toBe(true);
    expect(s.code).toBe("ok");
    expect(s.lastSuccessAt).not.toBeNull();
    // lastFailureAt is null because failure was cleared by success
    expect(s.lastFailureAt).toBeNull();
  });

  it("IS-6: failure after success marks degraded, preserves lastSuccessAt", () => {
    recordInferenceSuccess();
    recordInferenceFailure("credits_exhausted", "billing error");
    const s = getInferenceStatus();
    expect(s.ok).toBe(false);
    expect(s.code).toBe("credits_exhausted");
    expect(s.lastSuccessAt).not.toBeNull();   // still recorded
    expect(s.lastFailureAt).not.toBeNull();
  });

  it("IS-7: isBillingError detects LLM credits-exhausted pattern", () => {
    const billingMsg = 'HTTP 403: {"code":"permission-denied","error":"Your team has either used all available credits or reached its monthly spending limit."}';
    expect(isBillingError(billingMsg)).toBe(true);
  });

  it("IS-8: isBillingError does not match normal AI response content", () => {
    expect(isBillingError("Welcome! I'm Sarah, your cert prep specialist.")).toBe(false);
    expect(isBillingError("")).toBe(false);
    expect(isBillingError("HTTP 500: internal server error")).toBe(false);
  });

  it("IS-9: isProviderError matches non-billing HTTP error content", () => {
    expect(isProviderError("HTTP 500: internal server error")).toBe(true);
    // billing errors are NOT generic provider errors
    expect(isProviderError('HTTP 403: {"code":"permission-denied","error":"credits reached"}')).toBe(false);
    // real AI response not a provider error
    expect(isProviderError("Let me help you study for the CSCS exam.")).toBe(false);
  });

});

// ── Health endpoint inference status integration tests ────────────────────────

describe("Sarah health endpoint — inference status integration", () => {
  let app: Express;
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, child: () => stubLog };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetInferenceStatus();
    mockSarahHealth.mockResolvedValue({ status: "healthy", latencyMs: 50 });

    const a = express();
    a.use(express.json());
    a.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).log = stubLog;
      next();
    });
    const { default: sarahRouter } = await import("../routes/sarah.js");
    a.use("/api", sarahRouter);
    app = a;
  });

  it("HI-1: fresh start returns healthy with inference.status unknown", async () => {
    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.inference).toMatchObject({
      status: "unknown",
      lastSuccessAt: null,
      lastFailureAt: null,
    });
  });

  it("HI-2: after billing failure, composite status becomes degraded", async () => {
    recordInferenceFailure("credits_exhausted", "LLM 403 billing");

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.inference.status).toBe("credits_exhausted");
    expect(res.body.inference.lastFailureAt).not.toBeNull();
    expect(res.body.inference.detail).toContain("billing");
  });

  it("HI-3: after provider error, composite status becomes degraded", async () => {
    recordInferenceFailure("provider_error", "upstream 500");

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("degraded");
    expect(res.body.inference.status).toBe("provider_error");
  });

  it("HI-4: after successful inference, composite status is healthy", async () => {
    recordInferenceSuccess();

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("healthy");
    expect(res.body.inference.status).toBe("ok");
    expect(res.body.inference.lastSuccessAt).not.toBeNull();
  });

  it("HI-5: Hermes unavailable takes precedence over inference status", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "unavailable", message: "Cannot reach tunnel" });
    recordInferenceSuccess(); // inference was ok last time

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    // Hermes unavailable → composite is unavailable regardless of inference
    expect(res.body.status).toBe("unavailable");
    expect(res.body.inference.status).toBe("ok"); // still shows last known inference
  });

  it("HI-6: degraded Hermes response is preserved even with ok inference", async () => {
    mockSarahHealth.mockResolvedValueOnce({ status: "degraded", latencyMs: 9000, message: "HTTP 503" });
    recordInferenceSuccess();

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.status).toBe("degraded");
    expect(res.body.inference.status).toBe("ok");
  });

  it("HI-7: health endpoint still requires authentication", async () => {
    const res = await request(app).get("/api/sarah/health");
    expect(res.status).toBe(401);
  });

  it("530-REG-4: health endpoint reports degraded when Hermes returns HTTP 530", async () => {
    mockSarahHealth.mockResolvedValueOnce({
      status: "degraded",
      latencyMs: undefined,
      message: "HTTP 530",
    });

    const res = await request(app)
      .get("/api/sarah/health")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
  });
});
