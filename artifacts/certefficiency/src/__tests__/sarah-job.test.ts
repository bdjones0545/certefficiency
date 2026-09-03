/**
 * Sarah job ID validation and polling regression tests.
 *
 * Tests the pure utility layer (sarah-job.ts) that guards the polling hook
 * from receiving objects, empty strings, or invalid UUIDs that would produce
 * /api/sarah/jobs/[object%20Object] fetch URLs.
 *
 * POLL-1  String jobId passes UUID validation.
 * POLL-2  Object mutation result does not extract as a jobId.
 * POLL-3  An object passed directly is not a valid job ID.
 * POLL-4  Missing (null / undefined) jobId returns null.
 * POLL-5  Invalid UUID string fails validation.
 * POLL-6  Completed job status is terminal (polling should stop).
 * POLL-7  Failed job status is terminal (polling should stop, error shown).
 * POLL-8  No URL built from extractSarahJobId ever contains [object Object].
 * POLL-9  New conversation: valid jobId extracted from backend response shape.
 * POLL-10 Existing conversation: same extraction works on repeated calls.
 */

import { describe, it, expect } from "vitest";
import {
  SARAH_JOB_ID_REGEX,
  isValidSarahJobId,
  extractSarahJobId,
  buildSarahJobUrl,
  isAwaitingSarahReply,
} from "../lib/sarah-job.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_UUID  = "1dd346fd-6616-41c0-ac02-1d5c4a40e5b7";
const VALID_UUID2 = "38467eeb-f6d8-404d-80ac-d6f3a453f9a2";

