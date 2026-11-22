/**
 * fsm-store tests — EXECUTED-VERIFIED against InMemoryFsmCaseStore with the
 * REAL module transition functions (notice-consent fsm.ts, priorauth fsm.ts,
 * gfe-ppdr ppdr.ts). Covers: server-authoritative persistence, forged-state
 * rejection (client can never inject state), CAS version conflicts, guard
 * pass-through, idempotency, and hash-chain verification.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryFsmCaseStore,
  FsmCaseNotFoundError,
  FsmDuplicateCaseError,
  FsmVersionConflictError,
  verifyFsmChain,
  FSM_GENESIS_HASH,
  type FsmStoredCase,
} from "./store";
import { REQUIRED_NOTICE_ELEMENTS } from "../notice-consent/waiver";
import {
  createNoticeConsentCase,
  transition as ncTransition,
  type NoticeConsentCase,
} from "../notice-consent/fsm";
import {
  createPaRequest,
  transition as paTransition,
  type PaRequest,
} from "../priorauth/fsm";
import {
  createPpdrDispute,
  transition as ppdrTransition,
  type PpdrDispute,
} from "../gfe-ppdr/ppdr";

const NC = "notice-consent";
const PA = "priorauth";
const PPDR = "gfe-ppdr";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function ncFixture(caseId: string) {
  return () =>
    createNoticeConsentCase({
      id: caseId,
      waiverInput: { serviceCategory: "NON_EMERGENCY" },
      timing: {
        scheduledAt: new Date("2026-03-01T10:00:00Z"),
        serviceAt: new Date("2026-03-10T10:00:00Z"),
        noticeDeliveredAt: new Date("2026-03-01T10:00:00Z"),
      },
      noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
    });
}

function paFixture(caseId: string) {
  return () =>
    createPaRequest({ id: caseId, payerType: "MA", urgency: "STANDARD" });
}

function ppdrFixture(caseId: string) {
  return () =>
    createPpdrDispute({
      id: caseId,
      gfeTotalUsd: 1000,
      billedTotalUsd: 1600,
      billedAt: new Date("2026-02-01T00:00:00Z"),
      insuranceBilled: false,
    });
}

/** NC route-style revive (mirrors routes.ts reviveCase). */
function reviveNc(raw: NoticeConsentCase): NoticeConsentCase {
  return {
    ...raw,
    timing: {
      ...raw.timing,
      scheduledAt: new Date(raw.timing.scheduledAt),
      serviceAt: new Date(raw.timing.serviceAt),
      noticeDeliveredAt: new Date(raw.timing.noticeDeliveredAt),
      consentSignedAt: raw.timing.consentSignedAt ? new Date(raw.timing.consentSignedAt) : undefined,
    },
    retentionUntil: raw.retentionUntil ? new Date(raw.retentionUntil) : null,
    events: raw.events.map((e) => ({ ...e, at: new Date(e.at) })),
  };
}

function revivePa(raw: PaRequest): PaRequest {
  return {
    ...raw,
    submittedAt: raw.submittedAt ? new Date(raw.submittedAt) : null,
    decidedAt: raw.decidedAt ? new Date(raw.decidedAt) : null,
    events: raw.events.map((e) => ({ ...e, at: new Date(e.at) })),
  };
}

