/**
 * Attachment rules — regression tests for document upload support.
 *
 * Before this, the picker accepted only images while the API had always
 * accepted PDF, DOCX, TXT and Markdown. That made the product's central promise
 * — bring your candidate handbook, exam outline or professional standards —
 * impossible to fulfil from the UI.
 *
 * The two upload endpoints are easy to get wrong: they differ in BOTH the form
 * field name and the response shape, so both pairings are pinned here.
 */

import { describe, it, expect } from "vitest";
import {
  ACCEPTED_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  FILE_PICKER_ACCEPT,
  MAX_UPLOAD_BYTES,
  attachmentKindFor,
  extractAttachmentId,
  formatBytes,
  isAcceptedFile,
  uploadTargetFor,
} from "@/lib/attachments";

const file = (name: string, type: string, size = 1024) => ({ name, type, size });

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("accepted formats", () => {
  it("ATT-1: accepts the document types the API allows", () => {
    for (const type of DOCUMENT_MIME_TYPES) {
      expect(isAcceptedFile(file("materials", type))).toBe(true);
    }
  });

  it("ATT-2: accepts a candidate handbook PDF — the headline use case", () => {
    expect(isAcceptedFile(file("Candidate Handbook.pdf", PDF))).toBe(true);
    expect(isAcceptedFile(file("Instructor Notes.docx", DOCX))).toBe(true);
  });

  it("ATT-3: still accepts images", () => {
    expect(isAcceptedFile(file("whiteboard.jpg", "image/jpeg"))).toBe(true);
    expect(isAcceptedFile(file("diagram.png", "image/png"))).toBe(true);
  });

  it("ATT-4: accepts .md when the browser reports no MIME type", () => {
    // Chrome and Safari commonly hand back "" for Markdown; rejecting on that
    // alone would turn a learner's own notes into an unsupported format.
    expect(isAcceptedFile(file("my-notes.md", ""))).toBe(true);
    expect(isAcceptedFile(file("outline.markdown", ""))).toBe(true);
    expect(isAcceptedFile(file("cheatsheet.txt", ""))).toBe(true);
  });

  it("ATT-5: rejects genuinely unsupported types, including empty-type binaries", () => {
    expect(isAcceptedFile(file("lecture.mp4", "video/mp4"))).toBe(false);
    expect(isAcceptedFile(file("archive.zip", "application/zip"))).toBe(false);
    expect(isAcceptedFile(file("mystery.bin", ""))).toBe(false);
  });

  it("ATT-6: the picker offers documents, not only images", () => {
    expect(FILE_PICKER_ACCEPT).toContain(PDF);
    expect(FILE_PICKER_ACCEPT).toContain(DOCX);
    expect(FILE_PICKER_ACCEPT).toContain(".md");
    expect(FILE_PICKER_ACCEPT).toContain("image/png");
  });

  it("ATT-7: the client size cap matches the server's 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("attachment kind", () => {
  it("ATT-8: images are images, everything else is a document", () => {
    expect(attachmentKindFor(file("a.png", "image/png"))).toBe("image");
    expect(attachmentKindFor(file("a.gif", "image/gif"))).toBe("image");
    expect(attachmentKindFor(file("handbook.pdf", PDF))).toBe("document");
    expect(attachmentKindFor(file("notes.md", ""))).toBe("document");
  });
});

describe("upload routing", () => {
  it("ATT-9: images go to /uploads/images under the field 'image'", () => {
    expect(uploadTargetFor("image")).toEqual({ url: "/api/uploads/images", field: "image" });
  });

  it("ATT-10: documents go to /uploads under the field 'file'", () => {
    // Posting a document to the image endpoint, or under the wrong field name,
    // fails with an opaque 400 — so the pairing is asserted, not assumed.
    expect(uploadTargetFor("document")).toEqual({ url: "/api/uploads", field: "file" });
  });
});

describe("upload response normalisation", () => {
  it("ATT-11: reads the nested id from the image endpoint", () => {
    expect(extractAttachmentId({ attachment: { id: "img-1", kind: "image" } })).toBe("img-1");
  });

  it("ATT-12: reads the top-level id from the general endpoint's record", () => {
    expect(extractAttachmentId({ id: "doc-1", mimeType: PDF, status: "processing" })).toBe("doc-1");
  });

  it("ATT-13: returns null rather than an undefined id when neither shape matches", () => {
    // The caller turns null into a visible failure; a silent undefined would be
    // sent to the message endpoint as an attachment that does not exist.
    expect(extractAttachmentId({})).toBeNull();
    expect(extractAttachmentId(null)).toBeNull();
    expect(extractAttachmentId("nope")).toBeNull();
    expect(extractAttachmentId({ attachment: {} })).toBeNull();
    expect(extractAttachmentId({ id: "" })).toBeNull();
  });
});

describe("size formatting", () => {
  it("ATT-14: reports sizes a learner can sanity-check", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("client/server parity", () => {
  it("ATT-15: the client allowlist matches the API's ALL_ALLOWED_MIME_TYPES", () => {
    // Kept explicit so that widening one side without the other fails here
    // rather than as a 400 the learner sees.
    expect([...ACCEPTED_MIME_TYPES].sort()).toEqual(
      [
        PDF,
        DOCX,
        "text/plain",
        "text/markdown",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ].sort(),
    );
  });
});
