"""
HealthPoint SMART on FHIR Launch Context Handler
=================================================
Handles both EHR-launch and standalone-launch flows per the
SMART App Launch Framework v2.0 (https://hl7.org/fhir/smart-app-launch/).

Supported launch contexts:
  - EHR launch: patient, encounter, user, intent
  - Standalone launch: patient search, coverage verification
  - Scopes: launch/patient, launch/encounter, openid, fhirUser,
            patient/*.read, user/*.read, system/*.read

All OAuth state, tokens, and launch contexts are persisted to PostgreSQL.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse

from backend.shared.database import get_db_pool
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="SMART on FHIR Launch Service",
    description="SMART App Launch Framework v2.0 — EHR and standalone launch handler",
    version="1.0.0",
)

setup_telemetry("smart-launch-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── EMR SMART Configuration ──────────────────────────────────────────────────

EMR_CONFIGS: Dict[str, Dict[str, Any]] = {
    "epic": {
        "name": "Epic MyChart",
        "fhir_base_url": os.getenv("EPIC_FHIR_BASE_URL", "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"),
        "authorize_url": os.getenv("EPIC_AUTHORIZE_URL", "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize"),
        "token_url": os.getenv("EPIC_TOKEN_URL", "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"),
        "client_id": os.getenv("EPIC_CLIENT_ID", ""),
        "client_secret": os.getenv("EPIC_CLIENT_SECRET", ""),
        "scopes": [
            "launch", "launch/patient", "launch/encounter",
            "openid", "fhirUser",
            "patient/Patient.read", "patient/Coverage.read",
            "patient/Encounter.read", "patient/Condition.read",
            "patient/Procedure.read", "patient/MedicationRequest.read",
            "patient/Claim.read", "patient/ExplanationOfBenefit.read",
        ],
        "pkce_required": True,
    },
    "cerner": {
        "name": "Cerner Millennium",
        "fhir_base_url": os.getenv("CERNER_FHIR_BASE_URL", "https://fhir-ehr.cerner.com/r4"),
        "authorize_url": os.getenv("CERNER_AUTHORIZE_URL", "https://authorization.cerner.com/tenants/{tenant_id}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize"),
        "token_url": os.getenv("CERNER_TOKEN_URL", "https://authorization.cerner.com/tenants/{tenant_id}/protocols/oauth2/profiles/smart-v1/token"),
        "client_id": os.getenv("CERNER_CLIENT_ID", ""),
        "client_secret": os.getenv("CERNER_CLIENT_SECRET", ""),
        "scopes": [
            "launch", "launch/patient",
            "openid", "fhirUser",
            "patient/Patient.read", "patient/Coverage.read",
            "patient/Encounter.read", "patient/Condition.read",
            "patient/Procedure.read",
        ],
        "pkce_required": False,
    },
    "allscripts": {
        "name": "Allscripts",
        "fhir_base_url": os.getenv("ALLSCRIPTS_FHIR_BASE_URL", ""),
        "authorize_url": os.getenv("ALLSCRIPTS_AUTHORIZE_URL", ""),
        "token_url": os.getenv("ALLSCRIPTS_TOKEN_URL", ""),
        "client_id": os.getenv("ALLSCRIPTS_CLIENT_ID", ""),
        "client_secret": os.getenv("ALLSCRIPTS_CLIENT_SECRET", ""),
        "scopes": ["launch", "openid", "patient/Patient.read", "patient/Coverage.read"],
        "pkce_required": False,
    },
    "eclinicalworks": {
        "name": "eClinicalWorks",
        "fhir_base_url": os.getenv("ECW_FHIR_BASE_URL", ""),
        "authorize_url": os.getenv("ECW_AUTHORIZE_URL", ""),
        "token_url": os.getenv("ECW_TOKEN_URL", ""),
        "client_id": os.getenv("ECW_CLIENT_ID", ""),
        "client_secret": os.getenv("ECW_CLIENT_SECRET", ""),
        "scopes": ["launch", "openid", "patient/Patient.read", "patient/Coverage.read"],
        "pkce_required": True,
    },
}

APP_REDIRECT_URI = os.getenv(
    "SMART_REDIRECT_URI",
    "http://localhost:8000/smart/callback",
)


# ─── PKCE Helpers ─────────────────────────────────────────────────────────────

def generate_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE code_verifier and code_challenge (S256)."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


# ─── EHR Launch Endpoint ──────────────────────────────────────────────────────

@app.get("/smart/launch")
async def ehr_launch(
    iss: str = Query(..., description="FHIR base URL of the launching EHR"),
    launch: str = Query(..., description="Opaque launch token from the EHR"),
    emr: str = Query("epic", description="EMR identifier: epic, cerner, allscripts, eclinicalworks"),
) -> RedirectResponse:
    """
    EHR-launch entry point. The EHR redirects here with ?iss=&launch=.
    We store the launch context and redirect to the EMR's authorize endpoint.
    """
    config = EMR_CONFIGS.get(emr)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unknown EMR: {emr}")

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(16)
    code_verifier, code_challenge = generate_pkce_pair()

    # Persist launch state to PostgreSQL
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO smart_launch_states
              (state, emr, iss, launch_token, nonce, code_verifier,
               launch_type, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'ehr', NOW() + INTERVAL '10 minutes', NOW())
            """,
            state, emr, iss, launch, nonce, code_verifier,
        )

    # Build authorization URL
    authorize_url = config["authorize_url"].replace("{tenant_id}", "")
    params: Dict[str, str] = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": APP_REDIRECT_URI,
        "scope": " ".join(config["scopes"]),
        "state": state,
        "aud": iss,
        "launch": launch,
        "nonce": nonce,
    }
    if config["pkce_required"]:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    redirect_url = f"{authorize_url}?{urllib.parse.urlencode(params)}"
    logger.info(f"EHR launch initiated: emr={emr}, iss={iss}, state={state[:8]}...")
    return RedirectResponse(url=redirect_url, status_code=302)


