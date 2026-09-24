/**
 * Wave W4 vitest — notice-consent: i18n statutory notices (F1),
 * POST_STABILIZATION category (F2), consent expiry + revocation downstream
 * (F3), e-signature artifacts (F4), same-day timezone fix (F7).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateWaiverEligibility,
  validateNoticeContent,
  validateNoticeTiming,
  evaluateConsentExpiry,
  CONSENT_MAX_VALIDITY_DAYS,
  REQUIRED_NOTICE_ELEMENTS,
  civilDateKey,
} from "./waiver";
import { createNoticeConsentCase, transition, type NoticeConsentCase } from "./fsm";
import {
  NOTICE_DICTIONARY,
  NOTICE_LANGUAGES,
  availableNoticeElements,
  composeNoticeDocument,
} from "../../shared/i18n/notices";
import {
  buildSignatureArtifact,
  computeArtifactHash,
  verifySignatureArtifact,
  caseIdFromTokenRef,
  tokenCaseRef,
} from "./signature";

const DAY = 24 * 60 * 60 * 1000;

/* ── F1: i18n statutory notices ──────────────────────────────────────────── */

describe("F1 shared/i18n/notices", () => {
  it("every language provides complete, non-empty text for all required notice elements", () => {
    for (const lang of NOTICE_LANGUAGES) {
      const pack = NOTICE_DICTIONARY[lang];
      for (const el of REQUIRED_NOTICE_ELEMENTS) {
        const text = pack.noticeConsent.elements[el];
        expect(text, `${lang}.${el}`).toBeTruthy();
        expect(text.trim().length, `${lang}.${el} non-empty`).toBeGreaterThan(20);
      }
      expect(availableNoticeElements(lang).sort()).toEqual([...REQUIRED_NOTICE_ELEMENTS].sort());
    }
  });

  it("Spanish pack is a genuine translation (not the English text re-served)", () => {
    for (const el of REQUIRED_NOTICE_ELEMENTS) {
      expect(NOTICE_DICTIONARY.es.noticeConsent.elements[el]).not.toEqual(
        NOTICE_DICTIONARY.en.noticeConsent.elements[el],
      );
    }
    expect(NOTICE_DICTIONARY.es.noticeConsent.documentTitle).toMatch(/Aviso/);
  });

  it("GFE required elements are present in both languages", () => {
    for (const lang of NOTICE_LANGUAGES) {
      const g = NOTICE_DICTIONARY[lang].gfe.elements;
      for (const k of Object.keys(g) as (keyof typeof g)[]) {
        expect(g[k].trim().length, `${lang}.gfe.${k}`).toBeGreaterThan(20);
      }
      expect(NOTICE_DICTIONARY[lang].gfe.coProviderAggregationRule).toBeTruthy();
    }
  });

  it("validateContent validates against the matching language", () => {
    const ok = validateNoticeContent(REQUIRED_NOTICE_ELEMENTS, "es");
    expect(ok.complete).toBe(true);
    expect(ok.language).toBe("es");
    const missing = validateNoticeContent(REQUIRED_NOTICE_ELEMENTS.slice(0, 4), "es");
    expect(missing.complete).toBe(false);
    expect(missing.missing.length).toBe(4);
  });

  it("validateContent fails closed on an unsupported language", () => {
    const r = validateNoticeContent(REQUIRED_NOTICE_ELEMENTS, "fr");
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual([...REQUIRED_NOTICE_ELEMENTS]);
  });

  it("composeNoticeDocument embeds every required block in both languages", () => {
    for (const lang of NOTICE_LANGUAGES) {
      const pack = NOTICE_DICTIONARY[lang];
      const doc = composeNoticeDocument({
        providerName: "Clinic Norte",
        caseId: "NC-1",
        itemsAndServices: ["CPT 99213"],
        gfeTotalUsd: 250,
        language: lang,
      });
      for (const el of REQUIRED_NOTICE_ELEMENTS) {
        expect(doc).toContain(pack.noticeConsent.elements[el]);
      }
      expect(doc).toContain(pack.noticeConsent.consentAttestation);
      expect(doc).toContain("NC-1");
    }
  });
});

/* ── F2: POST_STABILIZATION category ─────────────────────────────────────── */

