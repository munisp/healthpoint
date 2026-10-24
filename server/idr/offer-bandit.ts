/**
 * server/idr/offer-bandit.ts
 *
 * Phase 22 (S1): contextual bandit over the offer-strategy-v2 estimate.
 * Pure module, no DB — the router (offerStrategy.recommendV2 in
 * server/routers/intelligence.ts) gathers arm posteriors and the org's daily
 * counters, and calls selectOfferArm().
 *
 * Mechanics (design §3.1):
 *  - Thompson sampling over Beta(a,b) posteriors, one per arm, with HARD
 *    exposure gates evaluated in order:
 *      1. min_pulls   — below OFFER_BANDIT_MIN_PULLS total pulls the baseline
 *                       arm is served (the bandit is collecting, not deciding);
 *      2. daily_cap   — exploresToday >= OFFER_BANDIT_MAX_EXPLORE_PER_ORG_PER_DAY;
 *      3. rate_cap    — the PROSPECTIVE exploration ratio
 *                       (exploresToday + 1) / (servesToday + 1) would exceed
 *                       OFFER_BANDIT_EXPLORATION_RATE.
 *  - Arm deltas are basis points around the v2 estimate, bounded by the env
 *    (default ±1000 bps = ±10%). The baseline arm (deltaBps 0) is ALWAYS
 *    present — parseArmsBps fails closed to [0] on garbage so a broken env
 *    can never remove the honest anchor.
 *  - Rewards are binary (accepted = 1, rejected = 0); countered and expired
 *    assignments are EXCLUDED from posteriors (recorded for audit only) and
 *    attributed nightly, never online (design §3.3).
 *
 * Beta sampling without a dependency: alpha/beta are integers >= 1 (rewards
 * are 0/1 from a Beta(1,1) prior), so Gamma(k) is exactly the sum of k
 * i.i.d. Exp(1) draws (-ln u over the injected rng). Beta(a,b) =
 * Ga/(Ga+Gb). Moment-checked in offer-bandit.test.ts.
 */

export interface BanditArm {
  armId: string;
  deltaBps: number;
}

export interface BanditArmState {
  armId: string;
  alpha: number;
  beta: number;
  pulls: number;
  served: number;
}

export interface BanditSelectionInput {
  /** v2 estimate (never null when we get here). */
  baselineUsd: number;
  /** From OFFER_BANDIT_ARMS_BPS; always includes deltaBps 0. */
  arms: BanditArm[];
  /** Per-org×segment posteriors (missing arm = Beta(1,1)). */
  states: BanditArmState[];
  /** Org×segment total pulls across arms. */
  totalPulls: number;
  /** Org's non-baseline servings today (cap counter). */
  exploresToday: number;
  /** Org's bandit-eligible servings today. */
  servesToday: number;
  explorationRate: number;
  maxExplorePerDay: number;
  minPulls: number;
  /** Injected (seeded in tests/journeys). */
  rng: () => number;
}

export interface BanditSelection {
  armId: string;
  deltaBps: number;
  servedUsd: number;
  /** arm ≠ baseline. */
  exploration: boolean;
  gate: "active" | "min_pulls" | "rate_cap" | "daily_cap";
  /** alpha/(alpha+beta) per arm, for the payload. */
  posteriorMeans: Record<string, number>;
}

export const DEFAULT_ARMS_BPS = [-1000, -500, 0, 500, 1000];
export const DEFAULT_EXPLORATION_RATE = 0.1;
export const DEFAULT_MAX_EXPLORE_PER_ORG_PER_DAY = 5;
export const DEFAULT_MIN_PULLS = 10;
export const DEFAULT_REWARD_WINDOW_DAYS = 30;
export const BASELINE_ARM_ID = "delta_bps_0";

export function armIdFor(deltaBps: number): string {
  return `delta_bps_${deltaBps > 0 ? `+${deltaBps}` : String(deltaBps)}`;
}

/** Fail-closed arm parsing: garbage env → baseline-only arm set. */
export function parseArmsBps(env: NodeJS.ProcessEnv = process.env): BanditArm[] {
  const raw = env.OFFER_BANDIT_ARMS_BPS;
  const parsed = (raw === undefined || raw.trim() === "" ? DEFAULT_ARMS_BPS : raw.split(",").map(s => Number(s.trim())))
    .filter(n => Number.isInteger(n) && Math.abs(n) <= 10000);
  if (!parsed.includes(0)) return [{ armId: BASELINE_ARM_ID, deltaBps: 0 }];
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.map(deltaBps => ({ armId: armIdFor(deltaBps), deltaBps }));
}

