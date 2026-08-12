"""
Fluvio streaming integration for HealthPoint IDR Platform.
Fluvio is a high-throughput, low-latency streaming platform (Rust-based).
Used for real-time IDR event streaming at millions of events/second.

Falls back to Kafka (aiokafka) if Fluvio is unavailable.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Callable, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

FLUVIO_ENDPOINT: str = os.getenv("FLUVIO_ENDPOINT", "fluvio:9003")
FLUVIO_ENABLED: bool = os.getenv("FLUVIO_ENABLED", "true").lower() == "true"

# ── Topic registry (mirrors Kafka topics) ────────────────────────────────────
class FluvioTopics:
    IDR_EVENTS_STREAM = "idr-events-stream"
    PAYMENT_STREAM = "payment-stream"
    FRAUD_ALERTS_STREAM = "fraud-alerts-stream"
    AUDIT_STREAM = "audit-stream"
    NOTIFICATION_STREAM = "notification-stream"
    ANALYTICS_STREAM = "analytics-stream"


class FluvioClient:
    """
    Async Fluvio client wrapper.
    Uses fluvio Python SDK when available, falls back to Kafka otherwise.
    """

    def __init__(self) -> None:
        self._fluvio = None
        self._available = False
        self._producers: dict[str, Any] = {}

    async def connect(self) -> None:
        """Connect to Fluvio cluster."""
        if not FLUVIO_ENABLED:
            logger.info("Fluvio disabled by FLUVIO_ENABLED=false, using Kafka fallback")
            return
        try:
            import fluvio
            self._fluvio = await fluvio.Fluvio.connect(FLUVIO_ENDPOINT)
            self._available = True
            logger.info("Fluvio connected: %s", FLUVIO_ENDPOINT)
        except ImportError:
            logger.warning("fluvio package not installed — using Kafka fallback for streaming")
            self._available = False
        except Exception as e:
            logger.warning("Fluvio connection failed: %s — using Kafka fallback", str(e))
            self._available = False

    async def close(self) -> None:
        self._producers.clear()
        self._fluvio = None
        self._available = False

    async def ensure_topic(self, topic: str, partitions: int = 12) -> None:
        """Create a Fluvio topic if it doesn't exist."""
        if not self._available:
            return
        try:
            admin = self._fluvio.admin()
            await admin.create_topic(topic, partitions=partitions)
            logger.info("Fluvio topic created: %s (%d partitions)", topic, partitions)
        except Exception as e:
            if "already exists" in str(e).lower():
                pass
            else:
                logger.warning("Could not create Fluvio topic %s: %s", topic, str(e))

    async def produce(
        self,
        topic: str,
        payload: dict[str, Any],
        key: Optional[str] = None,
    ) -> None:
        """Produce a message to a Fluvio topic."""
        event = {
            "event_id": str(uuid4()),
            "topic": topic,
            **payload,
        }
        encoded = json.dumps(event, default=str).encode()

        if self._available:
            try:
                if topic not in self._producers:
                    self._producers[topic] = await self._fluvio.topic_producer(topic)
                producer = self._producers[topic]
                if key:
                    await producer.send(key.encode(), encoded)
                else:
                    await producer.send_record(encoded)
                logger.debug("Fluvio produced to %s: event_id=%s", topic, event["event_id"])
                return
            except Exception as e:
                logger.error("Fluvio produce failed, falling back to Kafka: %s", str(e))

        # Kafka fallback
        await self._kafka_produce(topic, event, key)

    async def _kafka_produce(
        self,
        topic: str,
        event: dict[str, Any],
        key: Optional[str],
    ) -> None:
        """Kafka fallback producer."""
        from backend.shared.messaging import publish
        await publish(topic, event, key)

    async def consume(
        self,
        topic: str,
        group_id: str,
        handler: Callable[[dict[str, Any]], Any],
        offset: str = "earliest",
    ) -> None:
        """
        Consume messages from a Fluvio topic.
        Designed to run as a background asyncio task.
        """
        if self._available:
            try:
                consumer = await self._fluvio.partition_consumer(topic, 0)
                offset_obj = (
                    self._fluvio.Offset.beginning()
                    if offset == "earliest"
                    else self._fluvio.Offset.end()
                )
                async for record in consumer.stream(offset_obj):
                    try:
                        payload = json.loads(record.value_string())
                        await handler(payload)
                    except Exception as e:
                        logger.error("Fluvio handler error on %s: %s", topic, str(e))
                return
            except Exception as e:
                logger.error("Fluvio consume failed, falling back to Kafka: %s", str(e))

        # Kafka fallback
        from backend.shared.messaging import create_consumer
        await create_consumer(
            topics=[topic],
            group_id=group_id,
            handler=lambda t, p: handler(p),
        )


# ── Singleton ─────────────────────────────────────────────────────────────────
fluvio_client = FluvioClient()


# ── High-level helpers ────────────────────────────────────────────────────────
async def stream_idr_event(event_type: str, case_id: str, payload: dict[str, Any]) -> None:
    """Stream an IDR lifecycle event."""
    await fluvio_client.produce(
        FluvioTopics.IDR_EVENTS_STREAM,
        {
            "event_type": event_type,
            "case_id": case_id,
            **payload,
        },
        key=case_id,
    )


async def stream_payment_event(payment_id: str, payload: dict[str, Any]) -> None:
    """Stream a payment event."""
    await fluvio_client.produce(
        FluvioTopics.PAYMENT_STREAM,
        {"payment_id": payment_id, **payload},
        key=payment_id,
    )


async def stream_fraud_alert(case_id: str, score: float, is_fraud: bool) -> None:
    """Stream a fraud detection alert."""
    await fluvio_client.produce(
        FluvioTopics.FRAUD_ALERTS_STREAM,
        {
            "case_id": case_id,
            "fraud_score": score,
            "is_fraud": is_fraud,
        },
        key=case_id,
    )
