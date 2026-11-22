/**
 * J36: First-factor enrollment email confirmation (Wave P26, adversarial
 * finding O6 — forced-enrollment backdoor closure).
 *
 *  seed a factor-less staff user → first passkey enrollment completes the
 *  ceremony but the credential is PENDING (confirmed_at NULL), cannot
 *  authenticate, and does not satisfy getMfaRequirement → the emailed
 *  single-use token confirms it (replay rejected) → assertion now upgrades
 *  an mfa-pending session → first TOTP enrollment (active row, as the
 *  frozen routers.ts path leaves it) cannot verify ANY code until
 *  mfaConfirm.finalizeTotp + email confirmation → subsequent TOTP
 *  enrollment for an already-factored user auto-confirms via finalizeTotp
 *  (alert-email failure tolerated — no RESEND_API_KEY in the sandbox) →
 *  resend burns the previous token.
 *
 * Token capture uses the non-production test seam
 * getLastIssuedTokenForTests (mirrors replaceChallengeForTests; the sandbox
 * has no SMTP server — the email boundary is spy-tested in
 * server/auth/enroll-confirm.test.ts and server/routers/wave-p26.test.ts).
 * Postgres is real; the challenge store runs on the development-only
 * in-memory fallback (J35 precedent).
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

interface J36State {
  staffId: string;
  totpSecret: string;
  credentialRowId: string;
  savedEnabled: boolean;
}

export const j36: Journey = {
  id: "J36",
  title: "O6 first-factor enrollment: email confirmation gates passkey + TOTP activation; resend burns prior token",
  actor: "provider",
  description:
    "Proves the forced-enrollment backdoor is closed: a first passkey/TOTP enrollment stays INERT (cannot authenticate, cannot satisfy getMfaRequirement, cannot verify any code) until the out-of-band emailed token is confirmed; tokens are single-use; resend supersedes; subsequent enrollments for an already-factored user activate immediately with a tolerated alert-email failure.",
  steps: [
    {
      name: "seed-factorless-user-and-enable-feature",
      async run(ctx) {
        const { ENV } = await import("../../_core/env");
        const staffId = ctx.ns("j36-staff");
        const st: J36State = {
          staffId,
          totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
          credentialRowId: "",
          savedEnabled: ENV.webauthnEnabled,
        };
        (ctx as unknown as { _st: J36State })._st = st;
        ENV.webauthnEnabled = true;
        ENV.webauthnRpId = "localhost";
        ENV.webauthnOrigins = ["http://localhost:3000"];
        await ctx.sql.unsafe(
          `INSERT INTO users (id, name, email, "loginMethod", role)
           VALUES ($1, 'J36 Staff', $2, 'test', 'user') ON CONFLICT DO NOTHING`,
          [staffId, `${staffId}@test.local`],
        );
        // Idempotent re-runs: the committed fixture credential ID is unique.
        await ctx.sql.unsafe(
          `DELETE FROM webauthn_credentials WHERE credential_id = $1`,
          [Buffer.from(fixtures.credential.credentialId, "base64url")],
        );
        const rows = await ctx.sql.unsafe(
          `SELECT to_regclass('factor_enrollment_confirmations') AS r,
                  to_regclass('webauthn_credentials') AS w`);
        const r0 = rows[0] as unknown as { r: string; w: string };
        ctx.assertEqual(r0.r, "factor_enrollment_confirmations", "migration 0060 table present");
        ctx.assertEqual(r0.w, "webauthn_credentials", "0059 table still present");
        const col = await ctx.sql.unsafe(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'webauthn_credentials' AND column_name = 'confirmed_at'`);
        ctx.assertEqual(col.length, 1, "migration 0060 confirmed_at column present");
      },
    },
    {
      name: "first-passkey-enrollment-is-pending-and-inert",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J36State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { replaceChallengeForTests } = await import("../../auth/webauthn-challenge");
        const { getMfaRequirement } = await import("../../auth/mfa");
        const { expectTrpcError } = await import("./helpers");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));

        const opts = await caller.webauthn.registrationOptions({ name: "J36 key" });
        await replaceChallengeForTests(opts.ceremonyId, {
          challenge: fixtures.registration.challenge, userId: st.staffId, mode: "registration",
        });
        const reg = await caller.webauthn.verifyRegistration({
          ceremonyId: opts.ceremonyId, name: "J36 key", response: fixtures.registration.response,
        });
        ctx.assert(reg.success, "registration ceremony itself succeeds");
        ctx.assert(reg.requiresConfirmation === true, "first factor requires email confirmation");
        st.credentialRowId = reg.credentialId;

        const rows = await ctx.sql.unsafe(
          `SELECT confirmed_at FROM webauthn_credentials WHERE id = $1`, [reg.credentialId]);
        ctx.assertEqual((rows[0] as unknown as { confirmed_at: unknown }).confirmed_at, null,
          "credential stored PENDING (confirmed_at NULL)");

        // The backdoor, concretely: an mfa-pending attacker session cannot
        // use the freshly enrolled passkey.
        ctx.assertEqual(await getMfaRequirement(st.staffId), "none",
          "pending passkey does not satisfy the MFA requirement");
        const mfaCaller = rootRouter.createCaller(makeCtxForUser(urows[0] as never, { mfaPending: true }));
        const authOpts = await mfaCaller.webauthn.authenticationOptions({ ceremony: "mfa" });
        await replaceChallengeForTests(authOpts.ceremonyId, {
          challenge: fixtures.assertion.challenge, userId: st.staffId, mode: "mfa",
        });
        await expectTrpcError(ctx, mfaCaller.webauthn.verifyAuthentication({
          ceremonyId: authOpts.ceremonyId, response: fixtures.assertion.response,
        }), "UNAUTHORIZED", "pending credential rejected at authentication");
      },
    },
    {
      name: "email-confirmation-activates-passkey-single-use",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J36State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { replaceChallengeForTests } = await import("../../auth/webauthn-challenge");
        const { getMfaRequirement } = await import("../../auth/mfa");
        const { getLastIssuedTokenForTests } = await import("../../auth/enroll-confirm");
        const { expectTrpcError } = await import("./helpers");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));

        const token = getLastIssuedTokenForTests("passkey", st.credentialRowId);
        ctx.assert(!!token, "confirmation token was issued");
        const ok = await caller.mfaConfirm.confirm({ token: token! });
        ctx.assert(ok.success && ok.factorType === "passkey", "token confirms the passkey");
        // Single-use: replay rejected with the uniform error.
        await expectTrpcError(ctx, caller.mfaConfirm.confirm({ token: token! }),
          "BAD_REQUEST", "token replay rejected");
        ctx.assertEqual(await getMfaRequirement(st.staffId), "verify",
          "confirmed passkey now satisfies the MFA requirement");

        const mfaCaller = rootRouter.createCaller(makeCtxForUser(urows[0] as never, { mfaPending: true }));
        const authOpts = await mfaCaller.webauthn.authenticationOptions({ ceremony: "mfa" });
        await replaceChallengeForTests(authOpts.ceremonyId, {
          challenge: fixtures.assertion.challenge, userId: st.staffId, mode: "mfa",
        });
        const res = await mfaCaller.webauthn.verifyAuthentication({
          ceremonyId: authOpts.ceremonyId, response: fixtures.assertion.response,
        });
        ctx.assert(res.success && res.sessionIssued, "confirmed passkey upgrades mfa-pending session");

        const audits = await ctx.sql.unsafe(
          `SELECT action FROM audit_log WHERE "entityId" = $1 ORDER BY "createdAt"`, [st.credentialRowId]);
        const actions = (audits as unknown as Array<{ action: string }>).map(a => a.action);
        ctx.assert(actions.includes("webauthn.register"), "register audited");
        ctx.assert(actions.includes("mfaConfirm.confirmed"), "confirmation audited");
      },
    },
    {
      name: "first-totp-enrollment-cannot-verify-until-confirmed",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J36State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { verifyLoginCode, getMfaRequirement } = await import("../../auth/mfa");
        const { getLastIssuedTokenForTests } = await import("../../auth/enroll-confirm");
        const { generate: totpGenerate } = await import("otplib");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));

        // Staff already has a confirmed passkey, so a TOTP added now is a
        // SUBSEQUENT factor — finalizeTotp auto-confirms it. To exercise the
        // FIRST-factor TOTP path, use a fresh factor-less user.
        const freshId = ctx.ns("j36-fresh");
        await ctx.sql.unsafe(
          `INSERT INTO users (id, name, email, "loginMethod", role)
           VALUES ($1, 'J36 Fresh', $2, 'test', 'user') ON CONFLICT DO NOTHING`,
          [freshId, `${freshId}@test.local`],
        );
        // What the frozen routers.ts totp.setup+verify leaves behind:
        const totpRowId = ctx.ns("j36-totprow");
        await ctx.sql.unsafe(
          `INSERT INTO totp_secrets (id, "userId", secret, status)
           VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
          [totpRowId, freshId, st.totpSecret],
        );
        const goodCode = await totpGenerate({ secret: st.totpSecret });
        ctx.assertEqual(await verifyLoginCode(freshId, goodCode), false,
          "unconfirmed TOTP rejects even a CORRECT code (backdoor closed)");
        ctx.assertEqual(await getMfaRequirement(freshId), "none",
          "unconfirmed TOTP does not satisfy the MFA requirement");

        const frows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [freshId]);
        const freshCaller = rootRouter.createCaller(makeCtxForUser(frows[0] as never, { mfaPending: true }));
        const fin = await freshCaller.mfaConfirm.finalizeTotp();
        ctx.assertEqual(fin.status, "confirmation_required", "first-factor TOTP needs email confirmation");
        ctx.assertEqual(await verifyLoginCode(freshId, goodCode), false,
          "still inert until the emailed token is consumed");
        const token = getLastIssuedTokenForTests("totp", totpRowId);
        ctx.assert(!!token, "TOTP confirmation token issued");
        const ok = await freshCaller.mfaConfirm.confirm({ token: token! });
        ctx.assert(ok.success, "TOTP confirmed via emailed token");
        ctx.assertEqual(await verifyLoginCode(freshId, await totpGenerate({ secret: st.totpSecret })), true,
          "confirmed TOTP verifies");
        ctx.assertEqual(await getMfaRequirement(freshId), "verify", "TOTP now satisfies MFA");
      },
    },
    {
      name: "subsequent-totp-enrollment-auto-confirms-with-tolerated-alert",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J36State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { verifyLoginCode } = await import("../../auth/mfa");
        const { generate: totpGenerate } = await import("otplib");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.staffId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));

        // Staff (confirmed passkey from earlier steps) adds a TOTP — the
        // frozen routers.ts path leaves an ACTIVE, unconfirmed row.
        const totpRowId = ctx.ns("j36-staff-totp");
        await ctx.sql.unsafe(
          `INSERT INTO totp_secrets (id, "userId", secret, status)
           VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
          [totpRowId, st.staffId, st.totpSecret],
        );
        ctx.assertEqual(await verifyLoginCode(st.staffId, await totpGenerate({ secret: st.totpSecret })), false,
          "pre-finalize: subsequent TOTP also inert");
        const fin = await caller.mfaConfirm.finalizeTotp();
        ctx.assertEqual(fin.status, "confirmed",
          "subsequent enrollment auto-confirms (alert email failure tolerated: no RESEND_API_KEY)");
        ctx.assertEqual(await verifyLoginCode(st.staffId, await totpGenerate({ secret: st.totpSecret })), true,
          "TOTP active immediately after finalize");
      },
    },
    {
      name: "resend-supersedes-prior-token-and-cleanup",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J36State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const { getLastIssuedTokenForTests } = await import("../../auth/enroll-confirm");
        const { expectTrpcError } = await import("./helpers");
        const { ENV } = await import("../../_core/env");

        const uid = ctx.ns("j36-resend");
        await ctx.sql.unsafe(
          `INSERT INTO users (id, name, email, "loginMethod", role)
           VALUES ($1, 'J36 Resend', $2, 'test', 'user') ON CONFLICT DO NOTHING`,
          [uid, `${uid}@test.local`],
        );
        const totpRowId = ctx.ns("j36-resend-totp");
        await ctx.sql.unsafe(
          `INSERT INTO totp_secrets (id, "userId", secret, status)
           VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
          [totpRowId, uid, st.totpSecret],
        );
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [uid]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never, { mfaPending: true }));
        await caller.mfaConfirm.finalizeTotp();
        const first = getLastIssuedTokenForTests("totp", totpRowId);
        const r = await caller.mfaConfirm.resend({ factorType: "totp" });
        ctx.assertEqual(r.status, "sent", "resend issues a fresh token");
        const second = getLastIssuedTokenForTests("totp", totpRowId);
        ctx.assert(first && second && first !== second, "resend minted a different token");
        await expectTrpcError(ctx, caller.mfaConfirm.confirm({ token: first! }),
          "BAD_REQUEST", "superseded token rejected");
        const ok = await caller.mfaConfirm.confirm({ token: second! });
        ctx.assert(ok.success, "fresh token confirms");

        ENV.webauthnEnabled = st.savedEnabled;
      },
    },
  ],
};
