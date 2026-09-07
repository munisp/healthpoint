/**
 * server/tests/authz-helpers.test.ts
 *
 * Allow/deny matrix for the ReBAC authorization layer (server/authz.ts):
 *   - role shortcuts (admin always allowed, before any DB round-trip)
 *   - ownership (disputes.initiatingPartyId === user.id)
 *   - explicit dispute_access grants: read ⊆ write ⊆ admin hierarchy
 *   - fail-closed behavior (no dispute / no grant / DB error / DB down ⇒ deny)
 *   - assert* wrappers raise tRPC FORBIDDEN on denial
 *   - disputeVisibilityFilter scoping for list queries
 *
 * PERMIFY_URL must be unset for these tests (the default in CI): authz.ts then
 * exercises the PostgreSQL fallback path deterministically.
 * `../db` is replaced with an in-memory fake at the module boundary via vi.mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const state = {
  dispute: null as { id: string; initiatingPartyId: string } | null,
  grant: null as { permission: string } | null,
  dbDown: false,
  grantQueryThrows: false,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => {
    if (state.dbDown) return null;
    return {
      select(fields: Record<string, unknown>) {
        return {
          from(table: unknown) {
            return {
              where() {
                return {
                  async limit() {
                    const cols = Object.keys(fields);
                    if (cols.includes("initiatingPartyId")) {
                      return state.dispute ? [state.dispute] : [];
                    }
                    if (cols.includes("permission")) {
                      if (state.grantQueryThrows) throw new Error("dispute_access unavailable");
                      return state.grant ? [state.grant] : [];
                    }
                    return [];
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values(values: Record<string, unknown>) {
            return {
              async onConflictDoUpdate() {
                state.grant = { permission: values.permission as string };
              },
            };
          },
        };
      },
      delete() {
        return {
          where: async () => {
            state.grant = null;
          },
        };
      },
    };
  }),
}));

import {
  assertAdminAccess,
  assertDisputeAccess,
  assertDocumentAccess,
  canAccessDispute,
  canAccessDocument,
  disputeVisibilityFilter,
  grantDisputeAccess,
  revokeDisputeAccess,
} from "../authz";

const DISPUTE_ID = "dispute-authz-1";
const OWNER = "user-owner";
const STRANGER = "user-stranger";

beforeEach(() => {
  state.dispute = { id: DISPUTE_ID, initiatingPartyId: OWNER };
  state.grant = null;
  state.dbDown = false;
  state.grantQueryThrows = false;
});

describe("canAccessDispute allow/deny matrix", () => {
  it("admin role is allowed every permission without touching the database", async () => {
    state.dbDown = true; // prove no DB dependency for admins
    for (const permission of ["read", "write", "admin"] as const) {
      await expect(canAccessDispute(STRANGER, "admin", DISPUTE_ID, permission)).resolves.toBe(true);
    }
  });

  it("the dispute owner (initiating party) is allowed every permission", async () => {
    for (const permission of ["read", "write", "admin"] as const) {
      await expect(canAccessDispute(OWNER, "user", DISPUTE_ID, permission)).resolves.toBe(true);
    }
  });

  it("a stranger with no grant is denied everything", async () => {
    for (const permission of ["read", "write", "admin"] as const) {
      await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, permission)).resolves.toBe(false);
    }
  });

  it("grant hierarchy: read grant allows only read", async () => {
    state.grant = { permission: "read" };
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "read")).resolves.toBe(true);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "write")).resolves.toBe(false);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "admin")).resolves.toBe(false);
  });

  it("grant hierarchy: write grant allows read + write but not admin", async () => {
    state.grant = { permission: "write" };
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "read")).resolves.toBe(true);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "write")).resolves.toBe(true);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "admin")).resolves.toBe(false);
  });

  it("grant hierarchy: admin grant allows read + write + admin", async () => {
    state.grant = { permission: "admin" };
    for (const permission of ["read", "write", "admin"] as const) {
      await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, permission)).resolves.toBe(true);
    }
  });

  it("fails closed when the dispute does not exist", async () => {
    state.dispute = null;
    await expect(canAccessDispute(OWNER, "user", DISPUTE_ID, "read")).resolves.toBe(false);
  });

  it("fails closed when the database is unavailable", async () => {
    state.dbDown = true;
    await expect(canAccessDispute(OWNER, "user", DISPUTE_ID, "read")).resolves.toBe(false);
  });

  it("fails closed when the grant table errors (defense in depth during migrations)", async () => {
    state.grantQueryThrows = true;
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "read")).resolves.toBe(false);
    // Ownership is evaluated before the grant table and still works.
    await expect(canAccessDispute(OWNER, "user", DISPUTE_ID, "read")).resolves.toBe(true);
  });
});

describe("assert* wrappers", () => {
  it("assertDisputeAccess throws tRPC FORBIDDEN on denial and resolves on allow", async () => {
    await expect(assertDisputeAccess(STRANGER, "user", DISPUTE_ID, "write")).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN"
    );
    await expect(assertDisputeAccess(OWNER, "user", DISPUTE_ID, "write")).resolves.toBeUndefined();
  });

  it("assertDocumentAccess inherits dispute access", async () => {
    await expect(assertDocumentAccess(STRANGER, "user", DISPUTE_ID, "read")).rejects.toBeInstanceOf(TRPCError);
    await expect(assertDocumentAccess(OWNER, "user", DISPUTE_ID, "read")).resolves.toBeUndefined();
    await expect(canAccessDocument(OWNER, "user", DISPUTE_ID, "read")).resolves.toBe(true);
  });

  it("assertAdminAccess gates user-management actions", () => {
    expect(() => assertAdminAccess("user")).toThrow(TRPCError);
    expect(() => assertAdminAccess("user", "rotate API keys")).toThrow(/rotate API keys/);
    expect(() => assertAdminAccess("admin")).not.toThrow();
  });
});

describe("grant/revoke lifecycle", () => {
  it("a write grant then revocation flips access allow → deny", async () => {
    await grantDisputeAccess(DISPUTE_ID, STRANGER, "write", OWNER);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "write")).resolves.toBe(true);
    await revokeDisputeAccess(DISPUTE_ID, STRANGER);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "write")).resolves.toBe(false);
    await expect(canAccessDispute(STRANGER, "user", DISPUTE_ID, "read")).resolves.toBe(false);
  });
});

describe("disputeVisibilityFilter", () => {
  it("returns no filter for admins (full visibility)", () => {
    expect(disputeVisibilityFilter(STRANGER, "admin")).toBeUndefined();
  });

  it("returns an ownership predicate for regular users", () => {
    const filter = disputeVisibilityFilter(STRANGER, "user");
    expect(filter).toBeDefined();
    expect(typeof filter).toBe("object");
  });
});