describe("F2 post-stabilization (45 CFR 149.410(b)(2)(ii))", () => {
  const allTrue = {
    patientStable: true,
    canTravelToParticipatingFacility: true,
    receivingFacilityReachable: true,
    informedConsentObtained: true,
  };

  it("waivable ONLY when all four condition flags are explicitly true", () => {
    const r = evaluateWaiverEligibility({ serviceCategory: "POST_STABILIZATION", postStabilization: allTrue });
    expect(r.waivable).toBe(true);
    expect(r.eligibility).toBe("WAIVABLE");
  });

  it("fails closed when the conditions object is absent", () => {
    const r = evaluateWaiverEligibility({ serviceCategory: "POST_STABILIZATION" });
    expect(r.waivable).toBe(false);
    expect(r.eligibility).toBe("NON_WAIVABLE_POST_STABILIZATION_CONDITIONS");
  });

  it("matrix: every single missing/false flag makes it NEVER_WAIVABLE", () => {
    const keys = Object.keys(allTrue) as (keyof typeof allTrue)[];
    // omit one flag at a time (undefined)
    for (const k of keys) {
      const ps = { ...allTrue } as Record<string, boolean | undefined>;
      delete ps[k];
      const r = evaluateWaiverEligibility({ serviceCategory: "POST_STABILIZATION", postStabilization: ps });
      expect(r.waivable, `omitted ${k}`).toBe(false);
      expect(r.reason, `omitted ${k}`).toContain(k);
    }
    // explicit false
    for (const k of keys) {
      const r = evaluateWaiverEligibility({
        serviceCategory: "POST_STABILIZATION",
        postStabilization: { ...allTrue, [k]: false },
      });
      expect(r.waivable, `false ${k}`).toBe(false);
    }
  });

  it("post-stabilization case cannot reach CONSENT_SIGNED when conditions unmet", () => {
    const c = createNoticeConsentCase({
      id: "PS-1",
      waiverInput: { serviceCategory: "POST_STABILIZATION" }, // no conditions
      timing: {
        scheduledAt: new Date(Date.now() - 10 * DAY),
        serviceAt: new Date(Date.now() + 5 * DAY),
        noticeDeliveredAt: new Date(Date.now() - 4 * DAY),
        consentSignedAt: new Date(Date.now() - 3 * DAY),
      },
      noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
    });
    const delivered = transition(c, "NOTICE_DELIVERED");
    expect(() => transition(delivered, "CONSENT_SIGNED")).toThrow(/exception unavailable/);
  });
});

/* ── F3: consent expiry + revocation downstream ──────────────────────────── */

describe("F3 consent expiry", () => {
  const base = {
    noticeDeliveredAt: new Date("2026-01-01T12:00:00Z"),
    noticedServiceAt: new Date("2026-01-20T12:00:00Z"),
    consentSignedAt: new Date("2026-01-02T12:00:00Z"),
  };

  it("not expired within window and 90 days", () => {
    const r = evaluateConsentExpiry({ ...base, asOf: new Date("2026-01-10T00:00:00Z") });
    expect(r.expired).toBe(false);
  });

  it("expires when rescheduled beyond the noticed service window", () => {
    const r = evaluateConsentExpiry({
      ...base,
      currentServiceAt: new Date("2026-01-21T00:00:01Z"),
      asOf: new Date("2026-01-10T00:00:00Z"),
    });
    expect(r.expired).toBe(true);
    expect(r.reasons[0]).toMatch(/rescheduled/);
  });

  it("does NOT expire when rescheduled EARLIER within the noticed window", () => {
    const r = evaluateConsentExpiry({
      ...base,
      currentServiceAt: new Date("2026-01-15T00:00:00Z"),
      asOf: new Date("2026-01-10T00:00:00Z"),
    });
    expect(r.expired).toBe(false);
  });

  it("expires after 90 days (boundary: day 90 ok, day 91 expired)", () => {
    const at90 = new Date(base.consentSignedAt.getTime() + 90 * DAY);
    const at91 = new Date(base.consentSignedAt.getTime() + 91 * DAY);
    expect(evaluateConsentExpiry({ ...base, asOf: at90 }).expired).toBe(false);
    expect(evaluateConsentExpiry({ ...base, asOf: at91 }).expired).toBe(true);
    expect(CONSENT_MAX_VALIDITY_DAYS).toBe(90);
  });

  function signedCase(): NoticeConsentCase {
    const c = createNoticeConsentCase({
      id: "EXP-1",
      waiverInput: { serviceCategory: "NON_EMERGENCY", providerInNetwork: false, noInNetworkProviderAvailable: false },
      timing: {
        scheduledAt: new Date("2026-01-01T00:00:00Z"),
        serviceAt: new Date("2026-06-01T12:00:00Z"),
        noticeDeliveredAt: new Date("2026-01-02T00:00:00Z"),
        consentSignedAt: new Date("2026-01-02T01:00:00Z"),
        timeZone: "America/Chicago",
      },
      noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
    });
    return transition(transition(c, "NOTICE_DELIVERED"), "CONSENT_SIGNED");
  }

  it("NOTICE_EXPIRED guard rejects a non-expired flip (fail closed)", () => {
    const s = signedCase();
    expect(() =>
      transition(s, "NOTICE_EXPIRED", { now: new Date("2026-02-01T00:00:00Z") }),
    ).toThrow(/requires an expired consent/);
  });

  it("NOTICE_EXPIRED succeeds past the 90-day ceiling", () => {
    const s = signedCase();
    const e = transition(s, "NOTICE_EXPIRED", { now: new Date("2026-06-01T00:00:00Z") });
    expect(e.state).toBe("NOTICE_EXPIRED");
  });

  it("NOTICE_EXPIRED succeeds when rescheduled beyond the frozen noticed date", () => {
    const s = signedCase();
    // noticedServiceAt frozen at NOTICE_DELIVERED (2026-06-01); reschedule later.
    const rescheduled: NoticeConsentCase = {
      ...s,
      timing: { ...s.timing, serviceAt: new Date("2026-06-15T12:00:00Z") },
    };
    const e = transition(rescheduled, "NOTICE_EXPIRED", { now: new Date("2026-02-01T00:00:00Z") });
    expect(e.state).toBe("NOTICE_EXPIRED");
    expect(s.noticedServiceAt?.toISOString()).toBe("2026-06-01T12:00:00.000Z");
  });
});

