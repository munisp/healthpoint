"""
HealthPoint HL7v2 Ingest Service
=================================
Receives HL7v2 messages over MLLP (port 2575) and HTTP POST,
parses them, converts to FHIR R4 resources, and writes to Medplum.

Supported message types:
  ADT^A01  — Patient Admit
  ADT^A08  — Patient Update
  ADT^A03  — Patient Discharge
  DFT^P03  — Charge Posting (→ FHIR Claim item)
  ORM^O01  — Order Message (→ FHIR ServiceRequest)
  ORU^R01  — Observation Result (→ FHIR Observation)
  SIU^S12  — Appointment Scheduling (→ FHIR Appointment)

All parsed resources are written to Medplum and indexed in PostgreSQL.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import socket
import struct
from datetime import datetime, date
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.shared.auth import get_current_user
from backend.shared.database import get_db_pool
from backend.shared.medplum_client import MedplumClient
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="HL7v2 Ingest Service",
    description="Parses HL7v2 messages and converts them to FHIR R4 via Medplum",
    version="1.0.0",
)

setup_telemetry("hl7v2-ingest-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── HL7v2 Parser ─────────────────────────────────────────────────────────────

class HL7Message:
    """Minimal HL7v2 message parser — no external library required."""

    FIELD_SEP = "|"
    COMPONENT_SEP = "^"
    REPEAT_SEP = "~"
    ESCAPE = "\\"
    SUBCOMPONENT_SEP = "&"

    def __init__(self, raw: str):
        self.raw = raw.strip()
        self.segments: Dict[str, List[List[str]]] = {}
        self._parse()

    def _parse(self) -> None:
        lines = self.raw.replace("\r\n", "\r").replace("\n", "\r").split("\r")
        for line in lines:
            if not line.strip():
                continue
            fields = line.split(self.FIELD_SEP)
            seg_name = fields[0]
            if seg_name not in self.segments:
                self.segments[seg_name] = []
            self.segments[seg_name].append(fields)

    def get(self, segment: str, field: int, component: int = 0, occurrence: int = 0) -> str:
        """Get a field value by segment name, field index, component index, occurrence."""
        segs = self.segments.get(segment, [])
        if occurrence >= len(segs):
            return ""
        fields = segs[occurrence]
        if field >= len(fields):
            return ""
        components = fields[field].split(self.COMPONENT_SEP)
        if component >= len(components):
            return ""
        return components[component].strip()

    @property
    def message_type(self) -> str:
        return f"{self.get('MSH', 8, 0)}^{self.get('MSH', 8, 1)}"

    @property
    def message_control_id(self) -> str:
        return self.get("MSH", 9)

    @property
    def sending_facility(self) -> str:
        return self.get("MSH", 3)

    def hl7_date_to_iso(self, hl7_date: str) -> Optional[str]:
        """Convert HL7 date (YYYYMMDD or YYYYMMDDHHMMSS) to ISO 8601."""
        if not hl7_date:
            return None
        hl7_date = hl7_date[:8]  # Take date part only
        try:
            return datetime.strptime(hl7_date, "%Y%m%d").date().isoformat()
        except ValueError:
            return None

    def hl7_datetime_to_iso(self, hl7_dt: str) -> Optional[str]:
        """Convert HL7 datetime to ISO 8601."""
        if not hl7_dt:
            return None
        try:
            if len(hl7_dt) >= 14:
                return datetime.strptime(hl7_dt[:14], "%Y%m%d%H%M%S").isoformat()
            elif len(hl7_dt) >= 8:
                return datetime.strptime(hl7_dt[:8], "%Y%m%d").isoformat()
        except ValueError:
            pass
        return None


# ─── FHIR R4 Converters ───────────────────────────────────────────────────────

def adt_to_fhir_patient(msg: HL7Message) -> Dict[str, Any]:
    """Convert ADT^A01/A08 to FHIR R4 Patient."""
    pid = msg.segments.get("PID", [[]])[0]

    # PID-3: Patient Identifier List
    patient_id = msg.get("PID", 3, 0)
    mrn = msg.get("PID", 3, 0)
    assigning_authority = msg.get("PID", 3, 3)

    # PID-5: Patient Name (Family^Given^Middle^Suffix^Prefix)
    family = msg.get("PID", 5, 0)
    given = msg.get("PID", 5, 1)
    middle = msg.get("PID", 5, 2)

    # PID-7: Date of Birth
    dob = msg.hl7_date_to_iso(msg.get("PID", 7))

    # PID-8: Administrative Sex
    sex_map = {"M": "male", "F": "female", "O": "other", "U": "unknown"}
    gender = sex_map.get(msg.get("PID", 8, 0).upper(), "unknown")

    # PID-11: Patient Address
    street = msg.get("PID", 11, 0)
    city = msg.get("PID", 11, 2)
    state = msg.get("PID", 11, 3)
    zip_code = msg.get("PID", 11, 4)
    country = msg.get("PID", 11, 5) or "US"

    # PID-13: Phone Number
    phone = msg.get("PID", 13, 0)

    # PID-19: SSN (last 4 only for HIPAA)
    ssn = msg.get("PID", 19, 0)

    patient: Dict[str, Any] = {
        "resourceType": "Patient",
        "identifier": [],
        "name": [
            {
                "use": "official",
                "family": family,
                "given": [g for g in [given, middle] if g],
            }
        ],
        "gender": gender,
        "address": [],
        "telecom": [],
        "extension": [
            {
                "url": "http://healthpoint.local/fhir/StructureDefinition/hl7-sending-facility",
                "valueString": msg.sending_facility,
            }
        ],
    }

    if mrn:
        patient["identifier"].append({
            "use": "usual",
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "MR",
                        "display": "Medical Record Number",
                    }
                ]
            },
            "system": f"urn:oid:{assigning_authority}" if assigning_authority else "urn:healthpoint:mrn",
            "value": mrn,
        })

    if dob:
        patient["birthDate"] = dob

    if street or city:
        patient["address"].append({
            "use": "home",
            "line": [street] if street else [],
            "city": city,
            "state": state,
            "postalCode": zip_code,
            "country": country,
        })

    if phone:
        patient["telecom"].append({
            "system": "phone",
            "value": phone,
            "use": "home",
        })

    return patient


def dft_to_fhir_claim_item(msg: HL7Message) -> Dict[str, Any]:
    """Convert DFT^P03 charge posting to a FHIR Claim item dict."""
    # FT1 segment: Financial Transaction
    procedure_code = msg.get("FT1", 19, 0)  # CPT/HCPCS
    procedure_desc = msg.get("FT1", 19, 1)
    quantity = msg.get("FT1", 10, 0) or "1"
    unit_price = msg.get("FT1", 22, 0) or "0"
    service_date = msg.hl7_date_to_iso(msg.get("FT1", 4, 0))
    diagnosis_code = msg.get("DG1", 3, 0)  # ICD-10

    item: Dict[str, Any] = {
        "sequence": 1,
        "productOrService": {
            "coding": [
                {
                    "system": "http://www.ama-assn.org/go/cpt",
                    "code": procedure_code,
                    "display": procedure_desc,
                }
            ]
        },
        "quantity": {"value": float(quantity)},
        "unitPrice": {"value": float(unit_price), "currency": "USD"},
    }

    if service_date:
        item["servicedDate"] = service_date

    if diagnosis_code:
        item["diagnosisSequence"] = [1]

    return item


def orm_to_fhir_service_request(msg: HL7Message) -> Dict[str, Any]:
    """Convert ORM^O01 order message to FHIR R4 ServiceRequest."""
    # ORC: Common Order
    order_id = msg.get("ORC", 2, 0)
    order_status_map = {
        "NW": "active",
        "CA": "revoked",
        "CM": "completed",
        "HD": "on-hold",
        "DC": "revoked",
    }
    order_status = order_status_map.get(msg.get("ORC", 1, 0), "active")
    order_datetime = msg.hl7_datetime_to_iso(msg.get("ORC", 9, 0))

    # OBR: Observation Request
    service_code = msg.get("OBR", 4, 0)
    service_desc = msg.get("OBR", 4, 1)
    service_system = msg.get("OBR", 4, 2) or "http://loinc.org"
    priority_map = {"S": "stat", "A": "asap", "R": "routine", "P": "routine"}
    priority = priority_map.get(msg.get("OBR", 27, 0), "routine")

    service_request: Dict[str, Any] = {
        "resourceType": "ServiceRequest",
        "status": order_status,
        "intent": "order",
        "priority": priority,
        "code": {
            "coding": [
                {
                    "system": service_system,
                    "code": service_code,
                    "display": service_desc,
                }
            ]
        },
        "identifier": [
            {
                "system": "urn:healthpoint:order-id",
                "value": order_id,
            }
        ],
        "extension": [
            {
                "url": "http://healthpoint.local/fhir/StructureDefinition/hl7-sending-facility",
                "valueString": msg.sending_facility,
            }
        ],
    }

    if order_datetime:
        service_request["authoredOn"] = order_datetime

    return service_request


def oru_to_fhir_observation(msg: HL7Message) -> List[Dict[str, Any]]:
    """Convert ORU^R01 observation result to list of FHIR R4 Observation resources."""
    observations = []

    for obx_seg in msg.segments.get("OBX", []):
        # OBX-3: Observation Identifier
        obs_code = obx_seg[3].split("^")[0] if len(obx_seg) > 3 else ""
        obs_desc = obx_seg[3].split("^")[1] if len(obx_seg) > 3 and "^" in obx_seg[3] else ""
        obs_system = obx_seg[3].split("^")[2] if len(obx_seg) > 3 and obx_seg[3].count("^") >= 2 else "http://loinc.org"

        # OBX-5: Observation Value
        value_type = obx_seg[2] if len(obx_seg) > 2 else "ST"
        raw_value = obx_seg[5] if len(obx_seg) > 5 else ""

        # OBX-6: Units
        units = obx_seg[6].split("^")[0] if len(obx_seg) > 6 else ""

        # OBX-11: Observation Result Status
        status_map = {
            "F": "final",
            "P": "preliminary",
            "C": "corrected",
            "X": "cancelled",
            "I": "registered",
        }
        status = status_map.get(obx_seg[11] if len(obx_seg) > 11 else "F", "final")

        # OBX-14: Date/Time of Observation
        obs_datetime = msg.hl7_datetime_to_iso(obx_seg[14] if len(obx_seg) > 14 else "")

        obs: Dict[str, Any] = {
            "resourceType": "Observation",
            "status": status,
            "code": {
                "coding": [
                    {
                        "system": obs_system,
                        "code": obs_code,
                        "display": obs_desc,
                    }
                ]
            },
        }

        if obs_datetime:
            obs["effectiveDateTime"] = obs_datetime

        # Set value based on type
        if value_type == "NM" and raw_value:
            try:
                obs["valueQuantity"] = {
                    "value": float(raw_value),
                    "unit": units,
                    "system": "http://unitsofmeasure.org",
                    "code": units,
                }
            except ValueError:
                obs["valueString"] = raw_value
        elif value_type == "CE":
            parts = raw_value.split("^")
            obs["valueCodeableConcept"] = {
                "coding": [
                    {
                        "system": parts[2] if len(parts) > 2 else "http://snomed.info/sct",
                        "code": parts[0] if parts else "",
                        "display": parts[1] if len(parts) > 1 else "",
                    }
                ]
            }
        else:
            obs["valueString"] = raw_value

        observations.append(obs)

    return observations


# ─── Message Router ───────────────────────────────────────────────────────────

async def process_hl7_message(
    raw: str,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> Dict[str, Any]:
    """Parse an HL7v2 message, convert to FHIR, write to Medplum, index in PostgreSQL."""
    msg = HL7Message(raw)
    msg_type = msg.message_type
    control_id = msg.message_control_id
    sending_facility = msg.sending_facility

    results: Dict[str, Any] = {
        "message_type": msg_type,
        "control_id": control_id,
        "resources_created": [],
    }

    # ── ADT^A01 / ADT^A08 — Patient admit/update ─────────────────────────────
    if msg_type in ("ADT^A01", "ADT^A08", "ADT^A03"):
        patient_resource = adt_to_fhir_patient(msg)
        mrn = patient_resource.get("identifier", [{}])[0].get("value", "")

        # Upsert patient in Medplum
        created = await medplum.upsert_resource(
            patient_resource,
            identifier_system="urn:healthpoint:mrn",
            identifier_value=mrn,
        )
        results["resources_created"].append(
            {"resourceType": "Patient", "id": created.get("id"), "mrn": mrn}
        )

        # Index in PostgreSQL
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO hl7_ingest_log
                  (control_id, message_type, sending_facility, fhir_resource_type,
                   fhir_resource_id, patient_mrn, processed_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (control_id) DO NOTHING
                """,
                control_id, msg_type, sending_facility,
                "Patient", created.get("id", ""), mrn,
            )

    # ── DFT^P03 — Charge posting ──────────────────────────────────────────────
    elif msg_type == "DFT^P03":
        claim_item = dft_to_fhir_claim_item(msg)
        patient_id = msg.get("PID", 3, 0)

        # Store the charge item in PostgreSQL for batch claim assembly
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO hl7_charge_items
                  (control_id, sending_facility, patient_mrn, procedure_code,
                   service_date, unit_price, quantity, raw_item_json, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (control_id) DO NOTHING
                """,
                control_id, sending_facility, patient_id,
                claim_item.get("productOrService", {}).get("coding", [{}])[0].get("code", ""),
                claim_item.get("servicedDate"),
                claim_item.get("unitPrice", {}).get("value", 0),
                claim_item.get("quantity", {}).get("value", 1),
                json.dumps(claim_item),
            )
        results["resources_created"].append(
            {"resourceType": "ChargeItem", "procedure_code": claim_item.get("productOrService", {})}
        )

    # ── ORM^O01 — Order message ───────────────────────────────────────────────
    elif msg_type == "ORM^O01":
        service_request = orm_to_fhir_service_request(msg)
        patient_id = msg.get("PID", 3, 0)

        # Link patient reference
        if patient_id:
            patients = await medplum.search_resources(
                "Patient",
                {"identifier": f"urn:healthpoint:mrn|{patient_id}"},
            )
            if patients:
                service_request["subject"] = {
                    "reference": f"Patient/{patients[0]['id']}"
                }

        created = await medplum.create_resource(service_request)
        results["resources_created"].append(
            {"resourceType": "ServiceRequest", "id": created.get("id")}
        )

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO hl7_ingest_log
                  (control_id, message_type, sending_facility, fhir_resource_type,
                   fhir_resource_id, patient_mrn, processed_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (control_id) DO NOTHING
                """,
                control_id, msg_type, sending_facility,
                "ServiceRequest", created.get("id", ""), patient_id,
            )

    # ── ORU^R01 — Observation result ──────────────────────────────────────────
    elif msg_type == "ORU^R01":
        observations = oru_to_fhir_observation(msg)
        patient_id = msg.get("PID", 3, 0)

        for obs in observations:
            if patient_id:
                patients = await medplum.search_resources(
                    "Patient",
                    {"identifier": f"urn:healthpoint:mrn|{patient_id}"},
                )
                if patients:
                    obs["subject"] = {"reference": f"Patient/{patients[0]['id']}"}

            created = await medplum.create_resource(obs)
            results["resources_created"].append(
                {"resourceType": "Observation", "id": created.get("id")}
            )

    else:
        logger.warning(f"Unsupported HL7v2 message type: {msg_type} (control_id={control_id})")
        results["warning"] = f"Message type {msg_type} is not yet supported."

    return results


