import { promises as fs } from "node:fs";
import path from "node:path";

export class UploadInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadInspectionError";
  }
}

const MIME_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
  "image/gif": new Set([".gif"]),
  "application/pdf": new Set([".pdf"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set([".docx"]),
  "text/plain": new Set([".txt"]),
  "text/markdown": new Set([".md", ".markdown"]),
};

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function contentMatches(mimeType: string, bytes: Buffer): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
    case "image/webp":
      return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
        bytes.includes(Buffer.from("[Content_Types].xml")) &&
        bytes.includes(Buffer.from("word/document.xml"));
    case "text/plain":
    case "text/markdown":
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export async function inspectUploadedFile(file: {
  path: string;
  originalname: string;
  mimetype: string;
}): Promise<void> {
  const allowedExtensions = MIME_EXTENSIONS[file.mimetype];
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions?.has(extension)) {
    throw new UploadInspectionError("The file extension does not match an allowed file type.");
  }

  const bytes = await fs.readFile(file.path);
  if (bytes.length === 0 || !contentMatches(file.mimetype, bytes)) {
    throw new UploadInspectionError("The file contents do not match the declared file type.");
  }

  await fs.chmod(file.path, 0o600);
}
