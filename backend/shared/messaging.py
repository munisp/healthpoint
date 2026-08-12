"""
Shared Kafka messaging layer for all HealthPoint services.
Uses aiokafka — no in-memory queues, no stubs.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Optional
from uuid import uuid4

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP: str = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_GROUP_PREFIX: str = os.getenv("KAFKA_GROUP_PREFIX", "healthpoint")

# ── Topic registry ────────────────────────────────────────────────────────────
class Topics:
    IDR_CASE_CREATED      = "idr.case.created"
    IDR_CASE_UPDATED      = "idr.case.updated"
    IDR_CASE_RESOLVED     = "idr.case.resolved"
    PAYMENT_INITIATED     = "payment.initiated"
    PAYMENT_SETTLED       = "payment.settled"
    PAYMENT_FAILED        = "payment.failed"
    FRAUD_DETECTED        = "fraud.detected"
    FRAUD_CLEARED         = "fraud.cleared"
    NOTIFICATION_SEND     = "notification.send"
    AUDIT_EVENT           = "audit.event"
    DOCUMENT_UPLOADED     = "document.uploaded"
    DOCUMENT_VIRUS_SCANNED = "document.virus_scanned"
    WORKFLOW_STARTED      = "workflow.started"
    WORKFLOW_COMPLETED    = "workflow.completed"
    WORKFLOW_FAILED       = "workflow.failed"
    USER_CREATED          = "user.created"
    USER_ROLE_CHANGED     = "user.role_changed"
    STAKEHOLDER_INVITED               = "stakeholder.invited"
    STAKEHOLDER_VERIFICATION_COMPLETE = "stakeholder.verification_complete"
    STAKEHOLDER_APPROVED              = "stakeholder.approved"
    STAKEHOLDER_REJECTED              = "stakeholder.rejected"
    EMR_ONBOARDING_STARTED            = "emr.onboarding.started"
    EMR_ONBOARDING_COMPLETED          = "emr.onboarding.completed"
    MODEL_TRAINED                     = "ml.model.trained"
    MODEL_DRIFT_DETECTED              = "ml.model.drift_detected"
    AB_TEST_RESULT                    = "ml.ab_test.result"


# ── Producer singleton ────────────────────────────────────────────────────────
_producer: Optional[AIOKafkaProducer] = None


async def get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is not None:
        return _producer
    _producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v, default=str).encode(),
        key_serializer=lambda k: k.encode() if k else None,
        acks="all",
        enable_idempotence=True,
        compression_type="gzip",
        max_batch_size=65536,
        linger_ms=5,
    )
    await _producer.start()
    logger.info("Kafka producer started: %s", KAFKA_BOOTSTRAP)
    return _producer


async def close_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
        logger.info("Kafka producer stopped")


async def publish(topic: str, payload: dict[str, Any], key: Optional[str] = None) -> None:
    """Publish a JSON event to a Kafka topic."""
    event = {
        "event_id": str(uuid4()),
        "topic": topic,
        **payload,
    }
    producer = await get_producer()
    await producer.send_and_wait(topic, value=event, key=key)
    logger.debug("Published to %s: event_id=%s", topic, event["event_id"])


# ── Consumer factory ──────────────────────────────────────────────────────────
async def create_consumer(
    topics: list[str],
    group_id: str,
    handler: Callable[[str, dict], Any],
    auto_offset_reset: str = "earliest",
) -> None:
    """
    Create and run a Kafka consumer loop.
    Calls handler(topic, payload) for each message.
    Designed to run as a background asyncio task.
    """
    full_group_id = f"{KAFKA_GROUP_PREFIX}.{group_id}"
    consumer = AIOKafkaConsumer(
        *topics,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id=full_group_id,
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset=auto_offset_reset,
        enable_auto_commit=False,
        max_poll_records=100,
    )
    await consumer.start()
    logger.info("Kafka consumer started: group=%s topics=%s", full_group_id, topics)
    try:
        async for msg in consumer:
            try:
                await handler(msg.topic, msg.value)
                await consumer.commit()
            except Exception as e:
                logger.error("Error handling message from %s: %s", msg.topic, str(e))
    finally:
        await consumer.stop()
        logger.info("Kafka consumer stopped: group=%s", full_group_id)