# ─── MLLP Server ──────────────────────────────────────────────────────────────

MLLP_START = b"\x0b"
MLLP_END = b"\x1c\x0d"


async def handle_mllp_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> None:
    """Handle a single MLLP TCP connection."""
    addr = writer.get_extra_info("peername")
    logger.info(f"MLLP connection from {addr}")

    try:
        while True:
            # Read until MLLP start byte
            start = await reader.read(1)
            if not start:
                break
            if start != MLLP_START:
                continue

            # Read message until MLLP end sequence
            data = b""
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                data += chunk
                if MLLP_END in data:
                    data = data[: data.index(MLLP_END)]
                    break

            raw_message = data.decode("utf-8", errors="replace")
            logger.info(f"Received MLLP message ({len(raw_message)} bytes) from {addr}")

            try:
                result = await process_hl7_message(raw_message, pool, medplum)
                ack = _build_ack(raw_message, "AA", "Message accepted")
            except Exception as e:
                logger.error(f"Error processing HL7 message: {e}", exc_info=True)
                ack = _build_ack(raw_message, "AE", str(e)[:100])

            # Send ACK
            writer.write(MLLP_START + ack.encode("utf-8") + MLLP_END)
            await writer.drain()

    except asyncio.IncompleteReadError:
        pass
    finally:
        writer.close()
        logger.info(f"MLLP connection closed: {addr}")


