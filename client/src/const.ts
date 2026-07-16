export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "HealthPoint";

export const APP_LOGO =
  import.meta.env.VITE_APP_LOGO ||
  "https://d2xsxph8kpxj0f.cloudfront.net/114501028/Ko6TiyjsXLeVjoMLkkxz58/healthpoint-logo-KHkgbr4JATo4FJnvK2noam.png";

/**
 * Manus OAuth — all auth flows go through the Manus OAuth portal.
 * The server handles the callback at /api/oauth/callback.
 */

const OAUTH_PORTAL_URL = import.meta.env.VITE_OAUTH_PORTAL_URL || "https://manus.im";
const APP_ID = import.meta.env.VITE_APP_ID || "";

/** Redirect the browser to the Manus OAuth sign-in page */
export const getLoginUrl = (redirectTo = "/dashboard") =>
  `${OAUTH_PORTAL_URL}/login?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(window.location.origin + "/api/oauth/callback?redirectTo=" + encodeURIComponent(redirectTo))}`;

/** Redirect the browser to the Manus OAuth sign-in page (registration uses same flow) */
export const getRegisterUrl = (_role = "", redirectTo = "/dashboard") =>
  getLoginUrl(redirectTo);

/** Clear local session cookie and redirect to home */
export const getLogoutUrl = () => `/`;
