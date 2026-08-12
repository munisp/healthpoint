"""
HealthPoint FHIR Bulk Data Export Service ($export)
=====================================================
Implements the HL7 FHIR Bulk Data Access (SMART Backend Services) specification
for Group-level and Patient-level NDJSON export.

Spec: https://hl7.org/fhir/uv/bulkdata/export.html

Supported export types:
  - Patient/$export  — all resources for all patients
  - Group/{id}/$export — all resources for patients in a group
  - /fhir/$export    — system-level export

Resources exported: Patient, Coverage, Claim, ExplanationOfBenefit,
  Encounter, Condition, Procedure, MedicationRequest, Observation,
  DiagnosticReport, PaymentReconciliation, Task

Export files are written to S3 as NDJSON (one resource per line).
Status polling follows the async kick-off pattern per the spec.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg
import boto3
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.shared.database import get_db_pool
from backend.shared.auth import get_current_user
from backend.shared.medplum_client import MedplumClient
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FHIR Bulk Data Export Service",
    description="SMART Backend Services bulk export ($export) for payer data exchange",
    version="1.0.0",
)

setup_telemetry("fhir-bulk-export-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Prefer"],
)

S3_BUCKET = os.getenv("FHIR_EXPORT_S3_BUCKET", "healthpoint-fhir-exports")
S3_REGION = os.getenv("AWS_REGION", "us-east-1")
BASE_URL = os.getenv("FHIR_BASE_URL", "https://fhir.healthpoint.io")

EXPORTABLE_RESOURCES = [
    "Patient",
    "Coverage",
    "Claim",
    "ExplanationOfBenefit",
    "Encounter",
    "Condition",
    "Procedure",
    "MedicationRequest",
    "Observation",
    "DiagnosticReport",
    "PaymentReconciliation",
    "Task",
]


# ─── Models ───────────────────────────────────────────────────────────────────

class ExportJobStatus(BaseModel):
    job_id: str
    status: str  # "accepted", "in-progress", "completed", "failed"
    export_type: str
    resource_types: List[str]
    since: Optional[str]
    created_at: str
    completed_at: Optional[str]
    output_files: List[Dict[str, Any]]
    error_files: List[Dict[str, Any]]
    request_url: str


# ─── S3 Helpers ───────────────────────────────────────────────────────────────

def get_s3_client():
    return boto3.client("s3", region_name=S3_REGION)


def s3_presigned_url(key: str, expires: int = 3600) -> str:
    s3 = get_s3_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def s3_put_ndjson(key: str, lines: List[str]) -> str:
    """Write NDJSON lines to S3 and return the key."""
    s3 = get_s3_client()
    body = "\n".join(lines) + "\n"
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType="application/fhir+ndjson",
    )
    return key


# ─── Export Worker ────────────────────────────────────────────────────────────

async def run_export_job(
    job_id: str,
    export_type: str,
    group_id: Optional[str],
    resource_types: List[str],
    since: Optional[str],
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> None:
    """
    Background task: fetch resources from Medplum, write NDJSON to S3,
    update job status in PostgreSQL.
    """
    output_files: List[Dict[str, Any]] = []
    error_files: List[Dict[str, Any]] = []

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE fhir_export_jobs SET status = 'in-progress', updated_at = NOW() WHERE id = $1",
                job_id,
            )

        for resource_type in resource_types:
            try:
                # Build search params
                search_params: Dict[str, str] = {}
                if since:
                    search_params["_lastUpdated"] = f"ge{since}"
                if export_type == "group" and group_id:
                    # For group export, get patient IDs in the group first
                    group = await medplum.read_resource("Group", group_id)
                    member_ids = [
                        m["entity"]["reference"].split("/")[-1]
                        for m in group.get("member", [])
                        if "entity" in m
                    ]
                    if not member_ids:
                        continue
                    search_params["patient"] = ",".join(
                        [f"Patient/{pid}" for pid in member_ids]
                    )

                # Fetch all pages from Medplum
                all_resources: List[Dict[str, Any]] = []
                next_url: Optional[str] = None
                page_count = 0

                while True:
                    if next_url:
                        bundle = await medplum._request("GET", next_url)
                    else:
                        bundle = await medplum.search_resources(
                            resource_type,
                            {**search_params, "_count": "200"},
                        )

                    entries = bundle.get("entry", [])
                    for entry in entries:
                        resource = entry.get("resource")
                        if resource:
                            all_resources.append(resource)

                    # Follow pagination
                    next_url = None
                    for link in bundle.get("link", []):
                        if link.get("relation") == "next":
                            next_url = link["url"]
                            break

                    page_count += 1
                    if not next_url or page_count > 1000:
                        break

                if not all_resources:
                    continue

                # Write NDJSON to S3
                ndjson_lines = [json.dumps(r) for r in all_resources]
                s3_key = f"exports/{job_id}/{resource_type}.ndjson"
                s3_put_ndjson(s3_key, ndjson_lines)

                output_files.append({
                    "type": resource_type,
                    "url": s3_presigned_url(s3_key),
                    "count": len(all_resources),
                })

                logger.info(
                    f"Export job {job_id}: wrote {len(all_resources)} "
                    f"{resource_type} resources to S3"
                )

            except Exception as resource_err:
                logger.error(
                    f"Export job {job_id}: error exporting {resource_type}: {resource_err}"
                )
                error_key = f"exports/{job_id}/{resource_type}-errors.ndjson"
                error_line = json.dumps({
                    "resourceType": "OperationOutcome",
                    "issue": [{
                        "severity": "error",
                        "code": "exception",
                        "diagnostics": str(resource_err),
                    }],
                })
                s3_put_ndjson(error_key, [error_line])
                error_files.append({
                    "type": resource_type,
                    "url": s3_presigned_url(error_key),
                })

        # Mark job complete
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE fhir_export_jobs
                SET status = 'completed',
                    output_files = $1,
                    error_files = $2,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $3
                """,
                json.dumps(output_files),
                json.dumps(error_files),
                job_id,
            )

        logger.info(f"Export job {job_id} completed: {len(output_files)} files.")

    except Exception as err:
        logger.error(f"Export job {job_id} failed: {err}")
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE fhir_export_jobs
                SET status = 'failed',
                    error_message = $1,
                    updated_at = NOW()
                WHERE id = $2
                """,
                str(err),
                job_id,
            )


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/fhir/Patient/\$export")
async def patient_export(
    request: Request,
    background_tasks: BackgroundTasks,
    _type: Optional[str] = None,
    _since: Optional[str] = None,
    current_user: Dict = Depends(get_current_user),
) -> Response:
    """Kick off a Patient-level bulk export."""
    return await _kick_off_export(
        request, background_tasks, "patient", None, _type, _since
    )


@app.get("/fhir/Group/{group_id}/\$export")
async def group_export(
    group_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    _type: Optional[str] = None,
    _since: Optional[str] = None,
    current_user: Dict = Depends(get_current_user),
) -> Response:
    """Kick off a Group-level bulk export."""
    return await _kick_off_export(
        request, background_tasks, "group", group_id, _type, _since
    )


@app.get("/fhir/\$export")
async def system_export(
    request: Request,
    background_tasks: BackgroundTasks,
    _type: Optional[str] = None,
    _since: Optional[str] = None,
    current_user: Dict = Depends(get_current_user),
) -> Response:
    """Kick off a system-level bulk export."""
    return await _kick_off_export(
        request, background_tasks, "system", None, _type, _since
    )


async def _kick_off_export(
    request: Request,
    background_tasks: BackgroundTasks,
    export_type: str,
    group_id: Optional[str],
    _type: Optional[str],
    _since: Optional[str],
) -> Response:
    """Common kick-off logic for all export types."""
    # Validate Accept header per spec
    accept = request.headers.get("Accept", "application/fhir+json")
    if "application/fhir+json" not in accept and "*/*" not in accept:
        raise HTTPException(
            status_code=406,
            detail="Accept header must include application/fhir+json",
        )

    resource_types = (
        [r.strip() for r in _type.split(",")]
        if _type
        else EXPORTABLE_RESOURCES
    )

    # Validate requested resource types
    invalid = [r for r in resource_types if r not in EXPORTABLE_RESOURCES]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported resource types: {', '.join(invalid)}",
        )

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO fhir_export_jobs
              (id, status, export_type, group_id, resource_types, since,
               request_url, output_files, error_files, created_at, updated_at)
            VALUES ($1, 'accepted', $2, $3, $4, $5, $6, '[]', '[]', NOW(), NOW())
            """,
            job_id,
            export_type,
            group_id,
            json.dumps(resource_types),
            _since,
            str(request.url),
        )

    background_tasks.add_task(
        run_export_job,
        job_id,
        export_type,
        group_id,
        resource_types,
        _since,
        app.state.pool,
        app.state.medplum,
    )

    # Per spec: 202 Accepted with Content-Location header pointing to status URL
    status_url = f"{BASE_URL}/fhir/export/status/{job_id}"
    return Response(
        status_code=202,
        headers={
            "Content-Location": status_url,
            "X-Progress": "accepted",
        },
    )


