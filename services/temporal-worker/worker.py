"""
HealthPoint IDR — Temporal workflow worker with REAL activities (no mocks):
  - PostgreSQL (system of record) via asyncpg, same tables / quoted camelCase
    columns as drizzle/schema.ts. Mutating activities write the state change
    AND an event_log audit row in ONE transaction, deduped by a deterministic
    key on event_log."idempotencyKey" (unique index) — a retried activity whose
    first attempt committed is a safe no-op.
  - Go sidecar (services/go) for TigerBeetle funds movement with the same
    deterministic SHA-256 IDs as server/tigerbeetle-ledger.ts (retries dedupe
    inside TigerBeetle via TransferExists).
  - Platform outbox (event_log status "pending") for event publication; the TS
    outbox worker performs the Kafka dispatch.
Business-rule failures raise ApplicationError(non_retryable=True); transient
failures (DB down, sidecar 5xx, network) raise and are retried. Audit rows use
topic "idr.temporal.activities", status "skipped" (never dispatched to Kafka).
"""

import asyncio
import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import aiohttp
import asyncpg
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.common import RetryPolicy
from temporalio.exceptions import ApplicationError
from temporalio.worker import Worker, UnsandboxedWorkflowRunner

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Aligns with server/temporal.ts defaults and docker-compose.yml.
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST") or os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "default")
TASK_QUEUE = os.getenv("TEMPORAL_TASK_QUEUE", "healthpoint-idr")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://idr_user:idr_pass123@localhost:5432/idr_demo")
GO_SERVICES_URL = os.getenv("GO_SERVICES_URL", "http://localhost:8001").rstrip("/")
INTERNAL_SERVICE_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")
TB_LEDGER_ENABLED = os.getenv("TB_LEDGER_ENABLED", "false") == "true"

AUDIT_TOPIC = "idr.temporal.activities"
EVENT_STATUS_AUDIT = "skipped"   # audit-only: never dispatched by the outbox worker
EVENT_STATUS_OUTBOX = "pending"  # dispatched to Kafka by server/outbox-worker.ts

TB_LEDGER_USD_CENTS = 1
TB_CODE_SETTLEMENT = 7200
TB_CODE_SETTLEMENT_ACCOUNT = 720

# Workflow data classes

@dataclass
class DisputeWorkflowInput:
    """Envelope from server/temporal.ts startDisputeTemporalWorkflow (camelCase;
    only the dispute ID is authoritative — the rest loads from Postgres)."""
    disputeId: str
    requestedBy: str = ""
    requestedAt: str = ""


@dataclass
class WorkflowState:
    dispute_id: str
    current_step: int = 1
    status: str = "initiated"
    provider_id: str = ""
    payer_id: str = ""
    amount_cents: int = 0
    currency: str = "USD"
    offer_amount: Optional[int] = None
    counter_offer_amount: Optional[int] = None
    agreed_amount: Optional[int] = None
    idr_entity_id: Optional[str] = None
    resolution_notes: str = ""
    step_history: list = field(default_factory=list)


# Deterministic TigerBeetle identifiers (port of server/tigerbeetle-ledger.ts)

def _derive_uint128_hex(namespace: str, external_id: str) -> str:
    hex_id = hashlib.sha256(f"{namespace}:{external_id}".encode("utf-8")).hexdigest()[:32]
    if set(hex_id) == {"0"}:  # TigerBeetle forbids the zero identifier
        hex_id = "1" + hex_id[1:]
    return hex_id


def derive_account_id(dispute_id: str, role: str) -> str:
    return _derive_uint128_hex("healthpoint/tb-account", f"{dispute_id}:{role}")


def derive_transfer_id(outbox_idempotency_key: str) -> str:
    return _derive_uint128_hex("healthpoint/tb-transfer", outbox_idempotency_key)


def _business_error(message: str) -> ApplicationError:
    """Non-retryable failure: no amount of retrying can change the outcome."""
    return ApplicationError(message, non_retryable=True)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cents(value: Any) -> int:
    """numeric(12,2) dollars -> integer cents."""
    if value is None:
        return 0
    return int((Decimal(str(value)) * 100).quantize(Decimal("1")))


# Database helpers

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> Optional[asyncpg.Pool]:
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        except Exception as exc:  # transient — Temporal retries
            logger.warning("[temporal-worker] Postgres pool failed: %s", exc)
            return None
    return _pool


