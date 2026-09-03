import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, conversationsTable, uploadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { DeleteUploadParams } from "@workspace/api-zod";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../lib/logger";
import { generateSignedUploadUrl, getPublicBaseUrl, verifySignedToken } from "../lib/uploads-signing";
import jwt from "jsonwebtoken";
import { inspectUploadedFile, UploadInspectionError } from "../lib/uploadInspection";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const ALL_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  ...IMAGE_MIME_TYPES,
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const objectStorage = new ObjectStorageService();

function durableUploadsEnabled(): boolean {
  return Boolean(process.env.PRIVATE_OBJECT_DIR?.trim());
}

function unlinkTemporaryFile(filePath: string): Promise<void> {
  return new Promise((resolve) => fs.unlink(filePath, () => resolve()));
}

async function persistValidatedUpload(file: Express.Multer.File): Promise<string> {
  if (durableUploadsEnabled()) {
    const objectPath = await objectStorage.savePrivateUpload(
      file.filename,
      file.path,
      file.mimetype,
    );
    await unlinkTemporaryFile(file.path);
    return objectPath;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Private object storage is required for production uploads");
  }
  return file.path;
}

async function deleteStoredUpload(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  if (storagePath.startsWith("/objects/")) {
    await objectStorage.deleteObjectEntity(storagePath).catch((error) => {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    });
    return;
  }
  await unlinkTemporaryFile(storagePath);
}

function encodeContentDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function makeDiskStorage() {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
      cb(null, `${uuidv4()}${safeExt}`);
    },
  });
}

// General upload (all file types)
const upload = multer({
  storage: makeDiskStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not supported. Allowed: PDF, DOCX, TXT, Markdown, Images"));
    }
  },
});

// Image-only upload
const uploadImage = multer({
  storage: makeDiskStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are supported here (JPEG, PNG, WebP, GIF)."));
    }
  },
});

const router = Router();

// ---------------------------------------------------------------------------
// GET /uploads
// ---------------------------------------------------------------------------
router.get("/uploads", requireAuth, async (req, res): Promise<void> => {
  const uploads = await db.select()
    .from(uploadsTable)
    .where(eq(uploadsTable.userId, req.userId!));

  res.json(uploads);
});

