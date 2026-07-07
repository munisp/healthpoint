/**
 * HealthPoint Keycloak PKCE Authentication Module
 * Shared across all 14 frontend applications.
 *
 * Usage:
 *   import { initKeycloak, getToken, isAuthenticated, login, logout, getUser } from '../shared/auth/keycloak';
 *
 * In your app entry point (main.jsx):
 *   import { initKeycloak } from '../shared/auth/keycloak';
 *   initKeycloak().then(() => { ReactDOM.createRoot(...).render(<App />) });
 */

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.healthpoint.gov';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'healthpoint';
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'healthpoint-frontend';

const TOKEN_KEY = 'hp_access_token';
const REFRESH_KEY = 'hp_refresh_token';
const USER_KEY = 'hp_user_info';
const CODE_VERIFIER_KEY = 'hp_pkce_verifier';

// ─── PKCE Helpers ────────────────────────────────────────────────────────────

function generateRandomString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return hash;
}

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const hash = await sha256(verifier);
  return base64URLEncode(hash);
}

// ─── Token Storage ────────────────────────────────────────────────────────────

function storeTokens(accessToken, refreshToken) {
  // Use sessionStorage for access token (cleared on tab close)
  // Use localStorage for refresh token (persists across tabs)
  sessionStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

function clearTokens() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  // Consider token expired 30 seconds before actual expiry
  return Date.now() / 1000 > payload.exp - 30;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForToken(code, codeVerifier, redirectUri) {
  const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KEYCLOAK_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return response.json();
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: KEYCLOAK_CLIENT_ID,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data = await response.json();
    storeTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize Keycloak auth. Call this before rendering the React app.
 * Handles the OAuth callback redirect automatically.
 */
export async function initKeycloak() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const storedState = sessionStorage.getItem('hp_oauth_state');

  if (code && state && state === storedState) {
    // We're handling the OAuth callback
    const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
    const redirectUri = window.location.origin + window.location.pathname;

    try {
      const tokens = await exchangeCodeForToken(code, codeVerifier, redirectUri);
      storeTokens(tokens.access_token, tokens.refresh_token);

      // Store user info
      const userInfo = parseJwt(tokens.access_token);
      if (userInfo) {
        localStorage.setItem(USER_KEY, JSON.stringify({
          id: userInfo.sub,
          name: userInfo.name || userInfo.preferred_username,
          email: userInfo.email,
          roles: userInfo.realm_access?.roles || [],
          tenantId: userInfo.tenant_id,
        }));
      }

      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      sessionStorage.removeItem('hp_oauth_state');
      sessionStorage.removeItem(CODE_VERIFIER_KEY);
    } catch (err) {
      console.error('[Auth] Token exchange failed:', err);
      clearTokens();
    }
    return;
  }

  // Check if we have a valid token
  const accessToken = sessionStorage.getItem(TOKEN_KEY);
  if (accessToken && !isTokenExpired(accessToken)) {
    return; // Already authenticated
  }

  // Try to refresh
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return; // Refreshed successfully
  }

  // No valid token — redirect to login
  await login();
}

/**
 * Redirect to Keycloak login page using PKCE flow.
 */
export async function login() {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);
  const redirectUri = window.location.origin + window.location.pathname;

  sessionStorage.setItem(CODE_VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem('hp_oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email roles tenant_id',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;
}

/**
 * Log out the current user.
 */
export async function logout() {
  const idToken = parseJwt(sessionStorage.getItem(TOKEN_KEY) || '')?.jti;
  clearTokens();

  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    post_logout_redirect_uri: window.location.origin,
  });

  window.location.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout?${params}`;
}

/**
 * Get the current access token, refreshing if expired.
 * Returns null if not authenticated.
 */
export async function getToken() {
  let token = sessionStorage.getItem(TOKEN_KEY);

  if (!token || isTokenExpired(token)) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
    token = sessionStorage.getItem(TOKEN_KEY);
  }

  return token;
}

/**
 * Returns true if the user is currently authenticated.
 */
export function isAuthenticated() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  return !!token && !isTokenExpired(token);
}

/**
 * Get the current user's profile from the stored JWT.
 */
export function getUser() {
  const stored = localStorage.getItem(USER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  // Fall back to parsing the current token
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const payload = parseJwt(token);
  if (!payload) return null;

  return {
    id: payload.sub,
    name: payload.name || payload.preferred_username,
    email: payload.email,
    roles: payload.realm_access?.roles || [],
    tenantId: payload.tenant_id,
  };
}

/**
 * Check if the current user has a specific role.
 */
export function hasRole(role) {
  const user = getUser();
  return user?.roles?.includes(role) ?? false;
}

/**
 * Create an authenticated fetch wrapper that automatically attaches Bearer token.
 * Use this instead of raw fetch() for all API calls.
 *
 * Example:
 *   const response = await authFetch('/api/v1/disputes');
 */
export async function authFetch(url, options = {}) {
  const token = await getToken();

  if (!token) {
    // Not authenticated — redirect to login
    await login();
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  // Handle 401 — token may have been revoked server-side
  if (response.status === 401) {
    clearTokens();
    await login();
    return;
  }

  return response;
}

/**
 * React hook for auth state. Use in components.
 *
 * Example:
 *   const { user, loading, authenticated } = useAuth();
 */
export function useAuth() {
  const [state, setState] = React.useState({
    user: null,
    loading: true,
    authenticated: false,
  });

  React.useEffect(() => {
    const user = getUser();
    const authenticated = isAuthenticated();
    setState({ user, loading: false, authenticated });

    // Set up token refresh interval (every 4 minutes)
    const interval = setInterval(async () => {
      if (isAuthenticated()) {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token && isTokenExpired(token)) {
          await refreshAccessToken();
        }
      }
    }, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return state;
}

// Make React available for the hook (imported by consuming apps)
import React from 'react';
