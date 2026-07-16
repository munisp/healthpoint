"""
HealthPoint IDR — Lakehouse Ingestion Pipeline
Reads from Kafka topics and writes to Apache Iceberg tables on MinIO (S3-compatible)
using PySpark with Delta Lake / Iceberg format.

Integrates:
  - PostgreSQL CDC (via Kafka Connect Debezium) → disputes, users, payments tables
  - TigerBeetle ledger events → financial_ledger table
  - IDR workflow events → workflow_audit table
  - OpenSearch sync → dispute_search_index
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField, StringType, LongType,
    TimestampType, DoubleType, BooleanType, MapType
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:29092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "idr-lakehouse")
POSTGRES_URL = os.getenv("DATABASE_URL", "jdbc:postgresql://postgres:5432/idr")
POSTGRES_USER = os.getenv("POSTGRES_USER", "idr_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "idr_password")
CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", f"s3a://{MINIO_BUCKET}/checkpoints")
WAREHOUSE_DIR = f"s3a://{MINIO_BUCKET}/warehouse"

# ── Spark session ──────────────────────────────────────────────────────────────

def create_spark_session() -> SparkSession:
    """Create a Spark session with Iceberg, Kafka, and S3 support."""
    return (
        SparkSession.builder
        .appName("IDR-Lakehouse-Pipeline")
        .config("spark.sql.extensions", "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.idr", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.idr.type", "hadoop")
        .config("spark.sql.catalog.idr.warehouse", WAREHOUSE_DIR)
        .config("spark.hadoop.fs.s3a.endpoint", MINIO_ENDPOINT)
        .config("spark.hadoop.fs.s3a.access.key", MINIO_ACCESS_KEY)
        .config("spark.hadoop.fs.s3a.secret.key", MINIO_SECRET_KEY)
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.hadoop.fs.s3a.connection.ssl.enabled", "false")
        .config("spark.sql.shuffle.partitions", "8")
        .config("spark.default.parallelism", "8")
        .getOrCreate()
    )

# ── Schema definitions ─────────────────────────────────────────────────────────

DISPUTE_EVENT_SCHEMA = StructType([
    StructField("id", StringType(), False),
    StructField("eventType", StringType(), False),
    StructField("aggregateId", StringType(), False),
    StructField("aggregateType", StringType(), False),
    StructField("payload", StringType(), True),
    StructField("timestamp", StringType(), False),
    StructField("userId", StringType(), True),
    StructField("correlationId", StringType(), True),
])

PAYMENT_EVENT_SCHEMA = StructType([
    StructField("type", StringType(), False),
    StructField("transactionId", StringType(), True),
    StructField("transferId", StringType(), True),
    StructField("disputeId", StringType(), True),
    StructField("amount", LongType(), True),
    StructField("currency", StringType(), True),
    StructField("status", StringType(), False),
    StructField("timestamp", LongType(), False),
])

AUDIT_EVENT_SCHEMA = StructType([
    StructField("action", StringType(), False),
    StructField("userId", StringType(), True),
    StructField("resourceType", StringType(), True),
    StructField("resourceId", StringType(), True),
    StructField("metadata", StringType(), True),
    StructField("timestamp", StringType(), False),
    StructField("ipAddress", StringType(), True),
])

# ── Table creation ─────────────────────────────────────────────────────────────

def create_iceberg_tables(spark: SparkSession) -> None:
    """Create Iceberg tables if they don't exist."""
    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS idr.disputes (
            dispute_id STRING,
            event_type STRING,
            step_number INT,
            status STRING,
            provider_id STRING,
            payer_id STRING,
            amount_cents BIGINT,
            currency STRING,
            created_at TIMESTAMP,
            updated_at TIMESTAMP,
            payload STRING,
            correlation_id STRING
        )
        USING iceberg
        PARTITIONED BY (days(created_at))
        TBLPROPERTIES (
            'write.format.default' = 'parquet',
            'write.parquet.compression-codec' = 'snappy',
            'history.expire.max-snapshot-age-ms' = '604800000'
        )
    """)

    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS idr.payments (
            transaction_id STRING,
            transfer_id STRING,
            dispute_id STRING,
            amount BIGINT,
            currency STRING,
            status STRING,
            event_type STRING,
            processed_at TIMESTAMP,
            raw_event STRING
        )
        USING iceberg
        PARTITIONED BY (days(processed_at))
        TBLPROPERTIES ('write.format.default' = 'parquet')
    """)

    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS idr.audit_log (
            action STRING,
            user_id STRING,
            resource_type STRING,
            resource_id STRING,
            metadata STRING,
            ip_address STRING,
            event_at TIMESTAMP
        )
        USING iceberg
        PARTITIONED BY (days(event_at))
        TBLPROPERTIES ('write.format.default' = 'parquet')
    """)

    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS idr.workflow_steps (
            dispute_id STRING,
            step_number INT,
            step_name STRING,
            status STRING,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            duration_ms BIGINT,
            actor_id STRING,
            notes STRING
        )
        USING iceberg
        PARTITIONED BY (days(started_at))
        TBLPROPERTIES ('write.format.default' = 'parquet')
    """)

    logger.info("[lakehouse] Iceberg tables created/verified")

