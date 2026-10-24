/**
 * server/idr/ranking.ts
 *
 * Phase 22 (S2 + S3): honest learning-to-rank. Pure module, no DB.
 *
 * One mechanism serves both rankers: a Beta(1,1)-smoothed act rate per item,
 * with a hard impressions floor (RANKING_MIN_IMPRESSIONS, default 10). Below
 * the floor the item is ineligible and the P21 static ordering stands —
 * cold-start output is byte-identical to Phase 21 (design §5.2, §5.4).
 *
 * Learning NEVER crosses severity groups: a deadline card can never be
 * ranked down by preference. Copy says "learned from your team's past
 * actions" — no deep learning, no gradient anything (design §5).
 */

export const DEFAULT_RANKING_MIN_IMPRESSIONS = 10;

export function rankingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_ACTION_RANKING_ENABLED !== "false";
}

export function rankingMinImpressions(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RANKING_MIN_IMPRESSIONS);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_RANKING_MIN_IMPRESSIONS;
}

/** Beta(1,1)-smoothed act rate: (acts + 1) / (acts + negatives + 2). */
export function smoothedActRate(acts: number, negatives: number): number {
  return (acts + 1) / (acts + negatives + 2);
}

/** An item's learned score may move it only above the impressions floor. */
export function rankingEligible(presented: number, minImpressions: number): boolean {
  return presented >= minImpressions;
}

/**
 * Bounded confidence blend for S3 (design §5.4): acceptance telemetry can
 * move confidence by at most half the distance, never to 0 or 1.
 */
export function blendConfidence(baseConfidence: number, actRate: number): number {
  const blended = 0.5 * baseConfidence + 0.5 * actRate;
  return Math.round(Math.min(0.99, Math.max(0.01, blended)) * 1000) / 1000;
}

/**
 * Severity-group-local reorder (design §5.4). The set of positions occupied
 * by each severity group is preserved exactly; within a group, ELIGIBLE
 * items (scoreOf !== null) are sorted by score descending into the positions
 * they already occupied (ties keep static order); ineligible items stay at
 * their exact static positions. When zero items are eligible the output is
 * byte-identical to the input order.
 */
export function reorderWithinSeverity<T>(
  items: T[],
  severityOf: (item: T) => string,
  scoreOf: (item: T) => number | null,
): { items: T[]; learnedItems: number } {
  const result = [...items];
  const positionsBySeverity = new Map<string, number[]>();
  items.forEach((item, i) => {
    const sev = severityOf(item);
    const arr = positionsBySeverity.get(sev) ?? [];
    arr.push(i);
    positionsBySeverity.set(sev, arr);
  });
  let learnedItems = 0;
  for (const positions of positionsBySeverity.values()) {
    const eligiblePos = positions.filter(p => scoreOf(items[p]) !== null);
    learnedItems += eligiblePos.length;
    if (eligiblePos.length < 2) continue;
    const sorted = [...eligiblePos].sort((a, b) => {
      const d = scoreOf(items[b])! - scoreOf(items[a])!;
      return d !== 0 ? d : a - b; // stable: ties keep static order
    });
    sorted.forEach((srcPos, k) => {
      result[eligiblePos[k]] = items[srcPos];
    });
  }
  return { items: result, learnedItems };
}
