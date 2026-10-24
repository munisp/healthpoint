/**
 * server/auth/register-redirect.ts
 *
 * Phase13-FC (G13): strip the tamperable `role` param from a
 * post-registration redirect target. Registration never propagates a
 * client-supplied role — new accounts are provisioned at the lowest
 * privilege (users.role="user", no stakeholder role); privileged roles are
 * assigned only by admin grants (admin.updateUserRole) or invite-accept
 * flows (orgs.acceptInvite / payer invite activation).
 *
 * Kept in a standalone module so the rule is unit-testable without pulling
 * the Keycloak/openid-client dependency graph into tests.
 */
export function sanitizeRegisterRedirect(redirectTo: string): string {
  try {
    const url = new URL(redirectTo || "/", "http://localhost");
    url.searchParams.delete("role");
    const out = url.pathname + (url.search === "?" ? "" : url.search);
    return out || "/";
  } catch {
    return "/";
  }
}