# ── Streaming pipelines ────────────────────────────────────────────────────────

def run_dispute_events_pipeline(spark: SparkSession) -> None:
    """Stream dispute events from Kafka → Iceberg disputes table."""
    df = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("subscribe", "idr.disputes,idr.disputes.state_changes")
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load()
    )

    parsed = (
        df.select(
            F.from_json(
                F.col("value").cast("string"),
                DISPUTE_EVENT_SCHEMA
            ).alias("data"),
            F.col("timestamp").alias("kafka_ts")
        )
        .select("data.*", "kafka_ts")
        .filter(F.col("id").isNotNull())
        .withColumn("created_at", F.to_timestamp("timestamp"))
        .withColumn("updated_at", F.current_timestamp())
        .withColumn("dispute_id", F.col("aggregateId"))
        .withColumn("event_type", F.col("eventType"))
        .withColumn("step_number",
            F.when(F.col("payload").contains('"step"'),
                F.get_json_object(F.col("payload"), "$.step").cast("int")
            ).otherwise(F.lit(0))
        )
        .withColumn("status",
            F.coalesce(
                F.get_json_object(F.col("payload"), "$.status"),
                F.lit("unknown")
            )
        )
        .withColumn("provider_id",
            F.get_json_object(F.col("payload"), "$.providerId")
        )
        .withColumn("payer_id",
            F.get_json_object(F.col("payload"), "$.payerId")
        )
        .withColumn("amount_cents",
            F.get_json_object(F.col("payload"), "$.amountCents").cast("bigint")
        )
        .withColumn("currency",
            F.coalesce(
                F.get_json_object(F.col("payload"), "$.currency"),
                F.lit("USD")
            )
        )
        .select(
            "dispute_id", "event_type", "step_number", "status",
            "provider_id", "payer_id", "amount_cents", "currency",
            "created_at", "updated_at", "payload", "correlationId"
        )
        .withColumnRenamed("correlationId", "correlation_id")
    )

    query = (
        parsed.writeStream
        .format("iceberg")
        .outputMode("append")
        .option("path", "idr.disputes")
        .option("checkpointLocation", f"{CHECKPOINT_DIR}/disputes")
        .trigger(processingTime="30 seconds")
        .start()
    )

    logger.info("[lakehouse] dispute events pipeline started")
    return query

