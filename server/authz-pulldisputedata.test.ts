/**
 * server/authz-pulldisputedata.test.ts
 *
 * Regression for the object-level authorization gap on ai.pullDisputeData:
 * the procedure was mapped only to the EMR-connection ownership check, so any
 * user who owned an EMR connection could merge extracted fields into ANY
 * dispute by passing its id (overwriting billed amount, CPT/ICD codes, payer
 * name). The registry now also requires WRITE access to input.disputeId.
 *
 * DB layer is mocked in-memory (no live infrastructure), matching authz-idor.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const state = vi.hoisted(() => ({
  connections: [] as Array<{ id: string; createdBy: string }>,
  disputes: [] as Array<{ id: string; initiatingPartyId: string }>,
  grants: [] as Array<{ disputeId: string; userId: string; permission: string }>,
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  const schema = await vi.importActual<typeof import("../drizzle/schema")>("../drizzle/schema");
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.emrConnections) return state.connections;
    if (table === schema.disputes) return state.disputes;
    if (table === schema.disputeAccess) return state.grants;
    return [];
  };
  const makeQuery = (rows: unknown[]): any => ({
    where: () => makeQuery(rows),
    orderBy: () => makeQuery(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (f: any, r: any) => Promise.resolve(rows).then(f, r),
  });
  return {
    ...actual,
    getDb: async () => ({ select: () => ({ from: (t: unknown) => makeQuery(rowsFor(t)) }) }),
  };
});

import { enforcePathAuthz } from "./authz-registry";

const OWNER = "user-owner";
const ATTACKER = "user-attacker";
const CONN = "conn-attacker";
const DISPUTE = "dispute-owner";

beforeEach(() => {
  state.connections = [{ id: CONN, createdBy: ATTACKER }]; // attacker owns the EMR connection
  state.disputes = [{ id: DISPUTE, initiatingPartyId: OWNER }]; // dispute belongs to the owner
  state.grants = [];
});

const run = (userId: string, input: unknown) =>
  enforcePathAuthz("ai.pullDisputeData", { user: { id: userId, role: "user" as const } }, input);

describe("ai.pullDisputeData object-level authz", () => {
  it("denies merging EMR data into a dispute the caller cannot write", async () => {
    await expect(run(ATTACKER, { connectionId: CONN, disputeId: DISPUTE })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } as Partial<TRPCError>);
  });

  it("allows the dispute owner (who also owns the connection)", async () => {
    state.connections = [{ id: CONN, createdBy: OWNER }];
    await expect(run(OWNER, { connectionId: CONN, disputeId: DISPUTE })).resolves.toBeUndefined();
  });

  it("allows a pull with no merge target (no disputeId) for the connection owner", async () => {
    await expect(run(ATTACKER, { connectionId: CONN })).resolves.toBeUndefined();
  });

  it("allows a caller with an explicit write grant on the dispute", async () => {
    state.grants = [{ disputeId: DISPUTE, userId: ATTACKER, permission: "write" }];
    await expect(run(ATTACKER, { connectionId: CONN, disputeId: DISPUTE })).resolves.toBeUndefined();
  });

  it("still denies when the caller has only a read grant", async () => {
    state.grants = [{ disputeId: DISPUTE, userId: ATTACKER, permission: "read" }];
    await expect(run(ATTACKER, { connectionId: CONN, disputeId: DISPUTE })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } as Partial<TRPCError>);
  });
});