async def _insert_audit(conn: asyncpg.Connection, activity_name: str, dispute_id: str,
                        idem_key: str, payload: dict) -> None:
    now = _utcnow()
    await conn.execute(
        '''INSERT INTO event_log
             (id, topic, "eventType", "aggregateId", "aggregateType", payload, metadata,
              "idempotencyKey", status, "retryCount", "nextAttemptAt", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 0, $10, $10)''',
        str(uuid.uuid4()), AUDIT_TOPIC, f"temporal.activity.{activity_name}", dispute_id,
        "dispute", json.dumps(payload),
        json.dumps({"userId": "system", "source": "temporal_worker", "timestamp": now.isoformat()}),
        idem_key, EVENT_STATUS_AUDIT, now,
    )


async def _run_idempotent(activity_name: str, dispute_id: str, idem_key: str,
                          payload: dict, work) -> dict:
    """Run work(conn) in one transaction guarded by idem_key; a pre-existing key
    means the change already committed — return a duplicate marker instead."""
    pool = await get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL unavailable — activity will be retried")
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                prior = await conn.fetchval(
                    'SELECT id FROM event_log WHERE "idempotencyKey" = $1', idem_key)
                if prior is not None:
                    logger.info("[activity] %s duplicate suppressed by %s", activity_name, idem_key)
                    return {"duplicate": True, "idempotencyKey": idem_key, "disputeId": dispute_id}
                result = await work(conn)
                await _insert_audit(conn, activity_name, dispute_id, idem_key,
                                    {**payload, "result": {k: v for k, v in result.items() if k != "duplicate"}})
                return result
    except asyncpg.exceptions.UniqueViolationError:
        # Lost a race against a concurrent execution of the same logical work.
        return {"duplicate": True, "idempotencyKey": idem_key, "disputeId": dispute_id}


async def _fetch_dispute(conn: asyncpg.Connection, dispute_id: str) -> asyncpg.Record:
    row = await conn.fetchrow(
        '''SELECT id, "initiatingPartyId", "respondingPartyId", "initiatingPartyName",
                  "respondingPartyName", "billedAmount", "qpaAmount",
                  "initiatingPartyOffer", "respondingPartyOffer", status, "currentStep",
                  "openNegotiationDeadline", "idrEntityId"
             FROM disputes WHERE id = $1''',
        dispute_id)
    if row is None:
        raise _business_error(f"Dispute {dispute_id} not found in Postgres (system of record)")
    return row


# Go sidecar (TigerBeetle) transport

async def _sidecar_post(path: str, body: dict) -> dict:
    if not INTERNAL_SERVICE_TOKEN:
        raise _business_error("INTERNAL_SERVICE_TOKEN is not configured for the ledger sidecar")
    timeout = aiohttp.ClientTimeout(total=10)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{GO_SERVICES_URL}{path}",
                json=body,
                headers={"Content-Type": "application/json", "X-Internal-Auth": INTERNAL_SERVICE_TOKEN},
            ) as resp:
                text = await resp.text()
                if resp.status in (400, 409):
                    raise _business_error(f"Ledger rejected {path} (HTTP {resp.status}): {text[:300]}")
                if resp.status != 200:
                    raise RuntimeError(f"Ledger sidecar {path} returned HTTP {resp.status}: {text[:300]}")
                return json.loads(text) if text else {}
    except aiohttp.ClientError as exc:
        raise RuntimeError(f"Ledger sidecar unreachable at {path}: {exc}") from exc


# Activities

@activity.defn
async def load_dispute(dispute_id: str) -> dict:
    """Load the authoritative dispute; the TS dispatcher only passes an ID."""
    pool = await get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL unavailable — activity will be retried")
    async with pool.acquire() as conn:
        row = await _fetch_dispute(conn, dispute_id)
    logger.info("[activity] load_dispute: %s status=%s", dispute_id, row["status"])
    return {
        "disputeId": row["id"],
        "providerId": row["initiatingPartyId"],
        "payerId": row["respondingPartyId"] or "",
        "amountCents": _cents(row["billedAmount"]),
        "currency": "USD",
        "status": row["status"],
        "currentStep": row["currentStep"],
    }


