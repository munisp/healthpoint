"""
OpenTelemetry distributed tracing for HealthPoint services.

Usage in each service:
    from shared.telemetry import setup_telemetry, get_tracer

    # At service startup (before app creation):
    setup_telemetry(service_name="nsa-idr-dispute-service", service_version="1.0.0")

    # In route handlers:
    tracer = get_tracer()
    with tracer.start_as_current_span("process_dispute") as span:
        span.set_attribute("dispute.id", dispute_id)
        span.set_attribute("dispute.status", status)
        ...
"""
import os
import logging
from typing import Optional

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.b3 import B3MultiFormat
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)

_tracer_provider: Optional[TracerProvider] = None
_meter_provider: Optional[MeterProvider] = None


def setup_telemetry(
    service_name: str,
    service_version: str = "1.0.0",
    environment: Optional[str] = None,
    sample_rate: float = 1.0,
) -> None:
    """
    Initialize OpenTelemetry tracing and metrics for a service.
    Call this once at service startup before creating the FastAPI app.
    """
    global _tracer_provider, _meter_provider

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317")
    env = environment or os.getenv("ENVIRONMENT", "production")

    # ── Resource attributes ───────────────────────────────────────────────────
    resource = Resource.create({
        SERVICE_NAME: service_name,
        SERVICE_VERSION: service_version,
        "deployment.environment": env,
        "service.namespace": "healthpoint",
        "k8s.namespace.name": os.getenv("K8S_NAMESPACE", "healthpoint-services"),
        "k8s.pod.name": os.getenv("HOSTNAME", "unknown"),
    })

    # ── Tracing ───────────────────────────────────────────────────────────────
    sampler = ParentBased(root=TraceIdRatioBased(sample_rate))

    otlp_span_exporter = OTLPSpanExporter(
        endpoint=otlp_endpoint,
        insecure=env != "production",
    )

    _tracer_provider = TracerProvider(resource=resource, sampler=sampler)
    _tracer_provider.add_span_processor(
        BatchSpanProcessor(
            otlp_span_exporter,
            max_queue_size=2048,
            max_export_batch_size=512,
            export_timeout_millis=30000,
        )
    )

    # Also export to console in development
    if env == "development":
        _tracer_provider.add_span_processor(
            BatchSpanProcessor(ConsoleSpanExporter())
        )

    trace.set_tracer_provider(_tracer_provider)

    # ── Metrics ───────────────────────────────────────────────────────────────
    otlp_metric_exporter = OTLPMetricExporter(
        endpoint=otlp_endpoint,
        insecure=env != "production",
    )

    metric_reader = PeriodicExportingMetricReader(
        exporter=otlp_metric_exporter,
        export_interval_millis=30000,
    )

    _meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    metrics.set_meter_provider(_meter_provider)

    # ── Propagators: W3C TraceContext + B3 (for Zipkin/Jaeger compat) ─────────
    set_global_textmap(CompositePropagator([
        TraceContextTextMapPropagator(),
        B3MultiFormat(),
    ]))

    # ── Auto-instrumentation ──────────────────────────────────────────────────
    AsyncPGInstrumentor().instrument()
    RedisInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    LoggingInstrumentor().instrument(set_logging_format=True)

    logger.info(
        f"OpenTelemetry initialized for {service_name} v{service_version} "
        f"[env={env}, otlp={otlp_endpoint}, sample_rate={sample_rate}]"
    )


def instrument_fastapi(app) -> None:
    """
    Instrument a FastAPI application with OpenTelemetry.
    Call this after setup_telemetry() and after creating the FastAPI app.
    """
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=_tracer_provider,
        excluded_urls="/health,/metrics,/readiness,/liveness",
    )


def get_tracer(name: Optional[str] = None) -> trace.Tracer:
    """Get a named tracer. Uses the global tracer provider."""
    return trace.get_tracer(name or __name__)


def get_meter(name: Optional[str] = None):
    """Get a named meter. Uses the global meter provider."""
    return metrics.get_meter(name or __name__)


def shutdown_telemetry() -> None:
    """Flush and shutdown telemetry providers. Call on service shutdown."""
    if _tracer_provider:
        _tracer_provider.shutdown()
    if _meter_provider:
        _meter_provider.shutdown()


# ── Business metric helpers ───────────────────────────────────────────────────

class IDRMetrics:
    """Pre-built business metrics for the IDR platform."""

    def __init__(self, service_name: str):
        meter = get_meter(service_name)

        self.disputes_created = meter.create_counter(
            name="idr.disputes.created",
            description="Number of IDR disputes created",
            unit="1",
        )
        self.disputes_resolved = meter.create_counter(
            name="idr.disputes.resolved",
            description="Number of IDR disputes resolved",
            unit="1",
        )
        self.determination_amount = meter.create_histogram(
            name="idr.determination.amount_usd",
            description="IDR determination amounts in USD",
            unit="USD",
        )
        self.payment_processing_duration = meter.create_histogram(
            name="idr.payment.processing_duration_ms",
            description="Payment processing duration in milliseconds",
            unit="ms",
        )
        self.claims_processed = meter.create_counter(
            name="claims.processed",
            description="Number of claims processed",
            unit="1",
        )
        self.fraud_alerts_raised = meter.create_counter(
            name="fraud.alerts.raised",
            description="Number of fraud alerts raised",
            unit="1",
        )
        self.active_disputes = meter.create_up_down_counter(
            name="idr.disputes.active",
            description="Number of currently active IDR disputes",
            unit="1",
        )
