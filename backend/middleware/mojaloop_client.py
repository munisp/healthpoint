"""
Mojaloop payment rails connector for HealthPoint IDR Platform.
Implements the Mojaloop Open API for real-time interoperable payments.

Mojaloop by default uses MySQL. This implementation:
1. Uses the Mojaloop REST API (agnostic to its internal DB)
2. Stores all payment state in PostgreSQL (HealthPoint's DB)
3. Supports high-throughput via async HTTP with connection pooling

Architecture:
  HealthPoint → Mojaloop Hub → Payer FSP → Payee FSP
  All state is mirrored to PostgreSQL for audit and reconciliation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
MOJALOOP_HUB_URL: str = os.getenv("MOJALOOP_HUB_URL", "http://mojaloop-hub:3000")
MOJALOOP_FSPIOP_SOURCE: str = os.getenv("MOJALOOP_FSPIOP_SOURCE", "healthpoint")
MOJALOOP_JWS_KEY: str = os.environ.get("MOJALOOP_JWS_KEY", "")
MOJALOOP_CALLBACK_URL: str = os.getenv("MOJALOOP_CALLBACK_URL", "http://healthpoint-api:8000/mojaloop/callbacks")
MOJALOOP_ENABLED: bool = os.getenv("MOJALOOP_ENABLED", "true").lower() == "true"


class TransactionState(str, Enum):
    RECEIVED = "RECEIVED"
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    ABORTED = "ABORTED"


class TransferState(str, Enum):
    RECEIVED = "RECEIVED"
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    ABORTED = "ABORTED"


# ── HTTP client ───────────────────────────────────────────────────────────────
def _get_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=MOJALOOP_HUB_URL,
        timeout=30,
        headers={
            "Content-Type": "application/vnd.interoperability.transfers+json;version=1.1",
            "Accept": "application/vnd.interoperability.transfers+json;version=1.1",
            "FSPIOP-Source": MOJALOOP_FSPIOP_SOURCE,
            "Date": datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT"),
        },
    )


def _sign_request(body: dict) -> str:
    """Sign request body with JWS key for Mojaloop."""
    if not MOJALOOP_JWS_KEY:
        return ""
    body_str = json.dumps(body, sort_keys=True, separators=(",", ":"))
    sig = hmac.new(MOJALOOP_JWS_KEY.encode(), body_str.encode(), hashlib.sha256)
    return sig.hexdigest()


# ── Mojaloop API calls ────────────────────────────────────────────────────────
async def initiate_transfer(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    payer_id: str,
    payee_id: str,
    amount: str,
    currency: str = "USD",
    note: Optional[str] = None,
) -> dict[str, Any]:
    """
    Initiate a Mojaloop transfer (POST /transfers).
    Returns the transfer response or raises on error.
    """
    if not MOJALOOP_ENABLED:
        return await _pg_record_transfer(
            transfer_id, payer_fsp, payee_fsp, payer_id, payee_id, amount, currency, "SIMULATED"
        )

    body = {
        "transferId": transfer_id,
        "payerFsp": payer_fsp,
        "payeeFsp": payee_fsp,
        "amount": {"amount": amount, "currency": currency},
        "ilpPacket": _generate_ilp_packet(transfer_id, amount, currency),
        "condition": _generate_condition(transfer_id),
        "expiration": (datetime.utcnow() + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "extensionList": {
            "extension": [
                {"key": "note", "value": note or "IDR payment"},
                {"key": "source", "value": "healthpoint-idr"},
            ]
        },
    }

    try:
        async with _get_http_client() as client:
            resp = await client.post(
                "/transfers",
                json=body,
                headers={
                    "FSPIOP-Destination": payee_fsp,
                    "X-Signature": _sign_request(body),
                },
            )
            resp.raise_for_status()
            result = resp.json() if resp.content else {"transferId": transfer_id, "transferState": "RECEIVED"}
    except httpx.HTTPError as e:
        logger.error("Mojaloop transfer failed: %s", str(e))
        raise RuntimeError(f"Mojaloop transfer failed: {str(e)}")

    # Mirror to PostgreSQL
    await _pg_record_transfer(
        transfer_id, payer_fsp, payee_fsp, payer_id, payee_id, amount, currency,
        result.get("transferState", "RECEIVED"),
    )
    return result


async def get_transfer_status(transfer_id: str) -> dict[str, Any]:
    """Get transfer status from Mojaloop (GET /transfers/{id})."""
    if not MOJALOOP_ENABLED:
        return await _pg_get_transfer(transfer_id)

    try:
        async with _get_http_client() as client:
            resp = await client.get(f"/transfers/{transfer_id}")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        logger.error("Mojaloop get transfer failed: %s", str(e))
        # Fall back to PostgreSQL record
        return await _pg_get_transfer(transfer_id)


async def handle_transfer_callback(callback_body: dict[str, Any]) -> None:
    """
    Process a Mojaloop callback (PUT /transfers/{id}).
    Updates PostgreSQL with the final transfer state.
    """
    transfer_id = callback_body.get("transferId")
    state = callback_body.get("transferState", "UNKNOWN")

    if not transfer_id:
        logger.error("Mojaloop callback missing transferId")
        return

    from backend.shared.database import execute
    await execute(
        """
        UPDATE mojaloop_transfers
        SET state = $1, callback_payload = $2, updated_at = NOW()
        WHERE transfer_id = $3
        """,
        state,
        json.dumps(callback_body),
        transfer_id,
    )

    # Publish to Kafka for downstream processing
    from backend.shared.messaging import publish, Topics
    await publish(
        Topics.PAYMENT_SETTLED if state == "COMMITTED" else Topics.PAYMENT_FAILED,
        {
            "transfer_id": transfer_id,
            "state": state,
            "callback": callback_body,
        },
    )
    logger.info("Mojaloop callback processed: transfer=%s state=%s", transfer_id, state)


# ── PostgreSQL persistence ────────────────────────────────────────────────────
async def _pg_record_transfer(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    payer_id: str,
    payee_id: str,
    amount: str,
    currency: str,
    state: str,
) -> dict[str, Any]:
    """Record a Mojaloop transfer in PostgreSQL."""
    from backend.shared.database import execute
    await execute(
        """
        INSERT INTO mojaloop_transfers
            (transfer_id, payer_fsp, payee_fsp, payer_id, payee_id, amount, currency, state)
        VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
        ON CONFLICT (transfer_id) DO UPDATE
        SET state = EXCLUDED.state, updated_at = NOW()
        """,
        transfer_id, payer_fsp, payee_fsp, payer_id, payee_id,
        float(amount), currency, state,
    )
    return {"transferId": transfer_id, "transferState": state}


async def _pg_get_transfer(transfer_id: str) -> dict[str, Any]:
    """Get transfer from PostgreSQL."""
    from backend.shared.database import fetchrow
    row = await fetchrow(
        "SELECT * FROM mojaloop_transfers WHERE transfer_id = $1",
        transfer_id,
    )
    if not row:
        return {"transferId": transfer_id, "transferState": "NOT_FOUND"}
    return dict(row)


# ── ILP helpers (simplified) ──────────────────────────────────────────────────
def _generate_ilp_packet(transfer_id: str, amount: str, currency: str) -> str:
    """Generate a simplified ILP packet for Mojaloop."""
    # In production, use a proper ILP library
    # This is a base64-encoded placeholder that satisfies Mojaloop's format requirement
    import base64
    data = f"{transfer_id}:{amount}:{currency}".encode()
    return base64.b64encode(data).decode()


def _generate_condition(transfer_id: str) -> str:
    """Generate a cryptographic condition for the ILP transfer."""
    import base64
    import hashlib
    # SHA-256 hash of transfer_id as condition (simplified)
    digest = hashlib.sha256(transfer_id.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


# ── Schema ────────────────────────────────────────────────────────────────────
MOJALOOP_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS mojaloop_transfers (
    id              BIGSERIAL PRIMARY KEY,
    transfer_id     VARCHAR(64) UNIQUE NOT NULL,
    payer_fsp       VARCHAR(128) NOT NULL,
    payee_fsp       VARCHAR(128) NOT NULL,
    payer_id        VARCHAR(255) NOT NULL,
    payee_id        VARCHAR(255) NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    state           VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    callback_payload JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_state ON mojaloop_transfers(state);
CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_payer ON mojaloop_transfers(payer_id);
"""


async def bootstrap_mojaloop_schema() -> None:
    from backend.shared.database import execute
    await execute(MOJALOOP_SCHEMA_SQL)
    logger.info("Mojaloop schema bootstrapped")
