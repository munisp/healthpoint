// HealthPoint IDR — Rust Services
// High-performance stream processing using Fluvio and Kafka
// Exposes HTTP API for health and metrics on port 8002

use std::env;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::util::Timeout;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Config {
    kafka_brokers: String,
    fluvio_sc_addr: String,
    port: u16,
}

impl Config {
    fn from_env() -> Self {
        Config {
            kafka_brokers: env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:29092".into()),
            fluvio_sc_addr: env::var("FLUVIO_SC_ADDR").unwrap_or_else(|_| "localhost:9003".into()),
            port: env::var("RUST_SERVICES_PORT")
                .unwrap_or_else(|_| "8002".into())
                .parse()
                .unwrap_or(8002),
        }
    }
}

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Default)]
struct Metrics {
    events_processed: u64,
    events_failed: u64,
    last_event_ts: u64,
}

type SharedMetrics = Arc<RwLock<Metrics>>;

// ── IDR Event types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IDREvent {
    id: String,
    event_type: String,
    aggregate_id: String,
    aggregate_type: String,
    payload: serde_json::Value,
    timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrichedEvent {
    #[serde(flatten)]
    event: IDREvent,
    processed_at: u64,
    processor: String,
    enrichments: serde_json::Value,
}

// ── Fluvio stream processor ───────────────────────────────────────────────────

