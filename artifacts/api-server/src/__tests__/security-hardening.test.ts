import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from "../lib/passwordReset";
import { getPublicBaseUrl, validateOrigin } from "../lib/publicUrl";
import {
  inspectUploadedFile,
  UploadInspectionError,
} from "../lib/uploadInspection";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("password reset tokens", () => {
  it("creates high-entropy tokens and stores only deterministic hashes", () => {
    const first = createPasswordResetToken();
    const second = createPasswordResetToken();

    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).toBe(hashPasswordResetToken(first.rawToken));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.rawToken);
  });
});

describe("trusted public URL resolution", () => {
  it("rejects paths, credentials, and insecure production origins", () => {
    expect(() => validateOrigin("https://example.com/path", true)).toThrow();
    expect(() => validateOrigin("https://user:pass@example.com", true)).toThrow();
    expect(() => validateOrigin("http://example.com", true)).toThrow();
  });

  it("uses configured server state rather than request-controlled data", () => {
    process.env.NODE_ENV = "production";
    process.env.CERTEFFICIENCY_PUBLIC_URL = "https://www.certefficiency.com";
    process.env.REPLIT_DOMAINS = "attacker.example";
    expect(getPublicBaseUrl()).toBe("https://www.certefficiency.com");
  });
});

describe("upload content inspection", () => {
  async function withFile(
    name: string,
    contents: Buffer,
    run: (filePath: string) => Promise<void>,
  ): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "certefficiency-upload-"));
    try {
      const filePath = path.join(directory, name);
      await writeFile(filePath, contents);
      await run(filePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("accepts content whose signature and extension match", async () => {
    await withFile("image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), async (filePath) => {
      await expect(inspectUploadedFile({
        path: filePath,
        originalname: "image.png",
        mimetype: "image/png",
      })).resolves.toBeUndefined();
    });
  });

  it("rejects spoofed MIME types and mismatched extensions", async () => {
    await withFile("image.png", Buffer.from("not actually a png"), async (filePath) => {
      await expect(inspectUploadedFile({
        path: filePath,
        originalname: "image.png",
        mimetype: "image/png",
      })).rejects.toBeInstanceOf(UploadInspectionError);
    });

    await withFile("image.txt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), async (filePath) => {
      await expect(inspectUploadedFile({
        path: filePath,
        originalname: "image.txt",
        mimetype: "image/png",
      })).rejects.toBeInstanceOf(UploadInspectionError);
    });
  });
});
