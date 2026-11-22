/**
 * server/upload-security.ts
 *
 * Phase 24 (F8 / supply-chain+secrets audit §4): content validation and
 * storage-key namespacing for document uploads (documents.upload /
 * uploadVersion in server/routers.ts).
 *
 * Two independent controls, both pure and unit-testable:
 *
 * 1. validateUploadContent — the previous pipeline trusted a client-declared
 *    `fileType: z.string().min(1)` and stored arbitrary bytes under it (no
 *    magic-byte sniffing, no extension/MIME allowlist). This enforces a
 *    closed allowlist of document types and verifies the actual bytes
 *    against the declared type for binary formats (pdf/png/jpeg/tiff/xlsx);
 *    text formats (txt/csv) have no reliable magic and are exempt from
 *    byte-sniffing by design.
 *
 * 2. normalizeStorageKey — `storageKey` was fully client-controlled and
 *    server/storage.ts normalizeKey only stripped leading slashes, so a
 *    user with write access to one dispute could write `../`-style or
 *    cross-tenant keys and overwrite other tenants' objects in the storage
 *    proxy. This forces every key into an `org/<orgId>/` namespace with all
 *    traversal segments, backslashes, null bytes, and duplicate slashes
 *    removed.
 *
 * Both throw TRPCError(BAD_REQUEST) so tRPC call sites surface a clean 400.
 */

import { TRPCError } from "@trpc/server";

// ── Content validation ──────────────────────────────────────────────────────

/** Closed allowlist: extension (lowercase, no dot) → accepted MIME types. */
const ALLOWED_TYPES: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  tiff: ["image/tiff"],
  txt: ["text/plain"],
  csv: ["text/csv"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
};

/** Extensions whose bytes carry a verifiable magic signature. */
const MAGIC_SIGNATURES: Record<string, readonly number[][]> = {
  // %PDF-
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  // \x89PNG\r\n\x1a\n
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // JPEG SOI + marker
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  // TIFF little-endian (II*\0) or big-endian (MM\0*)
  tiff: [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
  // xlsx is a ZIP container: PK\x03\x04
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
};

function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : "";
}

function matchesAnySignature(bytes: Buffer, signatures: readonly number[][]): boolean {
  return signatures.some(sig => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b));
}

/**
 * Validate an upload's declared type against a closed allowlist and, for
 * binary formats, against the actual magic bytes. Throws TRPCError
 * (BAD_REQUEST) on: empty file, unknown extension, extension/MIME mismatch,
 * or magic bytes that do not match the declared type.
 */
export function validateUploadContent(opts: {
  fileName: string;
  declaredMime: string;
  bytes: Buffer;
}): void {
  const { fileName, declaredMime, bytes } = opts;

  if (!bytes || bytes.byteLength === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Upload is empty" });
  }

  const ext = extensionOf(fileName);
  const allowedMimes = ALLOWED_TYPES[ext];
  if (!allowedMimes) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `File type ".${ext || "?"}" is not allowed (allowed: ${Object.keys(ALLOWED_TYPES).join(", ")})`,
    });
  }

  const mime = declaredMime.trim().toLowerCase();
  if (!allowedMimes.includes(mime)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Declared content type "${declaredMime}" does not match ".${ext}" (expected ${allowedMimes.join(" or ")})`,
    });
  }

  // Text formats (txt/csv) carry no reliable magic bytes — exempt by design.
  const signatures = MAGIC_SIGNATURES[ext];
  if (signatures && !matchesAnySignature(bytes, signatures)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `File content does not match declared type ".${ext}" (magic-byte check failed)`,
    });
  }
}

// ── Storage key namespacing ─────────────────────────────────────────────────

export const STORAGE_KEY_MAX_LENGTH = 512;

/**
 * Namespace and sanitize a user-provided storage key into
 * `org/<orgId>/<sanitized>`:
 *   - backslashes are treated as path separators, then every `..`/`.`
 *     segment is dropped (no traversal out of the org namespace);
 *   - null bytes are removed; duplicate slashes collapse;
 *   - the orgId segment is sanitized the same way;
 *   - the final key must be ≤ 512 chars.
 * Throws TRPCError(BAD_REQUEST) when nothing usable remains or the key is
 * too long — a silent rewrite would risk two hostile keys colliding onto
 * one object.
 */
export function normalizeStorageKey(orgId: string, userProvidedKey: string): string {
  const cleanSegment = (value: string): string[] =>
    value
      .replace(/\0/g, "")
      .replace(/\\/g, "/")
      .split("/")
      .map(seg => seg.trim())
      .filter(seg => seg.length > 0 && seg !== "." && seg !== "..");

  const orgSegments = cleanSegment(orgId);
  if (orgSegments.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid organization id for storage key" });
  }
  const keySegments = cleanSegment(userProvidedKey);
  if (keySegments.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid storage key" });
  }

  const key = ["org", ...orgSegments, ...keySegments].join("/");
  if (key.length > STORAGE_KEY_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Storage key is too long (${key.length} > ${STORAGE_KEY_MAX_LENGTH})`,
    });
  }
  return key;
}
