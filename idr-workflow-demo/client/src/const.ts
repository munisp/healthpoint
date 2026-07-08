export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "HealthPoint";

export const APP_LOGO =
  import.meta.env.VITE_APP_LOGO ||
  "https://d2xsxph8kpxj0f.cloudfront.net/114501028/Ko6TiyjsXLeVjoMLkkxz58/healthpoint-logo-KHkgbr4JATo4FJnvK2noam.png";

/**
 * Keycloak OIDC — all auth flows go through the server-side routes.
 * The server handles PKCE, state, and cookie creation.
 */

/** Redirect the browser to the Keycloak sign-in page */
export const getLoginUrl = (redirectTo = "/") =>
  `/api/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`;

/** Redirect the browser to the Keycloak registration page */
export const getRegisterUrl = (role = "", redirectTo = "/") =>
  `/api/auth/register?redirectTo=${encodeURIComponent(redirectTo)}&role=${encodeURIComponent(role)}`;

/** Redirect the browser to Keycloak end-session */
export const getLogoutUrl = () => `/api/auth/logout`;
