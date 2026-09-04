/**
 * Regression tests for three defects found by auditing a real account end to end
 * against production on 2026-09-03.
 *
 *   DEG-*  A degraded Sarah response was persisted as a normal assistant turn.
 *          Sarah answers HTTP 200 with a canned reply and metadata.degraded=true
 *          when her runtime fails.  The learner waited 63.1s and was shown text
 *          that reads like tutoring but teaches nothing.
 *
 *   CTX-*  context.topicMastery / recentAnswers / studyPlan were hardcoded to
 *          [] / [] / null on every dispatch, so Sarah could not know what the
 *          learner is weak in, got wrong, or was already told to do.
 *
 *   OPEN-* The opening greeting raced the learner's first message and lost,
 *          landing underneath it and asking for facts already supplied.
 *
 * These call dispatchSarahMessage() and initSarahConversation() directly.  The
 * DB mock is keyed by table rather than by call order, so the three context
 * queries can run in parallel without the assertions depending on their order.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetForTesting as resetInferenceStatus } from "../lib/sarah/inferenceStatus.js";

// ── drizzle-orm ───────────────────────────────────────────────────────────────
// Operators only need to be callable; the DB mock never inspects them.

vi.mock("drizzle-orm", () => {
  const noop = vi.fn(() => ({}));
  return {
    eq: noop, and: noop, or: noop, not: noop,
    desc: noop, asc: noop,
    inArray: noop, notInArray: noop,
    isNull: noop, isNotNull: noop,
    gt: noop, gte: noop, lt: noop, lte: noop, ne: noop,
    like: noop, ilike: noop, between: noop,
    sql: vi.fn(() => ({})),
    count: noop, sum: noop, avg: noop, min: noop, max: noop,
  };
});

// ── @workspace/db ─────────────────────────────────────────────────────────────

const TABLES = {
  conversationsTable: { __table: "conversations", id: "id", messageCount: "messageCount", lastMessageAt: "lastMessageAt", updatedAt: "updatedAt" },
  messagesTable: { __table: "messages", id: "id", conversationId: "conversationId", createdAt: "createdAt" },
  sarahJobsTable: { __table: "sarah_jobs", id: "id" },
  uploadsTable: { __table: "uploads", id: "id" },
  certificationsTable: { __table: "certifications", id: "id", name: "name" },
  userCertificationsTable: { __table: "user_certifications", userId: "userId" },
  topicMasteryTable: { __table: "topic_mastery", userId: "userId", certificationId: "certificationId", domain: "domain", masteryScore: "masteryScore" },
  practiceAttemptsTable: { __table: "practice_attempts", userId: "userId", questionId: "questionId", correct: "correct", createdAt: "createdAt" },
  practiceQuestionsTable: { __table: "practice_questions", id: "id", certificationId: "certificationId", domain: "domain" },
  studyPlansTable: { __table: "study_plans", userId: "userId", certificationId: "certificationId", status: "status", updatedAt: "updatedAt", examDate: "examDate", weeklyHoursAvailable: "weeklyHoursAvailable", weakDomains: "weakDomains", strongDomains: "strongDomains", milestones: "milestones" },
};

/** Rows each table returns, keyed by the table's marker name. */
let rowsByTable: Record<string, unknown[]> = {};
/** Tables whose SELECT should throw, to exercise the best-effort path. */
let throwingTables = new Set<string>();

const insertedRows: Array<Record<string, unknown>> = [];
const updatedSets: Array<Record<string, unknown>> = [];

/**
 * A thenable query builder: every drizzle chaining method returns itself, and
 * awaiting it yields the rows registered for whichever table `.from()` got.
 */
function makeSelectChain() {
  let table: string | null = null;

  const resolve = (): Promise<unknown[]> => {
    if (table && throwingTables.has(table)) {
      return Promise.reject(new Error(`simulated query failure: ${table}`));
    }
    return Promise.resolve(table ? (rowsByTable[table] ?? []) : []);
  };

  const chain: Record<string, unknown> = {
    from: vi.fn((t: { __table?: string }) => { table = t?.__table ?? null; return chain; }),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    returning: vi.fn(() => resolve()),
    then: (onOk: (v: unknown[]) => unknown, onErr?: (e: unknown) => unknown) =>
      resolve().then(onOk, onErr),
    catch: (onErr: (e: unknown) => unknown) => resolve().catch(onErr),
  };
  return chain;
}