// ---------------------------------------------------------------------------
// POST /uploads/images   (image-only, field: "image")
//
// Returns immediately with status "ready".  No Sarah pre-analysis — Sarah
// receives the image reference when the user sends a message.
// ---------------------------------------------------------------------------
router.post("/uploads/images", requireAuth, (req, res, next) => {
  uploadImage.single("image")(req, res, async (err) => {
    const reqLog = req.log;

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Image exceeds the 10 MB size limit." });
      return;
    }
    if (err) {
      res.status(400).json({ error: err.message || "Image upload failed." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No image provided." });
      return;
    }

    const file = req.file;

    reqLog.info(
      { userId: req.userId, mimeType: file.mimetype, sizeBytes: file.size },
      "image_upload_route_entered",
    );

    let persistedStoragePath: string | null = null;
    try {
      await inspectUploadedFile(file);
      persistedStoragePath = await persistValidatedUpload(file);
      reqLog.info(
        { userId: req.userId, mimeType: file.mimetype, sizeBytes: file.size },
        "image_upload_validated",
      );
      reqLog.info({ userId: req.userId }, "image_storage_started");

      const [record] = await db.insert(uploadsTable).values({
        userId: req.userId!,
        filename: file.filename,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: persistedStoragePath,
        status: "ready",
      }).returning();

      reqLog.info(
        { userId: req.userId, attachmentId: record.id, mimeType: file.mimetype, sizeBytes: file.size },
        "image_storage_completed",
      );

      reqLog.info(
        { userId: req.userId, attachmentId: record.id },
        "attachment_record_created",
      );

      res.status(201).json({
        attachment: {
          id: record.id,
          kind: "image",
          mimeType: record.mimeType,
          filename: record.originalFilename,
          sizeBytes: record.sizeBytes,
          status: record.status,
        },
      });
    } catch (e) {
      if (persistedStoragePath) await deleteStoredUpload(persistedStoragePath).catch(() => undefined);
      else await unlinkTemporaryFile(file.path);
      if (e instanceof UploadInspectionError) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /uploads  (general — all allowed types, field: "file")
// ---------------------------------------------------------------------------
router.post("/uploads", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File exceeds the 10 MB size limit." });
      return;
    }
    if (err) {
      res.status(400).json({ error: err.message || "Upload failed." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file provided." });
      return;
    }

    const { conversationId } = req.body;
    const file = req.file;

    let persistedStoragePath: string | null = null;
    try {
      await inspectUploadedFile(file);

      if (conversationId) {
        const [conversation] = await db
          .select({ id: conversationsTable.id })
          .from(conversationsTable)
          .where(
            and(
              eq(conversationsTable.id, conversationId),
              eq(conversationsTable.userId, req.userId!),
            ),
          )
          .limit(1);

        if (!conversation) {
          await unlinkTemporaryFile(file.path);
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
      }

      persistedStoragePath = await persistValidatedUpload(file);

      const [record] = await db.insert(uploadsTable).values({
        userId: req.userId!,
        conversationId: conversationId || null,
        filename: file.filename,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: persistedStoragePath,
        status: "processing",
      }).returning();

      res.status(201).json(record);
    } catch (e) {
      if (persistedStoragePath) await deleteStoredUpload(persistedStoragePath).catch(() => undefined);
      else await unlinkTemporaryFile(file.path);
      if (e instanceof UploadInspectionError) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /uploads/:id/file
//
// Serves the raw file bytes.  Accepts either:
//   (a) Authorization: Bearer <jwt>  — normal user auth (frontend <img> tags)
//   (b) ?token=<hmac>&expires=<ts>   — short-lived signed token (Sarah)
// ---------------------------------------------------------------------------
router.get("/uploads/:id/file", async (req, res): Promise<void> => {
  const uploadId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
    res.status(400).json({ error: "Invalid upload ID." });
    return;
  }

  // ── Auth: signed token (Sarah / server-to-server) ───────────────────────
  const { token, expires } = req.query as Record<string, string>;
  const secret = process.env.SESSION_SECRET || "";

  let authed = false;
  let userId: string | null = null;

  if (token && expires) {
    const expiresNum = parseInt(expires, 10);
    if (!isNaN(expiresNum) && verifySignedToken(uploadId, token, expiresNum, secret)) {
      authed = true; // token is valid — ownership is guaranteed by token itself
    }
  }

  // ── Auth: Bearer JWT (frontend) ─────────────────────────────────────────
  if (!authed) {
    const authHeader = req.headers.authorization || "";
    const jwtSecret = process.env.SESSION_SECRET || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { userId?: string; sub?: string };
        userId = payload.userId || payload.sub || null;
        if (userId) authed = true;
      } catch {
        // fall through to 401
      }
    }
  }

  if (!authed) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  // ── Fetch record ─────────────────────────────────────────────────────────
  const conditions = userId
    ? and(eq(uploadsTable.id, uploadId), eq(uploadsTable.userId, userId))
    : eq(uploadsTable.id, uploadId);

  const [record] = await db.select().from(uploadsTable).where(conditions).limit(1);

  if (!record) {
    res.status(404).json({ error: "Upload not found." });
    return;
  }

  if (!record.storagePath) {
    logger.error({ uploadId }, "Upload storage reference missing");
    res.status(404).json({ error: "File not found on server." });
    return;
  }

  const asciiFilename = path.basename(record.originalFilename)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encodedFilename = encodeContentDispositionFilename(path.basename(record.originalFilename));
  res.setHeader("Content-Type", record.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
  );
  res.setHeader("Cache-Control", "private, max-age=3600");

  if (record.storagePath.startsWith("/objects/")) {
    try {
      const objectFile = await objectStorage.getObjectEntityFile(record.storagePath);
      const [metadata] = await objectFile.getMetadata();
      if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
      objectFile.createReadStream().on("error", (error) => {
        logger.error({ uploadId, err: error }, "Upload object stream failed");
        if (!res.headersSent) res.status(404).json({ error: "File not found." });
        else res.destroy(error);
      }).pipe(res);
      return;
    } catch (error) {
      logger.error({ uploadId, err: error }, "Upload object missing");
      res.status(404).json({ error: "File not found on server." });
      return;
    }
  }

  if (!fs.existsSync(record.storagePath)) {
    logger.error({ uploadId }, "Upload file missing from disk");
    res.status(404).json({ error: "File not found on server." });
    return;
  }

  fs.createReadStream(record.storagePath).pipe(res);
});

// ---------------------------------------------------------------------------
// DELETE /uploads/:id
// ---------------------------------------------------------------------------
router.delete("/uploads/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteUploadParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [record] = await db.select()
    .from(uploadsTable)
    .where(and(eq(uploadsTable.id, params.data.id), eq(uploadsTable.userId, req.userId!)))
    .limit(1);

  if (!record) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }

  await deleteStoredUpload(record.storagePath);

  await db.delete(uploadsTable).where(eq(uploadsTable.id, record.id));
  res.sendStatus(204);
});

export { generateSignedUploadUrl, getPublicBaseUrl };
export default router;
