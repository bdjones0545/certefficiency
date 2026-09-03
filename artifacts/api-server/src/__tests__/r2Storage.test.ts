/**
 * Unit tests for the R2 storage service.
 * All AWS SDK calls are mocked — no live Cloudflare credentials required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock AWS SDK before importing the module under test ──────────────────────
// Use vi.hoisted so the mock fns are initialised before the vi.mock factory runs.

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

// All AWS SDK classes are used with `new`, so mocks must be regular functions
vi.mock("@aws-sdk/client-s3", () => ({
  /* eslint-disable prefer-arrow-callback */
  S3Client: vi.fn(function(this: { send: typeof mockSend }) {
    this.send = mockSend;
  }),
  GetObjectCommand: vi.fn(function(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, args);
    this._type = "GetObject";
  }),
  HeadObjectCommand: vi.fn(function(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, args);
    this._type = "HeadObject";
  }),
  DeleteObjectCommand: vi.fn(function(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, args);
    this._type = "DeleteObject";
  }),
  /* eslint-enable prefer-arrow-callback */
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import {
  validateObjectKey,
  R2ObjectKeyError,
  R2StorageService,
} from "../lib/r2Storage.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function withR2Env(fn: () => unknown) {
  const orig = {
    CLOUDFLARE_R2_ACCOUNT_ID: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_BUCKET: process.env.CLOUDFLARE_R2_BUCKET,
    R2_SIGNED_URL_EXPIRATION_SECONDS: process.env.R2_SIGNED_URL_EXPIRATION_SECONDS,
  };
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account-id";
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.CLOUDFLARE_R2_BUCKET = "aiagentcourse";
  process.env.R2_SIGNED_URL_EXPIRATION_SECONDS = "900";
  try {
    return fn();
  } finally {
    Object.assign(process.env, orig);
  }
}

// ── validateObjectKey ─────────────────────────────────────────────────────────

describe("validateObjectKey", () => {
  it("accepts a valid course object key", () => {
    expect(() =>
      validateObjectKey("courses/ai-agent-builder/lesson-3.mp4"),
    ).not.toThrow();
  });

  it("rejects a key that starts with /", () => {
    expect(() =>
      validateObjectKey("/courses/ai-agent-builder/lesson-3.mp4"),
    ).toThrow(R2ObjectKeyError);
  });

  it("rejects a key containing ..", () => {
    expect(() =>
      validateObjectKey("courses/../etc/passwd"),
    ).toThrow(R2ObjectKeyError);
  });

  it("rejects a key containing a backslash", () => {
    expect(() =>
      validateObjectKey("courses\\ai-agent-builder\\lesson-3.mp4"),
    ).toThrow(R2ObjectKeyError);
  });

  it("rejects a key that does not match courses/<slug>/<file> structure", () => {
    expect(() => validateObjectKey("random/path/file.mp4")).toThrow(R2ObjectKeyError);
    expect(() => validateObjectKey("courses/only-two-parts")).toThrow(R2ObjectKeyError);
    expect(() => validateObjectKey("not-courses/slug/file.mp4")).toThrow(R2ObjectKeyError);
  });

  it("rejects an empty key", () => {
    expect(() => validateObjectKey("")).toThrow(R2ObjectKeyError);
  });
});

// ── All 11 lesson object keys are structurally valid ─────────────────────────

