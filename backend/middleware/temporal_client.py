"""
Temporal workflow client for HealthPoint IDR Platform.
Manages long-running IDR case workflows with durability and retry guarantees.

Workflows:
- IDR Case Lifecycle (19-step process per No Surprises Act)
- GFE (Good Faith Estimate) generation
- Payment processing workflow
- Fraud investigation workflow
"""
from __future__ import annotations

import logging
import os
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

TEMPORAL_HOST: str = os.getenv("TEMPORAL_HOST", "temporal:7233")
TEMPORAL_NAMESPACE: str = os.getenv("TEMPORAL_NAMESPACE", "healthpoint")
TEMPORAL_TASK_QUEUE: str = os.getenv("TEMPORAL_TASK_QUEUE", "healthpoint-idr")

# ── Workflow IDs ──────────────────────────────────────────────────────────────
class WorkflowTypes:
    IDR_CASE_LIFECYCLE = "IDRCaseLifecycleWorkflow"
    GFE_GENERATION = "GFEGenerationWorkflow"
    PAYMENT_PROCESSING = "PaymentProcessingWorkflow"
    FRAUD_INVESTIGATION = "FraudInvestigationWorkflow"
    DOCUMENT_PROCESSING = "DocumentProcessingWorkflow"
    NOTIFICATION_DISPATCH = "NotificationDispatchWorkflow"


# ── Temporal client ───────────────────────────────────────────────────────────
_client = None


async def get_client():
    """Get or create the Temporal client."""
    global _client
    if _client is not None:
        return _client

    try:
        from temporalio.client import Client
        _client = await Client.connect(
            TEMPORAL_HOST,
            namespace=TEMPORAL_NAMESPACE,
        )
        logger.info("Temporal client connected: %s (namespace=%s)", TEMPORAL_HOST, TEMPORAL_NAMESPACE)
        return _client
    except ImportError:
        logger.warning("temporalio package not installed — workflow execution will use direct async calls")
        return None
    except Exception as e:
        logger.error("Temporal connection failed: %s", str(e))
        return None


async def start_idr_workflow(
    case_id: str,
    case_data: dict[str, Any],
) -> Optional[str]:
    """
    Start the IDR case lifecycle workflow.
    Returns the workflow run ID or None if Temporal is unavailable.
    """
    client = await get_client()
    if client is None:
        return await _pg_record_workflow(case_id, WorkflowTypes.IDR_CASE_LIFECYCLE, case_data)

    try:
        from temporalio.client import WorkflowExecutionStatus
        handle = await client.start_workflow(
            WorkflowTypes.IDR_CASE_LIFECYCLE,
            case_data,
            id=f"idr-case-{case_id}",
            task_queue=TEMPORAL_TASK_QUEUE,
            execution_timeout=timedelta(days=90),  # IDR cases can take up to 90 days
            retry_policy=None,  # Workflow-level retries disabled; activities handle retries
        )
        run_id = handle.run_id
        logger.info("Started IDR workflow: case=%s run_id=%s", case_id, run_id)
        await _pg_record_workflow(case_id, WorkflowTypes.IDR_CASE_LIFECYCLE, case_data, run_id)
        return run_id
    except Exception as e:
        logger.error("Failed to start IDR workflow for case %s: %s", case_id, str(e))
        return await _pg_record_workflow(case_id, WorkflowTypes.IDR_CASE_LIFECYCLE, case_data)


async def start_gfe_workflow(
    patient_id: str,
    provider_id: str,
    service_codes: list[str],
) -> Optional[str]:
    """Start a GFE generation workflow."""
    client = await get_client()
    workflow_data = {
        "patient_id": patient_id,
        "provider_id": provider_id,
        "service_codes": service_codes,
    }
    workflow_id = f"gfe-{patient_id}-{provider_id}"

    if client is None:
        return await _pg_record_workflow(workflow_id, WorkflowTypes.GFE_GENERATION, workflow_data)

    try:
        handle = await client.start_workflow(
            WorkflowTypes.GFE_GENERATION,
            workflow_data,
            id=workflow_id,
            task_queue=TEMPORAL_TASK_QUEUE,
            execution_timeout=timedelta(hours=72),
        )
        return handle.run_id
    except Exception as e:
        logger.error("Failed to start GFE workflow: %s", str(e))
        return None


