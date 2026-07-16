/// fluvio_bootstrap.rs
/// Creates all required Fluvio topics on startup if they don't already exist.
/// Called once from main() before starting the stream processor.

use fluvio::FluvioAdmin;

const TOPICS: &[(&str, u32, u32)] = &[
    // (name, partitions, replication_factor)
    ("idr.dispute.events", 3, 1),
    ("idr.payments",       2, 1),
    ("idr.audit",          2, 1),
    ("idr.dlq",            1, 1),
    ("idr.analytics",      2, 1),
];

pub async fn bootstrap_topics() -> anyhow::Result<()> {
    let admin = FluvioAdmin::connect().await?;
    let existing: Vec<String> = admin
        .list::<fluvio::metadata::topic::TopicSpec, _>(vec![])
        .await?
        .into_iter()
        .map(|t| t.name)
        .collect();

    for (name, partitions, _replication) in TOPICS {
        if existing.contains(&name.to_string()) {
            tracing::info!("Fluvio topic '{}' already exists — skipping", name);
            continue;
        }
        let spec = fluvio::metadata::topic::TopicSpec::new_computed(
            *partitions as i32,
            1,
            Some(false),
        );
        match admin.create(name.to_string(), false, spec).await {
            Ok(_) => tracing::info!("Created Fluvio topic '{}'", name),
            Err(e) => tracing::warn!("Failed to create Fluvio topic '{}': {}", name, e),
        }
    }
    Ok(())
}
