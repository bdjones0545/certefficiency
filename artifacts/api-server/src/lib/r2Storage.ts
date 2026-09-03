/**
 * Cloudflare R2 storage service.
 *
 * - Uses @aws-sdk/client-s3 with region "auto" and the R2 endpoint.
 * - Credentials are read from environment variables at call time — never from
 *   the browser, never logged, never persisted.
 * - Object key validation prevents path traversal and arbitrary key injection.
 */

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Object key validation
// Only allow:  courses/<course-slug>/<filename>.<ext>
// ---------------------------------------------------------------------------

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/;

export class R2ObjectKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2ObjectKeyError";
    Object.setPrototypeOf(this, R2ObjectKeyError.prototype);
  }
}

export function validateObjectKey(key: string): void {
  if (!key) throw new R2ObjectKeyError("Object key must not be empty");
  if (key.startsWith("/"))
    throw new R2ObjectKeyError("Object key must not start with /");
  if (key.includes(".."))
    throw new R2ObjectKeyError("Object key must not contain ..");
  if (key.includes("\\"))
    throw new R2ObjectKeyError("Object key must not contain backslashes");

  const parts = key.split("/");
  // Required structure: courses / <slug> / <filename>
  if (parts.length !== 3 || parts[0] !== "courses") {
    throw new R2ObjectKeyError(
      `Object key must match courses/<course-slug>/<filename> — got: "${key}"`,
    );
  }

  const [, slug, filename] = parts;
  if (!SAFE_SEGMENT.test(slug)) {
    throw new R2ObjectKeyError(`Invalid course slug in object key: "${slug}"`);
  }
  if (!filename || !/^[a-zA-Z0-9][a-zA-Z0-9\-_.]*\.[a-zA-Z0-9]{1,10}$/.test(filename)) {
    throw new R2ObjectKeyError(
      `Invalid filename in object key: "${filename}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  signedUrlExpirationSeconds: number;
}

export function getR2Config(): R2Config {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;

  const missing: string[] = [];
  if (!accountId) missing.push("CLOUDFLARE_R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("CLOUDFLARE_R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("CLOUDFLARE_R2_BUCKET");

  if (missing.length > 0) {
    throw new Error(
      `[R2] Missing required environment variables: ${missing.join(", ")}. ` +
        `Add them as Replit Secrets before using R2 video playback.`,
    );
  }

  const endpoint =
    process.env.CLOUDFLARE_R2_ENDPOINT ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  const rawExpiry = process.env.R2_SIGNED_URL_EXPIRATION_SECONDS;
  const signedUrlExpirationSeconds =
    rawExpiry && !isNaN(parseInt(rawExpiry, 10))
      ? parseInt(rawExpiry, 10)
      : 900;

  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    endpoint,
    signedUrlExpirationSeconds,
  };
}

/**
 * Call during server startup to warn early if R2 credentials are missing.
 * Does NOT crash the server — other functionality (Stripe, auth, GCS) still works.
 */
export function validateR2Config(): boolean {
  try {
    getR2Config();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// S3 client factory
// ---------------------------------------------------------------------------

function createS3Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

// ---------------------------------------------------------------------------
// R2 Storage Service
// ---------------------------------------------------------------------------

export class R2StorageService {
  /**
   * Generate a short-lived presigned GET URL for a private R2 object.
   * The caller must verify authorization before calling this.
   * NEVER log the returned URL — it contains the signing credentials inline.
   */
  async getSignedPlaybackUrl(
    objectKey: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    validateObjectKey(objectKey);
    const config = getR2Config();
    const client = createS3Client(config);
    const expiry = expiresInSeconds ?? config.signedUrlExpirationSeconds;

    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    });

    return getSignedUrl(client, command, { expiresIn: expiry });
  }

  /** Check whether an object exists in R2 without downloading it. */
  async objectExists(objectKey: string): Promise<boolean> {
    validateObjectKey(objectKey);
    const config = getR2Config();
    const client = createS3Client(config);
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch object metadata (content-type, size, ETag) without downloading. */
  async getObjectMetadata(objectKey: string): Promise<{
    contentType: string | undefined;
    contentLength: number | undefined;
    lastModified: Date | undefined;
    etag: string | undefined;
  }> {
    validateObjectKey(objectKey);
    const config = getR2Config();
    const client = createS3Client(config);
    const result = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      lastModified: result.LastModified,
      etag: result.ETag,
    };
  }

  /** Permanently delete an object from R2. */
  async deleteObject(objectKey: string): Promise<void> {
    validateObjectKey(objectKey);
    const config = getR2Config();
    const client = createS3Client(config);
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }
}

export const r2Storage = new R2StorageService();
