"""
HealthPoint IDR — Temporal Workflow Worker
Implements the 19-step IDR (Independent Dispute Resolution) workflow
as durable Temporal workflows and activities.
"""

import asyncio
import logging
import os
from datetime import timedelta
from typing import Optional

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.common import RetryPolicy

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "idr")
TASK_QUEUE = "idr-workflow-queue"

# ── IDR Workflow data classes ──────────────────────────────────────────────────

from dataclasses import dataclass, field
from enum import Enum

class DisputeStatus(str, Enum):
    INITIATED = "initiated"
    OPEN_NEGOTIATION = "open_negotiation"
    OFFER_SUBMITTED = "offer_submitted"
    COUNTER_OFFER = "counter_offer"
    AGREED = "agreed"
    IDR_ENTITY_REVIEW = "idr_entity_review"
    ARBITRATION = "arbitration"
    RESOLVED = "resolved"
    CLOSED = "closed"
    WITHDRAWN = "withdrawn"

@dataclass
class DisputeInput:
    dispute_id: str
    provider_id: str
    payer_id: str
    amount_cents: int
    currency: str = "USD"
    service_date: str = ""
    description: str = ""

@dataclass
class StepResult:
    step: int
    status: str
    actor_id: str
    notes: str = ""
    next_step: Optional[int] = None

@dataclass
class WorkflowState:
    dispute_id: str
    current_step: int = 1
    status: str = DisputeStatus.INITIATED
    provider_id: str = ""
    payer_id: str = ""
    amount_cents: int = 0
    currency: str = "USD"
    offer_amount: Optional[int] = None
    counter_offer_amount: Optional[int] = None
    agreed_amount: Optional[int] = None
    idr_entity_id: Optional[str] = None
    resolution_notes: str = ""
    step_history: list = field(default_factory=list)

# ── Activities ─────────────────────────────────────────────────────────────────

@activity.defn
async def validate_dispute(input: DisputeInput) -> dict:
    """Step 1: Validate dispute eligibility and completeness."""
    logger.info(f"[activity] validate_dispute: {input.dispute_id}")
    # In production: call Node.js API to validate
    return {
        "valid": True,
        "disputeId": input.dispute_id,
        "step": 1,
        "status": "validated",
    }

@activity.defn
async def notify_parties(dispute_id: str, step: int, message: str) -> dict:
    """Notify provider and payer of workflow step changes."""
    logger.info(f"[activity] notify_parties: dispute={dispute_id} step={step}")
    # In production: publish to Kafka idr.notifications topic
    return {"notified": True, "disputeId": dispute_id, "step": step}

@activity.defn
async def submit_initial_offer(dispute_id: str, provider_id: str, amount_cents: int) -> dict:
    """Step 4: Provider submits initial offer."""
    logger.info(f"[activity] submit_initial_offer: dispute={dispute_id} amount={amount_cents}")
    return {
        "disputeId": dispute_id,
        "step": 4,
        "offerAmount": amount_cents,
        "submittedBy": provider_id,
        "status": "offer_submitted",
    }

@activity.defn
async def process_counter_offer(dispute_id: str, payer_id: str, amount_cents: int) -> dict:
    """Step 7: Payer submits counter offer."""
    logger.info(f"[activity] process_counter_offer: dispute={dispute_id} amount={amount_cents}")
    return {
        "disputeId": dispute_id,
        "step": 7,
        "counterOfferAmount": amount_cents,
        "submittedBy": payer_id,
        "status": "counter_offer",
    }

@activity.defn
async def check_negotiation_deadline(dispute_id: str) -> dict:
    """Step 9: Check if 30-day open negotiation period has elapsed."""
    logger.info(f"[activity] check_negotiation_deadline: {dispute_id}")
    # In production: query DB for dispute creation date
    return {
        "disputeId": dispute_id,
        "deadlineElapsed": False,
        "daysRemaining": 15,
    }

@activity.defn
async def assign_idr_entity(dispute_id: str) -> dict:
    """Step 11: Assign a certified IDR entity to the dispute."""
    logger.info(f"[activity] assign_idr_entity: {dispute_id}")
    return {
        "disputeId": dispute_id,
        "step": 11,
        "idrEntityId": "idr-entity-001",
        "idrEntityName": "National IDR Services LLC",
        "status": "idr_entity_assigned",
    }

