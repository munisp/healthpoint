"""
Dapr integration for HealthPoint IDR Platform.
Dapr provides service-to-service invocation, pub/sub, state management,
and distributed tracing via sidecar pattern.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# Dapr sidecar listens on localhost at the configured HTTP port
DAPR_HTTP_PORT: int = int(os.getenv("DAPR_HTTP_PORT", "3500"))
DAPR_BASE_URL: str = f"http://localhost:{DAPR_HTTP_PORT}"
DAPR_PUBSUB_NAME: str = os.getenv("DAPR_PUBSUB_NAME", "healthpoint-pubsub")
DAPR_STATE_STORE: str = os.getenv("DAPR_STATE_STORE", "healthpoint-statestore")
DAPR_ENABLED: bool = os.getenv("DAPR_ENABLED", "true").lower() == "true"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=DAPR_BASE_URL,
        timeout=15,
        headers={"Content-Type": "application/json"},
    )


# ── Service invocation ────────────────────────────────────────────────────────
async def invoke_service(
    app_id: str,
    method: str,
    data: Optional[dict] = None,
    http_method: str = "POST",
) -> dict[str, Any]:
    """
    Invoke a method on another Dapr-enabled service.
    Uses Dapr service invocation API.
    """
    if not DAPR_ENABLED:
        raise RuntimeError(f"Dapr disabled — cannot invoke {app_id}/{method}")

    try:
        async with _client() as client:
            resp = await client.request(
                method=http_method,
                url=f"/v1.0/invoke/{app_id}/method/{method}",
                json=data,
            )
            resp.raise_for_status()
            return resp.json() if resp.content else {}
    except httpx.HTTPError as e:
        logger.error("Dapr invoke failed (%s/%s): %s", app_id, method, str(e))
        raise


# ── Pub/Sub ───────────────────────────────────────────────────────────────────
async def publish_event(topic: str, data: dict[str, Any]) -> None:
    """Publish an event via Dapr pub/sub."""
    if not DAPR_ENABLED:
        # Fall back to Kafka directly
        from backend.shared.messaging import publish
        await publish(topic, data)
        return

    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1.0/publish/{DAPR_PUBSUB_NAME}/{topic}",
                json=data,
            )
            resp.raise_for_status()
            logger.debug("Dapr published to %s", topic)
    except httpx.HTTPError as e:
        logger.error("Dapr publish failed (%s): %s — falling back to Kafka", topic, str(e))
        from backend.shared.messaging import publish
        await publish(topic, data)


# ── State management ──────────────────────────────────────────────────────────
async def save_state(key: str, value: Any, etag: Optional[str] = None) -> None:
    """Save state via Dapr state store."""
    if not DAPR_ENABLED:
        from backend.shared.cache import set_json
        await set_json(f"dapr:{key}", value)
        return

    body = [{"key": key, "value": value}]
    if etag:
        body[0]["etag"] = etag

    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1.0/state/{DAPR_STATE_STORE}",
                json=body,
            )
            resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.error("Dapr save_state failed (%s): %s", key, str(e))
        from backend.shared.cache import set_json
        await set_json(f"dapr:{key}", value)


async def get_state(key: str) -> Optional[Any]:
    """Get state from Dapr state store."""
    if not DAPR_ENABLED:
        from backend.shared.cache import get_json
        return await get_json(f"dapr:{key}")

    try:
        async with _client() as client:
            resp = await client.get(f"/v1.0/state/{DAPR_STATE_STORE}/{key}")
            if resp.status_code == 204:
                return None
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        logger.error("Dapr get_state failed (%s): %s", key, str(e))
        from backend.shared.cache import get_json
        return await get_json(f"dapr:{key}")


async def delete_state(key: str) -> None:
    """Delete state from Dapr state store."""
    if not DAPR_ENABLED:
        from backend.shared.cache import delete
        await delete(f"dapr:{key}")
        return

    try:
        async with _client() as client:
            resp = await client.delete(f"/v1.0/state/{DAPR_STATE_STORE}/{key}")
            resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.error("Dapr delete_state failed (%s): %s", key, str(e))


# ── Distributed tracing ───────────────────────────────────────────────────────
async def get_metadata() -> dict[str, Any]:
    """Get Dapr sidecar metadata (health check)."""
    try:
        async with _client() as client:
            resp = await client.get("/v1.0/metadata")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError:
        return {"status": "unavailable"}


async def health_check() -> bool:
    """Check if Dapr sidecar is healthy."""
    try:
        async with _client() as client:
            resp = await client.get("/v1.0/healthz")
            return resp.status_code == 204
    except Exception:
        return False