# ─── Standalone Launch Endpoint ───────────────────────────────────────────────

@app.get("/smart/standalone")
async def standalone_launch(
    emr: str = Query("epic", description="EMR identifier"),
    patient_id: Optional[str] = Query(None, description="Pre-selected patient FHIR ID"),
) -> RedirectResponse:
    """
    Standalone launch — user initiates from HealthPoint, not from the EHR.
    Scopes include launch/patient to request patient context selection.
    """
    config = EMR_CONFIGS.get(emr)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unknown EMR: {emr}")

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(16)
    code_verifier, code_challenge = generate_pkce_pair()

    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO smart_launch_states
              (state, emr, iss, launch_token, nonce, code_verifier,
               launch_type, pre_selected_patient_id, expires_at, created_at)
            VALUES ($1, $2, $3, NULL, $4, $5, 'standalone', $6,
                    NOW() + INTERVAL '10 minutes', NOW())
            """,
            state, emr,
            config["fhir_base_url"],
            nonce, code_verifier,
            patient_id,
        )

    authorize_url = config["authorize_url"].replace("{tenant_id}", "")
    scopes = config["scopes"]
    if "launch" in scopes:
        scopes = [s for s in scopes if s != "launch"]

    params: Dict[str, str] = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": APP_REDIRECT_URI,
        "scope": " ".join(scopes),
        "state": state,
        "aud": config["fhir_base_url"],
        "nonce": nonce,
    }
    if config["pkce_required"]:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    redirect_url = f"{authorize_url}?{urllib.parse.urlencode(params)}"
    logger.info(f"Standalone launch initiated: emr={emr}, state={state[:8]}...")
    return RedirectResponse(url=redirect_url, status_code=302)


# ─── OAuth Callback ───────────────────────────────────────────────────────────

@app.get("/smart/callback")
async def oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """
    OAuth2 callback. Exchanges the authorization code for tokens,
    extracts launch context (patient, encounter, user), and persists everything.
    """
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"OAuth error: {error} — {error_description}",
        )
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter.")

    # Load launch state from PostgreSQL
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT * FROM smart_launch_states
            WHERE state = $1 AND expires_at > NOW()
            """,
            state,
        )
        if not row:
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired OAuth state. Please restart the launch.",
            )
        launch_state = dict(row)

    config = EMR_CONFIGS.get(launch_state["emr"])
    if not config:
        raise HTTPException(status_code=500, detail="EMR config not found for state.")

    # Exchange code for tokens
    token_url = config["token_url"].replace("{tenant_id}", "")
    token_params: Dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": APP_REDIRECT_URI,
        "client_id": config["client_id"],
    }
    if config["pkce_required"]:
        token_params["code_verifier"] = launch_state["code_verifier"]
    else:
        token_params["client_secret"] = config["client_secret"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        token_response = await client.post(
            token_url,
            data=token_params,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if token_response.status_code != 200:
        logger.error(f"Token exchange failed: {token_response.text}")
        raise HTTPException(
            status_code=502,
            detail=f"Token exchange failed with EMR: {token_response.status_code}",
        )

    token_data = token_response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    id_token = token_data.get("id_token")

    # Extract SMART launch context from token response
    patient_id = token_data.get("patient")
    encounter_id = token_data.get("encounter")
    user_fhir_id = token_data.get("fhirUser") or token_data.get("user")
    smart_style_url = token_data.get("smart_style_url")
    need_patient_banner = token_data.get("need_patient_banner", True)

    # Decode id_token to get user claims (without full JWT validation here —
    # full validation happens in the auth middleware)
    user_claims: Dict[str, Any] = {}
    if id_token:
        try:
            payload_part = id_token.split(".")[1]
            padded = payload_part + "=" * (4 - len(payload_part) % 4)
            user_claims = json.loads(base64.urlsafe_b64decode(padded))
        except Exception as e:
            logger.warning(f"Could not decode id_token: {e}")

    # Persist the completed launch context
    token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

    async with app.state.pool.acquire() as conn:
        session_id = await conn.fetchval(
            """
            INSERT INTO smart_launch_sessions
              (state, emr, iss, launch_type, patient_id, encounter_id,
               user_fhir_id, user_claims, access_token, refresh_token,
               token_expires_at, smart_style_url, need_patient_banner,
               created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            RETURNING id
            """,
            state,
            launch_state["emr"],
            launch_state["iss"],
            launch_state["launch_type"],
            patient_id,
            encounter_id,
            user_fhir_id,
            json.dumps(user_claims),
            access_token,
            refresh_token,
            token_expires_at,
            smart_style_url,
            need_patient_banner,
        )

        # Mark the launch state as consumed
        await conn.execute(
            "DELETE FROM smart_launch_states WHERE state = $1",
            state,
        )

    logger.info(
        f"SMART launch completed: emr={launch_state['emr']}, "
        f"patient={patient_id}, encounter={encounter_id}, session={session_id}"
    )

    return {
        "session_id": session_id,
        "emr": launch_state["emr"],
        "launch_type": launch_state["launch_type"],
        "context": {
            "patient_id": patient_id,
            "encounter_id": encounter_id,
            "user_fhir_id": user_fhir_id,
            "need_patient_banner": need_patient_banner,
            "smart_style_url": smart_style_url,
        },
        "user": {
            "sub": user_claims.get("sub"),
            "name": user_claims.get("name"),
            "email": user_claims.get("email"),
            "fhir_user": user_fhir_id,
        },
        "token_expires_at": token_expires_at.isoformat(),
    }


# ─── Session Retrieval ────────────────────────────────────────────────────────

@app.get("/smart/session/{session_id}")
async def get_session(session_id: int) -> Dict[str, Any]:
    """Retrieve a completed SMART launch session with its context."""
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, emr, iss, launch_type, patient_id, encounter_id,
                   user_fhir_id, user_claims, token_expires_at,
                   smart_style_url, need_patient_banner, created_at
            FROM smart_launch_sessions
            WHERE id = $1
            """,
            session_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    session = dict(row)
    session["user_claims"] = json.loads(session["user_claims"] or "{}")
    session["token_expired"] = session["token_expires_at"] < datetime.utcnow()
    return session


@app.get("/smart/session/{session_id}/token")
async def get_session_token(session_id: int) -> Dict[str, Any]:
    """
    Return the access token for a session, refreshing it if expired.
    This endpoint is called by other services that need to make FHIR API calls
    on behalf of the launched user.
    """
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT emr, access_token, refresh_token, token_expires_at
            FROM smart_launch_sessions
            WHERE id = $1
            """,
            session_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    now = datetime.utcnow()
    expires_at = row["token_expires_at"]
    access_token = row["access_token"]

    # Refresh if within 60 seconds of expiry
    if expires_at and (expires_at - now).total_seconds() < 60:
        if not row["refresh_token"]:
            raise HTTPException(
                status_code=401,
                detail="Token expired and no refresh token available. Re-launch required.",
            )
        config = EMR_CONFIGS.get(row["emr"])
        if not config:
            raise HTTPException(status_code=500, detail="EMR config not found.")

        token_url = config["token_url"].replace("{tenant_id}", "")
        async with httpx.AsyncClient(timeout=30.0) as client:
            refresh_response = await client.post(
                token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": row["refresh_token"],
                    "client_id": config["client_id"],
                    "client_secret": config.get("client_secret", ""),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if refresh_response.status_code != 200:
            raise HTTPException(
                status_code=401,
                detail="Token refresh failed. Re-launch required.",
            )

        new_token_data = refresh_response.json()
        access_token = new_token_data["access_token"]
        new_expires_at = now + timedelta(seconds=new_token_data.get("expires_in", 3600))

        async with app.state.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE smart_launch_sessions
                SET access_token = $1,
                    refresh_token = COALESCE($2, refresh_token),
                    token_expires_at = $3
                WHERE id = $4
                """,
                access_token,
                new_token_data.get("refresh_token"),
                new_expires_at,
                session_id,
            )
        expires_at = new_expires_at
        logger.info(f"Token refreshed for session {session_id}")

    return {
        "access_token": access_token,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "token_type": "Bearer",
    }


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()

    async with app.state.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS smart_launch_states (
                state TEXT PRIMARY KEY,
                emr TEXT NOT NULL,
                iss TEXT NOT NULL,
                launch_token TEXT,
                nonce TEXT,
                code_verifier TEXT,
                launch_type TEXT NOT NULL DEFAULT 'ehr',
                pre_selected_patient_id TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS smart_launch_sessions (
                id BIGSERIAL PRIMARY KEY,
                state TEXT NOT NULL,
                emr TEXT NOT NULL,
                iss TEXT NOT NULL,
                launch_type TEXT NOT NULL,
                patient_id TEXT,
                encounter_id TEXT,
                user_fhir_id TEXT,
                user_claims JSONB,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                token_expires_at TIMESTAMPTZ,
                smart_style_url TEXT,
                need_patient_banner BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_smart_sessions_patient
                ON smart_launch_sessions (patient_id);
            CREATE INDEX IF NOT EXISTS idx_smart_sessions_emr
                ON smart_launch_sessions (emr, created_at DESC);
        """)

    logger.info("SMART Launch Service started.")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "smart-launch-service"}
