/**
 * Phase 21 (S1) — lib-level tests for client/src/lib/feedback.ts.
 * Node environment (no jsdom); exercises the pure helpers + WebCrypto
 * sha256 (Node 20 exposes globalThis.crypto.subtle).
 */
import { describe, expect, it } from "vitest";
import {
  KeystrokeTracker,
  buildPrefillTerminalEvents,
  classifyPrefillOutcome,
  honestyLabelCopy,
  isModelStale,
  sha256Hex,
  type PrefilledField,
} from "./feedback";

describe("sha256Hex", () => {
  it("produces a 64-char lowercase hex digest", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("matches the well-known sha256 of 'hello'", async () => {
    expect(await sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it("stringifies non-string values like the server (String(value))", async () => {
    expect(await sha256Hex(2100)).toBe(await sha256Hex("2100"));
  });
  it("is deterministic", async () => {
    expect(await sha256Hex("x")).toBe(await sha256Hex("x"));
  });
});

describe("classifyPrefillOutcome", () => {
  it("untouched-confirmed => accepted", () => {
    expect(classifyPrefillOutcome("CA", "CA")).toBe("accepted");
  });
  it("any change => edited", () => {
    expect(classifyPrefillOutcome("CA", "TX")).toBe("edited");
    expect(classifyPrefillOutcome("CA", "ca")).toBe("edited");
    expect(classifyPrefillOutcome("CA", "")).toBe("edited");
  });
});

describe("buildPrefillTerminalEvents", () => {
  const fields: PrefilledField[] = [
    { formKey: "patientState", sourceField: "patient_state", suggestedValue: "CA", suggestedValueHash: null, confidence: 0.9 },
    { formKey: "billedAmount", sourceField: "billed_amount", suggestedValue: "2100", suggestedValueHash: null, confidence: 0.7 },
  ];

  it("accepted field reuses/derives the suggested hash as final hash", async () => {
    const ks = new KeystrokeTracker();
    const events = await buildPrefillTerminalEvents(fields, { patientState: "CA", billedAmount: "2200" }, ks);
    expect(events).toHaveLength(2);
    const accepted = events.find(e => e.fieldName === "patient_state")!;
    expect(accepted.action).toBe("accepted");
    expect(accepted.finalValueHash).toBe(await sha256Hex("CA"));
    expect(accepted.keystrokeCount).toBe(0);
    const edited = events.find(e => e.fieldName === "billed_amount")!;
    expect(edited.action).toBe("edited");
    expect(edited.finalValueHash).toBe(await sha256Hex("2200"));
    expect(edited.finalValueHash).not.toBe(await sha256Hex("2100"));
  });

  it("reuses the server-provided suggestedValueHash verbatim when valid", async () => {
    const hash = "a".repeat(64);
    const ks = new KeystrokeTracker();
    const [ev] = await buildPrefillTerminalEvents(
      [{ formKey: "patientState", sourceField: "patient_state", suggestedValue: "CA", suggestedValueHash: hash, confidence: null }],
      { patientState: "CA" },
      ks,
    );
    expect(ev.suggestedValueHash).toBe(hash);
    expect(ev.finalValueHash).toBe(hash);
  });

  it("drops an invalid (non-64-hex) server hash instead of forwarding it", async () => {
    const ks = new KeystrokeTracker();
    const [ev] = await buildPrefillTerminalEvents(
      [{ formKey: "patientState", sourceField: "patient_state", suggestedValue: "CA", suggestedValueHash: "bogus", confidence: null }],
      { patientState: "TX" },
      ks,
    );
    expect(ev.suggestedValueHash).toBeNull();
    expect(ev.action).toBe("edited");
  });

  it("carries per-field keystroke counts", async () => {
    const ks = new KeystrokeTracker();
    ks.increment("billedAmount", 4);
    const events = await buildPrefillTerminalEvents(fields, { patientState: "CA", billedAmount: "2200" }, ks);
    expect(events.find(e => e.fieldName === "billed_amount")!.keystrokeCount).toBe(4);
    expect(events.find(e => e.fieldName === "patient_state")!.keystrokeCount).toBe(0);
  });
});

describe("KeystrokeTracker", () => {
  it("counts per field and in total", () => {
    const ks = new KeystrokeTracker();
    ks.increment("a");
    ks.increment("a");
    ks.increment("b", 3);
    expect(ks.get("a")).toBe(2);
    expect(ks.get("b")).toBe(3);
    expect(ks.get("missing")).toBe(0);
    expect(ks.total()).toBe(5);
  });
  it("reset clears counts", () => {
    const ks = new KeystrokeTracker();
    ks.increment("a");
    ks.reset();
    expect(ks.total()).toBe(0);
  });
  it("dwell is non-negative", () => {
    const ks = new KeystrokeTracker();
    expect(ks.dwellMs()).toBeGreaterThanOrEqual(0);
  });
});

describe("honestyLabelCopy", () => {
  it("covers both server labels and never promises outcomes", () => {
    expect(honestyLabelCopy("statistical_estimate")).toMatch(/not a prediction or guarantee/i);
    expect(honestyLabelCopy("insufficient_data")).toMatch(/not enough data/i);
  });
});

describe("isModelStale", () => {
  const now = Date.parse("2026-09-05T00:00:00Z");
  it("null/invalid trainedAt is stale (honest: unknown age)", () => {
    expect(isModelStale(null, 7, now)).toBe(true);
    expect(isModelStale("not-a-date", 7, now)).toBe(true);
  });
  it("fresh model is not stale", () => {
    expect(isModelStale("2026-09-04T00:00:00Z", 7, now)).toBe(false);
  });
  it("model older than the window is stale", () => {
    expect(isModelStale("2026-08-20T00:00:00Z", 7, now)).toBe(true);
  });
});
