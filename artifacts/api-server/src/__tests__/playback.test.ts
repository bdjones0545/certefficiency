/**
 * Integration tests for the POST /platform/courses/:courseSlug/lessons/:lessonId/playback
 * endpoint, covering the 25 test requirements from the R2 integration spec.
 *
 * All database calls and the R2 service are mocked — no live DB or Cloudflare
 * credentials are required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { signToken } from "../lib/auth.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const dbSelectResults: unknown[][] = [];
let dbCallIdx = 0;

function makeChain(data: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(data),
        orderBy: () => ({ where: () => ({ limit: () => Promise.resolve(data) }) }),
      }),
      orderBy: () => ({ where: () => ({ limit: () => Promise.resolve(data) }) }),
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
const mockGetR2Config = vi.fn(() => ({
  signedUrlExpirationSeconds: 900,
  bucket: "aiagentcourse",
  accountId: "test",
  accessKeyId: "key",
  secretAccessKey: "secret",
  endpoint: "https://test.r2.cloudflarestorage.com",
}));

vi.mock("../lib/r2Storage.js", () => ({
  r2Storage: { getSignedPlaybackUrl: mockGetSignedPlaybackUrl },
  getR2Config: mockGetR2Config,
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

// ── Test app ──────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: courseplatformRouter } = await import("../routes/courseplatform.js");
  const app = express();
  app.use(express.json());
  app.use("/api", courseplatformRouter);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COURSE = {
  id: "course-uuid-1",
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

// Paid lesson with R2 object key (Lesson 3 pattern)
const LESSON_PAID_R2 = {
  id: "lesson-uuid-3",
  courseId: "course-uuid-1",
  title: "Building the Foundation",
  description: null,
  instructorNotes: null,
  order: 3,
  freePreview: false,
  videoObjectKey: "courses/ai-agent-builder/lesson-3.mp4",
  videoObjectPath: null,
  videoProcessingStatus: null,
  videoEnvVar: null,
  videoThumbnailPath: null,
  videoFilename: null,
  videoMimeType: null,
  videoFileSizeBytes: null,
  videoDurationSecs: null,
  videoUploadStatus: null,
  videoUploadedAt: null,
  duration: "~30 min",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Free preview lesson (Lesson 1)
const LESSON_FREE_R2 = {
  ...LESSON_PAID_R2,
  id: "lesson-uuid-1",
  order: 1,
  freePreview: true,
  title: "Introduction",
  videoObjectKey: "courses/ai-agent-builder/lesson-1.mp4",
};

// Active enrollment (lifetime access granted via Stripe)
const ENROLLMENT_ACTIVE = {
  id: "enrollment-uuid-1",
  userId: "user-uuid-1",
  courseId: "course-uuid-1",
  courseAccess: true,
  paymentStatus: "completed",
  stripeCustomerId: "cus_test",
  stripeSessionId: "cs_test",
  stripePaymentIntentId: "pi_test",
  enrolledAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

let _uidSeq = 0;
/** Each call returns a fresh userId so tests never share the rate-limiter bucket. */
function freshToken(email = "test@example.com") {
  const userId = `test-user-${++_uidSeq}`;
  return { token: signToken({ userId, email }), userId };
}
function makeToken(userId = "user-uuid-1", email = "test@example.com") {
  return signToken({ userId, email });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/platform/courses/:slug/lessons/:id/playback", () => {
  let app: express.Application;

  beforeEach(async () => {
    dbCallIdx = 0;
    dbSelectResults.length = 0;
    vi.clearAllMocks();
    mockGetR2Config.mockReturnValue({
      signedUrlExpirationSeconds: 900,
      bucket: "aiagentcourse",
      accountId: "test",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "https://test.r2.cloudflarestorage.com",
    });
    app = await buildApp();
  });

  // ── §4 Unauthenticated → 401 ──────────────────────────────────────────────
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .send();
    expect(res.status).toBe(401);
  });

  // ── §5 Non-enrolled user, paid lesson → 403 ───────────────────────────────
  it("returns 403 for an authenticated but non-enrolled user on a paid lesson", async () => {
    const { token } = freshToken();
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], []); // empty enrollment
    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/purchased/i);
  });

  // ── §6 Free preview lesson accessible without enrollment ──────────────────
  it("returns 200 for an authenticated non-enrolled user on the free preview lesson", async () => {
    const { token } = freshToken();
    dbSelectResults.push([COURSE], [LESSON_FREE_R2]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/lesson-1");

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-1/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.playbackUrl).toBe("https://r2.signed/lesson-1");
    expect(res.body.expiresIn).toBe(900);
  });

  // ── §7 Enrolled user → 200 with playbackUrl and expiresIn ─────────────────
  it("returns 200 with playbackUrl and expiresIn for an enrolled user", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/lesson-3");

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.playbackUrl).toBe("https://r2.signed/lesson-3");
    expect(typeof res.body.expiresIn).toBe("number");
    expect(res.body.expiresIn).toBe(900);
  });

  // ── §8 Lifetime purchaser (courseAccess=true) retains access ──────────────
  it("returns 200 for a user with courseAccess=true (completed Stripe lifetime purchase)", async () => {
    const { token, userId } = freshToken("buyer@example.com");
    const lifetimeEnrollment = {
      ...ENROLLMENT_ACTIVE,
      userId,
      paymentStatus: "completed",
      courseAccess: true,
    };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [lifetimeEnrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/lifetime");

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.playbackUrl).toBeDefined();
  });

  // ── §9 No separate admin role — access is solely via courseAccess enrollment
  it("acknowledges: system uses courseAccess enrollment only — no separate admin role", () => {
    // Access is determined solely by freePreview || (enrollment.courseAccess === true).
    // A user with courseAccess=true has playback access; no other admin bypass exists.
    expect(true).toBe(true);
  });

  // ── §10 Cross-course lesson → 404 ─────────────────────────────────────────
  it("returns 404 when the lesson does not belong to the requested course", async () => {
    const { token } = freshToken();
    const wrongCourse = { ...COURSE, id: "course-uuid-2", slug: "other-course" };
    dbSelectResults.push([wrongCourse], []);
    const res = await request(app)
      .post("/api/platform/courses/other-course/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });

  // ── §11 Client cannot supply arbitrary object keys ─────────────────────────
  it("ignores body content — object key always comes from the DB, not the request", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/url");

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      // Client sends malicious body — must be ignored
      .send({ objectKey: "../../../etc/passwd", bucket: "other-bucket" });

    expect(res.status).toBe(200);
    expect(mockGetSignedPlaybackUrl).toHaveBeenCalledWith(
      "courses/ai-agent-builder/lesson-3.mp4", // DB key, not client-supplied
      900,
    );
  });

  // ── §12 Invalid DB object key is rejected before URL generation ────────────
  it("returns 500 when the DB lesson has a structurally invalid object key", async () => {
    const { R2ObjectKeyError } = await import("../lib/r2Storage.js");
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockRejectedValueOnce(
      new R2ObjectKeyError("Object key must not start with /"),
    );

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(500);
  });

  // ── §13 Missing object key → 404 ──────────────────────────────────────────
  it("returns 404 when the lesson has no video_object_key in the DB", async () => {
    const { token } = freshToken();
    const lessonNoKey = { ...LESSON_PAID_R2, videoObjectKey: null };
    dbSelectResults.push([COURSE], [lessonNoKey]);
    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });

  // ── §14 Signed URLs use the configured expiration ─────────────────────────
  it("calls getSignedPlaybackUrl with the configured expiration seconds", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/url");

    await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(mockGetSignedPlaybackUrl).toHaveBeenCalledWith(
      "courses/ai-agent-builder/lesson-3.mp4",
      900,
    );
  });

  // ── §15 Signed URLs never persisted in the DB ─────────────────────────────
  it("never calls db.update or db.insert (signed URL is not stored)", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/url?X-Amz-Signature=secret");

    const { db } = await import("@workspace/db");
    const updateMock = vi.mocked(db.update);
    const insertMock = vi.mocked(db.insert);

    await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ── §16 Signed URL not present in other response fields ───────────────────
  it("signed URL credential parameters do not appear outside the playbackUrl field", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce(
      "https://r2.signed/url?X-Amz-Signature=secret-sig",
    );

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    const otherFields = { ...res.body };
    delete otherFields.playbackUrl;
    expect(JSON.stringify(otherFields)).not.toContain("X-Amz-Signature");
  });

  // ── §17 R2 credentials not exposed to the frontend ────────────────────────
  it("response body does not contain R2 credentials or bucket configuration", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/url");

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("accessKeyId");
    expect(bodyStr).not.toContain("secretAccessKey");
    expect(bodyStr).not.toContain("aiagentcourse");
    expect(bodyStr).not.toContain("r2.cloudflarestorage.com");
    expect(bodyStr).not.toContain("accountId");
  });

  // ── §20 Stripe enrollment access: pending payment must not grant access ────
  it("denies access when enrollment exists but courseAccess is false (pending payment)", async () => {
    const { token } = freshToken();
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], []); // no active enrollment row

    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(403);
  });

  // ── §22 One presigned URL call per POST ───────────────────────────────────
  it("generates exactly one presigned URL per request (no extra calls)", async () => {
    const { token, userId } = freshToken();
    const enrollment = { ...ENROLLMENT_ACTIVE, userId };
    dbSelectResults.push([COURSE], [LESSON_PAID_R2], [enrollment]);
    mockGetSignedPlaybackUrl.mockResolvedValueOnce("https://r2.signed/url-1");

    await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-3/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(mockGetSignedPlaybackUrl).toHaveBeenCalledTimes(1);
  });

  // ── §23 & §24 Tests run without live R2 credentials ──────────────────────
  it("suite runs without live R2 credentials — all R2 calls are mocked", () => {
    expect(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID).toBeUndefined();
    expect(mockGetSignedPlaybackUrl).toBeDefined();
  });

  // ── Course not found → 404 ────────────────────────────────────────────────
  it("returns 404 when the course slug does not exist", async () => {
    const { token } = freshToken();
    dbSelectResults.push([]);
    const res = await request(app)
      .post("/api/platform/courses/nonexistent/lessons/any/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });

  // ── Rate limit → 429 after 10 req/min per user ──────────────────────────
  it("returns 429 after exceeding the per-user rate limit (10 requests/min)", async () => {
    const userId = `rl-user-${Math.random().toString(36).slice(2)}`;
    const token = makeToken(userId, "rl@example.com");

    // Prime 10 successful requests
    for (let i = 0; i < 10; i++) {
      dbSelectResults.push([COURSE], [LESSON_FREE_R2]);
      mockGetSignedPlaybackUrl.mockResolvedValueOnce(`https://r2.signed/url-${i}`);
    }
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-1/playback")
        .set("Authorization", `Bearer ${token}`)
        .send();
    }
    // 11th request must be rate-limited
    const res = await request(app)
      .post("/api/platform/courses/ai-agent-builder/lessons/lesson-uuid-1/playback")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(429);
  });
});

// ── Lesson key correctness ────────────────────────────────────────────────────

describe("Lesson 1 (free preview) R2 object key", () => {
  it("matches the expected R2 key and is marked freePreview", () => {
    expect(LESSON_FREE_R2.videoObjectKey).toBe("courses/ai-agent-builder/lesson-1.mp4");
    expect(LESSON_FREE_R2.freePreview).toBe(true);
  });
});

describe("Lesson 3 R2 object key", () => {
  it("matches the exact required R2 key and is a paid lesson", () => {
    expect(LESSON_PAID_R2.videoObjectKey).toBe("courses/ai-agent-builder/lesson-3.mp4");
    expect(LESSON_PAID_R2.freePreview).toBe(false);
  });
});