@activity.defn
async def validate_dispute(input: dict) -> dict:
    """Step 1: validate against the system of record (exists, positive amount, non-terminal)."""
    dispute_id = input["disputeId"]

    async def work(conn):
        row = await _fetch_dispute(conn, dispute_id)
        billed = _cents(row["billedAmount"])
        if billed <= 0:
            raise _business_error(f"Dispute {dispute_id} has no positive billed amount")
        expected = int(input.get("amountCents") or 0)
        if expected and abs(expected - billed) > 1:
            raise _business_error(
                f"Dispute {dispute_id} billed {billed}c != workflow input {expected}c")
        if row["status"] in ("closed", "determination_issued", "payment_pending"):
            raise _business_error(f"Dispute {dispute_id} is already in terminal state {row['status']}")
        return {"valid": True, "disputeId": dispute_id, "step": 1, "status": "validated",
                "amountCents": billed}

    result = await _run_idempotent("validate_dispute", dispute_id, f"temporal-activity:validate:{dispute_id}",
                                   {"step": 1}, work)
    logger.info("[activity] validate_dispute: %s", dispute_id)
    return result


@activity.defn
async def notify_parties(dispute_id: str, step: int, message: str) -> dict:
    """Write in-app notification rows for both parties (the platform `notifications` table)."""
    async def work(conn):
        row = await _fetch_dispute(conn, dispute_id)
        recipients = [uid for uid in (row["initiatingPartyId"], row["respondingPartyId"]) if uid]
        now = _utcnow()
        for user_id in recipients:
            await conn.execute(
                '''INSERT INTO notifications
                     (id, "disputeId", "userId", "notificationType", title, message, "isRead", "createdAt")
                   VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)''',
                str(uuid.uuid4()), dispute_id, user_id, "workflow_step",
                f"Dispute {dispute_id} — step {step}", message, now)
        return {"notified": True, "disputeId": dispute_id, "step": step, "recipients": len(recipients)}

    result = await _run_idempotent("notify_parties", dispute_id,
                                   f"temporal-activity:notify:{dispute_id}:{step}",
                                   {"step": step, "message": message[:500]}, work)
    logger.info("[activity] notify_parties: dispute=%s step=%s", dispute_id, step)
    return result


@activity.defn
async def submit_initial_offer(dispute_id: str, provider_id: str, amount_cents: int) -> dict:
    """Step 4: record the provider initial offer in dispute_offers."""
    if amount_cents <= 0:
        raise _business_error("Initial offer amount must be positive")

    async def work(conn):
        await _fetch_dispute(conn, dispute_id)
        await conn.execute(
            '''INSERT INTO dispute_offers
                 (id, "disputeId", "offerType", amount, "submittedBy", "submittedAt", "isAccepted")
               VALUES ($1, $2, 'initiating_party', $3, $4, $5, FALSE)''',
            str(uuid.uuid4()), dispute_id, Decimal(amount_cents) / 100, provider_id,
            _utcnow())
        return {"disputeId": dispute_id, "step": 4, "offerAmount": amount_cents,
                "submittedBy": provider_id, "status": "offer_submitted"}

    result = await _run_idempotent("submit_initial_offer", dispute_id,
                                   f"temporal-activity:offer:{dispute_id}:initial",
                                   {"step": 4, "amountCents": amount_cents}, work)
    logger.info("[activity] submit_initial_offer: dispute=%s amount=%s", dispute_id, amount_cents)
    return result


@activity.defn
async def process_counter_offer(dispute_id: str, payer_id: str, amount_cents: int) -> dict:
    """Step 7: record the payer counter-offer in dispute_offers."""
    if amount_cents <= 0:
        raise _business_error("Counter-offer amount must be positive")

    async def work(conn):
        await _fetch_dispute(conn, dispute_id)
        await conn.execute(
            '''INSERT INTO dispute_offers
                 (id, "disputeId", "offerType", amount, "submittedBy", "submittedAt", "isAccepted")
               VALUES ($1, $2, 'responding_party', $3, $4, $5, FALSE)''',
            str(uuid.uuid4()), dispute_id, Decimal(amount_cents) / 100, payer_id,
            _utcnow())
        return {"disputeId": dispute_id, "step": 7, "counterOfferAmount": amount_cents,
                "submittedBy": payer_id, "status": "counter_offer"}

    result = await _run_idempotent("process_counter_offer", dispute_id,
                                   f"temporal-activity:offer:{dispute_id}:counter",
                                   {"step": 7, "amountCents": amount_cents}, work)
    logger.info("[activity] process_counter_offer: dispute=%s amount=%s", dispute_id, amount_cents)
    return result


@activity.defn
async def check_negotiation_deadline(dispute_id: str) -> dict:
    """Step 9: report whether the NSA open-negotiation deadline (set by server/db.ts) elapsed."""
    pool = await get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL unavailable — activity will be retried")
    async with pool.acquire() as conn:
        row = await _fetch_dispute(conn, dispute_id)
    deadline = row["openNegotiationDeadline"]
    if deadline is None:
        raise _business_error(f"Dispute {dispute_id} has no open-negotiation deadline on record")
    now = _utcnow()
    remaining = (deadline - now).days
    logger.info("[activity] check_negotiation_deadline: %s elapsed=%s", dispute_id, remaining < 0)
    return {"disputeId": dispute_id, "deadlineElapsed": remaining < 0,
            "daysRemaining": max(remaining, 0), "deadline": deadline.isoformat()}


