/**
 * Text extraction for uploaded study materials.
 *
 * Sarah cannot read files.  Her prompt builder takes a transcript and a message
 * and nothing else, and her /v1/uploads/analyze endpoint explicitly refuses to
 * guess at contents it was not given — "I won't invent contents of files I
 * cannot read."  It expects the caller to supply the text.
 *
 * So an uploaded candidate handbook is worth nothing to a learner until this
 * side turns it into text.  Extraction happens once, at upload time, from the
 * multer temporary file — before persistValidatedUpload moves it to object
 * storage and unlinks it.
 *
 * Every failure here is non-fatal by design.  A handbook that cannot be parsed
 * should still upload and still be visible in the conversation; the learner
 * loses grounding, not their file.
 */

import { readFile } from "node:fs/promises";
import { logger } from "./logger";

/**
 * Upper bound on stored text.  A large handbook can run to hundreds of pages;
 * storing it whole would bloat the row without helping, since only an excerpt
 * is ever sent to Sarah.
 */
export const MAX_EXTRACTED_CHARS = 200_000;

/**
 * How much of the extracted text travels to Sarah with a message.
 *
 * Deliberately conservative. Her provider already stalls mid-stream on turns
 * around 7k tokens, and Sarah's prompt builder applies its own budget on top —
 * shipping more than she will use makes the request larger and the turn slower
 * for no gain.
 */
export const MAX_EXCERPT_CHARS = 6_000;

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PLAIN_TEXT_MIMES = ["text/plain", "text/markdown"];

/** True when this type is one we can turn into text at all. */
export function isExtractableMimeType(mimeType: string): boolean {
  return (
    mimeType === PDF_MIME ||
    mimeType === DOCX_MIME ||
    PLAIN_TEXT_MIMES.includes(mimeType)
  );
}

/**
 * Collapses the runs of whitespace that PDF layout extraction produces, without
 * destroying paragraph structure — blank lines carry meaning in an exam outline.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Truncates on a line boundary so an excerpt never ends mid-sentence. */
export function buildExcerpt(text: string, maxChars = MAX_EXCERPT_CHARS): string {
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  const lastBreak = clipped.lastIndexOf("\n");
  const body = lastBreak > maxChars * 0.5 ? clipped.slice(0, lastBreak) : clipped;
  return `${body.trimEnd()}\n\n[Excerpt truncated — the full document is longer.]`;
}

async function extractPdf(filePath: string): Promise<string> {
  // Imported lazily so the PDF engine is only loaded when a PDF is uploaded;
  // it is far larger than the rest of this route's dependencies.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = new Uint8Array(await readFile(filePath));
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractPlainText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}

export interface ExtractionResult {
  /** Normalised text, or null when this type carries none we can read. */
  text: string | null;
  /** Short machine-readable outcome, for logs and future diagnostics. */
  status: "extracted" | "empty" | "unsupported" | "failed";
}

/**
 * Extracts text from an uploaded file. Never throws.
 *
 * Images return `unsupported` rather than an empty string: there is no OCR
 * here, and claiming an image yielded no text would be indistinguishable from
 * a scanned page we failed to read.
 */
export async function extractUploadText(
  filePath: string,
  mimeType: string,
  context: { uploadId?: string; userId?: string } = {},
): Promise<ExtractionResult> {
  if (!isExtractableMimeType(mimeType)) {
    return { text: null, status: "unsupported" };
  }

  try {
    let raw: string;
    if (mimeType === PDF_MIME) {
      raw = await extractPdf(filePath);
    } else if (mimeType === DOCX_MIME) {
      raw = await extractDocx(filePath);
    } else {
      raw = await extractPlainText(filePath);
    }

    const normalized = normalizeExtractedText(raw).slice(0, MAX_EXTRACTED_CHARS);

    if (!normalized) {
      // A scanned handbook is the common case here: a real PDF with no text
      // layer. Worth distinguishing from a parse failure.
      logger.info({ ...context, mimeType }, "upload_text_extraction_empty");
      return { text: null, status: "empty" };
    }

    logger.info(
      { ...context, mimeType, chars: normalized.length },
      "upload_text_extraction_succeeded",
    );
    return { text: normalized, status: "extracted" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ ...context, mimeType, errorMsg }, "upload_text_extraction_failed");
    return { text: null, status: "failed" };
  }
}
