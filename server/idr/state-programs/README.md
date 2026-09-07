# State IDR Program Registry (`server/idr/state-programs/`)

Strategic expansion #1 for the HealthPoint NSA/IDR platform: multi-jurisdiction
support for state surprise-billing / Independent Dispute Resolution (IDR)
programs alongside the federal No Surprises Act (NSA) process.

## Honesty section — read first

### What ships now
- **`types.ts`** — the schema for a state program registry entry and for
  jurisdiction resolution inputs/outputs.
- **`registry.ts`** — a runtime registry with `registerStateProgram(entry)`.
  It **rejects** any entry claiming `verificationStatus: 'VERIFIED'` unless
  every citation field is non-empty (all deadline citations plus a non-null
  `authorityUrl`). It ships with **zero hardcoded per-state factual entries** —
  deliberate honesty, not an omission.
- **`resolver.ts`** — `resolveJurisdiction(input)`, a fail-closed decision
  tree that routes a dispute to `FEDERAL`, `STATE`, or `BIFURCATED_SPLIT`
  using only registered entries and the verified federal floor.
- **Federal floor logic** — NSA / 45 CFR 149 applies to self-funded plans
  everywhere, and to fully-insured coverage where no specified state law
  applies.

### Verified facts used (and only these)
From the Peterson-KFF Health System Tracker explainer (as of 2024-07) and the
federal NSA framework:
- A state process applies for fully-insured plans in **22 states** that have
  some surprise-billing protections.
- In **21 of those 22**, state law covers only a **portion** of federal
  protections ("bifurcated process": federal IDR applies where the bill is not
  covered under state law).
- **Some** states permit self-funded employer plans to opt into the state
  process.

Federal rules continue to evolve (CMS-9897-F context):
- $15 administrative fee for disputes initiated on/after **2026-06-11**.
- 50-item batching cap for open negotiation periods beginning on/after
  **2026-11-01**.

### What is BLOCKED
- **Per-state legal research.** No per-state statutes, citations, deadlines,
  arbitration styles, or scope determinations are included, because none are
  verified in our source set. Nothing in this module fabricates state law.
- **22-state data population.** Populating the registry with verified per-state
  entries is a dedicated research task. Until then, entries (if any) are marked
  `UNVERIFIED`, and the resolver warns and/or fails closed to the federal floor.

### How the effective-dated entry model supports future rule changes
Each entry carries `effectiveDates: Array<{ rule, effectiveDate }>`. Rule
changes (e.g. fee updates, batching caps, scope amendments) are appended as new
effective-dated records rather than overwritten, so:
- historical disputes resolve against the rules in force on the date of
  service, and
- re-registration of a state with an updated entry is a drop-in replacement
  (`registerStateProgram` replaces by `stateCode`), keeping the schema stable
  as both state laws and federal rules (e.g. the 2026 CMS-9897-F changes)
  evolve.

## Resolver decision tree
1. `SELF_FUNDED` → `FEDERAL`, unless a registered state program has
   `selfFundedOptIn === true` **and** the caller passes `optedIn: true` → `STATE`.
2. `FULLY_INSURED`, no registered program → `FEDERAL` (with a warning that
   absence of an entry is not proof no state law applies).
3. `FULLY_INSURED` + registered `PARTIAL` program → `BIFURCATED_SPLIT` (state
   for in-scope items; federal for out-of-scope items).
4. `FULLY_INSURED` + registered `FULL` program → `STATE`.
5. `scopeVsFederal: 'UNKNOWN'` → fails closed to `FEDERAL` with a warning.
6. Unknown `planType`, malformed `stateCode` / `dateOfService`, or unknown
   `serviceCategory` → throws `JurisdictionInputError`.

Every result carries `{ regime, stateProgramId?, rationale, verificationStatus, warnings }`.