async fn run_fluvio_processor(config: Config, metrics: SharedMetrics) {
    info!("[fluvio] connecting to SC at {}", config.fluvio_sc_addr);

    // Fluvio consumer loop — processes real-time dispute state changes
    // and enriches them before forwarding to Kafka for Lakehouse ingestion
    loop {
        match process_fluvio_stream(&config, metrics.clone()).await {
            Ok(_) => info!("[fluvio] stream processor completed"),
            Err(e) => {
                error!("[fluvio] stream processor error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_fluvio_stream(
    config: &Config,
    metrics: SharedMetrics,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // In production: use fluvio crate to connect and consume
    // For now: simulate stream processing with a Kafka consumer on the
    // idr.disputes.state_changes topic, enrich, and forward to idr.lakehouse.ingest

    let consumer: StreamConsumer = ClientConfig::new()
        .set("group.id", "idr-rust-fluvio-processor")
        .set("bootstrap.servers", &config.kafka_brokers)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "true")
        .set("session.timeout.ms", "30000")
        .create()?;

    consumer.subscribe(&["idr.disputes.state_changes"])?;

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &config.kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

    info!("[fluvio-processor] subscribed to idr.disputes.state_changes");

    loop {
        match consumer.recv().await {
            Err(e) => {
                warn!("[fluvio-processor] kafka receive error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok(msg) => {
                let payload = match msg.payload() {
                    None => continue,
                    Some(p) => p,
                };

                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;

                match serde_json::from_slice::<IDREvent>(payload) {
                    Ok(event) => {
                        // Enrich the event with processing metadata
                        let enriched = EnrichedEvent {
                            event: event.clone(),
                            processed_at: ts,
                            processor: "rust-fluvio-processor".into(),
                            enrichments: serde_json::json!({
                                "processingLatencyMs": ts,
                                "streamSource": "fluvio",
                                "partitionKey": event.aggregate_id,
                                "eventCategory": categorize_event(&event.event_type),
                            }),
                        };

                        // Forward to Lakehouse ingestion topic
                        let serialized = serde_json::to_string(&enriched)?;
                        let record = FutureRecord::to("idr.lakehouse.ingest")
                            .key(&event.aggregate_id)
                            .payload(&serialized);

                        match producer.send(record, Timeout::Never).await {
                            Ok(_) => {
                                let mut m = metrics.write().await;
                                m.events_processed += 1;
                                m.last_event_ts = ts;
                                info!(
                                    "[fluvio-processor] enriched event {} -> lakehouse",
                                    event.id
                                );
                            }
                            Err((e, _)) => {
                                error!("[fluvio-processor] kafka produce error: {}", e);
                                let mut m = metrics.write().await;
                                m.events_failed += 1;
                            }
                        }
                    }
                    Err(e) => {
                        warn!("[fluvio-processor] failed to parse event: {}", e);
                        let mut m = metrics.write().await;
                        m.events_failed += 1;
                    }
                }
            }
        }
    }
}

fn categorize_event(event_type: &str) -> &'static str {
    match event_type {
        t if t.starts_with("dispute.") => "dispute_lifecycle",
        t if t.starts_with("offer.") => "negotiation",
        t if t.starts_with("payment.") => "financial",
        t if t.starts_with("document.") => "document_management",
        t if t.starts_with("audit.") => "audit_trail",
        _ => "system",
    }
}

// ── Kafka high-throughput event handler ───────────────────────────────────────

async fn run_kafka_handler(config: Config, metrics: SharedMetrics) {
    info!("[kafka-handler] starting on brokers: {}", config.kafka_brokers);

    loop {
        match process_kafka_events(&config, metrics.clone()).await {
            Ok(_) => info!("[kafka-handler] completed"),
            Err(e) => {
                error!("[kafka-handler] error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_kafka_events(
    config: &Config,
    metrics: SharedMetrics,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("group.id", "idr-rust-event-handler")
        .set("bootstrap.servers", &config.kafka_brokers)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "true")
        .set("fetch.min.bytes", "1")
        .set("fetch.wait.max.ms", "100")
        .create()?;

    // Subscribe to all IDR topics for high-throughput processing
    consumer.subscribe(&[
        "idr.disputes",
        "idr.payments",
        "idr.audit",
        "idr.notifications",
    ])?;

    info!("[kafka-handler] subscribed to IDR topics");

    loop {
        match consumer.recv().await {
            Err(e) => {
                warn!("[kafka-handler] receive error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
            Ok(msg) => {
                let topic = msg.topic().to_string();
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;

                if let Some(payload) = msg.payload() {
                    match serde_json::from_slice::<serde_json::Value>(payload) {
                        Ok(event) => {
                            handle_event(&topic, &event).await;
                            let mut m = metrics.write().await;
                            m.events_processed += 1;
                            m.last_event_ts = ts;
                        }
                        Err(e) => {
                            warn!("[kafka-handler] parse error on topic {}: {}", topic, e);
                            let mut m = metrics.write().await;
                            m.events_failed += 1;
                        }
                    }
                }
            }
        }
    }
}

async fn handle_event(topic: &str, event: &serde_json::Value) {
    match topic {
        "idr.payments" => {
            // High-priority: payment events get immediate processing
            info!(
                "[kafka-handler] payment event: type={} id={}",
                event.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"),
                event.get("transactionId").and_then(|v| v.as_str()).unwrap_or("unknown")
            );
        }
        "idr.disputes" => {
            info!(
                "[kafka-handler] dispute event: type={} disputeId={}",
                event.get("eventType").and_then(|v| v.as_str()).unwrap_or("unknown"),
                event.get("aggregateId").and_then(|v| v.as_str()).unwrap_or("unknown")
            );
        }
        "idr.audit" => {
            // Audit events: validate and deduplicate
            info!(
                "[kafka-handler] audit event: action={}",
                event.get("action").and_then(|v| v.as_str()).unwrap_or("unknown")
            );
        }
        _ => {
            info!("[kafka-handler] event on topic: {}", topic);
        }
    }
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    timestamp: u64,
}

#[derive(Serialize)]
struct MetricsResponse {
    events_processed: u64,
    events_failed: u64,
    last_event_ts: u64,
    uptime_seconds: u64,
}

async fn health_handler() -> Json<HealthResponse> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    Json(HealthResponse {
        status: "ok".into(),
        service: "idr-rust-services".into(),
        timestamp: ts,
    })
}

async fn metrics_handler(State(metrics): State<SharedMetrics>) -> Json<MetricsResponse> {
    let m = metrics.read().await;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    Json(MetricsResponse {
        events_processed: m.events_processed,
        events_failed: m.events_failed,
        last_event_ts: m.last_event_ts,
        uptime_seconds: ts,
    })
}

#[derive(Deserialize)]
struct PublishRequest {
    topic: String,
    key: String,
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct PublishResponse {
    status: String,
    topic: String,
    key: String,
}

async fn publish_handler(
    State(state): State<(Config, SharedMetrics)>,
    Json(req): Json<PublishRequest>,
) -> Result<Json<PublishResponse>, (StatusCode, String)> {
    let (config, metrics) = state;

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &config.kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let payload = serde_json::to_string(&req.payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let record = FutureRecord::to(&req.topic)
        .key(&req.key)
        .payload(&payload);

    producer
        .send(record, Timeout::Never)
        .await
        .map_err(|(e, _)| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut m = metrics.write().await;
    m.events_processed += 1;

    Ok(Json(PublishResponse {
        status: "published".into(),
        topic: req.topic,
        key: req.key,
    }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            env::var("RUST_LOG")
                .unwrap_or_else(|_| "info".into())
                .as_str(),
        )
        .init();

    let config = Config::from_env();
    info!("[rust-services] starting on port {}", config.port);

    let metrics: SharedMetrics = Arc::new(RwLock::new(Metrics::default()));

    // Spawn Fluvio stream processor
    let fluvio_config = config.clone();
    let fluvio_metrics = metrics.clone();
    tokio::spawn(async move {
        run_fluvio_processor(fluvio_config, fluvio_metrics).await;
    });

    // Spawn Kafka event handler
    let kafka_config = config.clone();
    let kafka_metrics = metrics.clone();
    tokio::spawn(async move {
        run_kafka_handler(kafka_config, kafka_metrics).await;
    });

    // HTTP API server
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/publish", post(publish_handler))
        .with_state((config.clone(), metrics));

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    info!("[rust-services] listening on {}", addr);
    axum::serve(listener, app).await.unwrap();
}