export function banditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OFFER_BANDIT_ENABLED !== "false";
}

function numEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function explorationRate(env: NodeJS.ProcessEnv = process.env): number {
  const n = numEnv(env, "OFFER_BANDIT_EXPLORATION_RATE", DEFAULT_EXPLORATION_RATE);
  return Math.min(1, n);
}

export function maxExplorePerOrgPerDay(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor(numEnv(env, "OFFER_BANDIT_MAX_EXPLORE_PER_ORG_PER_DAY", DEFAULT_MAX_EXPLORE_PER_ORG_PER_DAY));
}

export function minPulls(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor(numEnv(env, "OFFER_BANDIT_MIN_PULLS", DEFAULT_MIN_PULLS));
}

export function rewardWindowDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.BANDIT_REWARD_WINDOW_DAYS);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_REWARD_WINDOW_DAYS;
}

/** Served amount for an arm: round(baseline × (1 + deltaBps/10000), 2). */
export function servedAmountUsd(baselineUsd: number, deltaBps: number): number {
  return Math.round(baselineUsd * (1 + deltaBps / 10000) * 100) / 100;
}

/** Exact Gamma(k) for integer k >= 1: sum of k i.i.d. Exp(1) draws. */
function sampleGammaInteger(shape: number, rng: () => number): number {
  let sum = 0;
  for (let i = 0; i < shape; i++) {
    const u = rng();
    // Guard against an rng returning exactly 0 (log(0) = -Infinity).
    sum += -Math.log(u > 0 ? u : Number.EPSILON);
  }
  return sum;
}

/** Beta(a, b) sample for integer a, b >= 1. */
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const ga = sampleGammaInteger(alpha, rng);
  const gb = sampleGammaInteger(beta, rng);
  return ga / (ga + gb);
}

export function selectOfferArm(input: BanditSelectionInput): BanditSelection {
  const baseline = input.arms.find(a => a.deltaBps === 0) ?? { armId: BASELINE_ARM_ID, deltaBps: 0 };
  const stateByArm = new Map(input.states.map(s => [s.armId, s]));
  const posteriorMeans: Record<string, number> = {};
  for (const arm of input.arms) {
    const st = stateByArm.get(arm.armId);
    const alpha = st?.alpha ?? 1;
    const beta = st?.beta ?? 1;
    posteriorMeans[arm.armId] = Math.round((alpha / (alpha + beta)) * 10000) / 10000;
  }

  const serveBaseline = (gate: BanditSelection["gate"]): BanditSelection => ({
    armId: baseline.armId,
    deltaBps: 0,
    servedUsd: servedAmountUsd(input.baselineUsd, 0),
    exploration: false,
    gate,
    posteriorMeans,
  });

  // Gate 1: not enough evidence — collect on the baseline arm.
  if (input.totalPulls < input.minPulls) return serveBaseline("min_pulls");
  // Gate 2: absolute daily exploration cap.
  if (input.exploresToday >= input.maxExplorePerDay) return serveBaseline("daily_cap");
  // Gate 3: prospective exploration-rate cap (never exceeded, even by a
  // concurrent pair — counters are re-read from the DB at serve time).
  if (input.servesToday > 0 && (input.exploresToday + 1) / (input.servesToday + 1) > input.explorationRate) {
    return serveBaseline("rate_cap");
  }

  // Thompson sampling: sample θ_arm ~ Beta(α, β) per arm, pick argmax.
  let winner = baseline;
  let best = -1;
  for (const arm of input.arms) {
    const st = stateByArm.get(arm.armId);
    const theta = sampleBeta(st?.alpha ?? 1, st?.beta ?? 1, input.rng);
    if (theta > best) {
      best = theta;
      winner = arm;
    }
  }
  const exploration = winner.deltaBps !== 0;
  return {
    armId: winner.armId,
    deltaBps: winner.deltaBps,
    servedUsd: servedAmountUsd(input.baselineUsd, winner.deltaBps),
    exploration,
    gate: "active",
    posteriorMeans,
  };
}

/** Nightly posterior update for a terminal reward (accepted=1, rejected=0). */
export function updatePosterior(state: BanditArmState, reward: 0 | 1): BanditArmState {
  return {
    ...state,
    alpha: state.alpha + reward,
    beta: state.beta + (1 - reward),
    pulls: state.pulls + 1,
  };
}
