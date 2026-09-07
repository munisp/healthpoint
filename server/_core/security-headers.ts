/**
 * server/_core/security-headers.ts
 *
 * Centralized HTTP security headers (helmet). Extracted from index.ts so the
 * policy is testable in isolation.
 *
 * Production CSP is compatible with the Vite PWA client:
 *   - client/index.html loads stylesheets from fonts.googleapis.com and font
 *     files from fonts.gstatic.com (styleSrc/fontSrc entries below).
 *   - The service worker (client/public/sw.js) is same-origin: workerSrc 'self'.
 *   - No inline scripts are used by the production build, so scriptSrc is
 *     'self' only (no 'unsafe-inline'/'unsafe-eval').
 * Development disables CSP entirely because Vite HMR needs eval + websockets.
 */

import helmet from "helmet";
import type { RequestHandler } from "express";

export function securityHeaders(isProduction: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: isProduction
      ? {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https:", "wss:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            workerSrc: ["'self'"],
            manifestSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    // HSTS: one year + subdomains; only meaningful (and only sent) in production.
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    // Belt-and-braces alongside CSP frame-ancestors 'none'.
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    // X-Content-Type-Options: nosniff is helmet's default.
    crossOriginEmbedderPolicy: false, // allow embedding for dashboard iframes
  });
}
