/**
 * server/upload-security.test.ts
 *
 * Phase 24 (F8): content validation + storage-key namespacing for
 * documents.upload / uploadVersion. Pure-function tests — no DB, no mocks.
 */
import { describe, expect, it } from "vitest";
import { validateUploadContent, normalizeStorageKey, STORAGE_KEY_MAX_LENGTH } from "./upload-security";

// ── Real magic-byte fixtures ────────────────────────────────────────────────
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32, 0x20)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0)]);
const TEXT = Buffer.from("claim_id,amount\nC-1,100.00\n", "utf8");

describe("validateUploadContent", () => {
  describe("accepts valid uploads", () => {
    it("accepts a real PDF", () => {
      expect(() => validateUploadContent({ fileName: "dispute.pdf", declaredMime: "application/pdf", bytes: PDF })).not.toThrow();
    });
    it("accepts a real PNG", () => {
      expect(() => validateUploadContent({ fileName: "scan.png", declaredMime: "image/png", bytes: PNG })).not.toThrow();
    });
    it("accepts a real JPEG (.jpg and .jpeg)", () => {
      expect(() => validateUploadContent({ fileName: "photo.jpg", declaredMime: "image/jpeg", bytes: JPEG })).not.toThrow();
      expect(() => validateUploadContent({ fileName: "photo.jpeg", declaredMime: "image/jpeg", bytes: JPEG })).not.toThrow();
    });
    it("accepts both TIFF byte orders", () => {
      expect(() => validateUploadContent({ fileName: "fax.tiff", declaredMime: "image/tiff", bytes: TIFF_LE })).not.toThrow();
      expect(() => validateUploadContent({ fileName: "fax.tiff", declaredMime: "image/tiff", bytes: TIFF_BE })).not.toThrow();
    });
    it("accepts a real xlsx (ZIP container)", () => {
      expect(() => validateUploadContent({
        fileName: "claims.xlsx",
        declaredMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: XLSX,
      })).not.toThrow();
    });
    it("accepts text formats without magic bytes (exempt by design)", () => {
      expect(() => validateUploadContent({ fileName: "notes.txt", declaredMime: "text/plain", bytes: TEXT })).not.toThrow();
      expect(() => validateUploadContent({ fileName: "claims.csv", declaredMime: "text/csv", bytes: TEXT })).not.toThrow();
    });
    it("is case-insensitive on extension and MIME", () => {
      expect(() => validateUploadContent({ fileName: "SCAN.PDF", declaredMime: "Application/PDF", bytes: PDF })).not.toThrow();
    });
  });

  describe("rejects invalid uploads", () => {
    it("rejects an empty file", () => {
      expect(() => validateUploadContent({ fileName: "a.pdf", declaredMime: "application/pdf", bytes: Buffer.alloc(0) }))
        .toThrow(/empty/i);
    });
    it("rejects an extension outside the allowlist", () => {
      expect(() => validateUploadContent({ fileName: "evil.exe", declaredMime: "application/octet-stream", bytes: PDF }))
        .toThrow(/not allowed/i);
      expect(() => validateUploadContent({ fileName: "page.html", declaredMime: "text/html", bytes: TEXT }))
        .toThrow(/not allowed/i);
    });
    it("rejects a file with no extension", () => {
      expect(() => validateUploadContent({ fileName: "noext", declaredMime: "application/pdf", bytes: PDF }))
        .toThrow(/not allowed/i);
    });
    it("rejects a declared MIME that does not match the extension", () => {
      expect(() => validateUploadContent({ fileName: "doc.pdf", declaredMime: "image/png", bytes: PDF }))
        .toThrow(/does not match/i);
    });
    it("rejects when magic bytes contradict the declared type (PDF declared, PNG bytes)", () => {
      expect(() => validateUploadContent({ fileName: "doc.pdf", declaredMime: "application/pdf", bytes: PNG }))
        .toThrow(/magic-byte/i);
    });
    it("rejects an executable masquerading as jpeg", () => {
      const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ header
      expect(() => validateUploadContent({ fileName: "photo.jpg", declaredMime: "image/jpeg", bytes: mz }))
        .toThrow(/magic-byte/i);
    });
    it("rejects a truncated file smaller than the signature", () => {
      expect(() => validateUploadContent({ fileName: "a.png", declaredMime: "image/png", bytes: Buffer.from([0x89, 0x50]) }))
        .toThrow(/magic-byte/i);
    });
    it("rejects a non-zip payload declared as xlsx", () => {
      expect(() => validateUploadContent({
        fileName: "claims.xlsx",
        declaredMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: TEXT,
      })).toThrow(/magic-byte/i);
    });
  });
});

describe("normalizeStorageKey", () => {
  it("namespaces a plain key under org/<orgId>/", () => {
    expect(normalizeStorageKey("org-1", "disputes/d1/doc.pdf")).toBe("org/org-1/disputes/d1/doc.pdf");
  });
  it("strips leading slashes", () => {
    expect(normalizeStorageKey("org-1", "/etc/passwd")).toBe("org/org-1/etc/passwd");
    expect(normalizeStorageKey("org-1", "///abs/key")).toBe("org/org-1/abs/key");
  });
  it("removes .. traversal segments (cannot escape the org namespace)", () => {
    // `..` segments are dropped outright; surviving segments stay INSIDE the
    // org namespace (we do not resolve "up-and-over", we delete the climb).
    expect(normalizeStorageKey("org-1", "../../other-org/doc.pdf")).toBe("org/org-1/other-org/doc.pdf");
    expect(normalizeStorageKey("org-1", "a/../../b.pdf")).toBe("org/org-1/a/b.pdf");
    expect(normalizeStorageKey("org-1", "..\\..\\windows\\win.ini")).toBe("org/org-1/windows/win.ini");
  });
  it("treats backslashes as separators and strips null bytes", () => {
    expect(normalizeStorageKey("org-1", "a\\b\\c.pdf")).toBe("org/org-1/a/b/c.pdf");
    expect(normalizeStorageKey("org-1", "a\0b.pdf")).toBe("org/org-1/ab.pdf");
  });
  it("collapses duplicate slashes and drops . segments", () => {
    expect(normalizeStorageKey("org-1", "a//b/./c.pdf")).toBe("org/org-1/a/b/c.pdf");
  });
  it("sanitizes the orgId segment too", () => {
    expect(normalizeStorageKey("../evil", "doc.pdf")).toBe("org/evil/doc.pdf");
  });
  it("rejects a key with nothing usable left", () => {
    expect(() => normalizeStorageKey("org-1", "../../..")).toThrow(/Invalid storage key/);
    expect(() => normalizeStorageKey("org-1", "")).toThrow(/Invalid storage key/);
    expect(() => normalizeStorageKey("org-1", "///")).toThrow(/Invalid storage key/);
  });
  it("rejects keys longer than 512 chars", () => {
    const long = `${"a".repeat(STORAGE_KEY_MAX_LENGTH)}.pdf`;
    expect(() => normalizeStorageKey("org-1", long)).toThrow(/too long/i);
  });
  it("accepts a key exactly at the limit", () => {
    // "org/" + "org-1/" = 9 chars of prefix; fill to exactly 512.
    const filler = "a".repeat(STORAGE_KEY_MAX_LENGTH - "org/org-1/".length - 4) + ".pdf";
    const key = normalizeStorageKey("org-1", filler);
    expect(key.length).toBe(STORAGE_KEY_MAX_LENGTH);
    expect(key.startsWith("org/org-1/")).toBe(true);
  });
});