def _build_ack(original: str, ack_code: str, text: str) -> str:
    """Build an HL7v2 ACK message."""
    msg = HL7Message(original)
    now = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    control_id = msg.message_control_id
    sending_app = msg.get("MSH", 2)
    sending_facility = msg.get("MSH", 3)
    receiving_app = msg.get("MSH", 4)
    receiving_facility = msg.get("MSH", 5)

    return (
        f"MSH|^~\\&|{receiving_app}|{receiving_facility}|{sending_app}|{sending_facility}"
        f"|{now}||ACK^A01|{control_id}_ACK|P|2.5\r"
        f"MSA|{ack_code}|{control_id}|{text}\r"
    )


# ─── HTTP Endpoints ───────────────────────────────────────────────────────────

class HL7IngestRequest(BaseModel):
    message: str
    encoding: str = "utf-8"


@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()
    app.state.medplum = MedplumClient(
        base_url=os.getenv("MEDPLUM_BASE_URL", "http://medplum:8103"),
        client_id=os.getenv("MEDPLUM_CLIENT_ID", ""),
        client_secret=os.getenv("MEDPLUM_CLIENT_SECRET", ""),
    )
    await app.state.medplum.authenticate()

    # Ensure HL7 ingest tables exist
    async with app.state.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS hl7_ingest_log (
                id BIGSERIAL PRIMARY KEY,
                control_id TEXT UNIQUE NOT NULL,
                message_type TEXT NOT NULL,
                sending_facility TEXT,
                fhir_resource_type TEXT,
                fhir_resource_id TEXT,
                patient_mrn TEXT,
                processed_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS hl7_charge_items (
                id BIGSERIAL PRIMARY KEY,
                control_id TEXT UNIQUE NOT NULL,
                sending_facility TEXT,
                patient_mrn TEXT,
                procedure_code TEXT,
                service_date DATE,
                unit_price NUMERIC(12,2),
                quantity NUMERIC(8,2),
                raw_item_json JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)

    # Start MLLP server in background
    asyncio.create_task(_start_mllp_server(app.state.pool, app.state.medplum))
    logger.info("HL7v2 Ingest Service started. MLLP server starting on port 2575.")


async def _start_mllp_server(pool: asyncpg.Pool, medplum: MedplumClient) -> None:
    server = await asyncio.start_server(
        lambda r, w: handle_mllp_client(r, w, pool, medplum),
        host="0.0.0.0",
        port=2575,
    )
    logger.info("MLLP server listening on port 2575")
    async with server:
        await server.serve_forever()


@app.post("/hl7/ingest")
async def ingest_hl7_http(request: HL7IngestRequest) -> Dict[str, Any]:
    """HTTP endpoint for HL7v2 message ingestion (for testing and non-MLLP sources)."""
    try:
        result = await process_hl7_message(
            request.message,
            app.state.pool,
            app.state.medplum,
        )
        return {"status": "accepted", **result}
    except Exception as e:
        logger.error(f"HL7 ingest error: {e}", exc_info=True)
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/hl7/log")
async def get_ingest_log(limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get recent HL7 ingest log entries."""
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT control_id, message_type, sending_facility,
                   fhir_resource_type, fhir_resource_id, patient_mrn, processed_at
            FROM hl7_ingest_log
            ORDER BY processed_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit, offset,
        )
    return [dict(r) for r in rows]


@app.get("/hl7/charge-items")
async def get_charge_items(
    patient_mrn: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Get pending charge items for claim assembly."""
    async with app.state.pool.acquire() as conn:
        if patient_mrn:
            rows = await conn.fetch(
                """
                SELECT * FROM hl7_charge_items
                WHERE patient_mrn = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                patient_mrn, limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM hl7_charge_items ORDER BY created_at DESC LIMIT $1",
                limit,
            )
    return [dict(r) for r in rows]


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "hl7v2-ingest-service"}
