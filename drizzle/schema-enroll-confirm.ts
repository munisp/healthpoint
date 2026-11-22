/**
 * drizzle/schema-enroll-confirm.ts
 *
 * Wave P26 (adversarial finding O6): out-of-band email confirmation for
 * FIRST-factor enrollment + alert notification for subsequent enrollments.
 *
 * One row per issued confirmation token. The same table is BOTH the token
 * store (single-use, hashed at rest, TTL-bound) and — for TOTP — the
 * confirmation-state companion table, because totp_secrets lives in the
 * frozen server/routers.ts-managed drizzle/schema.ts and cannot gain a
 * column. Passkeys store their confirmation state directly on
 * webauthn_credentials.confirmed_at (added in migration 0060); their rows
 * here are token records only.
 *
 * factor_fingerprint (TOTP only): md5 hex of the totp_secrets.secret
 * envelope at issuance time. totp.setup REPLACES the secret envelope
 * (server/routers.ts:5583), so a re-setup — e.g. an attacker with an
 * mfa-pending session overwriting the victim's TOTP — changes the
 * fingerprint and invalidates every prior confirmation. md5 is deliberate:
 * the fingerprint is a change-detector over an AES-256-GCM envelope, not
 * credential hashing, and md5() is available in core PostgreSQL (no
 * pgcrypto dependency) so migration 0060 can backfill grandfathered rows
 * with matching fingerprints.
 *
 * No DB-level FK, matching totp_secrets / webauthn_credentials precedent.
 */
import { pgTable, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const factorEnrollmentConfirmations = pgTable(
  "factor_enrollment_confirmations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** 'totp' | 'passkey' */
    factorType: varchar("factor_type", { length: 16 }).notNull(),
    /** totp_secrets.id or webauthn_credentials.id */
    factorId: varchar("factor_id", { length: 64 }).notNull(),
    /** TOTP: md5(secret envelope) at issuance; NULL for passkeys. */
    factorFingerprint: varchar("factor_fingerprint", { length: 64 }),
    /** sha256 hex of the raw confirm token; raw token is only ever emailed. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** Device / AAGUID label disclosed in the email. */
    label: varchar("label", { length: 128 }),
    requestIp: varchar("request_ip", { length: 64 }),
    requestUserAgent: varchar("request_user_agent", { length: 256 }),
    createdAt: timestamp("created_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    uniqueIndex("factor_enroll_confirm_token_uniq").on(t.tokenHash),
    index("factor_enroll_confirm_user_idx").on(t.userId),
    index("factor_enroll_confirm_factor_idx").on(t.factorType, t.factorId),
  ]
);
export type FactorEnrollmentConfirmation = typeof factorEnrollmentConfirmations.$inferSelect;
export type InsertFactorEnrollmentConfirmation = typeof factorEnrollmentConfirmations.$inferInsert;
