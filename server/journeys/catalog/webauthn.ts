/**
 * J35: WebAuthn / passkeys for staff authentication (Phase 25).
 *
 *  seed a dedicated staff user, an admin-tier user, and a TOTP-only user →
 *  staff enrolls a passkey through the REAL registration ceremony (fixture
 *  from server/routers/fixtures/webauthn/, real SimpleWebAuthn verification)
 *  → staff completes an mfa-pending → full-session upgrade with a passkey
 *  assertion (same session-issuance path as verifyLoginTotp) →
 *  TOTP fallback still passes end-to-end (auth.verifyLoginTotp with a live
 *  otplib code) and getMfaRequirement composition holds →
 *  WEBAUTHN_ENFORCEMENT=required admin without a passkey gets "enroll" →
 *  delete-last-factor is rejected under an org MFA mandate, then allowed
 *  once the mandate is lifted.
 *
 * The ceremony challenge store runs on the development-only in-memory
 * fallback (no Redis in the journey sandbox — server/auth/webauthn-challenge.ts
 * documents the fail-closed production path); Postgres is real. Fixture
 * challenges are planted via the non-production test seam
 * replaceChallengeForTests.
 *
 * Template: J34's pattern (dedicated fixtures + real tRPC callers).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Journey } from "../framework";

const fixtures = JSON.parse(readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), "../../routers/fixtures/webauthn/software-authenticator.json"),
  "utf8",
)) as {
  registration: { challenge: string; response: Record<string, unknown> };
  assertion: { challenge: string; response: Record<string, unknown> };
  credential: { credentialId: string };
};

interface J35State {
  staffId: string;
  adminId: string;
  totpUserId: string;
  totpSecret: string;
  credentialRowId: string;
  ceremonyId: string;
  savedEnv: { enabled: boolean; enforcement: string; roles: string[] };
}

export const j35: Journey = {
  id: "J35",
  title: "WebAuthn passkeys: enroll, mfa-pending upgrade, TOTP fallback, required tier, last-factor guard",
  actor: "provider",
  description:
    "Seeds dedicated staff/admin/TOTP users, enrolls a passkey through the real registration ceremony, completes an mfa-pending to full-session upgrade with a real assertion signature, proves the TOTP login fallback still passes end-to-end, proves the required enforcement tier forces enroll for passkey-less admins, and proves the last-factor guard rejects deletion under an org MFA mandate.",
  steps: [
    {
      name: "seed-users-and-enable-feature",
      async run(ctx) {
        const { ENV } = await import("../../_core/env");
        const staffId = ctx.ns("j35-staff");
        const adminId = ctx.ns("j35-admin");
        const totpUserId = ctx.ns("j35-totp");
        const st: J35State = {
          staffId, adminId, totpUserId,
          totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", // known base32 secret, 20 bytes (test fixture)
          credentialRowId: "",
          ceremonyId: "",
          savedEnv: {
            enabled: ENV.webauthnEnabled,
            enforcement: ENV.webauthnEnforcement,
            roles: [...ENV.webauthnRequiredRoles],
          },
        };
        (ctx as unknown as { _st: J35State })._st = st;
        // Feature flags for this journey (restored in the final step).
        ENV.webauthnEnabled = true;
        ENV.webauthnRpId = "localhost";
        ENV.webauthnOrigins = ["http://localhost:3000"];

        await ctx.sql.unsafe(
          `INSERT INTO users (id, name, email, "loginMethod", role)
           VALUES ($1, 'J35 Staff', $2, 'test', 'user'),
                  ($3, 'J35 Admin', $4, 'test', 'admin'),
                  ($5, 'J35 Totp', $6, 'test', 'user')
           ON CONFLICT DO NOTHING`,
          [staffId, `${staffId}@test.local`, adminId, `${adminId}@test.local`, totpUserId, `${totpUserId}@test.local`],
        );
        // TOTP-only user: ACTIVE plaintext secret (legacy plaintext is
        // accepted by verifyLoginCode, server/auth/mfa.ts).
        await ctx.sql.unsafe(
          `INSERT INTO totp_secrets (id, "userId", secret, status)
           VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
          [ctx.ns("j35-totpsecret"), totpUserId, st.totpSecret],
        );
        // Idempotent re-runs: the committed fixture credential ID is globally
        // unique — clear leftovers from prior runs.
        await ctx.sql.unsafe(
          `DELETE FROM webauthn_credentials WHERE credential_id = $1`,
          [Buffer.from(fixtures.credential.credentialId, "base64url")],
        );
        const rows = await ctx.sql.unsafe(`SELECT to_regclass('webauthn_credentials') AS r`);
        ctx.assertEqual((rows[0] as unknown as { r: string }).r, "webauthn_credentials", "migration 0059 table present");
      },
    },
    {
      name: "passkey-enrollment-via-real-ceremony",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J35State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { replaceChallengeForTests } = await import("../../auth/webauthn-challenge");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));

        const opts = await caller.webauthn.registrationOptions({ name: "J35 clinic key" });
        ctx.assertEqual(opts.options.rp.id, "localhost", "RP ID resolved");
        await replaceChallengeForTests(opts.ceremonyId, {
          challenge: fixtures.registration.challenge, userId: st.staffId, mode: "registration",
        });
        const reg = await caller.webauthn.verifyRegistration({
          ceremonyId: opts.ceremonyId,
          name: "J35 clinic key",
          response: fixtures.registration.response,
        });
        ctx.assert(reg.success, "registration verified");
        st.credentialRowId = reg.credentialId;
        const rows = await ctx.sql.unsafe(
          `SELECT user_id, counter, device_type FROM webauthn_credentials WHERE id = $1`, [reg.credentialId]);
        ctx.assertEqual(rows.length, 1, "credential row persisted");
        ctx.assertEqual((rows[0] as unknown as { user_id: string }).user_id, st.staffId, "row owned by staff user");
      },
    },
    {
      name: "mfa-pending-to-full-session-upgrade-with-passkey",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J35State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { replaceChallengeForTests } = await import("../../auth/webauthn-challenge");
        const { getMfaRequirement } = await import("../../auth/mfa");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never, { mfaPending: true }));

        ctx.assertEqual(await getMfaRequirement(st.staffId), "verify", "passkey-only user must verify");
        const opts = await caller.webauthn.authenticationOptions({ ceremony: "mfa" });
        ctx.assertEqual(opts.options.allowCredentials?.length, 1, "allowCredentials lists the passkey");
        await replaceChallengeForTests(opts.ceremonyId, {
          challenge: fixtures.assertion.challenge, userId: st.staffId, mode: "mfa",
        });
        const res = await caller.webauthn.verifyAuthentication({
          ceremonyId: opts.ceremonyId,
          response: fixtures.assertion.response,
        });
        ctx.assert(res.success && res.sessionIssued, "full session issued via the TOTP-identical path");
        st.ceremonyId = opts.ceremonyId; // step-up marker for the delete step
        const rows = await ctx.sql.unsafe(
          `SELECT counter, last_used_at FROM webauthn_credentials WHERE id = $1`, [st.credentialRowId]);
        ctx.assertEqual(Number((rows[0] as unknown as { counter: number }).counter), 1, "counter advanced");
        ctx.assert((rows[0] as unknown as { last_used_at: unknown }).last_used_at, "last_used_at set");
      },
    },
    {
      name: "totp-fallback-still-passes",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J35State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { getMfaRequirement } = await import("../../auth/mfa");
        const { generate: totpGenerate } = await import("otplib");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.totpUserId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never, { mfaPending: true }));
        ctx.assertEqual(await getMfaRequirement(st.totpUserId), "verify", "TOTP user must verify");
        const code = await totpGenerate({ secret: st.totpSecret });
        const res = await caller.auth.verifyLoginTotp({ code });
        ctx.assert(res.success === true, "TOTP upgrade path unchanged (G5 zero regression)");
      },
    },
    {
      name: "required-tier-admin-without-passkey-gets-enroll",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J35State })._st;
        const { ENV } = await import("../../_core/env");
        const { getMfaRequirement } = await import("../../auth/mfa");
        ENV.webauthnEnforcement = "required";
        ENV.webauthnRequiredRoles = ["admin"];
        try {
          ctx.assertEqual(await getMfaRequirement(st.adminId), "enroll", "required-tier admin must enroll");
          ctx.assertEqual(await getMfaRequirement(st.totpUserId), "verify", "TOTP still satisfies the mandate");
        } finally {
          ENV.webauthnEnforcement = st.savedEnv.enforcement;
          ENV.webauthnRequiredRoles = st.savedEnv.roles;
        }
      },
    },
    {
      name: "delete-last-factor-guard-and-cleanup",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J35State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        // Org MFA mandate → the sole passkey cannot be deleted.
        await ctx.sql.unsafe(
          `INSERT INTO org_settings (id, "userId", "requireMFA") VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
          [ctx.ns("j35-orgset"), st.staffId],
        );
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const delCtx = makeCtxForUser(urows[0] as never, {
          req: { headers: { "x-webauthn-stepup": st.ceremonyId } } as never,
        });
        const delCaller = rootRouter.createCaller(delCtx);
        let rejected = false;
        try {
          await delCaller.webauthn.deleteCredential({ credentialId: st.credentialRowId });
        } catch (err) {
          rejected = err instanceof Error && err.message.includes("cannot_remove_last_mfa_method");
        }
        ctx.assert(rejected, "last-factor guard rejected the delete");
        let rows = await ctx.sql.unsafe(`SELECT id FROM webauthn_credentials WHERE id = $1`, [st.credentialRowId]);
        ctx.assertEqual(rows.length, 1, "credential survived the rejected delete");

        // Lift the mandate → delete allowed (fresh step-up marker planted via
        // a second successful ceremony).
        await ctx.sql.unsafe(`DELETE FROM org_settings WHERE "userId" = $1`, [st.staffId]);
        const { storeStepupMarker } = await import("../../auth/webauthn-challenge");
        await storeStepupMarker(st.staffId, st.ceremonyId, 600);
        const del2 = await rootRouter.createCaller(makeCtxForUser(urows[0] as never, {
          req: { headers: { "x-webauthn-stepup": st.ceremonyId } } as never,
        })).webauthn.deleteCredential({ credentialId: st.credentialRowId });
        ctx.assert(del2.success, "delete allowed once the mandate is lifted");
        rows = await ctx.sql.unsafe(`SELECT id FROM webauthn_credentials WHERE id = $1`, [st.credentialRowId]);
        ctx.assertEqual(rows.length, 0, "credential deleted");

        // Restore the feature gate for subsequent runners in this process.
        const { ENV } = await import("../../_core/env");
        ENV.webauthnEnabled = st.savedEnv.enabled;
      },
    },
  ],
};
