"""
OpenSearch integration for HealthPoint IDR Platform.
Indexes IDR cases, documents, and audit events for full-text search.
Uses opensearch-py (NOT elasticsearch-py — OpenSearch is a separate fork).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from opensearchpy import AsyncOpenSearch, OpenSearchException
from opensearchpy.helpers import async_bulk

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
OPENSEARCH_URL: str = os.getenv("OPENSEARCH_URL", "https://opensearch:9200")
OPENSEARCH_USER: str = os.getenv("OPENSEARCH_USER", "admin")
OPENSEARCH_PASSWORD: str = os.environ.get("OPENSEARCH_PASSWORD", "")
OPENSEARCH_VERIFY_CERTS: bool = os.getenv("OPENSEARCH_VERIFY_CERTS", "false").lower() == "true"

# ── Index names ───────────────────────────────────────────────────────────────
IDX_IDR_CASES = "healthpoint-idr-cases"
IDX_DOCUMENTS = "healthpoint-documents"
IDX_AUDIT_EVENTS = "healthpoint-audit-events"
IDX_FRAUD_DETECTIONS = "healthpoint-fraud-detections"

# ── Client singleton ──────────────────────────────────────────────────────────
_client: Optional[AsyncOpenSearch] = None


def get_client() -> AsyncOpenSearch:
    global _client
    if _client is not None:
        return _client
    _client = AsyncOpenSearch(
        hosts=[OPENSEARCH_URL],
        http_auth=(OPENSEARCH_USER, OPENSEARCH_PASSWORD),
        use_ssl=OPENSEARCH_URL.startswith("https"),
        verify_certs=OPENSEARCH_VERIFY_CERTS,
        ssl_show_warn=False,
        timeout=30,
        max_retries=3,
        retry_on_timeout=True,
    )
    logger.info("OpenSearch client created: %s", OPENSEARCH_URL)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


# ── Index mappings ────────────────────────────────────────────────────────────
IDR_CASE_MAPPING = {
    "mappings": {
        "properties": {
            "id": {"type": "keyword"},
            "case_number": {"type": "keyword"},
            "status": {"type": "keyword"},
            "initiating_party": {"type": "keyword"},
            "provider_id": {"type": "keyword"},
            "plan_id": {"type": "keyword"},
            "disputed_amount": {"type": "double"},
            "qpa_amount": {"type": "double"},
            "final_amount": {"type": "double"},
            "service_date": {"type": "date"},
            "service_code": {"type": "keyword"},
            "service_description": {
                "type": "text",
                "analyzer": "standard",
                "fields": {"keyword": {"type": "keyword", "ignore_above": 256}},
            },
            "metadata": {"type": "object", "dynamic": True},
            "created_at": {"type": "date"},
            "updated_at": {"type": "date"},
            "resolved_at": {"type": "date"},
        }
    },
    "settings": {
        "number_of_shards": 3,
        "number_of_replicas": 1,
        "index.refresh_interval": "5s",
    },
}

AUDIT_EVENT_MAPPING = {
    "mappings": {
        "properties": {
            "id": {"type": "keyword"},
            "service": {"type": "keyword"},
            "action": {"type": "keyword"},
            "actor_id": {"type": "keyword"},
            "resource_type": {"type": "keyword"},
            "resource_id": {"type": "keyword"},
            "payload": {"type": "object", "dynamic": True},
            "ip_address": {"type": "ip"},
            "created_at": {"type": "date"},
        }
    },
    "settings": {"number_of_shards": 2, "number_of_replicas": 1},
}


async def bootstrap_indices() -> None:
    """Create indices if they don't exist."""
    client = get_client()
    indices = {
        IDX_IDR_CASES: IDR_CASE_MAPPING,
        IDX_AUDIT_EVENTS: AUDIT_EVENT_MAPPING,
    }
    for index_name, mapping in indices.items():
        try:
            exists = await client.indices.exists(index=index_name)
            if not exists:
                await client.indices.create(index=index_name, body=mapping)
                logger.info("Created OpenSearch index: %s", index_name)
            else:
                logger.debug("OpenSearch index already exists: %s", index_name)
        except OpenSearchException as e:
            logger.error("Failed to create index %s: %s", index_name, str(e))


# ── IDR Case indexing ─────────────────────────────────────────────────────────
async def index_idr_case(case: dict[str, Any]) -> None:
    """Index or update an IDR case in OpenSearch."""
    client = get_client()
    doc_id = str(case.get("id", ""))
    doc = {
        **case,
        "id": doc_id,
        "updated_at": datetime.utcnow().isoformat(),
    }
    # Convert UUID fields to strings
    for field in ("id", "provider_id", "plan_id", "idr_entity_id"):
        if isinstance(doc.get(field), UUID):
            doc[field] = str(doc[field])
    try:
        await client.index(
            index=IDX_IDR_CASES,
            id=doc_id,
            body=doc,
            refresh="wait_for",
        )
        logger.debug("Indexed IDR case: %s", doc_id)
    except OpenSearchException as e:
        logger.error("Failed to index IDR case %s: %s", doc_id, str(e))


async def search_idr_cases(
    query_text: Optional[str] = None,
    status: Optional[str] = None,
    provider_id: Optional[str] = None,
    plan_id: Optional[str] = None,
    from_: int = 0,
    size: int = 20,
) -> dict[str, Any]:
    """Search IDR cases with full-text and filter support."""
    client = get_client()
    must_clauses = []
    filter_clauses = []

    if query_text:
        must_clauses.append({
            "multi_match": {
                "query": query_text,
                "fields": ["case_number", "service_description", "service_code"],
                "type": "best_fields",
                "fuzziness": "AUTO",
            }
        })
    if status:
        filter_clauses.append({"term": {"status": status}})
    if provider_id:
        filter_clauses.append({"term": {"provider_id": provider_id}})
    if plan_id:
        filter_clauses.append({"term": {"plan_id": plan_id}})

    query = {
        "query": {
            "bool": {
                "must": must_clauses or [{"match_all": {}}],
                "filter": filter_clauses,
            }
        },
        "sort": [{"created_at": {"order": "desc"}}],
        "from": from_,
        "size": size,
        "track_total_hits": True,
    }

    try:
        result = await client.search(index=IDX_IDR_CASES, body=query)
        hits = result["hits"]
        return {
            "total": hits["total"]["value"],
            "cases": [h["_source"] for h in hits["hits"]],
        }
    except OpenSearchException as e:
        logger.error("OpenSearch search failed: %s", str(e))
        return {"total": 0, "cases": []}


async def index_audit_event(event: dict[str, Any]) -> None:
    """Index an audit event in OpenSearch."""
    client = get_client()
    doc_id = str(event.get("id", ""))
    try:
        await client.index(
            index=IDX_AUDIT_EVENTS,
            id=doc_id,
            body={**event, "id": doc_id},
        )
    except OpenSearchException as e:
        logger.error("Failed to index audit event %s: %s", doc_id, str(e))


async def bulk_index_cases(cases: list[dict[str, Any]]) -> None:
    """Bulk index multiple IDR cases."""
    client = get_client()
    actions = [
        {
            "_index": IDX_IDR_CASES,
            "_id": str(c.get("id", "")),
            "_source": c,
        }
        for c in cases
    ]
    try:
        success, errors = await async_bulk(client, actions, raise_on_error=False)
        logger.info("Bulk indexed %d cases, %d errors", success, len(errors))
    except OpenSearchException as e:
        logger.error("Bulk index failed: %s", str(e))
