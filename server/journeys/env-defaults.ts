/**
 * server/journeys/env-defaults.ts
 *
 * Env defaults required before server modules (server/_core/env et al.) are
 * evaluated. Mirrors scripts/journeys-env.mts — that script stays the entry
 * point for the direct runner; THIS module is imported first by the Temporal
 * worker/activities so the same journeys execute under either driver. Real
 * env always wins (??= only).
 */
process.env.JWT_SECRET ??= "journey-runner-local-secret";
process.env.EMR_CREDENTIALS_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// CPI factor table so the QPA engine is computable in the sandbox (without it
// the engine correctly fails closed with computable:false, which J06 also
// covers in step 1).
process.env.QPA_CPI_FACTORS_JSON ??=
  JSON.stringify({ baseYear: 2019, factors: { 2025: 1.19, 2026: 1.23 } });
export {};