@activity.defn
async def assign_idr_entity(dispute_id: str) -> dict:
    """Step 11: assign the available certified IDR entity with the lightest caseload."""
    async def work(conn):
        entity = await conn.fetchrow(
            '''SELECT id, name FROM idr_entities
                WHERE "isActive" = TRUE AND "currentActiveCases" < "maxConcurrentCases"
                ORDER BY "currentActiveCases" ASC, "avgResolutionDays" ASC NULLS LAST
                LIMIT 1
                FOR UPDATE''')
        if entity is None:
            raise _business_error("No certified IDR entity with available capacity")
        now = _utcnow()
        await conn.execute(
            'UPDATE idr_entities SET "currentActiveCases" = "currentActiveCases" + 1 WHERE id = $1',
            entity["id"])
        await conn.execute(
            '''UPDATE disputes
                  SET "idrEntityId" = $2, "idrEntityName" = $3,
                      status = 'idr_entity_selection', "currentStep" = 'STEP_07_IDR_ENTITY_SELECTED',
                      "updatedAt" = $4
                WHERE id = $1''',
            dispute_id, entity["id"], entity["name"], now)
        await conn.execute(
            '''INSERT INTO dispute_events
                 (id, "disputeId", step, "eventType", description, "performedBy", "createdAt")
               VALUES ($1, $2, 'STEP_07_IDR_ENTITY_SELECTED', 'idr_entity_assigned', $3, 'system', $4)''',
            str(uuid.uuid4()), dispute_id, f"IDR entity {entity['name']} assigned by Temporal workflow", now)
        return {"disputeId": dispute_id, "step": 11, "idrEntityId": entity["id"],
                "idrEntityName": entity["name"], "status": "idr_entity_assigned"}

    result = await _run_idempotent("assign_idr_entity", dispute_id,
                                   f"temporal-activity:assign-idr-entity:{dispute_id}",
                                   {"step": 11}, work)
    logger.info("[activity] assign_idr_entity: dispute=%s entity=%s", dispute_id, result.get("idrEntityId"))
    return result


@activity.defn
async def conduct_arbitration(dispute_id: str, idr_entity_id: str) -> dict:
    """Steps 12-16: NSA baseball-style determination — the offer closest to the QPA wins
    (45 CFR 149.510(c)(4)(ii)); without a QPA the lower offer wins. Ties resolve to the
    responding party. Missing party offers are a non-retryable business-rule failure."""
    async def work(conn):
        dispute = await _fetch_dispute(conn, dispute_id)
        offers = await conn.fetch(
            '''SELECT "offerType", amount FROM dispute_offers
                WHERE "disputeId" = $1 AND "offerType" IN ('initiating_party', 'responding_party')
                ORDER BY "submittedAt" DESC''',
            dispute_id)
        latest: dict = {}
        for offer in offers:  # rows are newest-first; first occurrence wins
            latest.setdefault(offer["offerType"], _cents(offer["amount"]))
        initiating = latest.get("initiating_party")
        responding = latest.get("responding_party")
        if initiating is None or responding is None:
            raise _business_error(
                f"Dispute {dispute_id} lacks both party offers; arbitration cannot determine an award")
        qpa = _cents(dispute["qpaAmount"]) if dispute["qpaAmount"] is not None else None
        if qpa is not None and qpa > 0:
            provider_distance = abs(initiating - qpa)
            payer_distance = abs(responding - qpa)
            # Ties resolve to the responding party's offer (the QPA-proximate
            # payer position), matching certified-IDR-entity practice.
            winner = "initiating_party" if provider_distance < payer_distance else "responding_party"
            basis = (f"Baseball-style determination: offer closest to the QPA ({qpa}c); "
                     f"provider offer {initiating}c, payer offer {responding}c.")
        else:
            winner = "initiating_party" if initiating <= responding else "responding_party"
            basis = "No QPA on record; lower offer selected pending QPA disclosure."
        award = initiating if winner == "initiating_party" else responding
        now = _utcnow()
        await conn.execute(
            '''UPDATE disputes
                  SET "determinationAmount" = $2, "determinationWinner" = $3,
                      "determinationBasis" = $4, status = 'determination_issued',
                      "currentStep" = 'STEP_13_DETERMINATION_ISSUED', "updatedAt" = $5
                WHERE id = $1''',
            dispute_id, Decimal(award) / 100, winner, basis, now)
        await conn.execute(
            '''INSERT INTO dispute_offers
                 (id, "disputeId", "offerType", amount, rationale, "submittedBy", "submittedAt", "isAccepted")
               VALUES ($1, $2, 'determination', $3, $4, $5, $6, TRUE)''',
            str(uuid.uuid4()), dispute_id, Decimal(award) / 100, basis,
            idr_entity_id or "temporal-workflow", now)
        await conn.execute(
            '''INSERT INTO dispute_events
                 (id, "disputeId", step, "eventType", description, "performedBy", "createdAt")
               VALUES ($1, $2, 'STEP_13_DETERMINATION_ISSUED', 'determination_issued', $3, $4, $5)''',
            str(uuid.uuid4()), dispute_id,
            f"Determination issued: {winner} prevails, award {award / 100:.2f} USD",
            idr_entity_id or "system", now)
        return {"disputeId": dispute_id, "step": 16, "determination": winner,
                "awardAmount": award, "idrEntityId": idr_entity_id, "status": "determination_issued"}

    result = await _run_idempotent("conduct_arbitration", dispute_id,
                                   f"temporal-activity:arbitrate:{dispute_id}",
                                   {"step": 16, "idrEntityId": idr_entity_id}, work)
    logger.info("[activity] conduct_arbitration: dispute=%s award=%s", dispute_id, result.get("awardAmount"))
    return result


