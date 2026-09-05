# Integration test harness (PostgreSQL-backed)

This harness exercises the money path end-to-end against a real PostgreSQL:

```
dispute (STEP_14, determination set)
  → recordPayment()            # double-entry ledger write + outbox insert (server/ledger.ts)
  → dispatchOutboxBatch()      # outbox claim → deliver → delivered (server/outbox.ts)
```

It is the artifact CI and the repo owner run to verify ledger/outbox behavior
that unit tests intentionally fake at the `getDb()` boundary.

## Contents

| File | Purpose |
| --- | --- |
| `docker-compose.test.yml` | Isolated throwaway Postgres 16 + Redis 7 on non-standard ports (54329 / 56379) so it never collides with a developer's dev stack. Data lives on tmpfs/anonymous volumes; `down -v` wipes everything. |
| `payment-flow.test.ts`  | Gated behind `RUN_INTEGRATION=1` (skipped by default, so `pnpm test` stays hermetic). Applies `drizzle/migrations/**` (in `meta/_journal.json` order) itself, then runs the payment → ledger → outbox flow with real SQL assertions, including idempotency replay, overpayment rejection, outbox delivery, and the dead-letter (retry-cap) guarantee. |

## Run it

```bash
# from the repo root
docker compose -f server/tests/integration/docker-compose.test.yml up -d --wait

RUN_INTEGRATION=1 \
DATABASE_URL=postgresql://healthpoint_test:healthpoint_test@localhost:54329/healthpoint_test \
REDIS_URL=redis://localhost:56379 \
  pnpm vitest run server/tests/integration

docker compose -f server/tests/integration/docker-compose.test.yml down -v
```

or simply:

```bash
make test-integration   # up → run → down, with cleanup on failure
```

The credentials above are throwaway, local-only test credentials for the
ephemeral compose stack — not environment secrets.

## Notes for maintainers

- The test never requires Kafka, Temporal, Permify, or OpenSearch. The outbox
  dispatcher treats Kafka as optional (no `KAFKA_BROKERS` ⇒ in-process delivery),
  which is exactly the degraded mode this test validates.
- Migrations are applied idempotently per run against a *fresh* database; if you
  point `DATABASE_URL` at a non-empty database the migration runner will fail on
  duplicate objects — use the compose stack or a scratch database.
- If you add a migration, no changes are needed here: the runner follows
  `drizzle/migrations/meta/_journal.json`.
