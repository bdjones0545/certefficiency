/**
 * Verifies that all expected R2 video objects exist and are readable.
 *
 * Uses HeadObject (no data download) to confirm:
 *   - the object exists
 *   - the credentials can read it
 *   - the file size is nonzero
 *   - the content type is video/mp4 (or a known-compatible type)
 *
 * Requires R2 credentials in the environment:
 *   CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID,
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET
 *
 * Run:  pnpm --filter @workspace/scripts run verify-r2
 */

import {
  S3Client,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

// All 11 expected objects in R2 (including lesson-11 which has no DB record yet)
const EXPECTED_OBJECTS = [
  "courses/ai-agent-builder/lesson-1.mp4",
  "courses/ai-agent-builder/lesson-2.mp4",
  "courses/ai-agent-builder/lesson-3.mp4",
  "courses/ai-agent-builder/lesson-4.mp4",
  "courses/ai-agent-builder/lesson-5.mp4",
  "courses/ai-agent-builder/lesson-6.mp4",
  "courses/ai-agent-builder/lesson-7.mp4",
  "courses/ai-agent-builder/lesson-8.mp4",
  "courses/ai-agent-builder/lesson-9.mp4",
  "courses/ai-agent-builder/lesson-10.mp4",
  "courses/ai-agent-builder/lesson-11.mp4",
];

const COMPATIBLE_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/mpeg",
  "application/octet-stream", // some uploaders don't set a content type
]);

interface VerificationResult {
  key: string;
  status: "ok" | "missing" | "empty" | "wrong_type" | "error";
  size: number | undefined;
  contentType: string | undefined;
  etag: string | undefined;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function verifyObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<VerificationResult> {
  let meta: HeadObjectCommandOutput;

  try {
    meta = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 / NoSuchKey means the object genuinely doesn't exist
    if (msg.includes("404") || msg.includes("NoSuchKey") || msg.includes("Not Found")) {
      return { key, status: "missing", size: undefined, contentType: undefined, etag: undefined };
    }
    return {
      key,
      status: "error",
      size: undefined,
      contentType: undefined,
      etag: undefined,
      error: msg,
    };
  }

  const size = meta.ContentLength;
  const contentType = meta.ContentType;
  const etag = meta.ETag;

  if (!size || size === 0) {
    return { key, status: "empty", size, contentType, etag };
  }

  const typeOk =
    !contentType || COMPATIBLE_CONTENT_TYPES.has(contentType.split(";")[0].trim());

  if (!typeOk) {
    return { key, status: "wrong_type", size, contentType, etag };
  }

  return { key, status: "ok", size, contentType, etag };
}

async function main() {
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
    console.error(`\n✗ Missing required environment variables: ${missing.join(", ")}`);
    console.error("  Add them to Replit Secrets before running this script.\n");
    process.exit(1);
  }

  const endpoint =
    process.env.CLOUDFLARE_R2_ENDPOINT ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });

  console.log(`\nVerifying ${EXPECTED_OBJECTS.length} R2 objects in bucket "${bucket}"...\n`);
  console.log("  course.media.verification.started");
  console.log();

  const results = await Promise.all(
    EXPECTED_OBJECTS.map((key) => verifyObject(client, bucket!, key)),
  );

  // ── Print results table ───────────────────────────────────────────────────
  const colKey = 48;
  console.log(
    "  " +
      "Object Key".padEnd(colKey) +
      "  Status".padEnd(12) +
      "  Size".padEnd(14) +
      "  Content-Type",
  );
  console.log("  " + "─".repeat(90));

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : "✗";
    const sizeStr = r.size != null ? formatBytes(r.size) : "—";
    const typeStr = r.contentType ?? "—";

    const statusLabel = r.status === "ok" ? "ok" : r.status.replace("_", " ");
    console.log(
      `  ${icon} ${r.key.padEnd(colKey - 2)}  ${statusLabel.padEnd(10)}  ${sizeStr.padEnd(12)}  ${typeStr}`,
    );
    if (r.error) console.log(`     Error: ${r.error}`);
    if (r.status === "ok") passed++;
    else failed++;
  }

  console.log();

  if (failed === 0) {
    console.log(`  ✓ course.media.verification.completed — all ${passed} objects verified\n`);
  } else {
    console.log(`  ✗ course.media.verification.failed — ${failed} object(s) failed\n`);
  }

  // ── Known mismatch note ───────────────────────────────────────────────────
  const l11 = results.find((r) => r.key.includes("lesson-11"));
  if (l11?.status === "ok") {
    console.log(
      "  ⚠  Note: lesson-11.mp4 exists in R2 but has no DB record.",
      "\n     Create the Lesson 11 record and add it to the seed script to expose it to students.",
    );
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ course.media.verification.failed\n  ", err.message ?? err);
  process.exit(1);
});
