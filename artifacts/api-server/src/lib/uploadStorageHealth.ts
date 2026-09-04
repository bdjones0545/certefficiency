/**
 * Why an upload failed, in a form the caller can act on.
 *
 * Uploads have been failing in production with a bare
 * `{"error":"Internal server error"}`. The real exception was logged all along
 * by the global error handler, but that is only reachable from the deployment
 * console — so diagnosing it from outside meant probing five endpoints and
 * reasoning from status codes, and still ending up unsure.
 *
 * The fix is not to leak the exception. It is to return a coarse, safe CODE
 * saying which link in the chain broke, so an operator (or a support request)
 * can go straight to the right cause. The human-readable message stays generic;
 * the code carries the signal.
 *
 * Storage in production goes: PRIVATE_OBJECT_DIR must be set → the Replit
 * sidecar at 127.0.0.1:1106 must be reachable to mint credentials → the bucket
 * write must succeed. Each link fails differently and needs a different fix,
 * and previously all three looked identical from outside.
 */

export const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export type UploadStorageCode =
  /** PRIVATE_OBJECT_DIR is absent — Object Storage was never provisioned. */
  | "storage_not_configured"
  /** The Replit credential sidecar did not answer — storage cannot authenticate. */
  | "storage_unreachable"
  /** Configured and reachable, but the write itself failed. */
  | "storage_write_failed";

export interface UploadStorageProblem {
  code: UploadStorageCode;
  /** Operator-facing detail. Logged; never returned in an API response body. */
  detail: string;
}

export function privateObjectDirConfigured(): boolean {
  return Boolean(process.env.PRIVATE_OBJECT_DIR?.trim());
}

/**
 * Classifies a failure thrown while persisting an upload.
 *
 * Deliberately conservative: anything that is not recognisably a configuration
 * or connectivity problem is reported as a write failure rather than being
 * dressed up as a diagnosis we cannot support.
 */
export function classifyStorageFailure(err: unknown): UploadStorageProblem {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("PRIVATE_OBJECT_DIR")) {
    return { code: "storage_not_configured", detail: message };
  }

  // The sidecar mints the credentials the storage client uses. When it is
  // absent — which is the interesting case in an autoscale deployment — the
  // failure surfaces as a connection error or as the client's own "make sure
  // you're running on Replit" message.
  const sidecarSignals = [
    "ECONNREFUSED",
    "127.0.0.1:1106",
    "make sure you're running on Replit",
    "external_account",
    "Unable to detect a Project Id",
    "invalid_grant",
    "getaddrinfo",
  ];
  if (sidecarSignals.some((s) => message.includes(s))) {
    return { code: "storage_unreachable", detail: message };
  }

  return { code: "storage_write_failed", detail: message };
}

/**
 * Actively checks that storage could work, rather than only that a variable is
 * set. Used at boot so a misconfiguration is visible before the first learner
 * hits it.
 *
 * This is the distinction the previous check got wrong: confirming
 * PRIVATE_OBJECT_DIR is a non-empty string proves nothing about whether the
 * sidecar that authenticates against it is reachable.
 */
export async function probeUploadStorage(
  timeoutMs = 3000,
): Promise<UploadStorageProblem | null> {
  if (!privateObjectDirConfigured()) {
    return {
      code: "storage_not_configured",
      detail: "PRIVATE_OBJECT_DIR is not set",
    };
  }

  try {
    const res = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/credential`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        code: "storage_unreachable",
        detail: `Replit object-storage sidecar returned HTTP ${res.status}`,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: "storage_unreachable",
      detail: `Replit object-storage sidecar unreachable: ${message}`,
    };
  }

  return null;
}

/** The message shown to a learner. Never carries the underlying detail. */
export const UPLOAD_UNAVAILABLE_MESSAGE =
  "File uploads are temporarily unavailable. This is a server-side problem, " +
  "not a problem with your file.";
