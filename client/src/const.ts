export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "HealthPoint";

export const APP_LOGO =
  import.meta.env.VITE_APP_LOGO ||
  "https://d2xsxph8kpxj0f.cloudfront.net/114501028/Ko6TiyjsXLeVjoMLkkxz58/healthpoint-logo-KHkgbr4JATo4FJnvK2noam.png";

/**
 * Keycloak OIDC — all auth flows go through the Express server's Keycloak routes.
 * The server handles PKCE + code exchange and sets a session cookie.
 */

/** Redirect the browser to Keycloak login via the server-side OIDC flow */
export const getLoginUrl = (redirectTo = "/dashboard") =>
  `/api/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`;

/** Redirect the browser to Keycloak registration page via the server-side OIDC flow */
export const getRegisterUrl = (role = "", redirectTo = "/dashboard") => {
  const params = new URLSearchParams({ redirectTo });
  if (role) params.set("role", role);
  return `/api/auth/register?${params.toString()}`;
};

/** Redirect to Keycloak end-session (clears both app cookie and Keycloak SSO session) */
export const getLogoutUrl = () => `/api/auth/logout`;
