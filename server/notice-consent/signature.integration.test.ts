/**
 * W4-F4 integration: patient e-signature capture end-to-end against live
 * Postgres (patient_access_tokens + consent_signatures from migration 0040 +
 * the fsm-store hash-chained event log). Skips when DATABASE_URL is unset.
 *
 * Flow: provider creates case → NOTICE_DELIVERED → issueSignatureLink →
 * PUBLIC patientSignConsent(token) → CONSENT_SIGNED with a tamper-evident
 * artifact whose hash is recorded in the case metadata, the
 * consent_signatures table, and the transition event detail (chain-verified).
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { sql as dsql, eq } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable } from "../../drizzle/schema";
import { REQUIRED_NOTICE_ELEMENTS } from "./waiver";
import { getFsmCaseStore } from "../fsm-store/store";
import type { NoticeConsentCase } from "./fsm";
import { computeArtifactHash } from "./signature";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const USER_ID = `w4-sig-user-${RUN}`;
const CASE_ID = `w4-sig-case-${RUN}`;

describe.skipIf(!HAS_DB)("W4-F4 signature capture (live PG)", () => {
  let providerCaller: ReturnType<typeof rootRouter.createCaller>;
  let publicCaller: ReturnType<typeof rootRouter.createCaller>;

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    await db!
      .insert(usersTable)
      .values({ id: USER_ID, name: "W4 Sig", email: `${USER_ID}@test.local`, loginMethod: "test", role: "user" })
      .onConflictDoNothing();
    const [user] = await db!.select().from(usersTable).where(eq(usersTable.id, USER_ID)).limit(1);
    providerCaller = rootRouter.createCaller(makeCtxForUser(user));
    publicCaller = rootRouter.createCaller({
      user: null,
      req: { headers: { "x-forwarded-for": "203.0.113.99" } },
      res: { clearCookie: () => undefined, cookie: () => undefined },
      mfaPending: false,
      viaApiKey: false,
      apiKeyScopes: [],
    } as never);
  });

  it("captures a tamper-evident, hash-chained signature", async () => {
    const now = Date.now();
    const timing = {
      scheduledAt: new Date(now - 10 * 86400_000).toISOString(),
      serviceAt: new Date(now + 5 * 86400_000).toISOString(),
      noticeDeliveredAt: new Date(now - 26 * 3600_000).toISOString(),
      timeZone: "America/Chicago",
    };
    await providerCaller.noticeConsent.createCase({
      caseId: CASE_ID,
      waiverInput: { serviceCategory: "NON_EMERGENCY", providerInNetwork: false, noInNetworkProviderAvailable: false },
      timing,
      noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
      language: "es",
    });
    await providerCaller.noticeConsent.transition({ caseId: CASE_ID, to: "NOTICE_DELIVERED" });

    // Issue the signature link (raw token returned exactly once).
    const link = await providerCaller.noticeConsent.issueSignatureLink({
      caseId: CASE_ID,
      patientName: "Jane Patient",
    });
    expect(link.token).toBeTruthy();
    expect(link.path).toContain("/patient/consent-sign/");

    // renderNoticeDocument in Spanish for the patient to review.
    const rendered = await providerCaller.noticeConsent.renderNoticeDocument({
      caseId: CASE_ID,
      providerName: "Clinic Norte",
      language: "es",
    });
    expect(rendered.document).toMatch(/AVISO DE PROTECCIÓN CONTRA FACTURACIÓN SORPRESA/);

    // Wrong scope/garbage token fails closed.
    await expect(
      publicCaller.noticeConsent.patientSignConsent({
        token: "bogus",
        signerName: "Jane Patient",
        attestation: true,
        signatureText: "Jane Patient",
      }),
    ).rejects.toThrow(/Invalid, expired, or already-used/);

    // Public signing via the bearer token.
    const signed = await publicCaller.noticeConsent.patientSignConsent({
      token: link.token,
      signerName: "Jane Patient",
      attestation: true,
      signatureText: "Jane Patient",
    });
    expect(signed.state).toBe("CONSENT_SIGNED");
    expect(signed.artifactHash).toMatch(/^[0-9a-f]{64}$/);

    // Artifact hash recomputes from the documented fields (incl. client IP).
    const recomputed = computeArtifactHash({
      caseId: CASE_ID,
      signerName: "Jane Patient",
      signatureText: "Jane Patient",
      attestation: true,
      timestamp: signed.signedAt,
      ip: "203.0.113.99",
    });
    expect(recomputed).toBe(signed.artifactHash);

    // Case metadata carries the artifact.
    const store = getFsmCaseStore();
    const tenantId = `tenant:${USER_ID}`;
    const stored = await store.getCase<NoticeConsentCase>(tenantId, "notice-consent", CASE_ID);
    expect(stored?.data.signatureArtifact?.artifactHash).toBe(signed.artifactHash);
    expect(stored?.data.language).toBe("es");

    // consent_signatures row persisted, chained to the FSM event tip.
    const db = await getDb();
    const rows = await db!.execute(dsql`
      SELECT "artifactHash", "prevEventHash", "signerName", ip
      FROM consent_signatures WHERE "caseId" = ${CASE_ID}`);
    expect(rows.length).toBe(1);
    expect(rows[0].artifactHash).toBe(signed.artifactHash);
    expect(rows[0].ip).toBe("203.0.113.99");

    // Event chain intact and covers the artifact hash in the final event.
    const { events, verification } = await providerCaller.noticeConsent.getEvents({ caseId: CASE_ID });
    expect(verification.ok).toBe(true);
    const last = events[events.length - 1];
    expect(last.eventHash).toBe(rows[0].prevEventHash);
    expect(last.detail).toContain(`signatureArtifact:${signed.artifactHash}`);

    // Token is single-use.
    await expect(
      publicCaller.noticeConsent.patientSignConsent({
        token: link.token,
        signerName: "Jane Patient",
        attestation: true,
        signatureText: "Jane Patient",
      }),
    ).rejects.toThrow(/already-used/);
  });

  it("consent.revoked flags a linked dispute as balance-billing-prohibited", async () => {
    const db = await getDb();
    const disputeId = `w4-rev-dispute-${RUN}`;
    await db!.execute(dsql`
      INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType",
        "initiatingPartyName", "serviceType", "serviceDate", "patientState", "facilityState",
        "cptCodes", "billedAmount", "createdBy")
      VALUES (${disputeId}, ${"W4-REV-" + RUN}, ${USER_ID}, 'provider', 'W4 Test Provider',
        'other', NOW(), 'TX', 'TX', '["99213"]', 1200, ${USER_ID})
      ON CONFLICT (id) DO NOTHING`);

    const caseId = `w4-rev-case-${RUN}`;
    const now = Date.now();
    await providerCaller.noticeConsent.createCase({
      caseId,
      waiverInput: { serviceCategory: "NON_EMERGENCY", providerInNetwork: false, noInNetworkProviderAvailable: false },
      timing: {
        scheduledAt: new Date(now - 10 * 86400_000).toISOString(),
        serviceAt: new Date(now + 5 * 86400_000).toISOString(),
        noticeDeliveredAt: new Date(now - 26 * 3600_000).toISOString(),
        consentSignedAt: new Date(now - 25 * 3600_000).toISOString(),
        timeZone: "America/Chicago",
      },
      noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
    });
    await providerCaller.noticeConsent.transition({ caseId, to: "NOTICE_DELIVERED" });
    await providerCaller.noticeConsent.transition({ caseId, to: "CONSENT_SIGNED" });
    await providerCaller.noticeConsent.transition({ caseId, to: "CONSENT_REVOKED", linkedDisputeId: disputeId });

    // Listener is fire-and-forget (50ms setTimeout); poll for the flag.
    let flagged: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      flagged = await db!.execute(dsql`
        SELECT id FROM "event_log"
        WHERE "eventType" = 'consent.balance_billing_prohibited'
          AND "aggregateId" = ${disputeId}`);
      if (flagged.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(flagged.length).toBe(1);

    const notifs = await db!.execute(dsql`
      SELECT "userId", "notificationType" FROM notifications
      WHERE "disputeId" = ${disputeId} AND "notificationType" = 'consent_revoked'`);
    expect(notifs.length).toBe(1);
    expect(notifs[0].userId).toBe(USER_ID);

    // Idempotent: a duplicate revocation event does not double-flag.
    const { flagBalanceBillingProhibited } = await import("./consent-events");
    const again = await flagBalanceBillingProhibited({
      tenantId: `tenant:${USER_ID}`,
      caseId,
      revokedAt: new Date().toISOString(),
      ownerUserId: USER_ID,
      linkedDisputeId: disputeId,
    });
    expect(again.flagged).toBe(false);
  });
});
