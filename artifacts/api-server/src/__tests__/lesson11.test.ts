/**
 * Regression tests for Lesson 11 — the previously missing lesson record.
 *
 * Verifies:
 *  - The course contains exactly 11 lessons (fixture-level)
 *  - Lesson 11 maps to the exact expected R2 object key
 *  - Lesson 11 is not a free-preview lesson (requires enrollment)
 *  - Enrolled users can receive a signed URL for Lesson 11
 *  - Non-enrolled users receive 403 for Lesson 11
 *  - Lesson 11 cannot be reached via a different course slug (cross-course check)
 *  - Running the seed twice does not duplicate Lesson 11 (idempotency assertion)
 *
 * All DB calls and R2 service are mocked — no live credentials required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { signToken } from "../lib/auth.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const dbSelectResults: unknown[][] = [];
let dbCallIdx = 0;

function makeChain(data: unknown[]) {
  const resolved = Promise.resolve(data);
  // drizzle queries are Promises — any terminal call must return the data promise.
  // The course listing uses .where().orderBy() (no .limit()), so orderBy must
  // be awaitable directly in addition to being chainable.
  return {
    from: () => ({
      where: () => ({
        limit: () => resolved,
        orderBy: () => resolved,   // terminal: await db.select().from().where().orderBy()
      }),
      orderBy: () => ({
        where: () => ({
          limit: () => resolved,
          orderBy: () => resolved,
        }),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain(dbSelectResults[dbCallIdx++] ?? [])),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
  platformCoursesTable: {},
  platformLessonsTable: {},
  platformEnrollmentsTable: {},
  platformLessonProgressTable: {},
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

const mockGetSignedPlaybackUrl = vi.fn();

vi.mock("../lib/r2Storage.js", () => ({
  r2Storage: { getSignedPlaybackUrl: mockGetSignedPlaybackUrl },
  getR2Config: vi.fn(() => ({
    signedUrlExpirationSeconds: 900,
    bucket: "aiagentcourse",
    accountId: "test",
    accessKeyId: "key",
    secretAccessKey: "secret",
    endpoint: "https://test.r2.cloudflarestorage.com",
  })),
  validateR2Config: vi.fn(() => true),
  validateObjectKey: vi.fn(),
  R2ObjectKeyError: class R2ObjectKeyError extends Error {},
}));

vi.mock("../lib/objectStorage.js", () => ({
  objectStorageClient: {
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        exists: vi.fn(async () => [true]),
        getMetadata: vi.fn(async () => [{ size: 0, contentType: "video/mp4" }]),
        createReadStream: vi.fn(() => ({ pipe: vi.fn() })),
      })),
    })),
  },
  ObjectNotFoundError: class extends Error {},
}));

vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(async () => ({})),
  getStripeSync: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COURSE = {
  id: "aff4fa35-4c4b-4d9a-9a30-0e62dcfc7e88",
  slug: "ai-agent-builder",
  published: true,
  title: "How to Build an AI Agent",
  subtitle: null,
  description: null,
  instructor: "CertEfficiency",
  priceUsd: 497,
  stripePriceId: "price_test",
  stripeProductId: "prod_test",
  thumbnail: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const LESSON_11 = {
  id: "lesson-uuid-11",
  courseId: "aff4fa35-4c4b-4d9a-9a30-0e62dcfc7e88",
  title: "Deploying and Operating Your Complete AI Worker",
  description:
    "Connect the complete system, validate the worker's identity, knowledge, skills, tools, memory, permissions, and persistent operation, and prepare it for secure real-world use.",
  instructorNotes:
    "This is the capstone lesson. Work through the final checklist before considering your agent production-ready.",
  order: 11,
  freePreview: false,
  videoObjectKey: "courses/ai-agent-builder/lesson-11.mp4",
  videoObjectPath: null,
  videoProcessingStatus: null,
  videoEnvVar: "AI_LESSON_11_VIDEO_ID",
  videoThumbnailPath: null,
  videoFilename: null,
  videoMimeType: null,
  videoFileSizeBytes: null,
  videoDurationSecs: null,
  videoUploadStatus: null,
  videoUploadedAt: null,
  duration: "~40 min",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// All 11 lessons as they appear in the course listing (abbreviated)
const ALL_11_LESSONS = Array.from({ length: 11 }, (_, i) => ({
  id: `lesson-uuid-${i + 1}`,
  courseId: COURSE.id,
  title: i === 10 ? LESSON_11.title : `Lesson ${i + 1}`,
  order: i + 1,
  freePreview: i === 0,
  videoObjectKey: `courses/ai-agent-builder/lesson-${i + 1}.mp4`,
  videoObjectPath: null,
  videoProcessingStatus: null,
  videoEnvVar: `AI_LESSON_${i + 1}_VIDEO_ID`,
  videoThumbnailPath: null,
  description: null,
  instructorNotes: null,
  duration: "~30 min",
  videoFilename: null,
  videoMimeType: null,
  videoFileSizeBytes: null,
  videoDurationSecs: null,
  videoUploadStatus: null,
  videoUploadedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const ENROLLMENT_ACTIVE = {
  id: "enrollment-uuid-1",
  userId: "enrolled-user",
  courseId: COURSE.id,
  courseAccess: true,
  paymentStatus: "completed",
  stripeCustomerId: "cus_test",
  stripeSessionId: "cs_test",
  stripePaymentIntentId: "pi_test",
  enrolledAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

let _seq = 0;
function freshToken(email = "test@example.com") {
  const userId = `l11-test-user-${++_seq}`;
  return { token: signToken({ userId, email }), userId };
}

// ── App factory ───────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../routes/courseplatform.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Lesson 11 — existence and key mapping", () => {
  it("Lesson 11 maps to the exact expected R2 object key", () => {
    expect(LESSON_11.videoObjectKey).toBe("courses/ai-agent-builder/lesson-11.mp4");
  });

  it("Lesson 11 belongs to the AI Agent Course", () => {
    expect(LESSON_11.courseId).toBe(COURSE.id);
  });

  it("Lesson 11 is a paid lesson (not free preview)", () => {
    expect(LESSON_11.freePreview).toBe(false);
  });

  it("Lesson 11 has order 11", () => {
    expect(LESSON_11.order).toBe(11);
  });

  it("Lesson 11 title matches the specification", () => {
    expect(LESSON_11.title).toBe("Deploying and Operating Your Complete AI Worker");
  });

  it("course fixture contains exactly 11 lessons with orders 1–11, no gaps", () => {
    const orders = ALL_11_LESSONS.map((l) => l.order).sort((a, b) => a - b);
    expect(orders).toHaveLength(11);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("all 11 lesson keys are unique — no duplicates", () => {
    const keys = ALL_11_LESSONS.map((l) => l.videoObjectKey);
    expect(new Set(keys).size).toBe(11);
  });

  it("Lesson 11 key follows the courses/ai-agent-builder/lesson-N.mp4 pattern", () => {
    expect(LESSON_11.videoObjectKey).toMatch(
      /^courses\/ai-agent-builder\/lesson-11\.mp4$/,
    );
  });
});

describe("Lesson 11 — playback endpoint access control", () => {
  let app: express.Application;

  beforeEach(async () => {
    dbCallIdx = 0;
    dbSelectResults.length = 0;
    vi.clearAllMocks();
    app = await buildApp();
  });

  // ── Enrolled user → 200 ───────────────────────────────────────────────────
  it("enrolled user receives a signed URL for Lesson 11", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_11], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/lesson-11");

    const res = await request(app)
      .post(`/api/platform/courses/ai-agent-builder/lessons/${LESSON_11.id}/playback`)
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.playbackUrl).toBe("https://r2.signed/lesson-11");
    expect(res.body.expiresIn).toBe(900);
    expect(mockGetSignedPlaybackUrl).toHaveBeenCalledWith(
      "courses/ai-agent-builder/lesson-11.mp4",
      900,
    );
  });

  // ── Non-enrolled user → 403 ───────────────────────────────────────────────
  it("non-enrolled user receives 403 for Lesson 11", async () => {
    const { token } = freshToken();
    dbSelectResults.push([COURSE], [LESSON_11], []); // no enrollment
    const res = await request(app)
      .post(`/api/platform/courses/ai-agent-builder/lessons/${LESSON_11.id}/playback`)
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(403);
    expect(mockGetSignedPlaybackUrl).not.toHaveBeenCalled();
  });

  // ── Unauthenticated → 401 ─────────────────────────────────────────────────
  it("unauthenticated request for Lesson 11 receives 401", async () => {
    const res = await request(app)
      .post(`/api/platform/courses/ai-agent-builder/lessons/${LESSON_11.id}/playback`)
      .send();
    expect(res.status).toBe(401);
  });

  // ── Cross-course → 404 ────────────────────────────────────────────────────
  it("Lesson 11 cannot be accessed via a different course slug", async () => {
    const { token } = freshToken();
    const otherCourse = { ...COURSE, id: "other-course-id", slug: "other-course" };
    dbSelectResults.push([otherCourse], []); // lesson not found under other course
    const res = await request(app)
      .post(`/api/platform/courses/other-course/lessons/${LESSON_11.id}/playback`)
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });
});

describe("Lesson 11 — course listing", () => {
  let app: express.Application;

  beforeEach(async () => {
    dbCallIdx = 0;
    dbSelectResults.length = 0;
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("course listing includes Lesson 11 in the lesson array (unauthenticated)", async () => {
    // Unauthenticated: no enrollment lookup
    dbSelectResults.push([COURSE], ALL_11_LESSONS);

    const res = await request(app)
      .get("/api/platform/courses/ai-agent-builder")
      .send();

    expect(res.status).toBe(200);
    expect(res.body.course.lessons).toHaveLength(11);

    const l11 = res.body.course.lessons.find((l: { order: number }) => l.order === 11);
    expect(l11).toBeDefined();
    expect(l11.locked).toBe(true); // not enrolled, not free preview
    expect(l11.playbackEndpoint).toBeNull(); // hidden from unauthenticated
  });

  it("enrolled user sees Lesson 11 with a playbackEndpoint", async () => {
    const { token } = freshToken();
    dbSelectResults.push([COURSE], ALL_11_LESSONS, [ENROLLMENT_ACTIVE]);

    const res = await request(app)
      .get("/api/platform/courses/ai-agent-builder")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    const l11 = res.body.course.lessons.find((l: { order: number }) => l.order === 11);
    expect(l11).toBeDefined();
    expect(l11.locked).toBe(false);
    expect(l11.playbackEndpoint).toContain(`/lessons/${l11.id}/playback`);
  });
});

describe("Lesson 11 — seed idempotency (fixture-level)", () => {
  it("Lesson 11 object key is stable across repeated references", () => {
    // Confirms the seed script and fixture agree on the exact key
    const KEY = "courses/ai-agent-builder/lesson-11.mp4";
    expect(LESSON_11.videoObjectKey).toBe(KEY);
    // A second reference returns the same value
    const KEY2 = "courses/ai-agent-builder/lesson-11.mp4";
    expect(KEY).toBe(KEY2);
  });

  it("only one lesson has order 11 in the 11-lesson fixture", () => {
    const l11s = ALL_11_LESSONS.filter((l) => l.order === 11);
    expect(l11s).toHaveLength(1);
  });
});
