/**
 * drizzle/schema-intelligence.ts
 *
 * Phase 21: intelligence & learning loop.
 *
 * Tables:
 *  - suggestion_events: immutable analytics facts for every AI/learned
 *    suggestion shown to a user (prefill field, quarantine-repair value,
 *    offer recommendation, next-action card). PHI-free by construction:
 *    values are stored ONLY as sha256 hashes; context is a correlation hash
 *    of (orgId, surface, segment keys). This is deliberately NOT the
 *    event_log outbox (see phase-21 design §2.1).
 *  - model_versions: governance record for in-repo statistical models
 *    (offer-strategy-v2). Never purged; every serve carries the active
 *    row's id/version/honestyLabel in the response payload.
 *  - next_action_dismissals: per-user dismissal of next-action cards with
 *    expiry (purged by the retention worker on expires_at).
 *
 * Separate module (not appended to drizzle/schema.ts) to avoid
 * concurrent-edit conflicts, matching the schema-bulk-upload.ts /
 * schema-portal-rpa.ts precedent. Applied by the hand-written migration
 * drizzle/migrations/0056_wave_p21.sql (snake_case column names, matching
 * the newest wave modules).
 */
import crypto from "node:crypto";
import {
  pgTable,
  varchar,
  integer,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const SUGGESTION_EVENT_ACTIONS = ["presented", "accepted", "edited", "rejected", "expired"] as const;
export type SuggestionEventAction = (typeof SUGGESTION_EVENT_ACTIONS)[number];

export const SUGGESTION_SURFACES = [
  "new_dispute_prefill",
  "quarantine_repair",
  "offer_recommendation",
  "next_action",
] as const;
export type SuggestionSurface = (typeof SUGGESTION_SURFACES)[number];

/** One AI/learned proposal shown to a user; grouped by suggestion_id. */
export const suggestionEvents = pgTable(
  "suggestion_events",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Org scope (assertOrgMember-enforced at the router). */
    orgId: varchar("org_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** Groups presented -> terminal events for one suggestion. */
    suggestionId: varchar("suggestion_id", { length: 64 }).notNull(),
    surface: varchar("surface", { length: 48 }).notNull(),
    action: varchar("action", { length: 16 }).notNull(),
    modelName: varchar("model_name", { length: 64 }).notNull(),
    /** FK -> model_versions.id; null for rule-based producers. */
    modelVersionId: varchar("model_version_id", { length: 64 }),
    /** 0..1 when the producer reports one. */
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    /** sha256 of sorted (orgId, surface, segment keys) — correlation only, never raw PHI. */
    contextHash: varchar("context_hash", { length: 64 }),
    /** Per-field granularity for prefill/quarantine surfaces. */
    fieldName: varchar("field_name", { length: 64 }),
    /** sha256 of the suggested value; never the value itself. */
    suggestedValueHash: varchar("suggested_value_hash", { length: 64 }),
    /** Set on accepted/edited; equal to suggested_value_hash => accepted-as-is. */
    finalValueHash: varchar("final_value_hash", { length: 64 }),
    /** Client-measured edits between presented and terminal events. */
    keystrokeCount: integer("keystroke_count"),
    /** presented -> terminal dwell (ms). */
    latencyMs: integer("latency_ms"),
    /** Small, PHI-free extras (segment keys, threshold ids) — server-side denylist enforced on record. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("suggestion_events_org_surface_idx").on(t.orgId, t.surface, t.createdAt),
    index("suggestion_events_suggestion_idx").on(t.suggestionId),
    index("suggestion_events_model_idx").on(t.modelName, t.modelVersionId),
  ],
);

export const MODEL_VERSION_STATUSES = ["training", "active", "retired", "insufficient_data"] as const;
export type ModelVersionStatus = (typeof MODEL_VERSION_STATUSES)[number];

export const suggestionEventsTerminalUniq = "suggestion_events_terminal_uniq";

export const modelVersions = pgTable(
  "model_versions",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    modelName: varchar("model_name", { length: 64 }).notNull(),
    version: integer("version").notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    /** "real_determinations" | "synthetic" | "none". */
    trainedOn: varchar("trained_on", { length: 32 }).notNull(),
    trainingSampleSize: integer("training_sample_size").notNull().default(0),
    segmentCount: integer("segment_count").notNull().default(0),
    /** "statistical_estimate" | "insufficient_data". */
    honestyLabel: varchar("honesty_label", { length: 32 }).notNull(),
    /** Segment stats payload (aggregates only; segments with n < 5 suppressed). */
    parameters: jsonb("parameters").notNull(),
    trainedAt: timestamp("trained_at"),
    activatedAt: timestamp("activated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("model_versions_name_version_idx").on(t.modelName, t.version),
    index("model_versions_name_status_idx").on(t.modelName, t.status),
  ],
);

export const nextActionDismissals = pgTable(
  "next_action_dismissals",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: varchar("org_id", { length: 64 }),
    userId: varchar("user_id", { length: 64 }).notNull(),
    actionKey: varchar("action_key", { length: 191 }).notNull(),
    /** timestamptz: compared against JS Date at query time (dismissal expiry). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("next_action_dismissals_user_key_idx").on(t.userId, t.actionKey),
  ],
);

export type SuggestionEvent = typeof suggestionEvents.$inferSelect;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type NextActionDismissal = typeof nextActionDismissals.$inferSelect;
