import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

const sarahMocks = vi.hoisted(() => ({
  startStudyMode: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}));

vi.mock("@workspace/db", () => {
  const conversationsTable = {
    id: "conversations.id",
    userId: "conversations.userId",
  };

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => []),
      })),
      insert: dbMocks.insert,
      update: dbMocks.update,
      transaction: dbMocks.transaction,
    },
    conversationsTable,
    messagesTable: {},
    practiceAttemptsTable: {},
    practiceQuestionsTable: {},
    progressEventsTable: {},
    studySessionsTable: {},
    topicMasteryTable: {},
  };
});

vi.mock("../lib/auth.js", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "attacker-user-id";
    next();
  },
}));

vi.mock("../lib/sarah/index.js", () => ({
  sarah: sarahMocks,
}));

const CONVERSATION_ID = "6c69fb10-cdb3-4da6-a264-c711c42ced8e";
const QUESTION_ID = "7aec1092-882f-45a2-9705-38f428c40e18";

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { default: practiceRouter } = await import("../routes/practice.js");
  app.use("/api", practiceRouter);
  return app;
}

describe("practice conversation ownership", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("rejects starting study mode for another user's conversation before mutation", async () => {
    const response = await request(app)
      .post("/api/study-modes/start")
      .send({ conversationId: CONVERSATION_ID, mode: "practice" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Conversation not found" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
    expect(sarahMocks.startStudyMode).not.toHaveBeenCalled();
  });

  it("rejects an answer linked to another user's conversation before processing", async () => {
    const response = await request(app)
      .post(`/api/practice/${QUESTION_ID}/answer`)
      .send({ selectedOptionId: "a", conversationId: CONVERSATION_ID });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Conversation not found" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(sarahMocks.submitAnswer).not.toHaveBeenCalled();
  });
});