@activity.defn
async def process_payment(dispute_id: str, amount_cents: int, currency: str) -> dict:
    """Step 17: committed TigerBeetle transfer via the Go sidecar (payer clearing ->
    provider settlement). Fails closed (non-retryable) when the ledger integration is
    disabled or unauthenticated; retries dedupe by deterministic transfer ID."""
    if amount_cents <= 0:
        raise _business_error("Payment amount must be a positive integer number of cents")
    if currency != "USD":
        raise _business_error(f"Unsupported currency {currency}; the ledger holds USD cents only")
    if not TB_LEDGER_ENABLED:
        raise _business_error(
            "TB_LEDGER_ENABLED is not true; refusing to pay outside the authoritative ledger")

    idem_key = f"temporal-payment:{dispute_id}"
    transfer_id = derive_transfer_id(idem_key)
    payer_account = derive_account_id(dispute_id, "payer_clearing")
    provider_account = derive_account_id(dispute_id, "provider_settlement")

    await _sidecar_post("/internal/ledger/accounts", {"accounts": [
        {"accountId": payer_account, "ledger": TB_LEDGER_USD_CENTS, "code": TB_CODE_SETTLEMENT_ACCOUNT, "history": True},
        {"accountId": provider_account, "ledger": TB_LEDGER_USD_CENTS, "code": TB_CODE_SETTLEMENT_ACCOUNT, "history": True},
    ]})
    transfer = await _sidecar_post("/internal/ledger/transfer", {
        "transferId": transfer_id,
        "debitAccountId": payer_account,
        "creditAccountId": provider_account,
        "amount": amount_cents,
        "ledger": TB_LEDGER_USD_CENTS,
        "code": TB_CODE_SETTLEMENT,
        "phase": "committed",
    })
    status = str(transfer.get("status", ""))
    if status not in ("committed", "exists"):
        raise _business_error(f"TigerBeetle transfer {transfer_id} failed: {status}")

    async def work(conn):
        now = _utcnow()
        # Durable outbox event; the TS outbox worker dispatches it to Kafka.
        await conn.execute(
            '''INSERT INTO event_log
                 (id, topic, "eventType", "aggregateId", "aggregateType", payload, metadata,
                  "idempotencyKey", status, "retryCount", "nextAttemptAt", "createdAt")
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 0, $10, $10)''',
            str(uuid.uuid4()), "idr.payments", "dispute.payment_processed", dispute_id, "dispute",
            json.dumps({"disputeId": dispute_id, "amountCents": amount_cents, "currency": currency,
                        "tigerBeetleTransferId": transfer_id, "ledgerStatus": status}),
            json.dumps({"userId": "system", "source": "temporal_worker", "timestamp": now.isoformat()}),
            f"temporal-payment-event:{dispute_id}", EVENT_STATUS_OUTBOX, now)
        return {"disputeId": dispute_id, "step": 17, "transactionId": transfer_id,
                "amount": amount_cents, "currency": currency, "status": "payment_processed",
                "ledgerStatus": status}

    result = await _run_idempotent("process_payment", dispute_id,
                                   f"temporal-activity:payment:{dispute_id}",
                                   {"step": 17, "amountCents": amount_cents, "transferId": transfer_id}, work)
    logger.info("[activity] process_payment: dispute=%s transfer=%s status=%s", dispute_id, transfer_id, status)
    return result


