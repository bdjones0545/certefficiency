/**
 * A raw upstream error envelope must never be shown to a learner as tutoring.
 *
 * Observed in production on 2026-09-04. A learner sent "hi" and was shown, as a
 * normal assistant message:
 *
 *   HTTP 403: {"code":"unauthenticated:bad-credentials","error":"The OAuth …
 *
 * Sarah's runtime reported success and put the provider's error text in the
 * message body, so `degraded` was false and the existing suppression did not
 * apply. isProviderError already detected it and recorded an inference failure —
 * it simply never gated what the learner saw.
 *
 * The detection has to be narrow. Sarah tutors Security+ candidates, so a real
 * answer may legitimately begin "HTTP 403 means forbidden…", and suppressing
 * that would delete genuine teaching.
 */

import { describe, it, expect } from "vitest";
import {
  isBillingError,
  isProviderError,
  isRawProviderErrorEnvelope,
} from "../lib/sarah/inferenceStatus.js";

const OBSERVED =
  'HTTP 403: {"code":"unauthenticated:bad-credentials","error":"The OAuth token is invalid"}';

describe("raw provider error envelopes", () => {
  it("RAW-1: matches the envelope observed in production", () => {
    expect(isRawProviderErrorEnvelope(OBSERVED)).toBe(true);
  });

  it("RAW-2: matches other upstream statuses and array bodies", () => {
    expect(isRawProviderErrorEnvelope('HTTP 500: {"error":"upstream"}')).toBe(true);
    expect(isRawProviderErrorEnvelope('HTTP 429: [{"error":"rate limited"}]')).toBe(true);
    expect(isRawProviderErrorEnvelope('  HTTP 502: {"e":1}')).toBe(true);
  });

  it("RAW-3: does NOT match a learner-facing answer about HTTP status codes", () => {
    // This is the false positive that matters. isProviderError, which matches
    // any content starting with "HTTP ", would suppress all of these.
    const realTeaching = [
      "HTTP 403 means the server understood the request but refuses to authorize it.",
      "HTTP 401 versus HTTP 403 is a classic Security+ distractor: 401 is unauthenticated, 403 is unauthorized.",
      "HTTP status codes in the 4xx range indicate client errors.",
    ];
    for (const content of realTeaching) {
      expect(isRawProviderErrorEnvelope(content)).toBe(false);
    }
  });

  it("RAW-4: the broader isProviderError WOULD have suppressed that teaching", () => {
    // Documents precisely why a separate, stricter predicate exists.
    expect(isProviderError("HTTP 403 means the server refuses to authorize it.")).toBe(true);
    expect(isRawProviderErrorEnvelope("HTTP 403 means the server refuses to authorize it.")).toBe(false);
  });

  it("RAW-5: ordinary tutoring content is untouched", () => {
    expect(isRawProviderErrorEnvelope("Mitigation reduces probability or impact.")).toBe(false);
    expect(isRawProviderErrorEnvelope("")).toBe(false);
  });

  it("RAW-6: a billing envelope is still recognised as billing, and as raw", () => {
    const billing =
      'HTTP 403: {"code":"permission-denied","error":"used all available credits"}';
    expect(isBillingError(billing)).toBe(true);
    // Both classifications hold: it is a billing problem AND unfit to display.
    expect(isRawProviderErrorEnvelope(billing)).toBe(true);
  });
});
