/**
 * drizzle/schema-personas.ts
 *
 * Missing-stakeholder-persona tables (v1): payer accounts + case links,
 * patient access tokens, IDRE assignments, and a minimal org/membership
 * model. Defined in a separate module (not appended to drizzle/schema.ts)
 * to avoid concurrent-edit conflicts on the shared schema file, matching
 * the schema-idr-compliance.ts pattern. Applied by the hand-written
 * migration drizzle/migrations/0035_personas.sql.
 *
 * v1 limitations (documented):
 *  - Payer accounts are platform-user-based: a payer user is resolved to a
 *    payer account via matching contactEmail = user.email (no external SSO).
 *  - Patient access is link/token-based only (no patient login).
 *  - Org dispute scoping is membership-derived (disputes created by org
 *    members), not a first-class org foreign key on disputes.
 */

import {
  pgTable,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Payer accounts ──────────────────────────────────────────────────────────
export const payerAccounts = pgTable(
  "payer_accounts",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    payerName: varchar("payerName", { length: 255 }).notNull(),
    contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
    orgRef: varchar("orgRef", { length: 64 }),
    apiKeyHash: varchar("apiKeyHash", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("payer_accounts_email_idx").on(t.contactEmail),
    // Phase13-FA (G7): one payer account per contact email — prevents silent
    // mis-binding via accounts[0] email resolution. Applied by 0044_wave_fa.sql.
    uniqueIndex("payer_accounts_contact_email_uidx").on(t.contactEmail),
    index("payer_accounts_name_idx").on(t.payerName),
  ]
);
export type PayerAccount = typeof payerAccounts.$inferSelect;

// ─── Payer ↔ dispute case links ──────────────────────────────────────────────
export const PAYER_CASE_LINK_STATUS = ["invited", "active", "revoked"] as const;
export type PayerCaseLinkStatus = (typeof PAYER_CASE_LINK_STATUS)[number];

export const payerCaseLinks = pgTable(
  "payer_case_links",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    payerAccountId: varchar("payerAccountId", { length: 64 }).notNull(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    role: varchar("role", { length: 32 }).notNull().default("responding_party"),
    invitedByUserId: varchar("invitedByUserId", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("invited"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("payer_case_links_account_dispute_idx").on(t.payerAccountId, t.disputeId),
    index("payer_case_links_dispute_idx").on(t.disputeId),
    index("payer_case_links_account_idx").on(t.payerAccountId),
  ]
);
export type PayerCaseLink = typeof payerCaseLinks.$inferSelect;

// ─── Patient access tokens (public link access) ──────────────────────────────
export const PATIENT_TOKEN_SCOPE = ["view", "ppdr_intake"] as const;
export type PatientTokenScope = (typeof PATIENT_TOKEN_SCOPE)[number];

export const patientAccessTokens = pgTable(
  "patient_access_tokens",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** sha256 hex of the bearer token; the raw token is never stored. */
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    disputeId: varchar("disputeId", { length: 64 }),
    patientName: varchar("patientName", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 32 }),
    scope: varchar("scope", { length: 32 }).notNull().default("view"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdByUserId: varchar("createdByUserId", { length: 64 }).notNull(),
    usedAt: timestamp("usedAt"),
    /** Phase13-FA (G4): explicit revocation, checked alongside expiry on access. */
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("patient_access_tokens_hash_idx").on(t.tokenHash),
    index("patient_access_tokens_dispute_idx").on(t.disputeId),
  ]
);
export type PatientAccessToken = typeof patientAccessTokens.$inferSelect;

// ─── IDRE assignments / arbitrator workbench ─────────────────────────────────
export const IDRE_ASSIGNMENT_STATUS = ["proposed", "accepted", "declined"] as const;
export type IdreAssignmentStatus = (typeof IDRE_ASSIGNMENT_STATUS)[number];

export interface CoiAttestation {
  noFinancialInterest: boolean;
  noPriorEngagement: boolean;
  noPartyAffiliation: boolean;
  attestedBy: string;
}

export const idreAssignments = pgTable(
  "idre_assignments",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    idrEntityId: varchar("idrEntityId", { length: 64 }).notNull(),
    arbitratorUserId: varchar("arbitratorUserId", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("proposed"),
    coiAttestation: jsonb("coiAttestation").$type<CoiAttestation>(),
    assignedAt: timestamp("assignedAt").defaultNow().notNull(),
    decidedAt: timestamp("decidedAt"),
  },
  (t) => [
    index("idre_assignments_dispute_idx").on(t.disputeId),
    index("idre_assignments_entity_idx").on(t.idrEntityId),
    index("idre_assignments_arbitrator_idx").on(t.arbitratorUserId),
    index("idre_assignments_status_idx").on(t.status),
  ]
);
export type IdreAssignment = typeof idreAssignments.$inferSelect;

// ─── Organizations + memberships (v1 minimal) ────────────────────────────────
export const ORG_TYPE = ["provider", "biller", "payer", "idre"] as const;
export type OrgType = (typeof ORG_TYPE)[number];

export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    /**
     * Phase13-FC (G8): org suspension. 'active' | 'suspended'. Org-scoped
     * mutations are blocked for members of suspended orgs (see
     * assertOrgNotSuspended in server/routers/personas.ts). Reads remain
     * allowed so members can see why their org is suspended.
     */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    suspendedAt: timestamp("suspendedAt"),
    suspendedByUserId: varchar("suspendedByUserId", { length: 64 }),
    suspensionReason: text("suspensionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("organizations_type_idx").on(t.type)]
);
export type Organization = typeof organizations.$inferSelect;

export const ORG_ROLE = ["owner", "staff", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLE)[number];

export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: varchar("orgId", { length: 64 }).notNull(),
    userId: varchar("userId", { length: 64 }).notNull(),
    role: varchar("role", { length: 32 }).notNull().default("staff"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("org_memberships_org_user_idx").on(t.orgId, t.userId),
    index("org_memberships_user_idx").on(t.userId),
  ]
);
export type OrgMembership = typeof orgMemberships.$inferSelect;

// ─── Invite tokens (Phase13-FA, G1) ──────────────────────────────────────────
// Email-delivered invitations for payer contacts and org members. The raw
// token is emailed once; only its sha256 hash is persisted (same pattern as
// patient_access_tokens). Acceptance binds the accepting platform user to the
// org/role (org_member) or activates payer case links (payer_invite).
export const INVITE_TOKEN_PURPOSE = ["payer_invite", "org_member"] as const;
export type InviteTokenPurpose = (typeof INVITE_TOKEN_PURPOSE)[number];

export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** sha256 hex of the bearer invite token; the raw token is never stored. */
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    orgId: varchar("orgId", { length: 64 }),
    orgRole: varchar("orgRole", { length: 32 }),
    payerAccountId: varchar("payerAccountId", { length: 64 }),
    disputeId: varchar("disputeId", { length: 64 }),
    invitedByUserId: varchar("invitedByUserId", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    acceptedByUserId: varchar("acceptedByUserId", { length: 64 }),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invite_tokens_hash_idx").on(t.tokenHash),
    index("invite_tokens_email_idx").on(t.email),
  ]
);
export type InviteToken = typeof inviteTokens.$inferSelect;
