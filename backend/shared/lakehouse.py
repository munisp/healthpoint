"""
Lakehouse integration for HealthPoint — Apache Iceberg via REST Catalog.

All services use this module to:
1. Publish change events to the lakehouse-ingestion Kafka topic
2. Query Iceberg tables via the REST catalog for analytics

The actual Iceberg writes happen in Spark streaming jobs (lakehouse/spark-jobs/).
Services only need to publish events; the Spark jobs handle the Iceberg writes.
"""
import os
import json
import logging
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from enum import Enum

import httpx

logger = logging.getLogger(__name__)

LAKEHOUSE_CATALOG_URL = os.getenv("LAKEHOUSE_CATALOG_URL", "http://iceberg-rest-catalog:8181")
LAKEHOUSE_NAMESPACE = os.getenv("LAKEHOUSE_NAMESPACE", "healthpoint")
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
LAKEHOUSE_INGESTION_TOPIC = "lakehouse-ingestion"


class LakehouseTable(str, Enum):
    """Iceberg table names in the healthpoint namespace."""
    IDR_DISPUTES = "idr_disputes"
    CLAIMS = "claims"
    PAYMENTS = "payments"
    AUDIT_LOGS = "audit_logs"
    FRAUD_ALERTS = "fraud_alerts"
    GFE_ESTIMATES = "gfe_estimates"
    WORKFLOW_EVENTS = "workflow_events"
    ANALYTICS_SNAPSHOTS = "analytics_snapshots"
    PAYMENT_LEDGER = "payment_ledger"  # TigerBeetle mirror


class LakehouseClient:
    """
    Client for publishing events to the Lakehouse ingestion pipeline.
    Uses Kafka as the transport; Spark Structured Streaming reads from Kafka
    and writes to Iceberg tables via the REST catalog.
    """

    def __init__(self):
        self._producer = None
        self._catalog_client: Optional[httpx.AsyncClient] = None

    async def _get_producer(self):
        """Lazy-initialize Kafka producer."""
        if self._producer is None:
            try:
                from aiokafka import AIOKafkaProducer
                self._producer = AIOKafkaProducer(
                    bootstrap_servers=KAFKA_BOOTSTRAP,
                    value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
                    key_serializer=lambda k: k.encode("utf-8") if k else None,
                    acks="all",
                    enable_idempotence=True,
                    compression_type="lz4",
                    max_batch_size=65536,
                    linger_ms=10,
                )
                await self._producer.start()
                logger.info("Lakehouse Kafka producer started")
            except Exception as e:
                logger.error(f"Failed to start Lakehouse Kafka producer: {e}")
                self._producer = None
        return self._producer

    async def _get_catalog_client(self) -> httpx.AsyncClient:
        """Lazy-initialize Iceberg REST catalog HTTP client."""
        if self._catalog_client is None:
            self._catalog_client = httpx.AsyncClient(
                base_url=LAKEHOUSE_CATALOG_URL,
                timeout=30.0,
                headers={"Content-Type": "application/json"},
            )
        return self._catalog_client

    async def publish_event(
        self,
        table: LakehouseTable,
        operation: str,  # INSERT, UPDATE, DELETE
        record_id: str,
        data: Dict[str, Any],
        partition_key: Optional[str] = None,
    ) -> bool:
        """
        Publish a data change event to the lakehouse ingestion Kafka topic.
        The Spark streaming job will pick this up and write to Iceberg.

        Args:
            table: Target Iceberg table
            operation: INSERT, UPDATE, or DELETE
            record_id: Primary key of the record
            data: Full record data (for INSERT/UPDATE) or just the ID (for DELETE)
            partition_key: Kafka partition key (defaults to record_id)

        Returns:
            True if published successfully, False otherwise
        """
        producer = await self._get_producer()
        if producer is None:
            logger.warning(f"Lakehouse producer unavailable, skipping event for {table.value}/{record_id}")
            return False

        event = {
            "table": table.value,
            "namespace": LAKEHOUSE_NAMESPACE,
            "operation": operation,
            "record_id": record_id,
            "data": data,
            "event_time": datetime.now(timezone.utc).isoformat(),
            "schema_version": "1.0",
        }

        try:
            await producer.send_and_wait(
                topic=LAKEHOUSE_INGESTION_TOPIC,
                key=partition_key or record_id,
                value=event,
            )
            return True
        except Exception as e:
            logger.error(f"Failed to publish lakehouse event for {table.value}/{record_id}: {e}")
            return False

    async def query_table(
        self,
        table: LakehouseTable,
        sql: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> list:
        """
        Execute a SQL query against an Iceberg table via the REST catalog.
        Uses Spark Connect or Trino as the query engine.

        Args:
            table: Target Iceberg table
            sql: SQL query (parameterized with :param_name syntax)
            parameters: Query parameters

        Returns:
            List of row dicts
        """
        trino_url = os.getenv("TRINO_URL", "http://trino:8080")
        try:
            async with httpx.AsyncClient(base_url=trino_url, timeout=60.0) as client:
                # Substitute parameters
                query = sql
                if parameters:
                    for key, value in parameters.items():
                        if isinstance(value, str):
                            query = query.replace(f":{key}", f"'{value}'")
                        else:
                            query = query.replace(f":{key}", str(value))

                response = await client.post(
                    "/v1/statement",
                    headers={
                        "X-Trino-User": "healthpoint-service",
                        "X-Trino-Catalog": "iceberg",
                        "X-Trino-Schema": LAKEHOUSE_NAMESPACE,
                    },
                    content=query,
                )
                response.raise_for_status()

                result = response.json()
                rows = []

                # Paginate through Trino results
                while result:
                    if "data" in result and "columns" in result:
                        columns = [col["name"] for col in result["columns"]]
                        for row_data in result["data"]:
                            rows.append(dict(zip(columns, row_data)))

                    next_uri = result.get("nextUri")
                    if not next_uri:
                        break

                    await asyncio.sleep(0.1)
                    next_resp = await client.get(next_uri)
                    next_resp.raise_for_status()
                    result = next_resp.json()

                return rows

        except Exception as e:
            logger.error(f"Lakehouse query failed for {table.value}: {e}")
            return []

    async def get_table_snapshot(self, table: LakehouseTable) -> Optional[Dict]:
        """Get the latest snapshot metadata for an Iceberg table."""
        client = await self._get_catalog_client()
        try:
            response = await client.get(
                f"/v1/namespaces/{LAKEHOUSE_NAMESPACE}/tables/{table.value}"
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to get snapshot for {table.value}: {e}")
            return None

    async def close(self):
        """Clean up connections."""
        if self._producer:
            await self._producer.stop()
        if self._catalog_client:
            await self._catalog_client.aclose()


# ── Module-level singleton ────────────────────────────────────────────────────
_lakehouse_client: Optional[LakehouseClient] = None


def get_lakehouse_client() -> LakehouseClient:
    """Get the module-level LakehouseClient singleton."""
    global _lakehouse_client
    if _lakehouse_client is None:
        _lakehouse_client = LakehouseClient()
    return _lakehouse_client
