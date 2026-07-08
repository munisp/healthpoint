"""
HealthPoint FHIR Subscription Service
=======================================
Receives Medplum webhook notifications for FHIR resource changes,
persists them to PostgreSQL, and fans out to downstream services via Kafka.

Subscriptions managed:
  - Claim status changes       → IDR workflow engine
  - Coverage updates           → Eligibility validation service
  - Task (appeal) state changes → Appeal escalation service
  - ExplanationOfBenefit       → Payment processing service
  - Patient updates            → Patient management service

Spec: FHIR R4 Subscription (https://www.hl7.org/fhir/subscription.html)
Medplum webhooks: https://www.medplum.com/docs/subscriptions
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import asyncpg
from aiokafka import AIOKafkaProducer
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware

from backend.shared.database import get_db_pool
from backend.shared.messaging import get_kafka_producer
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FHIR Subscription Service",
    description="Receives Medplum webhook notifications and fans out to downstream services",
    version="1.0.0",
)

setup_telemetry("fhir-subscription-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type", "X-Medplum-Signature"],
)

WEBHOOK_SECRET = os.getenv("MEDPLUM_WEBHOOK_SECRET", "")

# ─── Subscription Definitions (registered in Medplum on startup) ──────────────

SUBSCRIPTIONS = [
    {
        "id": "claim-status-subscription",
        "criteria": "Claim?status=active",
        "reason": "IDR workflow: track Claim status changes",
        "kafka_topic": "fhir.claim.status",
        "downstream_service": "idr-workflow-engine",
    },
    {
        "id": "coverage-update-subscription",
        "criteria": "Coverage",
        "reason": "Eligibility: track Coverage updates",
        "kafka_topic": "fhir.coverage.update",
        "downstream_service": "eligibility-validation",
    },
    {
        "id": "task-appeal-subscription",
        "criteria": "Task?code=appeal-",
        "reason": "Appeal: track Task state changes",
        "kafka_topic": "fhir.task.appeal",
        "downstream_service": "appeal-escalation",
    },
    {
        "id": "eob-subscription",
        "criteria": "ExplanationOfBenefit",
        "reason": "Payment: track EOB updates",
        "kafka_topic": "fhir.eob.update",
        "downstream_service": "payment-processing",
    },
    {
        "id": "patient-update-subscription",
        "criteria": "Patient",
        "reason": "Patient management: track Patient updates",
        "kafka_topic": "fhir.patient.update",
        "downstream_service": "patient-management",
    },
    {
        "id": "payment-reconciliation-subscription",
        "criteria": "PaymentReconciliation",
        "reason": "Payment: track PaymentReconciliation creation",
        "kafka_topic": "fhir.payment.reconciliation",
        "downstream_service": "payment-processing",
    },
]


# ─── Webhook Verification ─────────────────────────────────────────────────────

def verify_medplum_signature(
    body: bytes,
    signature: Optional[str],
    secret: str,
) -> bool:
    """Verify the Medplum webhook HMAC-SHA256 signature."""
    if not secret:
        logger.warning("MEDPLUM_WEBHOOK_SECRET not set — skipping signature verification.")
        return True
    if not signature:
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


# ─── Webhook Handler ──────────────────────────────────────────────────────────

@app.post("/webhook/{subscription_id}")
async def receive_webhook(
    subscription_id: str,
    request: Request,
    x_medplum_signature: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Receive a Medplum webhook notification for a FHIR Subscription."""
    body = await request.body()

    # Verify signature
    if not verify_medplum_signature(body, x_medplum_signature, WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # Find the subscription config
    sub_config = next(
        (s for s in SUBSCRIPTIONS if s["id"] == subscription_id), None
    )
    if not sub_config:
        raise HTTPException(
            status_code=404,
            detail=f"Subscription '{subscription_id}' not registered.",
        )

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {e}")

    resource_type = payload.get("resourceType", "Unknown")
    resource_id = payload.get("id", "unknown")
    resource_status = payload.get("status", "unknown")

    logger.info(
        f"Webhook received: subscription={subscription_id}, "
        f"resource={resource_type}/{resource_id}, status={resource_status}"
    )

    # Persist to PostgreSQL
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO fhir_subscription_events
              (subscription_id, resource_type, resource_id, resource_status,
               payload, received_at, kafka_topic, downstream_service)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
            """,
            subscription_id,
            resource_type,
            resource_id,
            resource_status,
            json.dumps(payload),
            sub_config["kafka_topic"],
            sub_config["downstream_service"],
        )

    # Fan out to Kafka
    try:
        producer: AIOKafkaProducer = app.state.kafka_producer
        kafka_message = {
            "subscription_id": subscription_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "resource_status": resource_status,
            "payload": payload,
            "received_at": datetime.utcnow().isoformat(),
        }
        await producer.send_and_wait(
            sub_config["kafka_topic"],
            json.dumps(kafka_message).encode("utf-8"),
            key=resource_id.encode("utf-8"),
        )
        logger.info(
            f"Published {resource_type}/{resource_id} to Kafka topic {sub_config['kafka_topic']}"
        )
    except Exception as e:
        logger.error(f"Kafka publish failed for {resource_type}/{resource_id}: {e}", exc_info=True)
        # Do not fail the webhook — Kafka is best-effort here; PostgreSQL is the source of truth

    return {
        "status": "accepted",
        "subscription_id": subscription_id,
        "resource": f"{resource_type}/{resource_id}",
        "kafka_topic": sub_config["kafka_topic"],
    }


# ─── Subscription Registration ────────────────────────────────────────────────

async def register_subscriptions_in_medplum() -> None:
    """Register all subscriptions in Medplum on startup if they don't exist."""
    from backend.shared.medplum_client import MedplumClient

    medplum = MedplumClient(
        base_url=os.getenv("MEDPLUM_BASE_URL", "http://medplum:8103"),
        client_id=os.getenv("MEDPLUM_CLIENT_ID", ""),
        client_secret=os.getenv("MEDPLUM_CLIENT_SECRET", ""),
    )
    await medplum.authenticate()

    base_url = os.getenv("FHIR_SUBSCRIPTION_BASE_URL", "http://fhir-subscription-service:8000")

    for sub in SUBSCRIPTIONS:
        # Check if already registered
        existing = await medplum.search_resources(
            "Subscription",
            {"_tag": f"healthpoint|{sub['id']}"},
        )
        if existing:
            logger.info(f"Subscription {sub['id']} already registered in Medplum.")
            continue

        subscription_resource = {
            "resourceType": "Subscription",
            "status": "active",
            "reason": sub["reason"],
            "criteria": sub["criteria"],
            "channel": {
                "type": "rest-hook",
                "endpoint": f"{base_url}/webhook/{sub['id']}",
                "payload": "application/fhir+json",
                "header": [
                    f"X-Subscription-ID: {sub['id']}",
                ],
            },
            "meta": {
                "tag": [
                    {
                        "system": "healthpoint",
                        "code": sub["id"],
                    }
                ]
            },
        }

        try:
            created = await medplum.create_resource(subscription_resource)
            logger.info(
                f"Registered Subscription {sub['id']} in Medplum: "
                f"Subscription/{created.get('id')}"
            )
        except Exception as e:
            logger.error(f"Failed to register subscription {sub['id']}: {e}", exc_info=True)


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()
    app.state.kafka_producer = await get_kafka_producer()

    # Ensure subscription events table exists
    async with app.state.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS fhir_subscription_events (
                id BIGSERIAL PRIMARY KEY,
                subscription_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                resource_status TEXT,
                payload JSONB NOT NULL,
                received_at TIMESTAMPTZ DEFAULT NOW(),
                kafka_topic TEXT,
                downstream_service TEXT,
                INDEX idx_fhir_sub_events_resource (resource_type, resource_id),
                INDEX idx_fhir_sub_events_received (received_at)
            );
        """)

    # Register subscriptions in Medplum
    try:
        await register_subscriptions_in_medplum()
    except Exception as e:
        logger.warning(f"Could not register Medplum subscriptions on startup: {e}")

    logger.info("FHIR Subscription Service started.")


@app.on_event("shutdown")
async def shutdown() -> None:
    if hasattr(app.state, "kafka_producer"):
        await app.state.kafka_producer.stop()


# ─── Query Endpoints ──────────────────────────────────────────────────────────

@app.get("/subscriptions")
async def list_subscriptions() -> List[Dict[str, Any]]:
    """List all registered subscription configurations."""
    return SUBSCRIPTIONS


@app.get("/events")
async def get_events(
    subscription_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Query recent subscription events from PostgreSQL."""
    conditions = []
    params: List[Any] = []
    idx = 1

    if subscription_id:
        conditions.append(f"subscription_id = ${idx}")
        params.append(subscription_id)
        idx += 1
    if resource_type:
        conditions.append(f"resource_type = ${idx}")
        params.append(resource_type)
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])

    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, subscription_id, resource_type, resource_id,
                   resource_status, received_at, kafka_topic, downstream_service
            FROM fhir_subscription_events
            {where}
            ORDER BY received_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
    return [dict(r) for r in rows]


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "fhir-subscription-service"}
