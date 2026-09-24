/**
 * run-owners.ts — ownership bindings for portal RPA runs and checkpoints (X4).
 *
 * The run store and checkpoint queue are in-memory singletons with no owner
 * column (the persistence wave will move this into a table). Until then the
 * owning user id is recorded here at startRun/enqueue time and consulted by
 * both the routes (in-procedure enforcement) and the authz registry
 * (object-level checkers) — kept in its own module so server/authz-registry.ts
 * can import it without a circular dependency on routes.ts.
 *
 * Fail closed: an unknown runId/checkpointId denies non-admin callers.
 */

const runOwners = new Map<string, string>();
const checkpointOwners = new Map<string, string>();

export function recordRunOwner(runId: string, userId: string): void {
  runOwners.set(runId, userId);
}

export function getRunOwner(runId: string): string | undefined {
  return runOwners.get(runId);
}

export function recordCheckpointOwner(checkpointId: string, userId: string): void {
  checkpointOwners.set(checkpointId, userId);
}

export function getCheckpointOwner(checkpointId: string): string | undefined {
  return checkpointOwners.get(checkpointId);
}

/** Test hook: drop all ownership bindings. */
export function resetRunOwnersForTests(): void {
  runOwners.clear();
  checkpointOwners.clear();
}
