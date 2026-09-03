import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateMockExamBody } from "@workspace/api-zod";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  startMockExam: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((column, value) => ({ column, value })),
}));

vi.mock("@workspace/db", () => {
  const mockExamsTable = { id: "exams.id", userId: "exams.userId" };
  const mockExamQuestionsTable = { examId: "questions.examId" };
  const certificationsTable = { id: "certifications.id" };

  return {
    db: {
      select: vi.fn(() => {
        const result = mocks.selectResults.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.limit = vi.fn(async () => result);
        chain.then = (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(result).then(resolve);
        return chain;
      }),
      insert: mocks.insert,
      update: vi.fn(),
      delete: mocks.delete,
    },
    mockExamsTable,
    mockExamQuestionsTable,
    certificationsTable,
    progressEventsTable: {},
  };
});

vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = String(req.headers["x-test-user"] ?? "exam-user");
    next();
  },
}));

vi.mock("../lib/sarah/index.js", () => ({
  sarah: {
    startMockExam: mocks.startMockExam,
    gradeMockExam: vi.fn(),
  },
}));

function generatedQuestion(questionNumber: number) {
  return {
    questionNumber,
    domain: "Security",
    prompt: `Question ${questionNumber}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctOptionId: "a",
    explanation: "Because A is correct.",
  };
}

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() } as never;
    next();
  });
  const { default: router } = await import("../routes/mockExams.js");
  app.use("/api", router);
  return app;
}

function arrangeSuccessfulGeneration(questionCount = 10) {
  mocks.selectResults.push(
    [{ id: "cert-1", name: "Security+" }],
    Array.from({ length: questionCount }, (_, index) => ({
      id: `question-${index + 1}`,
      questionNumber: index + 1,
      prompt: `Question ${index + 1}`,
      domain: "Security",
      options: [],
      selectedOptionId: null,
      flagged: false,
    })),
  );
}

describe("mock exam generation bounds", () => {
  it.each([9, 101, 10.5])("rejects an unsafe question count of %s", (questionCount) => {
    expect(
      CreateMockExamBody.safeParse({ certificationId: "cert-1", questionCount })
        .success,
    ).toBe(false);
  });

  it.each([4, 481, 30.5])("rejects an unsafe time limit of %s", (timeLimitMinutes) => {
    expect(
      CreateMockExamBody.safeParse({
        certificationId: "cert-1",
        questionCount: 10,
        timeLimitMinutes,
      }).success,
    ).toBe(false);
  });
});

describe("mock exam generation rate limit", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.startMockExam.mockResolvedValue({
      questions: Array.from({ length: 10 }, (_, index) =>
        generatedQuestion(index + 1),
      ),
    });
    mocks.insert.mockImplementation((table) => ({
      values: vi.fn(() => {
        const result =
          table && "userId" in table
            ? [{ id: `exam-${Math.random()}`, status: "in_progress" }]
            : [];
        return {
          returning: vi.fn(async () => result),
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(result).then(resolve),
        };
      }),
    }));
    mocks.delete.mockReturnValue({ where: vi.fn(async () => []) });
    app = await buildApp();
  });

  it("allows three generations per account per hour and rejects the fourth", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      arrangeSuccessfulGeneration();
      const response = await request(app)
        .post("/api/mock-exams")
        .set("x-test-user", "rate-limited-user")
        .send({ certificationId: "cert-1", questionCount: 10 });
      expect(response.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/mock-exams")
      .set("x-test-user", "rate-limited-user")
      .send({ certificationId: "cert-1", questionCount: 10 });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "Mock exam generation limit reached. Please try again later.",
    });
    expect(mocks.startMockExam).toHaveBeenCalledTimes(3);
  });

  it("removes the incomplete exam when Sarah returns too few questions", async () => {
    mocks.selectResults.push([{ id: "cert-1", name: "Security+" }]);
    mocks.startMockExam.mockResolvedValue({
      questions: [generatedQuestion(1)],
    });

    const response = await request(app)
      .post("/api/mock-exams")
      .set("x-test-user", "incomplete-result-user")
      .send({ certificationId: "cert-1", questionCount: 10 });

    expect(response.status).toBe(502);
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
});
