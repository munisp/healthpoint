/**
 * Phase 22 (S1) unit tests — offer-bandit engine (pure, no DB).
 *
 *  - Thompson sampling with a seeded rng converges to the best arm.
 *  - min_pulls / rate_cap / daily_cap gates each force the baseline arm.
 *  - parseArmsBps fails closed to [0] on garbage.
 *  - updatePosterior α/β math; countered/expired are excluded upstream
 *    (reward attribution rules live in learningLoopRefresh.test.ts).
 *  - Beta sampler moment check against known integer-shape moments.
 */
import { describe, it, expect } from "vitest";
import {
  parseArmsBps,
  selectOfferArm,
  updatePosterior,
  sampleBeta,
  servedAmountUsd,
  armIdFor,
  type BanditArmState,
  type BanditSelectionInput,
} from "./offer-bandit";

/** Deterministic LCG rng (seeded) for reproducible tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ARMS = parseArmsBps({}); // default [-1000,-500,0,500,1000]

function baseInput(over: Partial<BanditSelectionInput> = {}): BanditSelectionInput {
  return {
    baselineUsd: 1000,
    arms: ARMS,
    states: [],
    totalPulls: 0,
    exploresToday: 0,
    servesToday: 0,
    explorationRate: 0.1,
    maxExplorePerDay: 5,
    minPulls: 10,
    rng: lcg(42),
    ...over,
  };
}

describe("parseArmsBps", () => {
  it("defaults to the ±1000bps ladder and always includes baseline", () => {
    expect(ARMS.map(a => a.deltaBps)).toEqual([-1000, -500, 0, 500, 1000]);
    expect(ARMS.map(a => a.armId)).toContain("delta_bps_0");
  });
  it("fails closed to baseline-only on garbage", () => {
    expect(parseArmsBps({ OFFER_BANDIT_ARMS_BPS: "garbage,,x" })).toEqual([{ armId: "delta_bps_0", deltaBps: 0 }]);
    // A valid set WITHOUT 0 fails closed too — the anchor can never be removed.
    expect(parseArmsBps({ OFFER_BANDIT_ARMS_BPS: "500,1000" })).toEqual([{ armId: "delta_bps_0", deltaBps: 0 }]);
  });
  it("dedupes and sorts valid input", () => {
    expect(parseArmsBps({ OFFER_BANDIT_ARMS_BPS: "500,0,-500,500" }).map(a => a.deltaBps)).toEqual([-500, 0, 500]);
  });
});

describe("arm math", () => {
  it("armIdFor + servedAmountUsd", () => {
    expect(armIdFor(500)).toBe("delta_bps_+500");
    expect(armIdFor(-1000)).toBe("delta_bps_-1000");
    expect(servedAmountUsd(1000, 1000)).toBe(1100);
    expect(servedAmountUsd(1000, -1000)).toBe(900);
    expect(servedAmountUsd(1000, 0)).toBe(1000);
    expect(servedAmountUsd(1234.56, 500)).toBe(1296.29);
  });
  it("updatePosterior: reward 1 → α+1; reward 0 → β+1", () => {
    const s: BanditArmState = { armId: "a", alpha: 1, beta: 1, pulls: 0, served: 0 };
    const s1 = updatePosterior(s, 1);
    expect([s1.alpha, s1.beta, s1.pulls]).toEqual([2, 1, 1]);
    const s0 = updatePosterior(s1, 0);
    expect([s0.alpha, s0.beta, s0.pulls]).toEqual([2, 2, 2]);
  });
  it("sampleBeta integer shapes: mean ≈ α/(α+β), no NaN/Infinity", () => {
    const rng = lcg(7);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = sampleBeta(8, 2, rng); // mean 0.8
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.78);
    expect(mean).toBeLessThan(0.82);
  });
});

describe("gates", () => {
  it("min_pulls: below the floor the baseline arm is served (collecting, not deciding)", () => {
    const r = selectOfferArm(baseInput({ totalPulls: 9 }));
    expect(r.gate).toBe("min_pulls");
    expect(r.deltaBps).toBe(0);
    expect(r.exploration).toBe(false);
    expect(r.servedUsd).toBe(1000);
  });
  it("daily_cap: exploresToday >= maxExplorePerDay forces baseline", () => {
    const r = selectOfferArm(baseInput({ totalPulls: 50, exploresToday: 5, servesToday: 100 }));
    expect(r.gate).toBe("daily_cap");
    expect(r.deltaBps).toBe(0);
  });
  it("rate_cap: PROSPECTIVE ratio (explores+1)/(serves+1) > rate forces baseline", () => {
    // (1+1)/(10+1) = 0.1818 > 0.10 → capped
    const capped = selectOfferArm(baseInput({ totalPulls: 50, exploresToday: 1, servesToday: 10 }));
    expect(capped.gate).toBe("rate_cap");
    // Boundary: (0+1)/(9+1) = 0.10 → NOT > rate → allowed through
    const ok = selectOfferArm(baseInput({ totalPulls: 50, exploresToday: 0, servesToday: 9 }));
    expect(ok.gate).toBe("active");
  });
  it("posteriorMeans reflect Beta means per arm", () => {
    const r = selectOfferArm(baseInput({
      states: [{ armId: "delta_bps_+500", alpha: 9, beta: 1, pulls: 8, served: 8 }],
    }));
    expect(r.posteriorMeans["delta_bps_+500"]).toBe(0.9);
    expect(r.posteriorMeans["delta_bps_0"]).toBe(0.5);
  });
});

describe("Thompson convergence", () => {
  it("with enough evidence the best arm is served almost always", () => {
    const states: BanditArmState[] = ARMS.map(a => ({ armId: a.armId, alpha: 1, beta: 1, pulls: 0, served: 0 }));
    // +500 arm is strongly rewarded; others strongly penalized.
    for (const s of states) {
      const strong = s.armId === "delta_bps_+500";
      for (let i = 0; i < 40; i++) {
        const updated = updatePosterior(s, strong ? 1 : 0);
        s.alpha = updated.alpha; s.beta = updated.beta; s.pulls = updated.pulls;
      }
    }
    const rng = lcg(1234);
    let picked = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const r = selectOfferArm(baseInput({ states, totalPulls: 200, rng }));
      expect(r.gate).toBe("active");
      if (r.armId === "delta_bps_+500") picked++;
      if (r.armId === "delta_bps_+500") {
        expect(r.exploration).toBe(true);
        expect(r.servedUsd).toBe(1050);
      }
    }
    expect(picked / trials).toBeGreaterThan(0.95);
  });
  it("baseline win counts as non-exploration", () => {
    // All priors equal → sometimes baseline wins; it must not count as exploration.
    const rng = lcg(99);
    let sawBaseline = false;
    for (let i = 0; i < 100; i++) {
      const r = selectOfferArm(baseInput({ totalPulls: 50, servesToday: 0, rng }));
      if (r.deltaBps === 0) {
        sawBaseline = true;
        expect(r.exploration).toBe(false);
        expect(r.servedUsd).toBe(1000);
      }
    }
    expect(sawBaseline).toBe(true);
  });
});