function makeDbLike() {
  return {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn((t: { __table?: string }) => ({
      values: vi.fn((row: Record<string, unknown>) => {
        insertedRows.push({ __table: t?.__table, ...row });
        return { returning: vi.fn(async () => [row]) };
      }),
    })),
    update: vi.fn((t: { __table?: string }) => ({
      set: vi.fn((fields: Record<string, unknown>) => {
        updatedSets.push({ __table: t?.__table, ...fields });
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [fields]),
            execute: vi.fn(async () => []),
          })),
        };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
  };
}

vi.mock("@workspace/db", () => {
  const base = makeDbLike();
  return {
    db: {
      ...base,
      // Transactions run the callback against the same recording surface, so a
      // transactional insert is observable exactly like a direct one.
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(makeDbLike())),
    },
    ...TABLES,
  };
});

// ── Sarah service ─────────────────────────────────────────────────────────────

const mockSendMessage = vi.fn();
const mockCreateConversation = vi.fn();

vi.mock("../lib/sarah/index.js", () => ({
  sarah: {
    sendMessage: (...a: unknown[]) => mockSendMessage(...a),
    createConversation: (...a: unknown[]) => mockCreateConversation(...a),
    health: vi.fn(),
  },
}));

vi.mock("../lib/uploads-signing.js", () => ({
  generateSignedUploadUrl: vi.fn(() => "https://example.com/signed"),
  getPublicBaseUrl: vi.fn(() => "https://example.com"),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CONV_ID = "aaaa0000-0000-0000-0000-000000000000";
const MSG_ID = "bbbb0000-0000-0000-0000-000000000000";
const JOB_ID = "cccc0000-0000-0000-0000-00000000dead";
const CERT_ID = "dddd0000-0000-0000-0000-000000000000";

/** The exact shape Sarah returns when her runtime fails (observed in production). */
const CANNED_FALLBACK =
  "Got it. For your certification (learn mode), I’ll treat this as a tutoring turn.\n\n" +
  "I’ll explain the concept at exam depth, flag common distractors, and end with one " +
  "check-for-understanding question.\n\n" +
  "What domain should we anchor this to?";

function dispatchInput(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    correlationId: "corr-1",
    userId: USER_ID,
    conversationId: CONV_ID,
    mode: "learn",
    certificationId: CERT_ID,
    certName: "NSCA Certified Strength and Conditioning Specialist",
    examDate: "2026-11-01",
    messageId: MSG_ID,
    content: "Teach me bioenergetics.",
    recentMessages: [{ role: "user", content: "Teach me bioenergetics." }],
    ...overrides,
  } as Parameters<typeof import("../lib/sarah/dispatch.js").dispatchSarahMessage>[0];
}

const assistantInserts = () =>
  insertedRows.filter((r) => r.__table === "messages" && r.role === "assistant");

beforeEach(() => {
  insertedRows.length = 0;
  updatedSets.length = 0;
  rowsByTable = {};
  throwingTables = new Set();
  vi.clearAllMocks();
  resetInferenceStatus();

  mockSendMessage.mockResolvedValue({
    responseMessages: [{ messageType: "text", content: "Real teaching content.", structuredData: null }],
    jobCompleted: true,
    degraded: false,
  });
  mockCreateConversation.mockResolvedValue({
    conversationId: "remote-conv-id",
    openingMessage: { messageType: "text", content: "Hi, I'm Sarah. Which certification?", structuredData: null },
  });
});

// ── A degraded response must never be presented as teaching ───────────────────

describe("degraded Sarah responses", () => {
  it("DEG-1: a degraded response is stored as an error message, not as a normal turn", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: CANNED_FALLBACK, structuredData: null }],
      jobCompleted: true,
      degraded: true,
    });

    await dispatchSarahMessage(dispatchInput());

    const assistant = assistantInserts();
    expect(assistant).toHaveLength(1);
    expect(assistant[0].messageType).toBe("error");
  });

  it("DEG-2: the canned fallback text never reaches the learner", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: CANNED_FALLBACK, structuredData: null }],
      jobCompleted: true,
      degraded: true,
    });

    await dispatchSarahMessage(dispatchInput());

    const content = String(assistantInserts()[0]?.content ?? "");
    // The specific phrases that made the fallback indistinguishable from tutoring.
    expect(content).not.toContain("tutoring turn");
    expect(content).not.toContain("check-for-understanding");
    expect(content).not.toContain("What domain should we anchor this to");
    expect(content).toContain("could not reach her reasoning engine");
  });

  it("DEG-3: the learner is given a support reference they can retry against", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: CANNED_FALLBACK, structuredData: null }],
      jobCompleted: true,
      degraded: true,
    });

    await dispatchSarahMessage(dispatchInput());

    expect(String(assistantInserts()[0]?.content)).toContain(JOB_ID.slice(-8));
  });

  it("DEG-4: the job records why it degraded so the failure is auditable", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: CANNED_FALLBACK, structuredData: null }],
      jobCompleted: true,
      degraded: true,
    });

    await dispatchSarahMessage(dispatchInput());

    const job = updatedSets.find((u) => u.__table === "sarah_jobs" && u.status === "completed");
    expect(job).toBeDefined();
    expect(job?.errorMessage).toBe("degraded_response");
  });

  it("DEG-5: a healthy response is still delivered normally", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");

    await dispatchSarahMessage(dispatchInput());

    const assistant = assistantInserts();
    expect(assistant).toHaveLength(1);
    expect(assistant[0].messageType).toBe("text");
    expect(assistant[0].content).toBe("Real teaching content.");
  });
});

