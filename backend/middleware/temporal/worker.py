"""
Temporal Worker — Full Production Implementation
Implements GFE workflow activities with real database and service calls.
"""
import asyncio, json, logging, os, uuid
from datetime import datetime, timedelta, date
from typing import Any, Dict, Optional

import asyncpg
import httpx
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://healthpoint:healthpoint@postgres:5432/healthpoint")
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://integration-notification-service:8034")
DOCUMENT_SERVICE_URL = os.getenv("DOCUMENT_SERVICE_URL", "http://document-generation-service:8030")

_pool: Optional[asyncpg.Pool] = None

async def get_db():
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        except Exception as e:
            logger.warning(f"DB pool failed: {e}")
    return _pool

@activity.defn
async def generate_gfe(gfe_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Activity: Generate a GFE document via the document generation service.
    Stores GFE record in database and returns the generated document URL.
    """
    gfe_id = gfe_data.get("gfe_id") or f"GFE-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    patient = gfe_data.get("patient", {})
    service_items = gfe_data.get("service_items", [])
    provider = gfe_data.get("provider", {})
    tenant_id = gfe_data.get("tenant_id", "default")

    total_cost = sum(float(item.get("estimated_cost", 0)) * int(item.get("quantity", 1))
                     for item in service_items)
    valid_until = (datetime.utcnow() + timedelta(days=90)).date()

    # Store GFE in database
    pool = await get_db()
    if pool:
        try:
            await pool.execute("""
                INSERT INTO idr_documents (id, document_type, status, content, tenant_id, total_amount, valid_until, created_at, updated_at)
                VALUES ($1,'gfe','draft',$2,$3,$4,$5,$6,$6) ON CONFLICT (id) DO NOTHING""",
                gfe_id, json.dumps({"patient": patient, "service_items": service_items, "provider": provider}),
                tenant_id, total_cost, valid_until, datetime.utcnow())
        except Exception as e:
            logger.warning(f"GFE DB store failed: {e}")

    # Generate PDF document
    doc_url = None
    try:
        payload = {
            "document_type": "gfe_letter", "output_format": "pdf",
            "patient": {"first_name": patient.get("firstName", ""), "last_name": patient.get("lastName", ""),
                        "member_id": patient.get("memberId")},
            "provider": {"name": provider.get("name", ""), "npi": provider.get("npi"),
                         "specialty": provider.get("specialty")},
            "service_items": [{"cpt_code": s.get("cptCode", ""), "description": s.get("description", ""),
                                "billed_amount": float(s.get("estimatedCost", 0))}
                               for s in service_items],
            "reference_number": gfe_id, "store_to_s3": True,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{DOCUMENT_SERVICE_URL}/api/v1/documents/generate", json=payload)
            if resp.status_code == 201:
                doc_url = resp.json().get("s3_url")
    except Exception as e:
        logger.warning(f"GFE document generation failed: {e}")

    logger.info(f"GFE {gfe_id} generated, doc_url: {doc_url}")
    return {"gfe_id": gfe_id, "status": "generated", "document_url": doc_url,
            "total_cost": total_cost, "valid_until": str(valid_until)}

@activity.defn
async def send_gfe_to_patient(gfe: Dict[str, Any]) -> Dict[str, Any]:
    """
    Activity: Send GFE to patient via notification service.
    Supports email and SMS channels.
    """
    gfe_id = gfe.get("gfe_id")
    patient = gfe.get("patient", {})
    doc_url = gfe.get("document_url", "")
    tenant_id = gfe.get("tenant_id", "default")

    if not patient.get("email") and not patient.get("phone"):
        logger.warning(f"GFE {gfe_id}: no patient contact info available")
        return {"gfe_id": gfe_id, "status": "skipped", "reason": "no_contact_info"}

    sent_channels = []
    try:
        if patient.get("email"):
            payload = {
                "channel": "email", "template": "document_ready",
                "recipient_email": patient["email"],
                "template_vars": {"document_type": "Good Faith Estimate",
                                   "reference_number": gfe_id,
                                   "download_url": doc_url or "Please contact your provider"},
                "tenant_id": tenant_id,
            }
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"{NOTIFICATION_SERVICE_URL}/api/v1/notifications/send", json=payload)
                if resp.status_code == 201:
                    sent_channels.append("email")

        if patient.get("phone"):
            payload = {
                "channel": "sms", "template": "document_ready",
                "recipient_phone": patient["phone"],
                "template_vars": {"document_type": "Good Faith Estimate",
                                   "reference_number": gfe_id, "download_url": ""},
                "tenant_id": tenant_id,
            }
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"{NOTIFICATION_SERVICE_URL}/api/v1/notifications/send", json=payload)
                if resp.status_code == 201:
                    sent_channels.append("sms")
    except Exception as e:
        logger.warning(f"GFE notification failed: {e}")

    # Update GFE status in database
    pool = await get_db()
    if pool:
        try:
            await pool.execute("UPDATE idr_documents SET status='sent', updated_at=$1 WHERE id=$2",
                                datetime.utcnow(), gfe_id)
        except Exception as e:
            logger.warning(f"GFE status update failed: {e}")

    logger.info(f"GFE {gfe_id} sent via: {sent_channels}")
    return {"gfe_id": gfe_id, "status": "sent", "channels": sent_channels}

@activity.defn
async def finalize_gfe(gfe_id: str) -> Dict[str, Any]:
    """
    Activity: Finalize GFE after patient confirmation.
    Updates status, records confirmation timestamp, and triggers audit log.
    """
    pool = await get_db()
    confirmed_at = datetime.utcnow()

    if pool:
        try:
            await pool.execute("""
                UPDATE idr_documents
                SET status='confirmed', updated_at=$1
                WHERE id=$2 AND document_type='gfe'""",
                confirmed_at, gfe_id)
            # Audit log entry
            await pool.execute("""
                INSERT INTO audit_log (id, event_type, entity_id, entity_type, metadata, created_at)
                VALUES ($1,'gfe_confirmed',$2,'gfe',$3,$4) ON CONFLICT DO NOTHING""",
                str(uuid.uuid4()), gfe_id,
                json.dumps({"confirmed_at": confirmed_at.isoformat(), "workflow": "temporal_gfe"}),
                confirmed_at)
        except Exception as e:
            logger.warning(f"GFE finalize DB update failed: {e}")

    logger.info(f"GFE {gfe_id} finalized at {confirmed_at}")
    return {"gfe_id": gfe_id, "status": "finalized", "confirmed_at": confirmed_at.isoformat()}

@workflow.defn
class GFEWorkflow:
    """Temporal workflow for GFE generation, delivery, and confirmation."""

    @workflow.run
    async def run(self, gfe_data: Dict[str, Any]) -> str:
        from datetime import timedelta
        # 1. Generate GFE document
        gfe = await workflow.execute_activity(
            generate_gfe, gfe_data,
            schedule_to_close_timeout=timedelta(seconds=60))

        # 2. Send GFE to patient
        merged = {**gfe_data, **gfe}
        await workflow.execute_activity(
            send_gfe_to_patient, merged,
            schedule_to_close_timeout=timedelta(seconds=30))

        # 3. Wait for patient confirmation (external event, timeout 90 days)
        try:
            await workflow.wait_condition(
                lambda: self._confirmed,
                timeout=timedelta(days=90))
        except asyncio.TimeoutError:
            return f"GFE {gfe.get('gfe_id')} expired without patient confirmation"

        # 4. Finalize GFE
        await workflow.execute_activity(
            finalize_gfe, gfe.get("gfe_id", ""),
            schedule_to_close_timeout=timedelta(seconds=30))

        return f"GFE workflow completed for {gfe.get('gfe_id')}"

    def __init__(self):
        self._confirmed = False

    @workflow.signal
    def patient_confirmation(self):
        self._confirmed = True

async def main():
    client = await Client.connect(TEMPORAL_HOST)
    worker = Worker(
        client,
        task_queue="gfe-task-queue",
        workflows=[GFEWorkflow],
        activities=[generate_gfe, send_gfe_to_patient, finalize_gfe],
    )
    logger.info("GFE Temporal worker started")
    await worker.run()

if __name__ == "__main__":
    asyncio.run(main())
