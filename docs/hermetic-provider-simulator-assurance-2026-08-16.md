# Hermetic Provider Simulator Assurance

## Purpose and Boundary

The hermetic provider simulator is a test fixture for HealthPoint's **inbound** settlement protocol. It does not listen on a network port, invoke a payment rail, release funds, or represent a provider/FSP. It can only run in test or development contexts when `PAYMENT_EXECUTION_MODE=disabled`; production and non-disabled modes are rejected.

## Verified Coverage

The simulator emits raw JSON callback and report envelopes signed with the same HMAC contract used by HealthPoint's settlement ingress. The PostgreSQL-backed end-to-end suite verified a simulator-issued failed callback is accepted exactly once without a ledger payment entry, and a simulator-issued report amount mismatch produces an immutable reconciliation exception without changing the submitted transfer. Existing end-to-end scenarios also verify signed settlement reconciliation, duplicate idempotency, malformed/stale signature rejection, reversal entries, and idempotent balance-proof generation.

## Non-Equivalence Statement

> Simulator execution is **not provider/FSP acceptance evidence**. It does not prove mTLS interoperability with a regulated counterparty, regulatory authorization, report-feed fidelity, funds availability, or transfer settlement. Real-money execution remains disabled until those independent acceptance conditions are evidenced.
