/**
 * client/src/lib/feedback.ts — Phase 21 (S1) suggestion-feedback helpers.
 *
 * Honesty contract (mirrors server/routers/intelligence.ts):
 *  - The PRODUCER records `presented` server-side; the client records only
 *    terminal actions (accepted / edited / rejected).
 *  - Suggested and final values are sent as sha256 hashes ONLY — never the
 *    value itself (suggestion_events is PHI-free by construction).
 *  - Field outcomes are classified by exact string comparison of the value
 *    the user submits vs. the value that was suggested: untouched-confirmed
 *    => "accepted", any change => "edited". No inference beyond that.
 */

/** Mirrors drizzle/schema-intelligence.ts SUGGESTION_EVENT_ACTIONS. */
export type SuggestionEventAction = "presented" | "accepted" | "edited" | "rejected" | "expired";

/** One field that was prefilled by a server suggestion (prefill.dispute). */
export interface PrefilledField {
  /** Form state key (e.g. "respondingPartyName"). */
  formKey: string;
  /** Server-side extracted field name (e.g. "responding_party_name"). */
  sourceField: string;
  /** The suggested value as applied to the form (string form). */
  suggestedValue: string;
  /** Server-provided sha256 of the suggested value (64 hex chars). */
  suggestedValueHash: string | null;
  /** Producer-reported confidence 0..1, or null when not reported. */
  confidence: number | null;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * sha256 hex of a value, matching the server's `sha256Hex(String(value))`.
 * Returns null when WebCrypto is unavailable (non-secure context) — callers
 * omit the hash field rather than fabricating one.
 */
export async function sha256Hex(value: unknown): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Classify the terminal outcome of a single prefilled field.
 * Exact match with the suggestion => accepted-as-is; anything else => edited.
 */
export function classifyPrefillOutcome(suggestedValue: string, currentValue: string): "accepted" | "edited" {
  return currentValue === suggestedValue ? "accepted" : "edited";
}

/** Per-field terminal event descriptor built at submit time. */
export interface PrefillTerminalEvent {
  fieldName: string;
  action: "accepted" | "edited";
  confidence: number | null;
  suggestedValueHash: string | null;
  finalValueHash: string | null;
  keystrokeCount: number;
}

/**
 * Build the terminal events for a prefilled form. Pure + async only for the
 * final-value hashes. Fields whose hashes cannot be computed still record
 * (hash omitted) — the denominator matters more than the hash.
 */
export async function buildPrefillTerminalEvents(
  prefilled: PrefilledField[],
  currentValues: Record<string, string>,
  keystrokes: KeystrokeTracker,
): Promise<PrefillTerminalEvent[]> {
  const out: PrefillTerminalEvent[] = [];
  for (const f of prefilled) {
    const current = currentValues[f.formKey] ?? "";
    const action = classifyPrefillOutcome(f.suggestedValue, current);
    // accepted-as-is: final == suggested, reuse the server hash; edited: hash the final value.
    const finalValueHash = action === "accepted"
      ? (f.suggestedValueHash && HEX_64.test(f.suggestedValueHash) ? f.suggestedValueHash : await sha256Hex(f.suggestedValue))
      : await sha256Hex(current);
    out.push({
      fieldName: f.sourceField,
      action,
      confidence: f.confidence,
      suggestedValueHash: f.suggestedValueHash && HEX_64.test(f.suggestedValueHash) ? f.suggestedValueHash : null,
      finalValueHash,
      keystrokeCount: keystrokes.get(f.formKey),
    });
  }
  return out;
}

/** Counts user keystrokes per form field between prefill and submit. */
export class KeystrokeTracker {
  private counts = new Map<string, number>();
  private sinceMs = Date.now();

  increment(fieldKey: string, by = 1): void {
    this.counts.set(fieldKey, (this.counts.get(fieldKey) ?? 0) + by);
  }
  get(fieldKey: string): number {
    return this.counts.get(fieldKey) ?? 0;
  }
  total(): number {
    let t = 0;
    for (const v of this.counts.values()) t += v;
    return t;
  }
  /** Milliseconds since the tracker was created (presented→terminal dwell). */
  dwellMs(now: number = Date.now()): number {
    return Math.max(0, Math.round(now - this.sinceMs));
  }
  reset(): void {
    this.counts.clear();
    this.sinceMs = Date.now();
  }
}

/**
 * Map an offer-strategy v2 honesty label to display copy. The label itself
 * is rendered verbatim next to this copy — never reword the label.
 */
export function honestyLabelCopy(label: "statistical_estimate" | "insufficient_data"): string {
  return label === "statistical_estimate"
    ? "Statistical estimate from real platform IDR determinations — not a prediction or guarantee."
    : "Not enough data yet — no estimate is produced until enough closed determinations exist.";
}

/** True when a model's trainedAt is older than `staleDays` (design §10.3). */
export function isModelStale(trainedAt: string | null | undefined, staleDays = 7, now: number = Date.now()): boolean {
  if (!trainedAt) return true;
  const t = Date.parse(trainedAt);
  if (Number.isNaN(t)) return true;
  return now - t > staleDays * 24 * 60 * 60 * 1000;
}

/** Feedback mutation payload (subset) — mirrors feedback.record input. */
export interface FeedbackRecordInput {
  orgId: string;
  suggestionId: string;
  surface: "new_dispute_prefill" | "quarantine_repair" | "offer_recommendation" | "next_action";
  action: SuggestionEventAction;
  modelName: string;
  modelVersionId?: string;
  confidence?: number;
  contextHash?: string;
  fieldName?: string;
  suggestedValueHash?: string;
  finalValueHash?: string;
  keystrokeCount?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}