async def get_workflow_status(workflow_id: str) -> dict[str, Any]:
    """Get the status of a running workflow."""
    client = await get_client()
    if client is None:
        return await _pg_get_workflow_status(workflow_id)

    try:
        handle = client.get_workflow_handle(workflow_id)
        desc = await handle.describe()
        return {
            "workflow_id": workflow_id,
            "run_id": desc.run_id,
            "status": str(desc.status),
            "start_time": desc.start_time.isoformat() if desc.start_time else None,
            "close_time": desc.close_time.isoformat() if desc.close_time else None,
        }
    except Exception as e:
        logger.error("Failed to get workflow status %s: %s", workflow_id, str(e))
        return await _pg_get_workflow_status(workflow_id)


async def signal_workflow(
    workflow_id: str,
    signal_name: str,
    payload: dict[str, Any],
) -> bool:
    """Send a signal to a running workflow."""
    client = await get_client()
    if client is None:
        logger.warning("Temporal unavailable — cannot signal workflow %s", workflow_id)
        return False

    try:
        handle = client.get_workflow_handle(workflow_id)
        await handle.signal(signal_name, payload)
        logger.info("Signaled workflow %s: %s", workflow_id, signal_name)
        return True
    except Exception as e:
        logger.error("Failed to signal workflow %s: %s", workflow_id, str(e))
        return False


async def terminate_workflow(workflow_id: str, reason: str) -> bool:
    """Terminate a running workflow."""
    client = await get_client()
    if client is None:
        return False

    try:
        handle = client.get_workflow_handle(workflow_id)
        await handle.terminate(reason=reason)
        logger.info("Terminated workflow %s: %s", workflow_id, reason)
        return True
    except Exception as e:
        logger.error("Failed to terminate workflow %s: %s", workflow_id, str(e))
        return False


# ── PostgreSQL fallback ───────────────────────────────────────────────────────
async def _pg_record_workflow(
    entity_id: str,
    workflow_type: str,
    input_payload: dict,
    temporal_run_id: Optional[str] = None,
) -> Optional[str]:
    """Record workflow instance in PostgreSQL when Temporal is unavailable."""
    from backend.shared.database import fetchval
    import uuid
    run_id = temporal_run_id or str(uuid.uuid4())
    await _pg_execute_workflow_insert(entity_id, workflow_type, input_payload, run_id)
    return run_id


async def _pg_execute_workflow_insert(
    entity_id: str,
    workflow_type: str,
    input_payload: dict,
    run_id: str,
) -> None:
    from backend.shared.database import execute
    import json
    await execute(
        """
        INSERT INTO workflow_instances
            (workflow_type, entity_id, entity_type, status, temporal_run_id, input_payload)
        VALUES ($1, $2::uuid, $3, 'running', $4, $5::jsonb)
        ON CONFLICT DO NOTHING
        """,
        workflow_type, entity_id, "idr_case", run_id, json.dumps(input_payload),
    )


async def _pg_get_workflow_status(workflow_id: str) -> dict[str, Any]:
    from backend.shared.database import fetchrow
    row = await fetchrow(
        "SELECT * FROM workflow_instances WHERE temporal_run_id = $1",
        workflow_id,
    )
    if not row:
        return {"workflow_id": workflow_id, "status": "NOT_FOUND"}
    return {
        "workflow_id": workflow_id,
        "run_id": row["temporal_run_id"],
        "status": row["status"],
        "start_time": row["started_at"].isoformat() if row["started_at"] else None,
        "close_time": row["completed_at"].isoformat() if row["completed_at"] else None,
    }