function revivePpdr(raw: PpdrDispute): PpdrDispute {
  return {
    ...raw,
    billedAt: new Date(raw.billedAt),
    determination: raw.determination
      ? { ...raw.determination, determinedAt: new Date(raw.determination.determinedAt) }
      : null,
    events: raw.events.map((e) => ({ ...e, at: new Date(e.at) })),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("InMemoryFsmCaseStore — persistence & authority", () => {
  let store: InMemoryFsmCaseStore;
  beforeEach(() => {
    store = new InMemoryFsmCaseStore();
  });

  it("createCase persists server-side and returns version 1", async () => {
    const c = await store.createCase({
      tenantId: "t1",
      caseType: NC,
      caseId: "case-1",
      create: ncFixture("case-1"),
    });
    expect(c.state).toBe("NOTICE_REQUIRED");
    expect(c.version).toBe(1);
    const loaded = await store.getCase("t1", NC, "case-1");
    expect(loaded?.state).toBe("NOTICE_REQUIRED");
  });

  it("duplicate createCase for same (tenantId, caseType, caseId) throws", async () => {
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "c1", create: ncFixture("c1") });
    await expect(
      store.createCase({ tenantId: "t1", caseType: NC, caseId: "c1", create: ncFixture("c1") })
    ).rejects.toBeInstanceOf(FsmDuplicateCaseError);
  });

  it("same caseId under a different tenant is independent", async () => {
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "c1", create: ncFixture("c1") });
    const other = await store.createCase({
      tenantId: "t2",
      caseType: NC,
      caseId: "c1",
      create: ncFixture("c1"),
    });
    expect(other.tenantId).toBe("t2");
  });

  it("transitionCase on an unknown case throws FsmCaseNotFoundError", async () => {
    await expect(
      store.transitionCase("t1", NC, "nope", {
        apply: (c: NoticeConsentCase) => ncTransition(c, "NOTICE_DELIVERED"),
      })
    ).rejects.toBeInstanceOf(FsmCaseNotFoundError);
  });

  it("FORGED-STATE REJECTION: client state is never consulted — transition uses only server-loaded case", async () => {
    // A forger creates a fresh case and then tries to jump straight to
    // CONSENT_SIGNED. The transition input carries no case object at all;
    // the store loads NOTICE_REQUIRED server-side and the guard rejects.
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "forge", create: ncFixture("forge") });
    await expect(
      store.transitionCase("t1", NC, "forge", {
        apply: (c: NoticeConsentCase) => ncTransition(reviveNc(c), "CONSENT_SIGNED"),
      })
    ).rejects.toThrow(/Invalid notice-consent transition/);
    const loaded = await store.getCase<NoticeConsentCase>("t1", NC, "forge");
    expect(loaded?.state).toBe("NOTICE_REQUIRED");
    expect(loaded?.version).toBe(1);
  });

  it("FORGED-STATE REJECTION (PA): cannot jump DRAFT → APPROVED", async () => {
    await store.createCase({ tenantId: "t1", caseType: PA, caseId: "pa1", create: paFixture("pa1") });
    await expect(
      store.transitionCase("t1", PA, "pa1", {
        apply: (c: PaRequest) => paTransition(revivePa(c), "APPROVED"),
      })
    ).rejects.toThrow(/Invalid PA transition/);
    expect((await store.getCase("t1", PA, "pa1"))?.state).toBe("DRAFT");
  });

  it("FORGED-STATE REJECTION (PPDR): cannot jump DRAFT → DETERMINED", async () => {
    await store.createCase({ tenantId: "t1", caseType: PPDR, caseId: "d1", create: ppdrFixture("d1") });
    await expect(
      store.transitionCase("t1", PPDR, "d1", {
        apply: (c: PpdrDispute) =>
          ppdrTransition(revivePpdr(c), "DETERMINED", {
            determination: {
              entityId: "ppdr-entity-1",
              determinedAt: new Date("2026-02-10T00:00:00Z"),
              patientOwesUsd: 1000,
              rationale: "x",
            },
          }),
      })
    ).rejects.toThrow(/Invalid PPDR transition/);
  });

  it("happy path: NC NOTICE_REQUIRED → NOTICE_DELIVERED persists and increments version", async () => {
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "c2", create: ncFixture("c2") });
    const next = await store.transitionCase("t1", NC, "c2", {
      apply: (c: NoticeConsentCase) =>
        ncTransition(reviveNc(c), "NOTICE_DELIVERED", { now: new Date("2026-03-01T11:00:00Z") }),
      now: new Date("2026-03-01T11:00:00Z"),
    });
    expect(next.state).toBe("NOTICE_DELIVERED");
    expect(next.version).toBe(2);
    const loaded = await store.getCase("t1", NC, "c2");
    expect(loaded?.state).toBe("NOTICE_DELIVERED");
    expect(loaded?.version).toBe(2);
  });

  it("guard pass-through: NC → CONSENT_SIGNED rejected when timing violated (server-side)", async () => {
    const badTiming = () =>
      createNoticeConsentCase({
        id: "c3",
        waiverInput: { serviceCategory: "NON_EMERGENCY" },
        timing: {
          scheduledAt: new Date("2026-03-09T10:00:00Z"),
          serviceAt: new Date("2026-03-10T10:00:00Z"),
          noticeDeliveredAt: new Date("2026-03-09T10:00:00Z"), // <72h before service
        },
        noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
      });
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "c3", create: badTiming });
    await store.transitionCase("t1", NC, "c3", {
      apply: (c: NoticeConsentCase) =>
        ncTransition(reviveNc(c), "NOTICE_DELIVERED", { now: new Date("2026-03-09T10:00:00Z") }),
    });
    await expect(
      store.transitionCase("t1", NC, "c3", {
        apply: (c: NoticeConsentCase) =>
          ncTransition(reviveNc(c), "CONSENT_SIGNED", { now: new Date("2026-03-09T12:00:00Z") }),
      })
    ).rejects.toThrow(/timing|consentSignedAt/i);
  });

  it("CAS: version increments monotonically across chained transitions", async () => {
    await store.createCase({ tenantId: "t1", caseType: PA, caseId: "pa2", create: paFixture("pa2") });
    const t1 = await store.transitionCase("t1", PA, "pa2", {
      apply: (c: PaRequest) => paTransition(revivePa(c), "SUBMITTED", { now: new Date("2026-01-05T00:00:00Z") }),
    });
    const t2 = await store.transitionCase("t1", PA, "pa2", {
      apply: (c: PaRequest) =>
        paTransition(revivePa(c), "APPROVED", { now: new Date("2026-01-06T00:00:00Z") }),
    });
    expect(t1.version).toBe(2);
    expect(t2.version).toBe(3);
    expect((await store.getCase("t1", PA, "pa2"))?.version).toBe(3);
  });

  it("CAS conflict surfaces FsmVersionConflictError when the row version diverges", async () => {
    await store.createCase({ tenantId: "t1", caseType: PA, caseId: "pa3", create: paFixture("pa3") });
    // Simulate a concurrent writer mutating the row between load and persist
    // by interposing an apply that triggers a nested transition.
    let interposed = false;
    await expect(
      store.transitionCase("t1", PA, "pa3", {
        apply: (c: PaRequest) => {
          if (!interposed) {
            interposed = true;
            // Directly poke the backing row to simulate a lost CAS race.
            (store as unknown as { rows: Map<string, { version: number }> })
              .rows.get(JSON.stringify(["t1", PA, "pa3"]))!.version = 99;
          }
          return paTransition(revivePa(c), "SUBMITTED");
        },
      })
    ).rejects.toBeInstanceOf(FsmVersionConflictError);
  });

  it("idempotency: replayed createCase returns the prior result without duplicate", async () => {
    const first = await store.createCase({
      tenantId: "t1",
      caseType: PA,
      caseId: "pa4",
      create: paFixture("pa4"),
      idempotencyKey: "k-create",
    });
    const replay = await store.createCase({
      tenantId: "t1",
      caseType: PA,
      caseId: "pa4",
      create: paFixture("pa4"),
      idempotencyKey: "k-create",
    });
    expect(replay.rowId).toBe(first.rowId);
  });

  it("idempotency: replayed transition returns prior result without double-applying", async () => {
    await store.createCase({ tenantId: "t1", caseType: PA, caseId: "pa5", create: paFixture("pa5") });
    const first = await store.transitionCase("t1", PA, "pa5", {
      apply: (c: PaRequest) => paTransition(revivePa(c), "SUBMITTED", { now: new Date("2026-01-05T00:00:00Z") }),
      idempotencyKey: "k-t1",
    });
    const replay = await store.transitionCase("t1", PA, "pa5", {
      apply: (c: PaRequest) => paTransition(revivePa(c), "SUBMITTED", { now: new Date("2026-01-05T00:00:00Z") }),
      idempotencyKey: "k-t1",
    });
    expect(replay.version).toBe(first.version);
    const events = await store.getEventLog("t1", PA, "pa5");
    expect(events.filter((e) => e.toState === "SUBMITTED")).toHaveLength(1);
  });

  it("hash chain verifies after a full NC lifecycle", async () => {
    await store.createCase({ tenantId: "t1", caseType: NC, caseId: "c4", create: ncFixture("c4") });
    await store.transitionCase("t1", NC, "c4", {
      apply: (c: NoticeConsentCase) =>
        ncTransition(reviveNc(c), "NOTICE_DELIVERED", { now: new Date("2026-03-01T11:00:00Z") }),
    });
    await store.transitionCase("t1", NC, "c4", {
      apply: (c: NoticeConsentCase) => {
        const revived = reviveNc(c);
        revived.timing = { ...revived.timing, consentSignedAt: new Date("2026-03-02T10:00:00Z") };
        return ncTransition(revived, "CONSENT_SIGNED", { now: new Date("2026-03-02T10:00:00Z") });
      },
    });
    const verification = await store.verifyEventChain("t1", NC, "c4");
    expect(verification.ok).toBe(true);
    expect(verification.eventCount).toBeGreaterThanOrEqual(2);
  });

  it("chain verification fails closed on tampering", async () => {
    await store.createCase({ tenantId: "t1", caseType: PA, caseId: "pa6", create: paFixture("pa6") });
    await store.transitionCase("t1", PA, "pa6", {
      apply: (c: PaRequest) => paTransition(revivePa(c), "SUBMITTED", { now: new Date("2026-01-05T00:00:00Z") }),
    });
    const chain = await store.getEventLog("t1", PA, "pa6");
    expect(verifyFsmChain(chain).ok).toBe(true);
    const tampered = chain.map((e, i) =>
      i === 0 ? { ...e, eventJson: e.eventJson.replace("SUBMITTED", "APPROVED") } : e
    );
    const result = verifyFsmChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/eventHash mismatch/);
  });

  it("chain verification fails closed on a seq gap", () => {
    const bogus = [
      {
        caseRowId: "x",
        seq: 1,
        eventType: "TRANSITION",
        fromState: null,
        toState: "DRAFT",
        at: new Date().toISOString(),
        detail: null,
        eventJson: "{}",
        prevEventHash: FSM_GENESIS_HASH,
        eventHash: "f".repeat(64),
      },
    ];
    const result = verifyFsmChain(bogus);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/seq gap/);
  });

  it("terminalStates sets closedAt on terminal transition", async () => {
    await store.createCase({
      tenantId: "t1",
      caseType: PA,
      caseId: "pa7",
      create: paFixture("pa7"),
      terminalStates: ["CLOSED", "CANCELLED"],
    });
    const cancelled = await store.transitionCase("t1", PA, "pa7", {
      apply: (c: PaRequest) => paTransition(revivePa(c), "CANCELLED"),
      terminalStates: ["CLOSED", "CANCELLED"],
    });
    expect(cancelled.state).toBe("CANCELLED");
    expect(cancelled.closedAt).toBeDefined();
  });

  it("PPDR happy path: DRAFT → INITIATED persists admin fee + eligibility event", async () => {
    await store.createCase({ tenantId: "t1", caseType: PPDR, caseId: "d2", create: ppdrFixture("d2") });
    const next = await store.transitionCase("t1", PPDR, "d2", {
      apply: (c: PpdrDispute) =>
        ppdrTransition(revivePpdr(c), "INITIATED", {
          now: new Date("2026-02-15T00:00:00Z"),
          adminFeeUsd: 25,
        }),
    });
    expect(next.state).toBe("INITIATED");
    const loaded = await store.getCase<PpdrDispute>("t1", PPDR, "d2");
    expect(loaded?.data.adminFeeUsd).toBe(25);
    const chain = await store.getEventLog("t1", PPDR, "d2");
    expect(chain.some((e) => e.eventType === "ELIGIBILITY_CHECK")).toBe(true);
  });

  it("getEventLog returns [] for unknown case and verifyEventChain reports ok on empty chain", async () => {
    expect(await store.getEventLog("t1", NC, "missing")).toEqual([]);
    const v = await store.verifyEventChain("t1", NC, "missing");
    expect(v.ok).toBe(true);
    expect(v.eventCount).toBe(0);
  });

  it("stored case data is isolated from caller mutation (defensive copies)", async () => {
    const created = await store.createCase({
      tenantId: "t1",
      caseType: PA,
      caseId: "pa8",
      create: paFixture("pa8"),
    });
    (created as FsmStoredCase<PaRequest>).data.state = "APPROVED";
    const loaded = await store.getCase<PaRequest>("t1", PA, "pa8");
    expect(loaded?.data.state).toBe("DRAFT");
  });
});
