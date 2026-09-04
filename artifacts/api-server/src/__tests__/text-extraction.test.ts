/**
 * Text extraction from uploaded study materials.
 *
 * Sarah has no file reader — her upload endpoint says so outright ("I won't
 * invent contents of files I cannot read") and her prompt builder only ever
 * received a transcript. So an uploaded candidate handbook reaches the model
 * only if this side turns it into text first.
 *
 * These run against REAL files, not mocks: a PDF produced by a real print
 * pipeline and a real DOCX zip container. A mocked parser would prove only that
 * the mock returns what it was told to.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_EXCERPT_CHARS,
  buildExcerpt,
  extractUploadText,
  isExtractableMimeType,
  normalizeExtractedText,
} from "../lib/textExtraction.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("extracting real files", () => {
  it("EXT-1: reads text out of a real PDF", async () => {
    const result = await extractUploadText(fixture("exam-outline.pdf"), PDF);

    expect(result.status).toBe("extracted");
    expect(result.text).toContain("CSCS Exam Content Outline");
    expect(result.text).toContain("phosphagen system");
  }, 30_000);

  it("EXT-2: reads text out of a real DOCX", async () => {
    const result = await extractUploadText(fixture("instructor-notes.docx"), DOCX);

    expect(result.status).toBe("extracted");
    expect(result.text).toContain("periodization is planned variation");
  }, 30_000);

  it("EXT-3: reads Markdown and plain text directly", async () => {
    const result = await extractUploadText(fixture("study-notes.md"), "text/markdown");

    expect(result.status).toBe("extracted");
    expect(result.text).toContain("Domain 2: Program Design");
  });
});

describe("failure handling", () => {
  it("EXT-4: a corrupt PDF fails without throwing, so the upload still succeeds", async () => {
    // Extraction is best-effort: a handbook we cannot parse must still upload.
    const result = await extractUploadText(fixture("corrupt.pdf"), PDF);

    expect(result.status).toBe("failed");
    expect(result.text).toBeNull();
  }, 30_000);

  it("EXT-5: a missing file fails without throwing", async () => {
    const result = await extractUploadText(fixture("does-not-exist.pdf"), PDF);

    expect(result.status).toBe("failed");
    expect(result.text).toBeNull();
  }, 30_000);

  it("EXT-6: images report unsupported rather than empty", async () => {
    // There is no OCR here. Reporting "empty" would be indistinguishable from a
    // scanned page we tried and failed to read.
    const result = await extractUploadText(fixture("exam-outline.pdf"), "image/png");

    expect(result.status).toBe("unsupported");
    expect(result.text).toBeNull();
  });

  it("EXT-7: knows which types it can handle", () => {
    expect(isExtractableMimeType(PDF)).toBe(true);
    expect(isExtractableMimeType(DOCX)).toBe(true);
    expect(isExtractableMimeType("text/markdown")).toBe(true);
    expect(isExtractableMimeType("image/jpeg")).toBe(false);
  });
});

describe("normalisation", () => {
  it("EXT-8: collapses PDF whitespace but keeps paragraph breaks", () => {
    const out = normalizeExtractedText("Domain   1:   Sciences\n\n\n\nDomain 2\r\nProgram");

    expect(out).toBe("Domain 1: Sciences\n\nDomain 2\nProgram");
  });
});

describe("excerpting", () => {
  it("EXT-9: short text passes through untouched", () => {
    expect(buildExcerpt("short outline")).toBe("short outline");
  });

  it("EXT-10: long text is bounded and says so", () => {
    const excerpt = buildExcerpt("line of outline text\n".repeat(2000));

    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 100);
    expect(excerpt).toContain("[Excerpt truncated");
  });

  it("EXT-11: truncation lands on a line boundary, not mid-sentence", () => {
    const body = buildExcerpt("alpha\nbravo\ncharlie\n".repeat(1000)).split(
      "\n\n[Excerpt truncated",
    )[0];

    // Every retained line is a whole word from the source, never a fragment.
    for (const line of body.split("\n").filter(Boolean)) {
      expect(["alpha", "bravo", "charlie"]).toContain(line);
    }
  });
});