// ── Learner state has to reach Sarah for her to behave like a tutor ───────────

describe("learner context sent to Sarah", () => {
  beforeEach(() => {
    rowsByTable = {
      topic_mastery: [{ domain: "Program Design", masteryScore: 41 }],
      practice_attempts: [
        { correct: false, domain: "Exercise Science" },
        { correct: true, domain: "Program Design" },
      ],
      study_plans: [{ examDate: "2026-11-01", weeklyHoursAvailable: 5, weakDomains: ["Exercise Science"], strongDomains: [], milestones: null, updatedAt: new Date() }],
    };
  });

  it("CTX-1: topic mastery reaches Sarah instead of an empty array", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");

    await dispatchSarahMessage(dispatchInput());

    const ctx = mockSendMessage.mock.calls[0][0].context;
    expect(ctx.topicMastery).toEqual([{ domain: "Program Design", masteryScore: 41 }]);
  });

  it("CTX-2: recent answers reach Sarah so she can revisit what was missed", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");

    await dispatchSarahMessage(dispatchInput());

    const ctx = mockSendMessage.mock.calls[0][0].context;
    expect(ctx.recentAnswers).toHaveLength(2);
    expect(ctx.recentAnswers).toContainEqual({ correct: false, domain: "Exercise Science" });
  });

  it("CTX-3: the active study plan reaches Sarah instead of null", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");

    await dispatchSarahMessage(dispatchInput());

    const ctx = mockSendMessage.mock.calls[0][0].context;
    expect(ctx.studyPlan).not.toBeNull();
    expect((ctx.studyPlan as Record<string, unknown>).weeklyHoursAvailable).toBe(5);
  });

  it("CTX-4: a context query failure costs context, never the learner's reply", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    throwingTables = new Set(["topic_mastery", "practice_attempts", "study_plans"]);

    await dispatchSarahMessage(dispatchInput());

    const ctx = mockSendMessage.mock.calls[0][0].context;
    expect(ctx.topicMastery).toEqual([]);
    expect(ctx.studyPlan).toBeNull();
    // The reply still lands — degraded context must not become a failed turn.
    expect(assistantInserts()[0]?.content).toBe("Real teaching content.");
  });

  it("CTX-5: with no certification chosen yet, dispatch still succeeds", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");

    await dispatchSarahMessage(dispatchInput({ certificationId: null }));

    const ctx = mockSendMessage.mock.calls[0][0].context;
    expect(ctx.topicMastery).toEqual([]);
    expect(ctx.recentAnswers).toEqual([]);
    expect(ctx.studyPlan).toBeNull();
    expect(assistantInserts()).toHaveLength(1);
  });
});

