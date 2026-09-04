/**
 * Upload storage failures must be diagnosable from outside the deployment.
 *
 * Uploads were failing in production with a bare
 * `{"error":"Internal server error"}`. The real exception WAS logged by the
 * global error handler the whole time — but that is only reachable from the
 * deployment console, so diagnosing it from outside meant probing five
 * endpoints, reasoning from status codes, and still guessing wrong.
 *
 * Storage in production is a chain: PRIVATE_OBJECT_DIR set → Replit credential
 * sidecar reachable → bucket write succeeds. Each link needs a different fix,
 * and all three used to look identical from outside. These tests pin the coarse
 * code that tells them apart, and pin that the underlying message is never
 * returned to a caller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UPLOAD_UNAVAILABLE_MESSAGE,
  classifyStorageFailure,
  privateObjectDirConfigured,
  probeUploadStorage,
} from "../lib/uploadStorageHealth.js";

describe("classifying a storage failure", () => {
  it("HLTH-1: a missing PRIVATE_OBJECT_DIR is a configuration problem", () => {
    const err = new Error(
      "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' tool and set PRIVATE_OBJECT_DIR env var.",
    );
    expect(classifyStorageFailure(err).code).toBe("storage_not_configured");
  });

  it("HLTH-2: sidecar failures are told apart from configuration failures", () => {
    // This is the distinction that cost the most time: the variable can be set
    // while the sidecar that authenticates against it is unreachable.
    const sidecarErrors = [
      new Error("connect ECONNREFUSED 127.0.0.1:1106"),
      new Error("Failed to sign object URL, errorcode: 500, make sure you're running on Replit"),
      new Error("getaddrinfo ENOTFOUND metadata.google.internal"),
      new Error("Unable to detect a Project Id in the current environment."),
    ];
    for (const err of sidecarErrors) {
      expect(classifyStorageFailure(err).code).toBe("storage_unreachable");
    }
  });

  it("HLTH-3: anything unrecognised is reported as a write failure, not a guess", () => {
    // Refusing to over-diagnose matters: a confident wrong code would send an
    // operator to the wrong fix, which is exactly what happened by hand.
    expect(classifyStorageFailure(new Error("bucket quota exceeded")).code)
      .toBe("storage_write_failed");
    expect(classifyStorageFailure("something odd").code).toBe("storage_write_failed");
  });

  it("HLTH-4: the underlying message is preserved for logs", () => {
    const problem = classifyStorageFailure(new Error("connect ECONNREFUSED 127.0.0.1:1106"));
    expect(problem.detail).toContain("ECONNREFUSED");
  });

  it("HLTH-5: the learner-facing message carries no internal detail", () => {
    expect(UPLOAD_UNAVAILABLE_MESSAGE).not.toMatch(/PRIVATE_OBJECT_DIR|1106|sidecar|bucket/i);
    expect(UPLOAD_UNAVAILABLE_MESSAGE).toMatch(/not a problem with your file/i);
  });
});

describe("probing storage at boot", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.PRIVATE_OBJECT_DIR;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.PRIVATE_OBJECT_DIR;
  });

  it("HLTH-6: reports a configuration problem when the variable is absent", async () => {
    const problem = await probeUploadStorage(50);
    expect(problem?.code).toBe("storage_not_configured");
  });

  it("HLTH-7: contacts the sidecar rather than trusting the variable", async () => {
    // The whole point: a set variable is not evidence that storage works.
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const problem = await probeUploadStorage(50);

    expect(problem).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("127.0.0.1:1106");
  });

  it("HLTH-8: a set variable with an unreachable sidecar is still unavailable", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1106");
    }) as unknown as typeof fetch;

    const problem = await probeUploadStorage(50);

    expect(problem?.code).toBe("storage_unreachable");
    expect(problem?.detail).toContain("ECONNREFUSED");
  });

  it("HLTH-9: a non-2xx from the sidecar is unavailable, not healthy", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;

    const problem = await probeUploadStorage(50);

    expect(problem?.code).toBe("storage_unreachable");
    expect(problem?.detail).toContain("503");
  });

  it("HLTH-10: privateObjectDirConfigured ignores whitespace-only values", () => {
    process.env.PRIVATE_OBJECT_DIR = "   ";
    expect(privateObjectDirConfigured()).toBe(false);
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    expect(privateObjectDirConfigured()).toBe(true);
  });
});