@activity.defn
async def conduct_arbitration(dispute_id: str, idr_entity_id: str) -> dict:
    """Steps 12-16: IDR entity conducts arbitration and issues determination."""
    logger.info(f"[activity] conduct_arbitration: dispute={dispute_id} entity={idr_entity_id}")
    return {
        "disputeId": dispute_id,
        "step": 16,
        "determination": "provider_prevails",
        "awardAmount": 0,
        "idrEntityId": idr_entity_id,
        "status": "determination_issued",
    }

@activity.defn
async def process_payment(dispute_id: str, amount_cents: int, currency: str) -> dict:
    """Step 17: Process payment via TigerBeetle ledger and Mojaloop."""
    logger.info(f"[activity] process_payment: dispute={dispute_id} amount={amount_cents}")
    # In production: call Go services /internal/ledger/transfer and /internal/payments/initiate
    return {
        "disputeId": dispute_id,
        "step": 17,
        "transactionId": f"txn-{dispute_id}-final",
        "amount": amount_cents,
        "currency": currency,
        "status": "payment_processed",
    }

@activity.defn
async def close_dispute(dispute_id: str, resolution: str, notes: str) -> dict:
    """Steps 18-19: Close the dispute and archive records."""
    logger.info(f"[activity] close_dispute: {dispute_id} resolution={resolution}")
    # In production: update DB, publish to Kafka, trigger Lakehouse sync
    return {
        "disputeId": dispute_id,
        "step": 19,
        "resolution": resolution,
        "notes": notes,
        "status": "closed",
        "closedAt": "now",
    }

@activity.defn
async def publish_event(topic: str, key: str, payload: dict) -> dict:
    """Publish an event to Kafka for downstream processing."""
    logger.info(f"[activity] publish_event: topic={topic} key={key}")
    # In production: use aiokafka producer
    return {"published": True, "topic": topic, "key": key}

# ── 19-Step IDR Workflow ───────────────────────────────────────────────────────