// ── The greeting must not answer a learner who already spoke ──────────────────

describe("opening greeting race", () => {
  it("OPEN-1: the greeting is stored when the learner has not spoken yet", async () => {
    const { initSarahConversation } = await import("../lib/sarah/dispatch.js");
    rowsByTable = { messages: [] };

    await initSarahConversation({
      userId: USER_ID, conversationId: CONV_ID, certificationId: null,
      certName: null, mode: "learn", correlationId: "corr-open",
    });

    expect(assistantInserts()).toHaveLength(1);
    expect(assistantInserts()[0].content).toContain("Hi, I'm Sarah");
  });

  it("OPEN-2: the greeting is skipped once the learner's message exists", async () => {
    const { initSarahConversation } = await import("../lib/sarah/dispatch.js");
    // The learner typed immediately; their message is already persisted.
    rowsByTable = { messages: [{ id: MSG_ID }] };

    await initSarahConversation({
      userId: USER_ID, conversationId: CONV_ID, certificationId: null,
      certName: null, mode: "learn", correlationId: "corr-open",
    });

    expect(assistantInserts()).toHaveLength(0);
  });

  it("OPEN-3: skipping the greeting does not inflate the conversation message count", async () => {
    const { initSarahConversation } = await import("../lib/sarah/dispatch.js");
    rowsByTable = { messages: [{ id: MSG_ID }] };

    await initSarahConversation({
      userId: USER_ID, conversationId: CONV_ID, certificationId: null,
      certName: null, mode: "learn", correlationId: "corr-open",
    });

    expect(updatedSets.filter((u) => u.__table === "conversations")).toHaveLength(0);
  });
});

// ── A raw upstream error envelope is not tutoring either ─────────────────────

describe("raw provider error envelopes reaching dispatch", () => {
  const OBSERVED =
    'HTTP 403: {"code":"unauthenticated:bad-credentials","error":"The OAuth token is invalid"}';

  it("RAWD-1: an envelope with degraded=false is still stored as an error", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    // Sarah's runtime reported success and put the provider error in the body,
    // which is exactly how this reached a learner in production.
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: OBSERVED, structuredData: null }],
      jobCompleted: true,
      degraded: false,
    });

    await dispatchSarahMessage(dispatchInput());

    const assistant = assistantInserts();
    expect(assistant).toHaveLength(1);
    expect(assistant[0].messageType).toBe("error");
  });

  it("RAWD-2: the learner never sees the provider's error text", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: OBSERVED, structuredData: null }],
      jobCompleted: true,
      degraded: false,
    });

    await dispatchSarahMessage(dispatchInput());

    const content = String(assistantInserts()[0]?.content ?? "");
    expect(content).not.toContain("bad-credentials");
    expect(content).not.toContain("OAuth");
    expect(content).not.toContain("HTTP 403");
    expect(content).toContain("could not reach her reasoning engine");
  });

  it("RAWD-3: a real answer about HTTP status codes is delivered untouched", async () => {
    const { dispatchSarahMessage } = await import("../lib/sarah/dispatch.js");
    const teaching =
      "HTTP 401 versus HTTP 403 is a classic Security+ distractor: 401 is unauthenticated, 403 is unauthorized.";
    mockSendMessage.mockResolvedValue({
      responseMessages: [{ messageType: "text", content: teaching, structuredData: null }],
      jobCompleted: true,
      degraded: false,
    });

    await dispatchSarahMessage(dispatchInput());

    const assistant = assistantInserts();
    expect(assistant[0].messageType).toBe("text");
    expect(assistant[0].content).toBe(teaching);
  });
});
