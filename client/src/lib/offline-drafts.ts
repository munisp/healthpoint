/**
 * Offline-first draft capture (IndexedDB).
 *
 * When the browser is offline (or the drafts.save mutation fails with a
 * network error), the New Dispute wizard queues the draft payload locally in
 * IndexedDB. On the next `online` event the queue is flushed back through
 * drafts.save. This complements the server-side draft (trpc.drafts.save),
 * which remains the canonical store when connectivity exists.
 */

export type OfflineDraftPayload = {
  wizardStep: number;
  formData: Record<string, unknown>;
};

type QueuedDraft = OfflineDraftPayload & { id: number; queuedAt: number };

const DB_NAME = "hp-offline-drafts";
const STORE = "drafts";

function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a draft payload locally. Returns false when IndexedDB is unavailable. */
export async function queueOfflineDraft(payload: OfflineDraftPayload): Promise<boolean> {
  if (!isIdbAvailable()) return false;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({ ...payload, queuedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** List all locally queued drafts (oldest first). */
export async function listOfflineDrafts(): Promise<QueuedDraft[]> {
  if (!isIdbAvailable()) return [];
  try {
    const db = await openDb();
    const rows = await new Promise<QueuedDraft[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedDraft[]).sort((a, b) => a.queuedAt - b.queuedAt));
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  } catch {
    return [];
  }
}

/** Remove a single queued draft after it has been flushed. */
export async function removeOfflineDraft(id: number): Promise<void> {
  if (!isIdbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort */
  }
}

/** Clear the whole offline queue (e.g. after the dispute is submitted). */
export async function clearOfflineDrafts(): Promise<void> {
  if (!isIdbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort */
  }
}

/** Heuristic: is this mutation error a connectivity failure? */
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /fetch failed|networkerror|failed to fetch|network request failed|offline/i.test(msg);
}