@activity.defn
async def close_dispute(dispute_id: str, resolution: str, notes: str) -> dict:
    """Steps 18-19: close the dispute in Postgres and record the timeline event."""
    async def work(conn):
        await _fetch_dispute(conn, dispute_id)
        now = _utcnow()
        await conn.execute(
            '''UPDATE disputes
                  SET status = 'closed', "currentStep" = 'STEP_17_DISPUTE_CLOSED',
                      "closedAt" = $2, "updatedAt" = $2
                WHERE id = $1''',
            dispute_id, now)
        await conn.execute(
            '''INSERT INTO dispute_events
                 (id, "disputeId", step, "eventType", description, "performedBy", "createdAt")
               VALUES ($1, $2, 'STEP_17_DISPUTE_CLOSED', 'dispute_closed', $3, 'system', $4)''',
            str(uuid.uuid4()), dispute_id,
            f"Dispute closed ({resolution}). {notes}".strip()[:500], now)
        return {"disputeId": dispute_id, "step": 19, "resolution": str(resolution),
                "status": "closed", "closedAt": now.isoformat()}

    result = await _run_idempotent("close_dispute", dispute_id,
                                   f"temporal-activity:close:{dispute_id}",
                                   {"step": 19, "resolution": str(resolution)}, work)
    logger.info("[activity] close_dispute: %s resolution=%s", dispute_id, resolution)
    return result


@activity.defn
async def publish_event(topic: str, key: str, payload: dict) -> dict:
    """Publish via the durable outbox (event_log "pending"); the TS outbox worker
    delivers it to Kafka after commit, deduped by idempotency key."""
    idem_key = payload.get("idempotencyKey") or f"temporal-event:{topic}:{key}"
    pool = await get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL unavailable — activity will be retried")
    async with pool.acquire() as conn:
        try:
            now = _utcnow()
            row_id = await conn.fetchval(
                '''INSERT INTO event_log
                     (id, topic, "eventType", "aggregateId", "aggregateType", payload, metadata,
                      "idempotencyKey", status, "retryCount", "nextAttemptAt", "createdAt")
                   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 0, $10, $10)
                   ON CONFLICT ("idempotencyKey") DO NOTHING
                   RETURNING id''',
                str(uuid.uuid4()), topic, str(payload.get("eventType", "temporal.event")), key,
                "dispute", json.dumps(payload.get("payload", payload)),
                json.dumps({"userId": "system", "source": "temporal_worker", "timestamp": now.isoformat()}),
                idem_key, EVENT_STATUS_OUTBOX, now)
        except asyncpg.exceptions.UniqueViolationError:
            row_id = None
    if row_id is None:
        return {"published": False, "duplicate": True, "topic": topic, "key": key}
    logger.info("[activity] publish_event: topic=%s key=%s", topic, key)
    return {"published": True, "topic": topic, "key": key}


# 19-Step IDR Workflow