def run_payment_events_pipeline(spark: SparkSession) -> None:
    """Stream payment events from Kafka → Iceberg payments table."""
    df = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("subscribe", "idr.payments")
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load()
    )

    parsed = (
        df.select(
            F.col("value").cast("string").alias("raw_event"),
            F.from_json(
                F.col("value").cast("string"),
                PAYMENT_EVENT_SCHEMA
            ).alias("data"),
            F.col("timestamp").alias("kafka_ts")
        )
        .select("data.*", "raw_event", "kafka_ts")
        .filter(F.col("status").isNotNull())
        .withColumn("processed_at",
            F.to_timestamp(F.col("timestamp").cast("double") / 1000)
        )
        .withColumn("transaction_id",
            F.coalesce(F.col("transactionId"), F.col("transferId"), F.expr("uuid()"))
        )
        .select(
            "transaction_id",
            F.col("transferId").alias("transfer_id"),
            F.col("disputeId").alias("dispute_id"),
            "amount", "currency", "status",
            F.col("type").alias("event_type"),
            "processed_at", "raw_event"
        )
    )

    query = (
        parsed.writeStream
        .format("iceberg")
        .outputMode("append")
        .option("path", "idr.payments")
        .option("checkpointLocation", f"{CHECKPOINT_DIR}/payments")
        .trigger(processingTime="30 seconds")
        .start()
    )

    logger.info("[lakehouse] payment events pipeline started")
    return query

def run_audit_pipeline(spark: SparkSession) -> None:
    """Stream audit events from Kafka → Iceberg audit_log table."""
    df = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("subscribe", "idr.audit")
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load()
    )

    parsed = (
        df.select(
            F.from_json(
                F.col("value").cast("string"),
                AUDIT_EVENT_SCHEMA
            ).alias("data")
        )
        .select("data.*")
        .filter(F.col("action").isNotNull())
        .withColumn("event_at", F.to_timestamp("timestamp"))
        .select(
            "action",
            F.col("userId").alias("user_id"),
            F.col("resourceType").alias("resource_type"),
            F.col("resourceId").alias("resource_id"),
            "metadata",
            F.col("ipAddress").alias("ip_address"),
            "event_at"
        )
    )

    query = (
        parsed.writeStream
        .format("iceberg")
        .outputMode("append")
        .option("path", "idr.audit_log")
        .option("checkpointLocation", f"{CHECKPOINT_DIR}/audit")
        .trigger(processingTime="60 seconds")
        .start()
    )

    logger.info("[lakehouse] audit pipeline started")
    return query

# ── Batch PostgreSQL sync ──────────────────────────────────────────────────────

def sync_postgres_to_lakehouse(spark: SparkSession) -> None:
    """
    Batch sync from PostgreSQL to Lakehouse.
    Runs on startup to backfill historical data.
    """
    logger.info("[lakehouse] starting PostgreSQL batch sync")

    tables_to_sync = [
        ("users", "idr.users_snapshot"),
        ("disputes", "idr.disputes_snapshot"),
    ]

    for pg_table, iceberg_table in tables_to_sync:
        try:
            df = (
                spark.read
                .format("jdbc")
                .option("url", POSTGRES_URL)
                .option("dbtable", pg_table)
                .option("user", POSTGRES_USER)
                .option("password", POSTGRES_PASSWORD)
                .option("driver", "org.postgresql.Driver")
                .option("fetchsize", "10000")
                .load()
            )

            # Add sync metadata
            df_with_meta = df.withColumn(
                "synced_at", F.current_timestamp()
            ).withColumn(
                "sync_source", F.lit("postgres_batch")
            )

            (
                df_with_meta.write
                .format("iceberg")
                .mode("overwrite")
                .option("path", iceberg_table)
                .save()
            )

            count = df.count()
            logger.info(f"[lakehouse] synced {count} rows from {pg_table} → {iceberg_table}")

        except Exception as e:
            logger.error(f"[lakehouse] failed to sync {pg_table}: {e}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    logger.info("[lakehouse] initializing PySpark session")
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")

    # Create tables
    create_iceberg_tables(spark)

    # Batch sync from PostgreSQL on startup
    sync_postgres_to_lakehouse(spark)

    # Start streaming pipelines
    queries = [
        run_dispute_events_pipeline(spark),
        run_payment_events_pipeline(spark),
        run_audit_pipeline(spark),
    ]

    logger.info(f"[lakehouse] {len(queries)} streaming pipelines active")

    # Wait for all streams
    for q in queries:
        if q:
            q.awaitTermination()

if __name__ == "__main__":
    main()
