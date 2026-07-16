"""
HealthPoint IDR — OpenSearch Indexer
Consumes Kafka events and indexes disputes/documents into OpenSearch
for full-text search and analytics.
"""

import os
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from kafka import KafkaConsumer
from opensearchpy import OpenSearch, helpers, RequestsHttpConnection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:29092").split(",")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
OPENSEARCH_USER = os.getenv("OPENSEARCH_USER", "")
OPENSEARCH_PASSWORD = os.getenv("OPENSEARCH_PASSWORD", "")
BATCH_SIZE = int(os.getenv("OPENSEARCH_BATCH_SIZE", "50"))
FLUSH_INTERVAL_SECONDS = int(os.getenv("OPENSEARCH_FLUSH_INTERVAL", "5"))

# ── OpenSearch client ──────────────────────────────────────────────────────────

def create_opensearch_client() -> OpenSearch:
    """Create and return an OpenSearch client."""
    host_parts = OPENSEARCH_URL.replace("http://", "").replace("https://", "").split(":")
    host = host_parts[0]
    port = int(host_parts[1]) if len(host_parts) > 1 else 9200
    use_ssl = OPENSEARCH_URL.startswith("https://")

    kwargs = {
        "hosts": [{"host": host, "port": port}],
        "use_ssl": use_ssl,
        "verify_certs": False,
        "connection_class": RequestsHttpConnection,
        "timeout": 30,
        "max_retries": 3,
        "retry_on_timeout": True,
    }
    if OPENSEARCH_USER:
        kwargs["http_auth"] = (OPENSEARCH_USER, OPENSEARCH_PASSWORD)

    return OpenSearch(**kwargs)

# ── Index mappings ─────────────────────────────────────────────────────────────

DISPUTE_INDEX_MAPPING = {
    "settings": {
        "number_of_shards": 2,
        "number_of_replicas": 1,
        "analysis": {
            "analyzer": {
                "idr_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "stop", "snowball"]
                }
            }
        }
    },
    "mappings": {
        "properties": {
            "disputeId": {"type": "keyword"},
            "eventType": {"type": "keyword"},
            "status": {"type": "keyword"},
            "step": {"type": "integer"},
            "providerId": {"type": "keyword"},
            "payerId": {"type": "keyword"},
            "amountCents": {"type": "long"},
            "currency": {"type": "keyword"},
            "description": {
                "type": "text",
                "analyzer": "idr_analyzer",
                "fields": {"keyword": {"type": "keyword", "ignore_above": 256}}
            },
            "notes": {"type": "text", "analyzer": "idr_analyzer"},
            "tags": {"type": "keyword"},
            "createdAt": {"type": "date"},
            "updatedAt": {"type": "date"},
            "payload": {"type": "object", "enabled": False},
        }
    }
}

AUDIT_INDEX_MAPPING = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 1},
    "mappings": {
        "properties": {
            "action": {"type": "keyword"},
            "userId": {"type": "keyword"},
            "resourceType": {"type": "keyword"},
            "resourceId": {"type": "keyword"},
            "ipAddress": {"type": "ip"},
            "timestamp": {"type": "date"},
            "metadata": {"type": "object", "enabled": False},
        }
    }
}

def ensure_indices(client: OpenSearch) -> None:
    """Create indices if they don't exist."""
    indices = {
        "idr-disputes": DISPUTE_INDEX_MAPPING,
        "idr-audit": AUDIT_INDEX_MAPPING,
    }
    for index_name, mapping in indices.items():
        if not client.indices.exists(index=index_name):
            client.indices.create(index=index_name, body=mapping)
            logger.info(f"[opensearch] created index: {index_name}")
        else:
            logger.info(f"[opensearch] index already exists: {index_name}")

# ── Event processing ───────────────────────────────────────────────────────────

