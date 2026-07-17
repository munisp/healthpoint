export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;

/** Session lifetime: 8 hours (used for JWT expiry and cookie maxAge) */
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;

/** Warn the user this many ms before session expiry (5 minutes) */
export const SESSION_WARN_BEFORE_MS = 1000 * 60 * 5;

/** Silent refresh window: attempt refresh when less than this many ms remain (15 minutes) */
export const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 15;
