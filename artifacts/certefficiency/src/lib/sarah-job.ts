/**
 * Utilities for Sarah job ID validation and extraction.
 *
 * Centralising this logic prevents objects from coercing to "[object Object]"
 * when they are interpolated into fetch URLs such as /api/sarah/jobs/${id}.
 */

/** UUIDv1–v5 regex — the canonical format returned by the backend. */
export const SARAH_JOB_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns true when `id` is a valid UUID string.
 * Rejects objects, null, undefined, empty strings, and anything non-UUID.
 */
export function isValidSarahJobId(id: unknown): id is string {
  return typeof id === "string" && SARAH_JOB_ID_REGEX.test(id);
}

/**
 * Extracts the canonical `jobId` string from a raw send-message mutation result.
 *
 * Backend contract: `{ jobId: string }` at the top level of the response body.
 * Returns `null` — never an object — when the response is malformed.
 *
 * Callers MUST check `isValidSarahJobId(jobId)` before using the return value
 * as a URL path segment.
 */
export function extractSarahJobId(result: unknown): string | null {
  if (result === null || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  // Primary shape: { jobId: "<uuid>" }
  if (isValidSarahJobId(r.jobId)) return r.jobId as string;

  return null;
}

/**
 * Builds the polling URL for a given job ID.
 * Returns `null` when the ID is not a valid UUID so the caller can skip the fetch.
 */
export function buildSarahJobUrl(jobId: unknown): string | null {
  if (!isValidSarahJobId(jobId)) return null;
  return `/api/sarah/jobs/${jobId}`;
}