@workflow.defn
class IDRDisputeWorkflow:
    """
    19-Step No Surprises Act IDR Workflow
    
    Steps:
      1.  Dispute initiation and validation
      2.  Eligibility determination
      3.  Open negotiation period begins (30 days)
      4.  Provider submits initial offer
      5.  Payer receives and reviews offer
      6.  Payer accepts or rejects offer
      7.  Counter-offer submission (if rejected)
      8.  Provider reviews counter-offer
      9.  Negotiation deadline check
      10. IDR initiation (if no agreement)
      11. IDR entity selection and assignment
      12. Administrative fee payment
      13. Offer submission to IDR entity
      14. IDR entity review period
      15. Additional information requests
      16. IDR entity determination
      17. Payment processing
      18. Dispute closure
      19. Record archival and reporting
    """

    def __init__(self):
        self._state = None
        self._signal_received = False
        self._signal_data = {}

    @workflow.run
    async def run(self, input: DisputeInput) -> WorkflowState:
        self._state = WorkflowState(
            dispute_id=input.dispute_id,
            provider_id=input.provider_id,
            payer_id=input.payer_id,
            amount_cents=input.amount_cents,
            currency=input.currency,
        )

        retry = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(minutes=10),
            maximum_attempts=5,
        )

        # ── Step 1: Validate dispute ─────────────────────────────────────────
        self._state.current_step = 1
        result = await workflow.execute_activity(
            validate_dispute,
            input,
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=retry,
        )
        self._record_step(1, result.get("status", "validated"), "system")

        # ── Step 2: Notify parties ───────────────────────────────────────────
        self._state.current_step = 2
        await workflow.execute_activity(
            notify_parties,
            args=[input.dispute_id, 2, "Dispute initiated. Open negotiation period begins."],
            start_to_close_timeout=timedelta(minutes=2),
        )
        self._record_step(2, "notified", "system")

        # ── Step 3: Open negotiation period (30 days) ────────────────────────
        self._state.current_step = 3
        self._state.status = DisputeStatus.OPEN_NEGOTIATION
        await workflow.execute_activity(
            publish_event,
            args=["idr.disputes.state_changes", input.dispute_id, {
                "eventType": "dispute.negotiation_started",
                "aggregateId": input.dispute_id,
                "payload": {"step": 3, "status": "open_negotiation"},
                "timestamp": str(workflow.now()),
            }],
            start_to_close_timeout=timedelta(minutes=2),
        )
        self._record_step(3, "open_negotiation", "system")

        # ── Step 4: Wait for provider offer (signal) ─────────────────────────
        self._state.current_step = 4
        await workflow.wait_condition(
            lambda: self._signal_received and self._signal_data.get("type") == "provider_offer",
            timeout=timedelta(days=30),
        )
        offer_amount = self._signal_data.get("amount", input.amount_cents)
        self._signal_received = False

        result = await workflow.execute_activity(
            submit_initial_offer,
            args=[input.dispute_id, input.provider_id, offer_amount],
            start_to_close_timeout=timedelta(minutes=5),
        )
        self._state.offer_amount = offer_amount
        self._state.status = DisputeStatus.OFFER_SUBMITTED
        self._record_step(4, "offer_submitted", input.provider_id)

        # ── Step 5-6: Payer reviews offer ────────────────────────────────────
        self._state.current_step = 5
        await workflow.execute_activity(
            notify_parties,
            args=[input.dispute_id, 5, f"Provider offer received: ${offer_amount/100:.2f}"],
            start_to_close_timeout=timedelta(minutes=2),
        )

        self._state.current_step = 6
        await workflow.wait_condition(
            lambda: self._signal_received and self._signal_data.get("type") in ("accept_offer", "reject_offer"),
            timeout=timedelta(days=10),
        )
        payer_decision = self._signal_data.get("type")
        self._signal_received = False
        self._record_step(6, payer_decision, input.payer_id)

        if payer_decision == "accept_offer":
            # Agreement reached — skip to payment
            self._state.agreed_amount = offer_amount
            self._state.status = DisputeStatus.AGREED
            self._record_step(6, "agreed", input.payer_id)
        else:
            # ── Step 7-8: Counter-offer ──────────────────────────────────────
            self._state.current_step = 7
            await workflow.wait_condition(
                lambda: self._signal_received and self._signal_data.get("type") == "counter_offer",
                timeout=timedelta(days=10),
            )
            counter_amount = self._signal_data.get("amount", offer_amount)
            self._signal_received = False

            await workflow.execute_activity(
                process_counter_offer,
                args=[input.dispute_id, input.payer_id, counter_amount],
                start_to_close_timeout=timedelta(minutes=5),
            )
            self._state.counter_offer_amount = counter_amount
            self._state.status = DisputeStatus.COUNTER_OFFER
            self._record_step(7, "counter_offer", input.payer_id)

            # ── Step 8: Provider reviews counter-offer ───────────────────────
            self._state.current_step = 8
            await workflow.wait_condition(
                lambda: self._signal_received and self._signal_data.get("type") in ("accept_counter", "reject_counter"),
                timeout=timedelta(days=5),
            )
            provider_decision = self._signal_data.get("type")
            self._signal_received = False

            if provider_decision == "accept_counter":
                self._state.agreed_amount = counter_amount
                self._state.status = DisputeStatus.AGREED
                self._record_step(8, "agreed_on_counter", input.provider_id)
            else:
                # ── Step 9-10: IDR initiation ────────────────────────────────
                self._state.current_step = 9
                deadline_result = await workflow.execute_activity(
                    check_negotiation_deadline,
                    input.dispute_id,
                    start_to_close_timeout=timedelta(minutes=2),
                )
                self._record_step(9, "deadline_checked", "system")

                self._state.current_step = 10
                self._state.status = DisputeStatus.IDR_ENTITY_REVIEW
                await workflow.execute_activity(
                    publish_event,
                    args=["idr.disputes.state_changes", input.dispute_id, {
                        "eventType": "dispute.idr_initiated",
                        "aggregateId": input.dispute_id,
                        "payload": {"step": 10, "status": "idr_initiated"},
                        "timestamp": str(workflow.now()),
                    }],
                    start_to_close_timeout=timedelta(minutes=2),
                )
                self._record_step(10, "idr_initiated", "system")

                # ── Step 11: Assign IDR entity ───────────────────────────────
                self._state.current_step = 11
                entity_result = await workflow.execute_activity(
                    assign_idr_entity,
                    input.dispute_id,
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=retry,
                )
                self._state.idr_entity_id = entity_result.get("idrEntityId")
                self._record_step(11, "idr_entity_assigned", "system")

                # ── Steps 12-16: Arbitration ─────────────────────────────────
                for step in range(12, 17):
                    self._state.current_step = step
                    self._record_step(step, f"arbitration_step_{step}", self._state.idr_entity_id or "idr_entity")

                arbitration_result = await workflow.execute_activity(
                    conduct_arbitration,
                    args=[input.dispute_id, self._state.idr_entity_id or ""],
                    start_to_close_timeout=timedelta(days=30),
                    retry_policy=retry,
                )
                self._state.status = DisputeStatus.ARBITRATION
                self._state.agreed_amount = arbitration_result.get("awardAmount", 0)
                self._record_step(16, "determination_issued", self._state.idr_entity_id or "idr_entity")

        # ── Step 17: Process payment ─────────────────────────────────────────
        self._state.current_step = 17
        if self._state.agreed_amount and self._state.agreed_amount > 0:
            payment_result = await workflow.execute_activity(
                process_payment,
                args=[input.dispute_id, self._state.agreed_amount, input.currency],
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=retry,
            )
            self._record_step(17, "payment_processed", "system")
        else:
            self._record_step(17, "no_payment_required", "system")

        # ── Step 18: Close dispute ───────────────────────────────────────────
        self._state.current_step = 18
        close_result = await workflow.execute_activity(
            close_dispute,
            args=[input.dispute_id, self._state.status, self._state.resolution_notes],
            start_to_close_timeout=timedelta(minutes=10),
        )
        self._record_step(18, "closed", "system")

        # ── Step 19: Archive and report ──────────────────────────────────────
        self._state.current_step = 19
        await workflow.execute_activity(
            publish_event,
            args=["idr.lakehouse.ingest", input.dispute_id, {
                "eventType": "dispute.archived",
                "aggregateId": input.dispute_id,
                "payload": {
                    "step": 19,
                    "status": "archived",
                    "finalStatus": self._state.status,
                    "agreedAmount": self._state.agreed_amount,
                    "stepHistory": self._state.step_history,
                },
                "timestamp": str(workflow.now()),
            }],
            start_to_close_timeout=timedelta(minutes=5),
        )
        self._state.status = DisputeStatus.CLOSED
        self._record_step(19, "archived", "system")

        logger.info(f"[workflow] IDR dispute {input.dispute_id} completed: {self._state.status}")
        return self._state

    @workflow.signal
    async def advance_step(self, signal_data: dict) -> None:
        """Signal to advance the workflow to the next step."""
        self._signal_data = signal_data
        self._signal_received = True
        logger.info(f"[workflow] signal received: {signal_data.get('type')} for {self._state.dispute_id if self._state else 'unknown'}")

    @workflow.query
    def get_state(self) -> dict:
        """Query the current workflow state."""
        if not self._state:
            return {}
        return {
            "disputeId": self._state.dispute_id,
            "currentStep": self._state.current_step,
            "status": self._state.status,
            "offerAmount": self._state.offer_amount,
            "counterOfferAmount": self._state.counter_offer_amount,
            "agreedAmount": self._state.agreed_amount,
            "stepHistory": self._state.step_history,
        }

    def _record_step(self, step: int, status: str, actor_id: str) -> None:
        if self._state:
            self._state.step_history.append({
                "step": step,
                "status": status,
                "actorId": actor_id,
                "timestamp": str(workflow.now()),
            })

# ── Worker main ────────────────────────────────────────────────────────────────

async def main():
    logger.info(f"[temporal-worker] connecting to {TEMPORAL_HOST}")

    client = await Client.connect(TEMPORAL_HOST, namespace=TEMPORAL_NAMESPACE)
    logger.info(f"[temporal-worker] connected to namespace: {TEMPORAL_NAMESPACE}")

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[IDRDisputeWorkflow],
        activities=[
            validate_dispute,
            notify_parties,
            submit_initial_offer,
            process_counter_offer,
            check_negotiation_deadline,
            assign_idr_entity,
            conduct_arbitration,
            process_payment,
            close_dispute,
            publish_event,
        ],
    )

    logger.info(f"[temporal-worker] worker started on task queue: {TASK_QUEUE}")
    await worker.run()

if __name__ == "__main__":
    asyncio.run(main())