@workflow.defn(name="idrDisputeWorkflow")
class IDRDisputeWorkflow:
    """19-step NSA IDR workflow (type idrDisputeWorkflow — started by
    server/temporal.ts with { disputeId, requestedBy, requestedAt })."""

    def __init__(self):
        self._state: Optional[WorkflowState] = None
        self._signal_received = False
        self._signal_data: dict = {}

    @workflow.run
    async def run(self, input: DisputeWorkflowInput) -> WorkflowState:
        retry = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(minutes=10),
            maximum_attempts=5,
        )

        loaded = await workflow.execute_activity(
            load_dispute, input.disputeId,
            start_to_close_timeout=timedelta(minutes=5), retry_policy=retry)
        self._state = WorkflowState(
            dispute_id=input.disputeId,
            provider_id=loaded["providerId"],
            payer_id=loaded["payerId"],
            amount_cents=loaded["amountCents"],
            currency=loaded.get("currency", "USD"),
        )

        # Step 1: Validate dispute
        self._state.current_step = 1
        result = await workflow.execute_activity(
            validate_dispute, {"disputeId": input.disputeId, "amountCents": loaded["amountCents"]},
            start_to_close_timeout=timedelta(minutes=5), retry_policy=retry)
        self._record_step(1, result.get("status", "validated"), "system")

        # Step 2: Notify parties
        self._state.current_step = 2
        await workflow.execute_activity(
            notify_parties,
            args=[input.disputeId, 2, "Dispute initiated. Open negotiation period begins."],
            start_to_close_timeout=timedelta(minutes=2),
        )
        self._record_step(2, "notified", "system")

        # Step 3: Open negotiation period (30 days)
        self._state.current_step = 3
        self._state.status = "open_negotiation"
        await workflow.execute_activity(
            publish_event,
            args=["idr.disputes.state_changes", input.disputeId, {
                "eventType": "dispute.negotiation_started",
                "aggregateId": input.disputeId,
                "payload": {"step": 3, "status": "open_negotiation"},
                "idempotencyKey": f"temporal-event:negotiation-started:{input.disputeId}",
                "timestamp": str(workflow.now()),
            }],
            start_to_close_timeout=timedelta(minutes=2),
        )
        self._record_step(3, "open_negotiation", "system")

        # Step 4: Wait for provider offer (signal)
        self._state.current_step = 4
        await workflow.wait_condition(
            lambda: self._signal_received and self._signal_data.get("type") == "provider_offer",
            timeout=timedelta(days=30),
        )
        offer_amount = int(self._signal_data.get("amount", self._state.amount_cents))
        self._signal_received = False

        result = await workflow.execute_activity(
            submit_initial_offer,
            args=[input.disputeId, self._state.provider_id, offer_amount],
            start_to_close_timeout=timedelta(minutes=5),
        )
        self._state.offer_amount = offer_amount
        self._state.status = "offer_submitted"
        self._record_step(4, "offer_submitted", self._state.provider_id)

        # Step 5-6: Payer reviews offer
        self._state.current_step = 5
        await workflow.execute_activity(
            notify_parties,
            args=[input.disputeId, 5, f"Provider offer received: ${offer_amount / 100:.2f}"],
            start_to_close_timeout=timedelta(minutes=2),
        )

        self._state.current_step = 6
        await workflow.wait_condition(
            lambda: self._signal_received and self._signal_data.get("type") in ("accept_offer", "reject_offer"),
            timeout=timedelta(days=10),
        )
        payer_decision = self._signal_data.get("type")
        self._signal_received = False
        self._record_step(6, payer_decision, self._state.payer_id)

        if payer_decision == "accept_offer":
            self._state.agreed_amount = offer_amount
            self._state.status = "agreed"
            self._record_step(6, "agreed", self._state.payer_id)
        else:
            # Step 7-8: Counter-offer
            self._state.current_step = 7
            await workflow.wait_condition(
                lambda: self._signal_received and self._signal_data.get("type") == "counter_offer",
                timeout=timedelta(days=10),
            )
            counter_amount = int(self._signal_data.get("amount", offer_amount))
            self._signal_received = False

            await workflow.execute_activity(
                process_counter_offer,
                args=[input.disputeId, self._state.payer_id, counter_amount],
                start_to_close_timeout=timedelta(minutes=5),
            )
            self._state.counter_offer_amount = counter_amount
            self._state.status = "counter_offer"
            self._record_step(7, "counter_offer", self._state.payer_id)

            # Step 8: Provider reviews counter-offer
            self._state.current_step = 8
            await workflow.wait_condition(
                lambda: self._signal_received and self._signal_data.get("type") in ("accept_counter", "reject_counter"),
                timeout=timedelta(days=5),
            )
            provider_decision = self._signal_data.get("type")
            self._signal_received = False

            if provider_decision == "accept_counter":
                self._state.agreed_amount = counter_amount
                self._state.status = "agreed"
                self._record_step(8, "agreed_on_counter", self._state.provider_id)
            else:
                # Step 9-10: IDR initiation
                self._state.current_step = 9
                await workflow.execute_activity(
                    check_negotiation_deadline,
                    input.disputeId,
                    start_to_close_timeout=timedelta(minutes=2),
                )
                self._record_step(9, "deadline_checked", "system")

                self._state.current_step = 10
                self._state.status = "idr_entity_review"
                await workflow.execute_activity(
                    publish_event,
                    args=["idr.disputes.state_changes", input.disputeId, {
                        "eventType": "dispute.idr_initiated",
                        "aggregateId": input.disputeId,
                        "payload": {"step": 10, "status": "idr_initiated"},
                        "idempotencyKey": f"temporal-event:idr-initiated:{input.disputeId}",
                        "timestamp": str(workflow.now()),
                    }],
                    start_to_close_timeout=timedelta(minutes=2),
                )
                self._record_step(10, "idr_initiated", "system")

                # Step 11: Assign IDR entity
                self._state.current_step = 11
                entity_result = await workflow.execute_activity(
                    assign_idr_entity,
                    input.disputeId,
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=retry,
                )
                self._state.idr_entity_id = entity_result.get("idrEntityId")
                self._record_step(11, "idr_entity_assigned", "system")

                # Steps 12-16: Arbitration
                for step in range(12, 17):
                    self._state.current_step = step
                    self._record_step(step, f"arbitration_step_{step}", self._state.idr_entity_id or "idr_entity")

                arbitration_result = await workflow.execute_activity(
                    conduct_arbitration,
                    args=[input.disputeId, self._state.idr_entity_id or ""],
                    start_to_close_timeout=timedelta(days=30),
                    retry_policy=retry,
                )
                self._state.status = "arbitration"
                self._state.agreed_amount = arbitration_result.get("awardAmount", 0)
                self._record_step(16, "determination_issued", self._state.idr_entity_id or "idr_entity")

        # Step 17: Process payment
        self._state.current_step = 17
        if self._state.agreed_amount and self._state.agreed_amount > 0:
            await workflow.execute_activity(
                process_payment,
                args=[input.disputeId, self._state.agreed_amount, self._state.currency],
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=retry,
            )
            self._record_step(17, "payment_processed", "system")
        else:
            self._record_step(17, "no_payment_required", "system")

        # Step 18: Close dispute
        self._state.current_step = 18
        await workflow.execute_activity(
            close_dispute,
            args=[input.disputeId, self._state.status, self._state.resolution_notes],
            start_to_close_timeout=timedelta(minutes=10),
        )
        self._record_step(18, "closed", "system")

        # Step 19: Archive and report
        self._state.current_step = 19
        await workflow.execute_activity(
            publish_event,
            args=["idr.lakehouse.ingest", input.disputeId, {
                "eventType": "dispute.archived",
                "aggregateId": input.disputeId,
                "payload": {
                    "step": 19,
                    "status": "archived",
                    "finalStatus": self._state.status,
                    "agreedAmount": self._state.agreed_amount,
                    "stepHistory": self._state.step_history,
                },
                "idempotencyKey": f"temporal-event:archived:{input.disputeId}",
                "timestamp": str(workflow.now()),
            }],
            start_to_close_timeout=timedelta(minutes=5),
        )
        self._state.status = "closed"
        self._record_step(19, "archived", "system")

        logger.info("[workflow] IDR dispute %s completed: %s", input.disputeId, self._state.status)
        return self._state

    @workflow.signal
    async def advance_step(self, signal_data: dict) -> None:
        """Signal to advance the workflow to the next step."""
        self._signal_data = signal_data
        self._signal_received = True
        logger.info("[workflow] signal received: %s for %s",
                    signal_data.get("type"), self._state.dispute_id if self._state else "unknown")

    @workflow.query
    def get_state(self) -> dict:
        """Query the current workflow state."""
        if not self._state:
            return {}
        return {
            "disputeId": self._state.dispute_id,
            "currentStep": self._state.current_step,
            "status": self._state.status,
            "offerAmount": self._state.offer_amount,
            "counterOfferAmount": self._state.counter_offer_amount,
            "agreedAmount": self._state.agreed_amount,
            "stepHistory": self._state.step_history,
        }

    def _record_step(self, step: int, status: str, actor_id: str) -> None:
        if self._state:
            self._state.step_history.append({
                "step": step,
                "status": status,
                "actorId": actor_id,
                "timestamp": str(workflow.now()),
            })


# Worker main

async def main():
    logger.info("[temporal-worker] connecting to %s ns=%s queue=%s",
                TEMPORAL_HOST, TEMPORAL_NAMESPACE, TASK_QUEUE)

    client = await Client.connect(TEMPORAL_HOST, namespace=TEMPORAL_NAMESPACE)
    worker = Worker(
        client, task_queue=TASK_QUEUE, workflows=[IDRDisputeWorkflow],
        activities=[load_dispute, validate_dispute, notify_parties, submit_initial_offer,
                    process_counter_offer, check_negotiation_deadline, assign_idr_entity,
                    conduct_arbitration, process_payment, close_dispute, publish_event],
        # Unsandboxed: activities hold asyncpg/aiohttp connections that the
        # sandboxed re-importer cannot proxy; workflow code stays deterministic.
        workflow_runner=UnsandboxedWorkflowRunner(),
    )

    logger.info("[temporal-worker] worker started on queue: %s", TASK_QUEUE)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
