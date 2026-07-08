export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "HealthPoint";

export const APP_LOGO =
  import.meta.env.VITE_APP_LOGO ||
  "https://placehold.co/128x128/0ea5e9/ffffff?text=HP";

/**
 * Keycloak OIDC — all auth flows go through the server-side routes.
 * The server handles PKCE, state, and cookie creation.
 */

/** Redirect the browser to the Keycloak sign-in page */
export const getLoginUrl = (redirectTo = "/") =>
  `/api/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`;

/** Redirect the browser to the Keycloak registration page */
export const getRegisterUrl = (redirectTo = "/", role = "") =>
  `/api/auth/register?redirectTo=${encodeURIComponent(redirectTo)}&role=${encodeURIComponent(role)}`;

/** Redirect the browser to Keycloak end-session */
export const getLogoutUrl = () => `/api/auth/logout`;
