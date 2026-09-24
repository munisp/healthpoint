/**
 * server/temporal/journeys.shared.ts
 *
 * PURE types/constants shared by workflow code, activity code, the worker,
 * and the CLI. Workflow bundles may only import side-effect-free modules —
 * this file must NEVER import server/db, routers, or Node I/O.
 */
import type { JourneyActor, StepReport } from "../journeys/framework";

/** Task queue the journeys worker polls (distinct from `healthpoint-idr`). */
export const JOURNEYS_TASK_QUEUE = "healthpoint-journeys";

/**
 * Default journey execution order — mirrors ALL_JOURNEYS in
 * server/journeys/catalog (kept as data here so workflows stay deterministic
 * and free of server-side imports).
 */
export const DEFAULT_JOURNEY_IDS = [
  "J01", "J02", "J03", "J04", "J05", "J06", "J07", "J08", "J09", "J10",
  "J11", "J12", "J13", "J14", "J15", "J16", "J17", "J18", "J19", "J20",
] as const;

export interface JourneyOrchestratorInput {
  /**Subset/order of journeys; defaults to DEFAULT_JOURNEY_IDS. */
  journeyIds?: string[];
  /** Fixture scale hint for seedBaselineActivity (currently only 'small'). */
  scale?: "small";
  /** Unique run namespace; every entity the journeys create derives from it. */
  runId: string;
  /** Wipe prior journey-run data before executing. */
  clean?: boolean;
}

export interface SingleJourneyInput {
  journeyId: string;
  runId: string;
}

export interface JourneyRunResult {
  journeyId: string;
  title: string;
  actor: JourneyActor;
  status: "PASS" | "FAIL";
  durationMs: number;
  asserts: number;
  steps: StepReport[];
}

export interface JourneyOrchestratorSummary {
  runId: string;
  results: JourneyRunResult[];
  allPassed: boolean;
}
