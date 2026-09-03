/**
 * Uploads the Lesson 1 video (and a thumbnail) from attached_assets/ to GCS
 * and updates the platform_lessons DB record.
 *
 * Run:  pnpm --filter @workspace/scripts run upload-lesson1
 * Safe to re-run — idempotent: always replaces the existing lesson record fields.
 */
import { Storage } from "@google-cloud/storage";
import { createReadStream } from "fs";
import { stat, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

// ─── GCS client (Replit sidecar auth) ────────────────────────────────────────
const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

// ─── Config ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const VIDEO_SRC = path.join(
  REPO_ROOT,
  "attached_assets/Welcome_to_Build_Your_First_Complete_AI_Agent_1080p_1785097455566.mp4",
);
const MIME_TYPE = "video/mp4";
const ORIGINAL_FILENAME = "Welcome_to_Build_Your_First_Complete_AI_Agent_1080p.mp4";
const DURATION_SECS = 191; // confirmed via ffprobe

const THUMBNAIL_TMP = "/tmp/lesson1_thumbnail.jpg";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePrivateDir(privateDir: string): { bucketName: string; prefix: string } {
  const clean = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const parts = clean.split("/");
  return { bucketName: parts[0], prefix: parts.slice(1).join("/") };
}

async function uploadFile(
  bucket: ReturnType<Storage["bucket"]>,
  objectName: string,
  srcPath: string,
  mimeType: string,
  label: string,
): Promise<void> {
  const fileStat = await stat(srcPath);
  const totalBytes = fileStat.size;
  const gcsFile = bucket.file(objectName);

  await new Promise<void>((resolve, reject) => {
    const read = createReadStream(srcPath);
    const write = gcsFile.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: totalBytes > 5 * 1024 * 1024,
    });
    let done = 0;
    read.on("data", (c: Buffer) => {
      done += c.length;
      process.stdout.write(
        `\r  ${label}: ${((done / totalBytes) * 100).toFixed(0)}%  (${(done / 1024 / 1024).toFixed(1)} MB)`,
      );
    });
    read.pipe(write);
    write.on("finish", () => { process.stdout.write("\n"); resolve(); });
    write.on("error", reject);
    read.on("error", reject);
  });

  // Mark as public in GCS custom metadata (matches objectAcl.ts convention)
  await gcsFile.setMetadata({
    metadata: { aclPolicy: JSON.stringify({ visibility: "public", permissions: {} }) },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  const dbUrl = process.env.DATABASE_URL;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR is not set");
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  const { bucketName, prefix } = parsePrivateDir(privateDir);
  const bucket = storage.bucket(bucketName);

  console.log(`Bucket: ${bucketName}  prefix: ${prefix || "(none)"}`);

  // ── 1. Extract thumbnail if not already done ──────────────────────────────
  try {
    await stat(THUMBNAIL_TMP);
    console.log("✓ Thumbnail already extracted at", THUMBNAIL_TMP);
  } catch {
    console.log("Extracting thumbnail with ffmpeg…");
    execSync(
      `ffmpeg -y -ss 3 -i "${VIDEO_SRC}" -vframes 1 -q:v 3 "${THUMBNAIL_TMP}"`,
      { stdio: "pipe" },
    );
    console.log("✓ Thumbnail extracted");
  }

  const videoFileId = randomUUID();
  const thumbFileId = randomUUID();

  const videoObjectName = prefix ? `${prefix}/uploads/${videoFileId}` : `uploads/${videoFileId}`;
  const thumbObjectName = prefix
    ? `${prefix}/thumbnails/${thumbFileId}.jpg`
    : `thumbnails/${thumbFileId}.jpg`;

  const videoObjectPath = `/objects/uploads/${videoFileId}`;
  const thumbObjectPath = `/objects/thumbnails/${thumbFileId}.jpg`;

  // ── 2. Upload thumbnail ───────────────────────────────────────────────────
  console.log(`\nUploading thumbnail to gs://${bucketName}/${thumbObjectName} …`);
  await uploadFile(bucket, thumbObjectName, THUMBNAIL_TMP, "image/jpeg", "Thumbnail");
  console.log("✓ Thumbnail uploaded. objectPath:", thumbObjectPath);

  // ── 3. Upload video ───────────────────────────────────────────────────────
  const videoStat = await stat(VIDEO_SRC);
  const fileSizeBytes = videoStat.size;
  console.log(
    `\nUploading video (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB) to gs://${bucketName}/${videoObjectName} …`,
  );
  await uploadFile(bucket, videoObjectName, VIDEO_SRC, MIME_TYPE, "Video");
  console.log("✓ Video uploaded. objectPath:", videoObjectPath);

  // ── 4. Update DB ──────────────────────────────────────────────────────────
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const courseRes = await pool.query(
      "SELECT id FROM platform_courses WHERE slug = 'ai-agent-builder' LIMIT 1",
    );
    if (!courseRes.rows.length) throw new Error("Course 'ai-agent-builder' not found");
    const courseId = courseRes.rows[0].id as string;

    const updateRes = await pool.query(
      `UPDATE platform_lessons
       SET video_object_path       = $1,
           video_filename          = $2,
           video_mime_type         = $3,
           video_file_size_bytes   = $4,
           video_duration_secs     = $5,
           video_upload_status     = 'completed',
           video_processing_status = 'ready',
           video_uploaded_at       = NOW(),
           video_thumbnail_path    = $6,
           updated_at              = NOW()
       WHERE course_id = $7 AND "order" = 1
       RETURNING id, title, "order"`,
      [
        videoObjectPath,
        ORIGINAL_FILENAME,
        MIME_TYPE,
        fileSizeBytes,
        DURATION_SECS,
        thumbObjectPath,
        courseId,
      ],
    );

    if (!updateRes.rows.length) throw new Error("Lesson 1 not found for course " + courseId);
    const lesson = updateRes.rows[0];
    console.log(`\n✓ DB updated — Lesson ${lesson.order}: "${lesson.title}" (id: ${lesson.id})`);
  } finally {
    await pool.end();
  }

  console.log(`
────────────────────────────────────────
Upload complete.

  Video path  : ${videoObjectPath}
  Thumb path  : ${thumbObjectPath}
  Size        : ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB
  Duration    : ${DURATION_SECS}s
  AI_LESSON_1_VIDEO_ID : no longer needed for Lesson 1
────────────────────────────────────────`);
}

main().catch((err) => { console.error(err); process.exit(1); });
