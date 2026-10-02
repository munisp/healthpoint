# TEST-CONC-001 — Concurrent payment submission cannot overspend or duplicate

**OBJECTIVE:** The earlier ledger idempotency testing (ledger-qpa-financial.md,
DEFECT-005) only exercised *sequential* retries — one request, wait for the
response, send the next. That proves retry-safety but not concurrency-safety:
a genuine race (two requests racing for the same lock before either commits)
is a different failure mode. The skill's own invariants ("concurrent transfers
cannot overspend an account", "idempotency keys remain effective across
retries") are explicit about this distinction. This test fires real,
simultaneous HTTP requests (via shell-backgrounded curl + `wait`, not
sequential awaits) against the live dev server and local Postgres.

**ENVIRONMENT:** Local dev server (`localhost:3000`) + local
`healthpoint-test-postgres` container. No impact on the live cluster — this
never touched production.

## Setup
Two disposable test disputes inserted directly at `STEP_14_PAYMENT_DETERMINATION`
/ `determination_issued` (same fixture shape as the repo's own
`payment-flow.test.ts`), one per sub-test. Both deleted after.

## Sub-test 1 — 10 concurrent requests, 10 distinct idempotency keys, same dispute
Dispute with `determinationAmount: $1000.00`. Fired 10 truly concurrent
`ledger.recordPayment` calls (backgrounded shell jobs + `wait`, not awaited
one-by-one), each requesting the full $1000, each with its own UUID
idempotency key, as the same admin session.

**Result:** exactly 1 of 10 succeeded (`verified: true`, real ledger entry).
The other 9 failed with the correct business error: *"No remaining
determined amount to pay: determination 1000.00 USD is already covered by
recorded payments of 1000.00 USD."*

**Final state verified directly in Postgres:**
- `disputes.paidAmount` = exactly `1000.00` (not more).
- `ledger_accounts`: `paid` = +100000 cents, `determination` = -100000 cents
  (correct double-entry, net zero).
- `ledger_entries` for this dispute/payment: **count = 1**, `sum(amountCents) = 100000`.

No overpayment, no double-spend, under genuine concurrent load.

## Sub-test 2 — 10 concurrent requests, 1 shared idempotency key, same dispute
Second dispute, `determinationAmount: $390.00`. Fired 10 truly concurrent
`ledger.recordPayment` calls, all with the **identical** idempotency key
(simulating a double-click / overlapping client retry, not a sequential one).

**Result:** all 10 HTTP responses returned the exact same `entry.id`
(`c82e1f6e-...`) — the lock correctly serialized the race: the first request
to acquire `pg_advisory_xact_lock(hashtext(disputeId))` created the entry,
and every other request, once it got the lock in turn, found the existing
row under the idempotency-key check and returned it instead of creating a
second one.

**Final state verified directly in Postgres:**
- `disputes.paidAmount` = exactly `390.00`.
- `ledger_entries` for this dispute/payment: **count = 1**, `sum = 39000` cents.

## Why this matters beyond the sequential test
`recordPaymentInTransaction` (server/ledger.ts) acquires
`pg_advisory_xact_lock(hashtext(disputeId))` *before* the idempotency check
and *before* reading the dispute's current `paidAmount` — so concurrent
transactions queue on the lock rather than racing to read stale state. Both
sub-tests are real, live confirmation that this ordering holds under actual
concurrent load, not just sequential retries.

## RESULT: PASS (2/2)
No defects found. Concurrent payment submission is safe against both
overspend (sub-test 1) and duplicate-entry creation under a genuine race on
the same idempotency key (sub-test 2).
