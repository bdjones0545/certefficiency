/**
 * Inference status tracker — in-memory singleton.
 *
 * Tracks the result of the most recent LLM inference attempt so the health
 * endpoint can accurately report "degraded" when Sarah's LLM backend is
 * unavailable (e.g. billing limit, provider outage) rather than always
 * reporting "healthy" because the Hermes service layer is up.
 *
 * State is process-local and resets on restart.  This is intentional: a
 * fresh restart should re-probe, not carry forward a stale "degraded" state.
 */

export type InferenceStatusCode = "unknown" | "ok" | "credits_exhausted" | "provider_error";

interface FailureRecord {
  code: Exclude<InferenceStatusCode, "unknown" | "ok">;
  recordedAt: Date;
  detail: string;
}

// Process-local state — no external dependency, no I/O.
let _lastSuccess: Date | null = null;
let _lastFailure: FailureRecord | null = null;

/** Call after a Sarah inference round-trip completes with a real AI response. */
export function recordInferenceSuccess(): void {
  _lastSuccess = new Date();
  _lastFailure = null; // clear any prior degraded state
}

/** Call after detecting a billing or provider error in an inference response. */
export function recordInferenceFailure(
  code: Exclude<InferenceStatusCode, "unknown" | "ok">,
  detail: string,
): void {
  _lastFailure = { code, recordedAt: new Date(), detail };
}

export interface InferenceStatusSnapshot {
  ok: boolean;
  code: InferenceStatusCode;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  detail?: string;
}

/** Returns the current inference health snapshot. */
export function getInferenceStatus(): InferenceStatusSnapshot {
  // A failure recorded at or after the last success → currently degraded.
  // Use <= so same-millisecond writes (common in tests) correctly report degraded.
  if (_lastFailure && (!_lastSuccess || _lastSuccess <= _lastFailure.recordedAt)) {
    return {
      ok: false,
      code: _lastFailure.code,
      lastSuccessAt: _lastSuccess?.toISOString() ?? null,
      lastFailureAt: _lastFailure.recordedAt.toISOString(),
      detail: _lastFailure.detail,
    };
  }

  if (_lastSuccess) {
    return {
      ok: true,
      code: "ok",
      lastSuccessAt: _lastSuccess.toISOString(),
      lastFailureAt: null,
    };
  }

  // No data yet (server just started, no inference attempted).
  return {
    ok: true,        // optimistic default — we don't fail health on startup
    code: "unknown",
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

/**
 * Returns true if the response content from Hermes looks like an LLM
 * billing / credits-exhausted error rather than a real AI response.
 *
 * Hermes wraps the LLM provider 403 into an HTTP 200 response body:
 *   "HTTP 403: {\"code\":\"permission-denied\",\"error\":\"Your team … has either
 *    used all available credits or reached its monthly spending limit.\"}"
 */
export function isBillingError(content: string): boolean {
  return (
    content.includes("permission-denied") &&
    (content.includes("credits") || content.includes("spending limit"))
  );
}

/**
 * Returns true if the response content looks like a generic provider error
 * (non-billing upstream failure passed through by Hermes).
 */
export function isProviderError(content: string): boolean {
  return content.startsWith("HTTP ") && !isBillingError(content);
}

/**
 * Returns true when the content is a raw upstream error envelope that must
 * never be shown to a learner as if Sarah had written it.
 *
 * Observed in production on 2026-09-04, stored as a normal assistant message:
 *   HTTP 403: {"code":"unauthenticated:bad-credentials","error":"The OAuth …
 *
 * Deliberately stricter than isProviderError, which matches any content
 * starting with "HTTP ". Sarah tutors Security+ candidates, so a genuine answer
 * may legitimately open with "HTTP 403 means forbidden…" — suppressing that
 * would delete real teaching. Requiring a JSON or array body immediately after
 * the status code distinguishes a machine error envelope from prose about one.
 */
export function isRawProviderErrorEnvelope(content: string): boolean {
  return /^HTTP \d{3}:\s*[{[]/.test(content.trimStart());
}

/**
 * Reset all state to the initial condition.
 * Exported for test isolation only — do not call in production code.
 */
export function resetForTesting(): void {
  _lastSuccess = null;
  _lastFailure = null;
}