def process_dispute_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Transform a dispute Kafka event into an OpenSearch document."""
    aggregate_id = event.get("aggregateId") or event.get("disputeId")
    if not aggregate_id:
        return None

    payload = {}
    if isinstance(event.get("payload"), str):
        try:
            payload = json.loads(event["payload"])
        except json.JSONDecodeError:
            payload = {}
    elif isinstance(event.get("payload"), dict):
        payload = event["payload"]

    return {
        "_index": "idr-disputes",
        "_id": f"{aggregate_id}_{event.get('id', '')}",
        "_source": {
            "disputeId": aggregate_id,
            "eventType": event.get("eventType", "unknown"),
            "status": payload.get("status", "unknown"),
            "step": payload.get("step", 0),
            "providerId": payload.get("providerId"),
            "payerId": payload.get("payerId"),
            "amountCents": payload.get("amountCents"),
            "currency": payload.get("currency", "USD"),
            "description": payload.get("description", ""),
            "notes": payload.get("notes", ""),
            "tags": payload.get("tags", []),
            "createdAt": event.get("timestamp"),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
    }

def process_audit_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Transform an audit Kafka event into an OpenSearch document."""
    return {
        "_index": "idr-audit",
        "_id": f"{event.get('userId', 'system')}_{event.get('timestamp', '')}_{event.get('action', '')}",
        "_source": {
            "action": event.get("action"),
            "userId": event.get("userId"),
            "resourceType": event.get("resourceType"),
            "resourceId": event.get("resourceId"),
            "ipAddress": event.get("ipAddress"),
            "timestamp": event.get("timestamp"),
            "metadata": event.get("metadata"),
        }
    }

# ── Main indexer loop ──────────────────────────────────────────────────────────

def run_indexer() -> None:
    """Main indexer loop — consumes Kafka and bulk-indexes into OpenSearch."""
    logger.info("[opensearch-indexer] starting")

    # Wait for OpenSearch to be ready
    client = None
    for attempt in range(10):
        try:
            client = create_opensearch_client()
            info = client.info()
            logger.info(f"[opensearch-indexer] connected: {info['version']['number']}")
            break
        except Exception as e:
            logger.warning(f"[opensearch-indexer] connection attempt {attempt+1}/10: {e}")
            time.sleep(5)

    if not client:
        raise RuntimeError("Failed to connect to OpenSearch after 10 attempts")

    ensure_indices(client)

    consumer = KafkaConsumer(
        "idr.disputes",
        "idr.disputes.state_changes",
        "idr.audit",
        bootstrap_servers=KAFKA_BROKERS,
        group_id="idr-opensearch-indexer",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        consumer_timeout_ms=FLUSH_INTERVAL_SECONDS * 1000,
    )

    logger.info("[opensearch-indexer] subscribed to Kafka topics")

    buffer = []
    last_flush = time.time()

    while True:
        try:
            for message in consumer:
                topic = message.topic
                event = message.value

                doc = None
                if topic in ("idr.disputes", "idr.disputes.state_changes"):
                    doc = process_dispute_event(event)
                elif topic == "idr.audit":
                    doc = process_audit_event(event)

                if doc:
                    buffer.append(doc)

                if len(buffer) >= BATCH_SIZE or (time.time() - last_flush) >= FLUSH_INTERVAL_SECONDS:
                    if buffer:
                        flush_buffer(client, buffer)
                        buffer = []
                        last_flush = time.time()

        except Exception as e:
            logger.error(f"[opensearch-indexer] consumer error: {e}")
            if buffer:
                flush_buffer(client, buffer)
                buffer = []
            time.sleep(2)

def flush_buffer(client: OpenSearch, buffer: list) -> None:
    """Bulk index a buffer of documents into OpenSearch."""
    try:
        success, errors = helpers.bulk(client, buffer, raise_on_error=False)
        if errors:
            logger.warning(f"[opensearch-indexer] {len(errors)} bulk errors: {errors[:3]}")
        logger.info(f"[opensearch-indexer] indexed {success} documents")
    except Exception as e:
        logger.error(f"[opensearch-indexer] bulk index error: {e}")

if __name__ == "__main__":
    run_indexer()
