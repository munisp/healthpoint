/**
 * server/ingest/drop-folder.ts
 *
 * Phase 19: drop-folder poller — watches DROP_FOLDER_PATH for new stable
 * files and drives the SAME chunked pipeline as web uploads (create session
 * -> insert chunks -> finalize -> ingestion runner). No separate code path.
 *
 * Env (all documented in .env.example):
 *  - DROP_FOLDER_ENABLED   (default off; poller only starts when "true")
 *  - DROP_FOLDER_PATH      (directory to watch)
 *  - DROP_FOLDER_POLL_MS   (default 30000)
 *  - DROP_FOLDER_ORG_MAP   (JSON {"filename-prefix":"orgId"} — first matching
 *                           prefix wins; unmatched files are skipped)
 *  - DROP_FOLDER_UPLOADED_BY (optional user id recorded as created_by;
 *                           defaults to "drop-folder")
 *
 * SFTP is a deployment-level adapter only (cron rsync/sftp into
 * DROP_FOLDER_PATH); it is intentionally NOT built in this phase.
 *
 * File-type detection: extension (.csv/.ndjson/.837/.835). Unknown
 * extensions are skipped. A file is "stable" when its size is unchanged
 * across two polls. Processed files are renamed to `<name>.done`.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { bulkUploadSessions, bulkUploadChunks } from "../../drizzle/schema-bulk-upload";
import { startIngestion, assembleSha256 } from "./bulk-ingest";

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

interface DropFolderConfig {
  path: string;
  pollMs: number;
  orgMap: Record<string, string>;
  uploadedBy: string;
}

function loadConfig(): DropFolderConfig | null {
  const dir = process.env.DROP_FOLDER_PATH;
  if (!dir) {
    console.warn("[drop-folder] DROP_FOLDER_ENABLED=true but DROP_FOLDER_PATH is unset — poller disabled");
    return null;
  }
  let orgMap: Record<string, string> = {};
  try {
    orgMap = process.env.DROP_FOLDER_ORG_MAP ? JSON.parse(process.env.DROP_FOLDER_ORG_MAP) : {};
  } catch {
    console.error("[drop-folder] DROP_FOLDER_ORG_MAP is not valid JSON — poller disabled");
    return null;
  }
  return {
    path: dir,
    pollMs: Number.parseInt(process.env.DROP_FOLDER_POLL_MS ?? "30000", 10) || 30000,
    orgMap,
    uploadedBy: process.env.DROP_FOLDER_UPLOADED_BY ?? "drop-folder",
  };
}

function orgForFile(cfg: DropFolderConfig, name: string): string | null {
  for (const [prefix, orgId] of Object.entries(cfg.orgMap)) {
    if (name.startsWith(prefix)) return orgId;
  }
  return null;
}

function fileTypeFor(name: string): "csv" | "ndjson" | "837" | "835" | null {
  const ext = path.extname(name).toLowerCase().replace(".", "");
  return ext === "csv" || ext === "ndjson" || ext === "837" || ext === "835" ? ext : null;
}

/** Process one file through the shared session/chunk/finalize pipeline. */
export async function ingestDropFile(cfg: DropFolderConfig, orgId: string, filePath: string, fileType: "csv" | "ndjson" | "837" | "835"): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — drop-folder ingestion aborted");
  const buf = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const totalChunks = Math.max(1, Math.ceil(buf.length / CHUNK_SIZE_BYTES));
  const sha = createHash("sha256").update(buf).digest("hex");
  const [session] = await db.insert(bulkUploadSessions).values({
    orgId,
    createdByUserId: cfg.uploadedBy,
    fileName,
    fileType,
    declaredSizeBytes: buf.length,
    chunkSizeBytes: CHUNK_SIZE_BYTES,
    totalChunks,
    chunksReceived: 0,
    assembledSha256: sha,
    status: "uploading",
  }).returning({ id: bulkUploadSessions.id });
  for (let i = 0; i < totalChunks; i++) {
    const slice = buf.subarray(i * CHUNK_SIZE_BYTES, (i + 1) * CHUNK_SIZE_BYTES);
    await db.insert(bulkUploadChunks).values({
      sessionId: session.id,
      chunkIndex: i,
      sha256: createHash("sha256").update(slice).digest("hex"),
      byteLength: slice.length,
      data: slice,
    });
  }
  await db.update(bulkUploadSessions).set({ chunksReceived: totalChunks }).where(eq(bulkUploadSessions.id, session.id));
  const assembled = await assembleSha256(db, session.id);
  if (assembled !== sha) {
    await db.update(bulkUploadSessions).set({ status: "failed", errorMessage: "drop-folder assembled sha256 mismatch" })
      .where(eq(bulkUploadSessions.id, session.id));
    throw new Error(`drop-folder assembled sha256 mismatch for ${fileName}`);
  }
  await db.update(bulkUploadSessions).set({ status: "ready", finalizedAt: new Date() })
    .where(eq(bulkUploadSessions.id, session.id));
  await startIngestion(session.id);
  return session.id;
}

let timer: NodeJS.Timeout | null = null;
const pendingSizes = new Map<string, number>();

export function startDropFolderPoller(): void {
  const cfg = loadConfig();
  if (!cfg || timer) return;
  console.log(`[drop-folder] polling ${cfg.path} every ${cfg.pollMs}ms`);
  timer = setInterval(() => {
    void pollOnce(cfg).catch(err =>
      console.error("[drop-folder] poll failed:", err instanceof Error ? err.message : err));
  }, cfg.pollMs);
  timer.unref?.();
}

export function stopDropFolderPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function pollOnce(cfg: DropFolderConfig): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(cfg.path);
  } catch {
    console.warn(`[drop-folder] cannot read ${cfg.path}`);
    return;
  }
  for (const name of entries) {
    if (name.endsWith(".done")) continue;
    const full = path.join(cfg.path, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const prev = pendingSizes.get(name);
    if (prev === undefined) {
      pendingSizes.set(name, stat.size);
      continue; // first sighting — wait one poll for stability
    }
    if (prev !== stat.size) {
      pendingSizes.set(name, stat.size);
      continue; // still growing
    }
    pendingSizes.delete(name);
    const orgId = orgForFile(cfg, name);
    const fileType = fileTypeFor(name);
    if (!orgId || !fileType) {
      console.warn(`[drop-folder] skipping ${name}: no org mapping or unknown extension`);
      await fs.rename(full, `${full}.done`).catch(() => undefined);
      continue;
    }
    const sessionId = await ingestDropFile(cfg, orgId, full, fileType);
    console.log(`[drop-folder] ${name} -> session ${sessionId} (org ${orgId}, ${stat.size} bytes)`);
    await fs.rename(full, `${full}.done`).catch(() => undefined);
  }
}

/** Test hook. */
export const __dropFolderInternals = { pollOnce, loadConfig, randomUUID };
