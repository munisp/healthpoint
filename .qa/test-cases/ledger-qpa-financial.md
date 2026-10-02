# TEST-FIN-001 — QPA calculation & ledger idempotency

**OBJECTIVE:** Verify the core financial logic (QPA benchmark estimate,
double-entry ledger, payment idempotency) actually works, not just that
the endpoints exist.
**ENVIRONMENT:** Same as TEST-AUTHZ-001 — real server, real Postgres,
real sessions, no mocks.

## QPA calculation (`qpa.validate`) — RESULT: PASS
Tested two distinct CPT codes / states, confirmed differentiated,
non-stubbed output:
| billedAmount | CPT | state | qpaEstimate | stateAdjustmentFactor | severity |
|---|---|---|---|---|---|
| $1500 | 99284 (ED high complexity) | CA | $310 (median $248) | 1.25 | extreme (484% of QPA) |
| $300 | 99285 (ED highest complexity) | TX | $390 (median $398) | 0.98 | ok (within range) |

Different CPT → different median; different state → different
adjustment factor. Confirms this is a real benchmark table, not a
hardcoded return value. **UNVERIFIED (out of QA scope):** whether the
underlying static benchmark table is accurate/current against real CMS
data — that's a domain/compliance question, not something testable from
code. The response is clearly labeled `qpaEstimate` and carries a
regulatory caveat, so it isn't presented as authoritative, which is the
right posture for an estimate tool either way.

## Double-entry ledger (`ledger.balances`) — RESULT: PASS
Creating a dispute with `billedAmount: $1500` immediately seeded a real
double-entry pair: `billed: +$1500` / `adjustment: -$1500` (net zero).
All other accounts (`allowed`, `paid`, `determination`,
`patient_responsibility`, `overpayment_credit`) correctly start at $0.

## Payment idempotency (`ledger.recordPayment`) — RESULT: PASS
Submitted the identical `idempotencyKey` twice as the non-admin owner
(`test-provider`, no settlement evidence linked → unverified-report path):
- Attempt 1: new report created, `duplicate: false`.
- Attempt 2 (same key): **same `reportId` returned**, `duplicate: true`.
- Ledger balance confirmed unchanged after both attempts (`paid` stayed
  $0 both times) — exactly correct, since an unverified report must not
  move money regardless of duplication.

## Admin/verified payment path — BLOCKED BY A REAL STATE GUARD (not a defect)
Attempted the same idempotency test as the promoted admin
(`platform-admin`). Both attempts were rejected with: *"Payment evidence
can only be posted after the payment-determination stage"* — a real,
working state-machine guard (the test dispute is still in its initial
post-creation state, nowhere near the determination step). This is
correct fail-closed behavior, not a bug.

**NOT YET TESTED (follow-up, non-trivial):** idempotency and ledger
correctness on the REAL money-moving path (admin/settlement-linked
payment after determination) requires walking a dispute through its
full IDR lifecycle first — open negotiation → IDR initiation →
`idrEntityId` assignment → `submitOffer` (both parties) → determination
via `disputes.advanceStep`. That's a materially bigger, multi-step setup
than this test, and is the natural next piece of work rather than
something to rush through.