describe("Expected lesson object keys", () => {
  // Authoritative mapping — matches the seed script and R2 bucket
  const LESSON_KEYS: Record<number, string> = {
    1:  "courses/ai-agent-builder/lesson-1.mp4",
    2:  "courses/ai-agent-builder/lesson-2.mp4",
    3:  "courses/ai-agent-builder/lesson-3.mp4",
    4:  "courses/ai-agent-builder/lesson-4.mp4",
    5:  "courses/ai-agent-builder/lesson-5.mp4",
    6:  "courses/ai-agent-builder/lesson-6.mp4",
    7:  "courses/ai-agent-builder/lesson-7.mp4",
    8:  "courses/ai-agent-builder/lesson-8.mp4",
    9:  "courses/ai-agent-builder/lesson-9.mp4",
    10: "courses/ai-agent-builder/lesson-10.mp4",
    // lesson-11.mp4 exists in R2 but has no DB record yet
    11: "courses/ai-agent-builder/lesson-11.mp4",
  };

  it("has exactly 11 expected R2 object keys", () => {
    expect(Object.keys(LESSON_KEYS)).toHaveLength(11);
  });

  it("all 11 lesson keys pass structural validation", () => {
    for (const [order, key] of Object.entries(LESSON_KEYS)) {
      expect(
        () => validateObjectKey(key),
        `Lesson ${order} key "${key}" should be valid`,
      ).not.toThrow();
    }
  });

  it("each key follows the courses/ai-agent-builder/lesson-N.mp4 pattern", () => {
    for (const [order, key] of Object.entries(LESSON_KEYS)) {
      expect(key).toBe(`courses/ai-agent-builder/lesson-${order}.mp4`);
    }
  });

  it("no two lessons share the same object key", () => {
    const keys = Object.values(LESSON_KEYS);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("keys do not contain path-traversal sequences", () => {
    for (const key of Object.values(LESSON_KEYS)) {
      expect(key).not.toContain("..");
      expect(key).not.toMatch(/^\/|\\|\:\/\//);
    }
  });
});

// ── R2StorageService ──────────────────────────────────────────────────────────

describe("R2StorageService", () => {
  let service: R2StorageService;

  beforeEach(() => {
    service = new R2StorageService();
    vi.clearAllMocks();
  });

  it("getSignedPlaybackUrl calls getSignedUrl with correct expiry", async () => {
    await withR2Env(async () => {
      const fakeUrl = "https://r2.example.com/signed?X-Amz-Expires=900&token=abc";
      mockGetSignedUrl.mockResolvedValueOnce(fakeUrl);

      const result = await service.getSignedPlaybackUrl(
        "courses/ai-agent-builder/lesson-3.mp4",
        900,
      );

      expect(result).toBe(fakeUrl);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          _type: "GetObject",
          Bucket: "aiagentcourse",
          Key: "courses/ai-agent-builder/lesson-3.mp4",
        }),
        { expiresIn: 900 },
      );
    });
  });

  it("getSignedPlaybackUrl rejects an invalid object key (R2ObjectKeyError propagates)", async () => {
    await withR2Env(async () => {
      await expect(
        service.getSignedPlaybackUrl("/courses/ai-agent-builder/lesson-3.mp4"),
      ).rejects.toThrow(R2ObjectKeyError);

      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
  });

  it("objectExists returns true when HeadObject succeeds", async () => {
    await withR2Env(async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await service.objectExists("courses/ai-agent-builder/lesson-3.mp4");
      expect(result).toBe(true);
    });
  });

  it("objectExists returns false when HeadObject throws (object missing)", async () => {
    await withR2Env(async () => {
      mockSend.mockRejectedValueOnce(new Error("NoSuchKey"));
      const result = await service.objectExists("courses/ai-agent-builder/lesson-3.mp4");
      expect(result).toBe(false);
    });
  });

  it("getObjectMetadata returns structured fields", async () => {
    await withR2Env(async () => {
      const now = new Date();
      mockSend.mockResolvedValueOnce({
        ContentType: "video/mp4",
        ContentLength: 142_000_000,
        LastModified: now,
        ETag: '"abc123"',
      });

      const meta = await service.getObjectMetadata(
        "courses/ai-agent-builder/lesson-3.mp4",
      );

      expect(meta.contentType).toBe("video/mp4");
      expect(meta.contentLength).toBe(142_000_000);
      expect(meta.etag).toBe('"abc123"');
    });
  });

  it("Lesson 3 object key matches the required value", () => {
    const LESSON_3_KEY = "courses/ai-agent-builder/lesson-3.mp4";
    expect(() => validateObjectKey(LESSON_3_KEY)).not.toThrow();
    expect(LESSON_3_KEY).toBe("courses/ai-agent-builder/lesson-3.mp4");
  });
});