/* ── F4: e-signature artifacts ───────────────────────────────────────────── */

describe("F4 signature artifacts", () => {
  const input = {
    caseId: "NC-SIG-1",
    signerName: "Jane Patient",
    signatureText: "Jane Patient",
    attestation: true,
    timestamp: new Date("2026-02-01T15:04:05Z"),
    ip: "203.0.113.10",
  };

  it("artifact hash is sha256 over canonical {caseId, signerName, timestamp, ip, ...}", () => {
    const a = buildSignatureArtifact(input);
    expect(a.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.artifactHash).toBe(
      computeArtifactHash({ ...input, timestamp: input.timestamp.toISOString() }),
    );
  });

  it("verifySignatureArtifact detects tampering in any field", () => {
    const a = buildSignatureArtifact(input);
    expect(verifySignatureArtifact(a)).toBe(true);
    expect(verifySignatureArtifact({ ...a, signerName: "Mallory" })).toBe(false);
    expect(verifySignatureArtifact({ ...a, caseId: "NC-SIG-2" })).toBe(false);
    expect(verifySignatureArtifact({ ...a, timestamp: "2026-02-02T00:00:00.000Z" })).toBe(false);
  });

  it("hash is deterministic and order-insensitive (canonical JSON)", () => {
    const h1 = computeArtifactHash({ ...input, timestamp: input.timestamp.toISOString() });
    const h2 = computeArtifactHash({
      ip: input.ip,
      attestation: true,
      signatureText: input.signatureText,
      signerName: input.signerName,
      caseId: input.caseId,
      timestamp: input.timestamp.toISOString(),
    });
    expect(h1).toBe(h2);
  });

  it("token case ref seam round-trips", () => {
    expect(tokenCaseRef("NC-1")).toBe("nc:NC-1");
    expect(caseIdFromTokenRef("nc:NC-1")).toBe("NC-1");
    expect(caseIdFromTokenRef("dispute-9")).toBeNull();
    expect(caseIdFromTokenRef(null)).toBeNull();
  });
});

/* ── F7: same-day timezone fix ───────────────────────────────────────────── */

describe("F7 validateNoticeTiming timezone", () => {
  // Scheduled 2026-03-01 17:00 local (Chicago) = 2026-03-01T23:00Z; notice
  // delivered 2026-03-01 18:00 local = 2026-03-02T00:00Z — SAME local day but
  // DIFFERENT UTC day. The old UTC-getter check flagged this as a violation.
  const scheduledAt = new Date("2026-03-01T23:00:00Z");
  const noticeDeliveredAt = new Date("2026-03-02T00:00:00Z");
  const serviceAt = new Date("2026-03-02T20:00:00Z"); // <72h horizon

  it("same local day passes with explicit facility timezone", () => {
    const r = validateNoticeTiming({
      scheduledAt,
      noticeDeliveredAt,
      serviceAt,
      consentSignedAt: new Date("2026-03-02T15:00:00Z"), // 5h before service
      timeZone: "America/Chicago",
    });
    expect(r.compliant).toBe(true);
    expect(r.timeZone).toBe("America/Chicago");
    expect(r.warnings).toEqual([]);
  });

  it("default UTC emits a warning and compares UTC civil days", () => {
    const r = validateNoticeTiming({ scheduledAt, noticeDeliveredAt, serviceAt });
    expect(r.timeZone).toBe("UTC");
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/UTC/);
    expect(r.compliant).toBe(false); // different UTC day
    expect(r.violations[0]).toMatch(/day of scheduling/);
  });

  it("invalid timezone identifier throws", () => {
    expect(() =>
      validateNoticeTiming({ scheduledAt, noticeDeliveredAt, serviceAt, timeZone: "Mars/Olympus" }),
    ).toThrow(/IANA timezone/);
  });

  it("civilDateKey respects timezone boundaries", () => {
    const d = new Date("2026-03-02T00:00:00Z");
    expect(civilDateKey(d, "UTC")).toBe("2026-03-02");
    expect(civilDateKey(d, "America/Chicago")).toBe("2026-03-01");
  });

  it("same-day rule: notice next LOCAL day is a violation even within 24h", () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date("2026-03-01T15:00:00Z"), // 09:00 Chicago
      noticeDeliveredAt: new Date("2026-03-02T14:00:00Z"), // 08:00 Chicago next day
      serviceAt: new Date("2026-03-02T20:00:00Z"),
      consentSignedAt: new Date("2026-03-02T15:00:00Z"),
      timeZone: "America/Chicago",
    });
    expect(r.compliant).toBe(false);
    expect(r.violations[0]).toMatch(/day of scheduling/);
  });
});
