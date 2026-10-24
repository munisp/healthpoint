/**
 * server/idr/segment-keys.ts
 *
 * Phase 22: canonical segment-key strings shared by the bandit (S1) and the
 * outcome model (S4). The key identifies the v2 hierarchy tier actually used
 * for a dispute; it is the join dimension for bandit_arm_stats and the
 * calibration log. Key parts are existing `disputes` columns (idre entity id,
 * service type, 2-letter patient state) — aggregates-class data, no PHI.
 */

import type { SegmentStatsV2 } from "./offer-strategy-v2";

export type SegmentTier = NonNullable<SegmentStatsV2["tier"]>;

export interface SegmentKeyFields {
  idrEntityId: string | null;
  serviceType: string | null;
  patientState: string | null;
}

/** Canonical key string, e.g. `service=emergency_medicine|state=TX`. */
export function canonicalSegmentKey(tier: SegmentTier, f: SegmentKeyFields): string {
  const svc = `service=${f.serviceType ?? "unknown"}`;
  const st = `state=${f.patientState ?? "unknown"}`;
  const idre = `idre=${f.idrEntityId ?? "none"}`;
  switch (tier) {
    case "idr_entity_x_service_x_patientstate":
      return `${idre}|${svc}|${st}`;
    case "idr_entity_x_service":
      return `${idre}|${svc}`;
    case "service_x_patientstate":
      return `${svc}|${st}`;
    case "service":
      return svc;
    case "platform":
      return "platform";
  }
}
