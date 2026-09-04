/**
 * Attachment rules shared by the composer and the chat page.
 *
 * These mirror the API's uploads route, which has always accepted documents —
 * only the picker was image-only, which made the product's central promise
 * (bring your candidate handbook, exam outline or professional standards)
 * impossible to fulfil from the UI.
 *
 * Kept free of JSX and React so it can be unit tested directly, the same way
 * lib/sarah-job.ts is.
 */

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export const ACCEPTED_MIME_TYPES: readonly string[] = [
  ...DOCUMENT_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
];

/**
 * Browsers disagree about Markdown and plain text, and often report an empty
 * type for .md — so the picker also offers these extensions and the guard below
 * falls back to them. Without this a learner's own notes are rejected as
 * "unsupported" purely because their OS has no MIME mapping for .md.
 */
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"] as const;

/** Matches MAX_FILE_SIZE in the API's uploads route. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type AttachmentKind = "image" | "document";

/** The subset of File this module needs — so tests need no DOM. */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function attachmentKindFor(file: FileLike): AttachmentKind {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(file.type) ? "image" : "document";
}

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isAcceptedFile(file: FileLike): boolean {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return true;
  // Unknown type — fall back to the extension rather than rejecting outright.
  return file.type === "" && hasAcceptedExtension(file.name);
}

/**
 * The two upload endpoints are not interchangeable: /uploads/images takes the
 * form field "image", while the general /uploads takes "file". Posting to one
 * with the other's field name fails with a confusing 400, so the pairing is
 * resolved in one place.
 */
export function uploadTargetFor(kind: AttachmentKind): { url: string; field: string } {
  return kind === "image"
    ? { url: "/api/uploads/images", field: "image" }
    : { url: "/api/uploads", field: "file" };
}

/**
 * Normalises the two response shapes: /uploads/images replies
 * `{ attachment: { id } }` while /uploads replies with the upload record
 * itself, carrying `id` at the top level. Returns null when neither is present
 * so the caller can fail loudly instead of sending an undefined id.
 */
export function extractAttachmentId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const nested = record.attachment;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }

  const topLevel = record.id;
  return typeof topLevel === "string" && topLevel ? topLevel : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The accept attribute for the file picker: MIME types plus extension fallbacks. */
export const FILE_PICKER_ACCEPT = [...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS].join(",");

export const UNSUPPORTED_FORMAT_MESSAGE =
  "Unsupported format. Accepted: PDF, DOCX, TXT, Markdown, JPEG, PNG, WebP, GIF.";
