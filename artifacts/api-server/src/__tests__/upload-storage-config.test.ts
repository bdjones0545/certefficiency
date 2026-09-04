/**
 * Upload storage misconfiguration must be legible.
 *
 * Production refuses to keep uploads on local disk — an autoscale instance's
 * filesystem does not survive a redeploy, so a learner's candidate handbook
 * would silently vanish. That refusal is correct.
 *
 * What was wrong is how it surfaced. persistValidatedUpload threw deep inside
 * the request, after the file had already been received, and the learner saw a
 * bare "Internal server error" while nothing named the cause. Observed live on
 * certefficiency.com: every upload — documents AND images — returned 500 with
 * no indication that PRIVATE_OBJECT_DIR was the problem.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  unlink: vi.fn((_p: string, cb: () => void) => cb()),
  savePrivateUpload: vi.fn(),
  singleHandler: vi.fn(),
}));

vi.mock("multer", () => {
  class MulterError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  }
  const multer = vi.fn(() => ({
    single: vi.fn(() => (req: express.Request, _res: express.Response, cb: (e?: Error) => void) => {
      mocks.singleHandler();
      req.file = {
        // Plain text on purpose: these tests are about the storage guard, not
        // extraction. A PDF fixture would pull in the PDF engine for nothing.
        fieldname: "file", originalname: "handbook.txt", encoding: "7bit",
        mimetype: "text/plain", size: 10, destination: "/tmp",
        filename: "f.txt", path: "/tmp/f.txt",
        buffer: Buffer.from("x"), stream: undefined as never,
      };
      cb();
    }),
  }));
  return { default: Object.assign(multer, { diskStorage: vi.fn(() => ({})), MulterError }) };
});

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true), mkdirSync: vi.fn(), unlink: mocks.unlink,
    createReadStream: vi.fn(),
    promises: { readFile: vi.fn(async () => Buffer.from("x")), chmod: vi.fn(async () => undefined) },
  },
}));

vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    })),
    insert: mocks.insert,
    delete: vi.fn(),
  },
  conversationsTable: { id: "id", userId: "userId" },
  uploadsTable: { id: "id", userId: "userId" },
}));

vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    savePrivateUpload = mocks.savePrivateUpload;
    getObjectEntityFile = vi.fn();
    deleteObjectEntity = vi.fn();
  },
}));

vi.mock("../lib/uploadInspection.js", () => ({
  inspectUploadedFile: vi.fn(async () => undefined),
  UploadInspectionError: class extends Error {},
}));

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { default: uploadsRouter } = await import("../routes/uploads.js");
  app.use("/api", uploadsRouter);
  return app;
}

describe("upload storage misconfiguration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.PRIVATE_OBJECT_DIR;
    mocks.insert.mockReturnValue({
      values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "u1" }]) })),
    });
    mocks.savePrivateUpload.mockResolvedValue("/objects/uploads/f.pdf");
  });

  it("CFG-1: refuses documents with an actionable 503, not an opaque 500", async () => {
    process.env.NODE_ENV = "production";
    const app = await buildApp();

    const res = await request(app).post("/api/uploads");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    // The learner is told it is not their file that is wrong.
    expect(res.body.error).toMatch(/not a problem with your file/i);
  });

  it("CFG-2: refuses images the same way — the outage covered both routes", async () => {
    process.env.NODE_ENV = "production";
    const app = await buildApp();

    const res = await request(app).post("/api/uploads/images");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });

  it("CFG-3: rejects before reading the upload, so a large file is not consumed first", async () => {
    process.env.NODE_ENV = "production";
    const app = await buildApp();

    await request(app).post("/api/uploads");

    expect(mocks.singleHandler).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("CFG-4: with storage configured, uploads proceed normally", async () => {
    process.env.NODE_ENV = "production";
    process.env.PRIVATE_OBJECT_DIR = "/objects/private";
    const app = await buildApp();

    // send({}) so express.json() populates req.body — the route destructures it.
    const res = await request(app).post("/api/uploads").send({});

    expect(res.status).toBe(201);
    expect(mocks.savePrivateUpload).toHaveBeenCalled();
  });

  it("CFG-5: development keeps working without object storage", async () => {
    // Local disk is acceptable outside production; requiring the env var in dev
    // would make the app unrunnable on a laptop.
    process.env.NODE_ENV = "test";
    const app = await buildApp();

    const res = await request(app).post("/api/uploads").send({});

    expect(res.status).toBe(201);
  });

  it("CFG-6: the reason names the variable an operator has to set", async () => {
    process.env.NODE_ENV = "production";
    const { uploadsStorageUnavailableReason } = await import("../routes/uploads.js");

    expect(uploadsStorageUnavailableReason()).toContain("PRIVATE_OBJECT_DIR");
  });

  it("CFG-7: no reason is reported once the variable is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.PRIVATE_OBJECT_DIR = "/objects/private";
    const { uploadsStorageUnavailableReason } = await import("../routes/uploads.js");

    expect(uploadsStorageUnavailableReason()).toBeNull();
  });
});