@app.get("/fhir/export/status/{job_id}", response_model=ExportJobStatus)
async def get_export_status(
    job_id: str,
    current_user: Dict = Depends(get_current_user),
) -> Any:
    """Poll the status of a bulk export job."""
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, status, export_type, resource_types, since,
                   output_files, error_files, request_url,
                   created_at, completed_at, error_message
            FROM fhir_export_jobs WHERE id = $1
            """,
            job_id,
        )

    if not row:
        raise HTTPException(status_code=404, detail=f"Export job {job_id} not found.")

    job = dict(row)

    if job["status"] == "in-progress":
        # Per spec: 202 with X-Progress header while in progress
        return Response(
            status_code=202,
            headers={"X-Progress": "in-progress"},
        )

    if job["status"] == "failed":
        raise HTTPException(
            status_code=500,
            detail=job.get("error_message", "Export job failed."),
        )

    # Completed: return 200 with manifest
    output_files = json.loads(job["output_files"] or "[]")
    error_files = json.loads(job["error_files"] or "[]")
    resource_types = json.loads(job["resource_types"] or "[]")

    return ExportJobStatus(
        job_id=job_id,
        status=job["status"],
        export_type=job["export_type"],
        resource_types=resource_types,
        since=job["since"],
        created_at=job["created_at"].isoformat() if job["created_at"] else None,
        completed_at=job["completed_at"].isoformat() if job["completed_at"] else None,
        output_files=output_files,
        error_files=error_files,
        request_url=job["request_url"],
    )


@app.delete("/fhir/export/status/{job_id}")
async def cancel_export(
    job_id: str,
    current_user: Dict = Depends(get_current_user),
) -> Response:
    """Cancel a pending or in-progress export job (per spec: DELETE on status URL)."""
    async with app.state.pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE fhir_export_jobs
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND status IN ('accepted', 'in-progress')
            """,
            job_id,
        )
    if result == "UPDATE 0":
        raise HTTPException(
            status_code=404,
            detail=f"Export job {job_id} not found or already completed.",
        )
    return Response(status_code=202)


# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()
    app.state.medplum = MedplumClient(
        base_url=os.getenv("MEDPLUM_BASE_URL", "http://medplum:8103"),
        client_id=os.getenv("MEDPLUM_CLIENT_ID", ""),
        client_secret=os.getenv("MEDPLUM_CLIENT_SECRET", ""),
    )

    async with app.state.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS fhir_export_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'accepted',
                export_type TEXT NOT NULL,
                group_id TEXT,
                resource_types JSONB NOT NULL DEFAULT '[]',
                since TEXT,
                request_url TEXT,
                output_files JSONB NOT NULL DEFAULT '[]',
                error_files JSONB NOT NULL DEFAULT '[]',
                error_message TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_fhir_export_status
                ON fhir_export_jobs (status, created_at);
        """)

    logger.info("FHIR Bulk Data Export Service started.")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "fhir-bulk-export-service"}
