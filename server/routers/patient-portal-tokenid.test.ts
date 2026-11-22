/**
 * Wave auditfix (A): patientPortal issue*Token must return the token row id
 * as `tokenId` (additive), and that id must work with revokeToken. Requires a
 * live DATABASE_URL; skips otherwise (store.pg.test.ts pattern).
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb, createDispute } from "../db";
import { users as usersTable } from "../../drizzle/schema";
import { patientAccessTokens } from "../../drizzle/schema-personas";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);

describe.skipIf(!HAS_DB)("patientPortal tokenId (live PG)", () => {
  let caller: ReturnType<typeof rootRouter.createCaller>;
  let disputeId = "";

  beforeAll(async () => {
    const db = (await getDb())!;
    const userId = `pp-tok-${RUN}`;
    await db.insert(usersTable).values({ id: userId, name: "PP Token User", email: `${userId}@test.local`, loginMethod: "test", role: "user" }).onConflictDoNothing();
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    caller = rootRouter.createCaller(makeCtxForUser(u));
    const dispute = await createDispute({
      id: crypto.randomUUID(),
      referenceNumber: "",
      initiatingPartyId: userId,
      initiatingPartyType: "provider",
      initiatingPartyName: `PP Token Provider ${RUN}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date(Date.now() - 14 * 86400_000),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "1200.00",
      createdBy: userId,
    });
    disputeId = dispute.id;
  });

  it("issueViewToken returns tokenId; revokeToken(tokenId) revokes that row", async () => {
    const issued = await caller.patientPortal.issueViewToken({ disputeId, patientName: `Pat ${RUN}` });
    expect(issued.token.length).toBeGreaterThanOrEqual(32);
    expect(issued.tokenId).toMatch(/^[0-9a-f-]{36}$/);
    const db = (await getDb())!;
    const [row] = await db.select().from(patientAccessTokens).where(eq(patientAccessTokens.id, issued.tokenId)).limit(1);
    expect(row.scope).toBe("view");
    expect(row.revokedAt).toBeNull();
    const revoked = await caller.patientPortal.revokeToken({ tokenId: issued.tokenId });
    expect(revoked.ok).toBe(true);
    const [after] = await db.select().from(patientAccessTokens).where(eq(patientAccessTokens.id, issued.tokenId)).limit(1);
    expect(after.revokedAt).not.toBeNull();
  });

  it("issuePpdrIntakeToken returns tokenId; revokeToken(tokenId) works", async () => {
    const issued = await caller.patientPortal.issuePpdrIntakeToken({ patientName: `PPDR ${RUN}` });
    expect(issued.tokenId).toMatch(/^[0-9a-f-]{36}$/);
    const revoked = await caller.patientPortal.revokeToken({ tokenId: issued.tokenId });
    expect(revoked.ok).toBe(true);
    const db = (await getDb())!;
    const [row] = await db.select().from(patientAccessTokens).where(eq(patientAccessTokens.id, issued.tokenId)).limit(1);
    expect(row.scope).toBe("ppdr_intake");
    expect(row.revokedAt).not.toBeNull();
  });
});