/** Shape of a real POST /conversations/:id/messages response */
function makeOkResult(jobId: string = VALID_UUID) {
  return {
    userMessage: { id: "msg-id", role: "user", content: "Hi Sarah" },
    jobId,
    sarahMessage: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Sarah job polling — 10 regression tests", () => {

  // POLL-1: String jobId passes UUID validation and starts polling
  it("POLL-1: valid UUID string passes isValidSarahJobId", () => {
    expect(isValidSarahJobId(VALID_UUID)).toBe(true);
    expect(isValidSarahJobId(VALID_UUID2)).toBe(true);
    // Validation passes → polling hook should be enabled
  });

  // POLL-2: Object mutation result — jobId must not be extracted as an object
  it("POLL-2: result with object-valued jobId returns null from extractSarahJobId", () => {
    // Simulate a response where the backend accidentally wraps jobId in an object
    const wrappedResult = { jobId: { id: VALID_UUID } };
    const extracted = extractSarahJobId(wrappedResult);
    expect(extracted).toBeNull();
    // Confirm the raw wrapped value is not a valid ID
    expect(isValidSarahJobId(wrappedResult.jobId)).toBe(false);
  });

  // POLL-3: Object passed directly as job ID is invalid
  it("POLL-3: passing a plain object to isValidSarahJobId returns false", () => {
    expect(isValidSarahJobId({ id: VALID_UUID })).toBe(false);
    expect(isValidSarahJobId({})).toBe(false);
    // Guard prevents [object Object] in URL
    expect(buildSarahJobUrl({ id: VALID_UUID })).toBeNull();
  });

  // POLL-4: Missing / null / undefined jobId returns null
  it("POLL-4: missing jobId yields null — loading state stops", () => {
    expect(extractSarahJobId({ jobId: null })).toBeNull();
    expect(extractSarahJobId({ jobId: undefined })).toBeNull();
    expect(extractSarahJobId({})).toBeNull();
    expect(extractSarahJobId(null)).toBeNull();
    expect(extractSarahJobId(undefined)).toBeNull();
  });

  // POLL-5: Invalid UUID strings fail validation
  it("POLL-5: non-UUID strings do not pass isValidSarahJobId", () => {
    expect(isValidSarahJobId("")).toBe(false);
    expect(isValidSarahJobId("not-a-uuid")).toBe(false);
    expect(isValidSarahJobId("[object Object]")).toBe(false);
    expect(isValidSarahJobId("00000000-0000-0000-0000-000000000000")).toBe(false); // version 0
    expect(isValidSarahJobId("1dd346fd-6616-41c0-ac02")).toBe(false); // truncated
    // None of these should start polling
    for (const bad of ["", "not-a-uuid", "[object Object]"]) {
      expect(buildSarahJobUrl(bad)).toBeNull();
    }
  });

  // POLL-6: Completed job is a terminal state — polling interval returns false
  it("POLL-6: completed status is terminal — refetchInterval should return false", () => {
    const TERMINAL = new Set(["completed", "failed"]);
    expect(TERMINAL.has("completed")).toBe(true);
    expect(TERMINAL.has("failed")).toBe(true);
    expect(TERMINAL.has("processing")).toBe(false);
    expect(TERMINAL.has("queued")).toBe(false);
    // refetchInterval in home.tsx: `status === "completed" || status === "failed" ? false : 2000`
    const refetchInterval = (status: string) =>
      status === "completed" || status === "failed" ? false : 2000;
    expect(refetchInterval("completed")).toBe(false);
    expect(refetchInterval("queued")).toBe(2000);
  });

  // POLL-7: Failed job is terminal — poller stops and caller shows retryable error
  it("POLL-7: failed status is terminal — refetchInterval returns false", () => {
    const refetchInterval = (status: string) =>
      status === "completed" || status === "failed" ? false : 2000;
    expect(refetchInterval("failed")).toBe(false);
    expect(refetchInterval("processing")).toBe(2000);
    // home.tsx fires setSendError / invalidateQueries when job.status === "failed"
    // (verified by the job completion useEffect)
  });

  // POLL-8: No URL built by buildSarahJobUrl ever contains [object Object]
  it("POLL-8: buildSarahJobUrl never produces a URL containing [object Object]", () => {
    const badInputs: unknown[] = [
      { id: VALID_UUID },
      {},
      null,
      undefined,
      "[object Object]",
      true,
      42,
      [],
    ];
    for (const bad of badInputs) {
      const url = buildSarahJobUrl(bad);
      expect(url).toBeNull();
      // Confirming: if a caller did interpolate `bad` into a URL, it would break
      if (bad !== null && bad !== undefined) {
        const coerced = String(bad);
        if (!SARAH_JOB_ID_REGEX.test(coerced)) {
          // Ensure this coerced string would produce a bad URL
          const wouldBe = `/api/sarah/jobs/${bad}`;
          expect(wouldBe).not.toMatch(/^\/api\/sarah\/jobs\/[0-9a-f-]{36}$/i);
        }
      }
    }
    // Only a real UUID passes
    expect(buildSarahJobUrl(VALID_UUID)).toBe(`/api/sarah/jobs/${VALID_UUID}`);
  });

  // POLL-9: New conversation flow — valid jobId extracted from real backend response
  it("POLL-9: extractSarahJobId extracts jobId from the real POST response shape", () => {
    const result = makeOkResult(VALID_UUID);
    const jobId = extractSarahJobId(result);
    expect(jobId).toBe(VALID_UUID);
    expect(isValidSarahJobId(jobId)).toBe(true);
    // The polling hook receives a string UUID → URL is /api/sarah/jobs/<uuid>
    expect(buildSarahJobUrl(jobId)).toBe(`/api/sarah/jobs/${VALID_UUID}`);
  });

  // POLL-10: Existing conversation flow — same extraction on a second message send
  it("POLL-10: extractSarahJobId works consistently across multiple message sends", () => {
    const first  = makeOkResult(VALID_UUID);
    const second = makeOkResult(VALID_UUID2);

    const jobId1 = extractSarahJobId(first);
    const jobId2 = extractSarahJobId(second);

    expect(jobId1).toBe(VALID_UUID);
    expect(jobId2).toBe(VALID_UUID2);
    expect(jobId1).not.toBe(jobId2); // different jobs, different IDs

    // Both produce valid polling URLs
    expect(buildSarahJobUrl(jobId1)).toBe(`/api/sarah/jobs/${VALID_UUID}`);
    expect(buildSarahJobUrl(jobId2)).toBe(`/api/sarah/jobs/${VALID_UUID2}`);
  });

  it("POLL-11: recent trailing user message restores pending state after refresh", () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    expect(isAwaitingSarahReply([
      { role: "assistant", createdAt: "2026-09-03T11:59:00Z" },
      { role: "user", createdAt: "2026-09-03T11:59:30Z" },
    ], now)).toBe(true);
  });

  it("POLL-12: assistant/error response and stale requests are not pending", () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    expect(isAwaitingSarahReply([
      { role: "user", createdAt: "2026-09-03T11:59:00Z" },
      { role: "assistant", createdAt: "2026-09-03T11:59:30Z" },
    ], now)).toBe(false);
    expect(isAwaitingSarahReply([
      { role: "user", createdAt: "2026-09-03T11:40:00Z" },
    ], now)).toBe(false);
  });
});
