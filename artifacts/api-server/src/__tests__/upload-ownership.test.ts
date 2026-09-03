import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  selectResult: [] as unknown[],
  unlink: vi.fn((_path: string, callback: () => void) => callback()),
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}));

vi.mock("multer", () => {
  class MulterError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  const multer = vi.fn(() => ({
    single: vi.fn(() => (req: express.Request, _res: express.Response, callback: (error?: Error) => void) => {
      req.file = {
        fieldname: "file",
        originalname: "notes.txt",
        encoding: "7bit",
        mimetype: "text/plain",
        size: 5,
        destination: "/tmp",
        filename: "fake-upload.txt",
        path: "/tmp/fake-upload.txt",
        buffer: Buffer.from("notes"),
        stream: undefined as never,
      };
      callback();
    }),
  }));

  return {
    default: Object.assign(multer, {
      diskStorage: vi.fn(() => ({})),
      MulterError,
    }),
  };
});

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    unlink: mocks.unlink,
    createReadStream: vi.fn(),
    promises: {
      readFile: vi.fn(async () => Buffer.from("notes")),
      chmod: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => mocks.selectResult),
    })),
    insert: mocks.insert,
    delete: vi.fn(),
  },
  conversationsTable: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  uploadsTable: {
    id: "uploads.id",
    userId: "uploads.userId",
  },
}));

vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = "attacker-user-id";
    next();
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../lib/uploadInspection.js", () => ({
  inspectUploadedFile: vi.fn(async () => undefined),
  UploadInspectionError: class UploadInspectionError extends Error {},
}));

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { default: uploadsRouter } = await import("../routes/uploads.js");
  app.use("/api", uploadsRouter);
  return app;
}

describe("upload conversation ownership", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.selectResult = [];
    mocks.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          {
            id: "upload-123",
            userId: "attacker-user-id",
            conversationId: null,
          },
        ]),
      })),
    });
    app = await buildApp();
  });

  it("rejects linking an upload to another user's conversation", async () => {
    const response = await request(app).post("/api/uploads").send({
      conversationId: "6c69fb10-cdb3-4da6-a264-c711c42ced8e",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Conversation not found" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith(
      "conversations.userId",
      "attacker-user-id",
    );
    expect(mocks.unlink).toHaveBeenCalledWith(
      "/tmp/fake-upload.txt",
      expect.any(Function),
    );
  });

  it("allows linking an upload when the authenticated user owns the conversation", async () => {
    mocks.selectResult = [
      { id: "6c69fb10-cdb3-4da6-a264-c711c42ced8e" },
    ];

    const response = await request(app).post("/api/uploads").send({
      conversationId: "6c69fb10-cdb3-4da6-a264-c711c42ced8e",
    });

    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
