/**
 * run-owners.ts — ownership lookup helpers for portal RPA runs/checkpoints.
 *
 * Ownership is now persisted on the `owner_user_id` columns of
 * idr_portal_rpa_runs / idr_portal_rpa_checkpoints (migration
 * 0055_wave_auditfix). This module is reduced to a thin delegating helper
 * over the configured stores (see server/idr/portal-rpa/store.ts), keeping
 * the exported names stable for server/authz-registry.ts and tests.
 *
 * A process-local overlay mirrors records written through this process so
 * authorization checks remain consistent immediately after a write; the
 * database stays the source of truth across restarts.
 *
 * Fail-closed semantics (unchanged): an unknown id resolves to `undefined`,
 * and callers deny non-admin access for unknown owners.
 */
import {
  getPortalRpaRunStore,
  getPortalRpaCheckpointQueue,
} from "./store";

// Process-local write-through overlay (also the sole store when tests inject
// in-memory implementations). DB remains authoritative across restarts.
const runOwners = new Map<string, string>();
const checkpointOwners = new Map<string, string>();

type OwnerCapableRunStore = {
  setOwner?: (runId: string, ownerUserId: string) => Promise<void>;
  getOwner?: (runId: string) => Promise<string | undefined>;
};
type OwnerCapableCheckpointQueue = {
  setOwner?: (checkpointId: string, ownerUserId: string) => Promise<void>;
  getOwner?: (checkpointId: string) => Promise<string | undefined>;
};

export function recordRunOwner(runId: string, userId: string): void {
  runOwners.set(runId, userId);
  const store = getPortalRpaRunStore() as OwnerCapableRunStore;
  if (store.setOwner) {
    void store.setOwner(runId, userId).catch((err) => {
      console.warn("[portal-rpa] failed to persist run owner:", err);
    });
  }
}

export function recordCheckpointOwner(checkpointId: string, userId: string): void {
  checkpointOwners.set(checkpointId, userId);
  const queue = getPortalRpaCheckpointQueue() as OwnerCapableCheckpointQueue;
  if (queue.setOwner) {
    void queue.setOwner(checkpointId, userId).catch((err) => {
      console.warn("[portal-rpa] failed to persist checkpoint owner:", err);
    });
  }
}

export async function getRunOwner(runId: string): Promise<string | undefined> {
  const local = runOwners.get(runId);
  if (local) return local;
  const store = getPortalRpaRunStore() as OwnerCapableRunStore;
  if (!store.getOwner) return undefined; // in-memory test store without owners
  try {
    const owner = await store.getOwner(runId);
    if (owner) runOwners.set(runId, owner);
    return owner;
  } catch {
    return undefined; // DB unavailable → unknown → callers fail closed
  }
}

export async function getCheckpointOwner(checkpointId: string): Promise<string | undefined> {
  const local = checkpointOwners.get(checkpointId);
  if (local) return local;
  const queue = getPortalRpaCheckpointQueue() as OwnerCapableCheckpointQueue;
  if (!queue.getOwner) return undefined;
  try {
    const owner = await queue.getOwner(checkpointId);
    if (owner) checkpointOwners.set(checkpointId, owner);
    return owner;
  } catch {
    return undefined;
  }
}

/** Test hook: clear the process-local overlay. */
export function resetRunOwnersForTests(): void {
  runOwners.clear();
  checkpointOwners.clear();
}
