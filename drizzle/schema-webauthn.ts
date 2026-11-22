import { pgTable, varchar, text, timestamp, boolean, bigint, index, uniqueIndex, customType } from "drizzle-orm/pg-core";

/** bytea column (drizzle pg-core has no first-class bytea builder; schema-bulk-upload.ts precedent). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

/**
 * Phase 25: WebAuthn / passkey credentials, one row per registered authenticator.
 * Migration: drizzle/migrations/0059_wave_p25.sql (hand-written, journal idx 59).
 * No org scoping: users.id is globally unique varchar(64) (drizzle/schema.ts)
 * and org membership is per-user settings, not a tenant FK (totp_secrets
 * precedent). Cross-user access is denied at the procedure layer (all queries
 * filter userId = ctx.user.id; admin paths go through audit-logged
 * adminTotp-style modules).
 */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: varchar("id", { length: 64 }).primaryKey(),                  // crypto.randomUUID()
    userId: varchar("user_id", { length: 64 }).notNull(),            // users.id
    credentialId: bytea("credential_id").notNull(),                  // raw credential ID bytes
    publicKey: bytea("public_key").notNull(),                        // COSE public key bytes
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports"),                                  // JSON array string, e.g. ["internal","hybrid"]
    aaguid: varchar("aaguid", { length: 64 }),                       // informational only (attestation: none)
    name: varchar("name", { length: 128 }).notNull().default("Passkey"),
    backedUp: boolean("backed_up").notNull().default(false),         // BE flag at registration
    deviceType: varchar("device_type", { length: 32 }).notNull().default("singleDevice"),
    createdAt: timestamp("created_at").defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    lastCounterAnomalyAt: timestamp("last_counter_anomaly_at"),
    // Wave P26 (O6): NULL = enrollment completed but pending out-of-band
    // email confirmation — the credential is INERT (rejected at
    // authentication, invisible to hasActivePasskey) until confirmed.
    // Migration 0060 backfills pre-existing rows to created_at.
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    uniqueIndex("webauthn_credentials_cred_uniq").on(t.credentialId),
    index("webauthn_credentials_user_idx").on(t.userId),
  ]
);
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type InsertWebauthnCredential = typeof webauthnCredentials.$inferInsert;
