/**
 * Environment defaults for the journey runner. Imported FIRST by
 * run-journeys.mts so values exist before server/_core/env is evaluated.
 * Only fills in values that are absent — real env always wins.
 */
process.env.JWT_SECRET ??= "journey-runner-local-secret";
process.env.EMR_CREDENTIALS_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// CPI factor table so the QPA engine is computable in the sandbox (without it
// the engine correctly fails closed with computable:false, which J06 also
// covers in step 1).
process.env.QPA_CPI_FACTORS_JSON ??=
  // NOTE: the base-year factor (2019: 1) is required by resolveCpiFactor —
  // without it every QPA compute fails closed with CPI_FACTOR_UNAVAILABLE.
  JSON.stringify({ baseYear: 2019, factors: { 2019: 1, 2025: 1.19, 2026: 1.23 } });
export {};
