/**
 * Phase 20-A integration: manual check postings + 835 BPR/TRN capture +
 * reconciliation proposals against live Postgres. Skips when DATABASE_URL
 * is unset (store.pg.test.ts pattern).
 *
 * PROPOSALS ONLY: no automatic match is ever persisted without an explicit
 * matchCheckToRemittances call (design honesty label 5).
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable } from "../../drizzle/schema";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
// receivedDate must sit within the ±10-day proposal window of the file's
// receivedAt (= now), so derive it from the clock rather than hardcoding.
const TODAY = new Date().toISOString().slice(0, 10);

function make835(claimId: string, amount: string, method: string, trace: string | null, payer = "AETNA HEALTH"): string {
  const segs = [
    "ISA*00*          *00*          *ZZ*A*ZZ*B*260901*1200*^*00501*000000905*1*T*:~",
    "ST*835*0001*005010X221A1~",
    `BPR*I*${amount}*C*${method}*CCP*01*999999999*DA*123456*1999999999**01*111111111*DA*987654*20260905~`,
  ];
  if (trace) segs.push(`TRN*1*${trace}*1999999999~`);
  segs.push(
    `N1*PR*${payer}~`,
    `CLP*${claimId}*2*${amount}*${amount}**MB*PCN-${claimId}*11*1~`,
    `SVC*HC:99285*${amount}*${amount}**1~`,
    "SE*8*0001~",
  );
  return segs.join("\n");
}

describe.skipIf(!HAS_DB)("Phase20-A check postings (live PG)", () => {
  let ownerCaller: ReturnType<typeof rootRouter.createCaller>;
  let viewerCaller: ReturnType<typeof rootRouter.createCaller>;
  let outsiderCaller: ReturnType<typeof rootRouter.createCaller>;
  let orgId = "";
  let checkPostingId = "";
  let lineIds: string[] = [];

  beforeAll(async () => {
    const db = (await getDb())!;
    const mk = async (id: string, name: string) => {
      await db.insert(usersTable).values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" }).onConflictDoNothing();
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      return rootRouter.createCaller(makeCtxForUser(u));
    };
    ownerCaller = await mk(`p20-own-${RUN}`, "P20 Owner");
    viewerCaller = await mk(`p20-view-${RUN}`, "P20 Viewer");
    outsiderCaller = await mk(`p20-out-${RUN}`, "P20 Outsider");
    const org = await ownerCaller.orgs.create({ name: `P20 Checks ${RUN}`, type: "biller" });
    orgId = org.orgId;
    // Add viewer membership.
    await db.execute(
      (await import("drizzle-orm")).sql`INSERT INTO org_memberships (id, "orgId", "userId", role) VALUES (${`m-${RUN}`}, ${orgId}, ${`p20-view-${RUN}`}, 'viewer') ON CONFLICT DO NOTHING`
    );
  });

  it("ingests an 835 with BPR CHK + TRN and captures header + line propagation", async () => {
    const res = await ownerCaller.submitter.ingest835({
      orgId, fileName: `p20-${RUN}.835`, content: make835(`CLM-P20-${RUN}`, "900.00", "CHK", `CHK-${RUN}-777`),
    });
    expect(res.duplicate).toBe(false);
    expect(res.payment).toEqual({ method: "check", traceNumber: `CHK-${RUN}-777` });
    const lines = await ownerCaller.submitter.listRemittanceLines({ fileId: res.fileId });
    expect(lines).toHaveLength(1);
    expect(lines[0].paymentTraceNumber).toBe(`CHK-${RUN}-777`);
    expect(lines[0].paymentMethodCode).toBe("CHK");
    lineIds = lines.map(l => l.id);
  });

  it("posts a paper check, gets proposals, replay → CONFLICT", async () => {
    const posted = await ownerCaller.submitter.postCheckPayment({
      orgId, checkNumber: `CHK-${RUN}-777`, amountUsd: "900.00",
      payerName: "Aetna Health, LLC", receivedDate: TODAY,
    });
    expect(posted.status).toBe("posted");
    checkPostingId = posted.checkPostingId;
    expect(posted.matchProposals.length).toBeGreaterThan(0);
    expect(posted.matchProposals[0].exactTraceMatch).toBe(true);
    // Replay: same org+check+payer → 409.
    await expect(ownerCaller.submitter.postCheckPayment({
      orgId, checkNumber: `CHK-${RUN}-777`, amountUsd: "900.00",
      payerName: "Aetna Health, LLC", receivedDate: "2026-09-05",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("direction A: check first, later 835 ingest returns proposedCheckMatches", async () => {
    const posted = await ownerCaller.submitter.postCheckPayment({
      orgId, checkNumber: `PAPER-${RUN}-55`, amountUsd: "1200.00",
      payerName: "AETNA HEALTH", receivedDate: TODAY,
    });
    expect(posted.matchProposals).toHaveLength(0); // no matching 835 yet
    const res = await ownerCaller.submitter.ingest835({
      orgId, fileName: `p20b-${RUN}.835`, content: make835(`CLM-P20B-${RUN}`, "1200.00", "CHK", null),
    });
    expect(res.proposedCheckMatches).toBeDefined();
    const mine = res.proposedCheckMatches!.filter(p => p.checkPostingId === posted.checkPostingId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].exactTraceMatch).toBe(false);
  });

  it("human confirms match, then deposits; status guards enforced", async () => {
    // Confirm the match from the first test (exact-trace proposal).
    const matched = await ownerCaller.submitter.matchCheckToRemittances({
      checkPostingId, remittanceLineIds: lineIds,
    });
    expect(matched.status).toBe("matched");
    expect(matched.matchedAmountCents).toBe(90000);
    expect(matched.discrepancyCents).toBe(0);
    // Re-match from non-posted state → CONFLICT.
    await expect(ownerCaller.submitter.matchCheckToRemittances({
      checkPostingId, remittanceLineIds: lineIds,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    const dep = await ownerCaller.submitter.markCheckDeposited({ checkPostingId, depositDate: "2026-09-08" });
    expect(dep.status).toBe("deposited");
    await expect(ownerCaller.submitter.markCheckDeposited({ checkPostingId, depositDate: "2026-09-09" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const listed = await ownerCaller.submitter.listCheckPostings({ orgId });
    const mine = listed.find(c => c.id === checkPostingId);
    expect(mine?.status).toBe("deposited");
    expect(mine?.depositDate).toBe("2026-09-08");
    expect(mine?.matchedPaymentTraceNumber).toBe(`CHK-${RUN}-777`);
    const filtered = await ownerCaller.submitter.listCheckPostings({ orgId, status: "posted" });
    expect(filtered.every(c => c.status === "posted")).toBe(true);
  });

  it("authZ: viewer cannot mutate; outsider blind; discrepancy recorded not blocking", async () => {
    await expect(viewerCaller.submitter.postCheckPayment({
      orgId, checkNumber: `V-${RUN}`, amountUsd: "10.00", payerName: "X", receivedDate: "2026-09-01",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsiderCaller.submitter.listCheckPostings({ orgId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    // Viewer CAN read.
    const listed = await viewerCaller.submitter.listCheckPostings({ orgId });
    expect(Array.isArray(listed)).toBe(true);
    // Discrepancy is recorded, not blocking.
    const off = await ownerCaller.submitter.postCheckPayment({
      orgId, checkNumber: `OFF-${RUN}`, amountUsd: "899.00",
      payerName: "AETNA HEALTH", receivedDate: TODAY,
    });
    const m = await ownerCaller.submitter.matchCheckToRemittances({
      checkPostingId: off.checkPostingId, remittanceLineIds: lineIds,
    });
    expect(m.discrepancyCents).toBe(100); // $1.00 over, recorded
  });
});
