/**
 * Phase 18 deadline-autopilot tests.
 *  - parseAlertDays: pure, EXECUTED-VERIFIED.
 *  - runDeadlineAutopilot idempotency: live PG, DATABASE_URL-gated
 *    (EXECUTED-VERIFIED when the DB is available; skipped otherwise).
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { parseAlertDays, runDeadlineAutopilot } from "./deadlineAutopilot";
import { getDb, createDispute } from "../db";
import { disputes, eventLog, notifications, users as usersTable } from "../../drizzle/schema";

describe("parseAlertDays", () => {
  it("defaults to 5/2/1 when unset", () => {
    expect(parseAlertDays({})).toEqual([5, 2, 1]);
  });
  it("parses, dedupes, and sorts a valid override", () => {
    expect(parseAlertDays({ DEADLINE_ALERT_DAYS: "1,3,3,10" })).toEqual([10, 3, 1]);
  });
  it("fails closed to defaults on garbage", () => {
    expect(parseAlertDays({ DEADLINE_ALERT_DAYS: "x,-4,0,999" })).toEqual([5, 2, 1]);
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);

describe.skipIf(!HAS_DB)("runDeadlineAutopilot (live PG)", () => {
  const userId = `p18-da-${RUN}`;
  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    await db!.insert(usersTable)
      .values({ id: userId, name: "P18 Autopilot", email: `${userId}@test.local`, loginMethod: "test", role: "user" })
      .onConflictDoNothing();
  });

  it("emits once per (dispute, deadline, threshold) and dedupes on rerun", async () => {
    const db = (await getDb())!;
    // Dispute with an ON deadline ~3 business days out → hits 5-day threshold only.
    const d = await createDispute({
      initiatingPartyType: "provider",
      initiatingPartyName: `P18 DA Provider ${RUN}`,
      initiatingPartyId: userId,
      serviceType: "emergency_medicine",
      serviceDate: new Date(),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "1000.00",
      createdBy: userId,
    } as Parameters<typeof createDispute>[0]);
    const soon = new Date(Date.now() + 3 * 86400_000);
    await db.update(disputes).set({ openNegotiationDeadline: soon }).where(eq(disputes.id, d.id));

    const first = await runDeadlineAutopilot(db, new Date(), [5, 2, 1]);
    expect(first.notificationsSent).toBeGreaterThanOrEqual(1);
    const keys = await db.select({ k: eventLog.idempotencyKey }).from(eventLog)
      .where(eq(eventLog.eventType, "deadline.autopilot"));
    expect(keys.some(r => r.k === `deadline-autopilot:${d.id}:open_negotiation:5`)).toBe(true);

    const notifCount = await db.select({ id: notifications.id }).from(notifications)
      .where(eq(notifications.disputeId, d.id));
    const second = await runDeadlineAutopilot(db, new Date(), [5, 2, 1]);
    expect(second.notificationsSent).toBe(0);
    expect(second.deduped).toBeGreaterThanOrEqual(1);
    const notifCountAfter = await db.select({ id: notifications.id }).from(notifications)
      .where(eq(notifications.disputeId, d.id));
    expect(notifCountAfter.length).toBe(notifCount.length);

    await db.delete(disputes).where(eq(disputes.id, d.id));
  });
});
