"""
Spark Structured Streaming Job: IDR Disputes → Apache Iceberg

Reads from Kafka topic 'lakehouse-ingestion' (filtered for idr_disputes table),
applies schema enforcement, deduplication, and writes to the Iceberg table
using MERGE INTO for upserts.

Run with:
    spark-submit \
        --packages org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.4.2,\
                   org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
        --conf spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions \
        --conf spark.sql.catalog.iceberg=org.apache.iceberg.spark.SparkCatalog \
        --conf spark.sql.catalog.iceberg.type=rest \
        --conf spark.sql.catalog.iceberg.uri=http://iceberg-rest-catalog:8181 \
        --conf spark.sql.catalog.iceberg.warehouse=s3a://healthpoint-lakehouse/warehouse \
        idr_disputes_ingestion.py
"""
import os
import json
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType,
    TimestampType, BooleanType, LongType
)

# ── Schema ────────────────────────────────────────────────────────────────────
EVENT_SCHEMA = StructType([
    StructField("table", StringType(), False),
    StructField("namespace", StringType(), False),
    StructField("operation", StringType(), False),
    StructField("record_id", StringType(), False),
    StructField("event_time", StringType(), False),
    StructField("schema_version", StringType(), True),
    StructField("data", StringType(), True),  # JSON string
])

DISPUTE_SCHEMA = StructType([
    StructField("id", StringType(), False),
    StructField("case_number", StringType(), True),
    StructField("status", StringType(), True),
    StructField("provider_id", StringType(), True),
    StructField("payer_id", StringType(), True),
    StructField("idr_entity_id", StringType(), True),
    StructField("billed_amount", DoubleType(), True),
    StructField("qpa_amount", DoubleType(), True),
    StructField("determination_amount", DoubleType(), True),
    StructField("service_code", StringType(), True),
    StructField("service_description", StringType(), True),
    StructField("service_date", TimestampType(), True),
    StructField("facility_type", StringType(), True),
    StructField("batched_dispute", BooleanType(), True),
    StructField("batch_id", StringType(), True),
    StructField("created_at", TimestampType(), True),
    StructField("updated_at", TimestampType(), True),
    StructField("open_negotiation_deadline", TimestampType(), True),
    StructField("determination_deadline", TimestampType(), True),
    StructField("payment_deadline", TimestampType(), True),
    StructField("tenant_id", StringType(), True),
])


def create_spark_session() -> SparkSession:
    return (
        SparkSession.builder
        .appName("healthpoint-idr-disputes-ingestion")
        .config("spark.sql.extensions",
                "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.iceberg",
                "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.iceberg.type", "rest")
        .config("spark.sql.catalog.iceberg.uri",
                os.getenv("ICEBERG_REST_CATALOG_URL", "http://iceberg-rest-catalog:8181"))
        .config("spark.sql.catalog.iceberg.warehouse",
                os.getenv("ICEBERG_WAREHOUSE", "s3a://healthpoint-lakehouse/warehouse"))
        # S3 config
        .config("spark.hadoop.fs.s3a.endpoint",
                os.getenv("S3_ENDPOINT", "http://minio:9000"))
        .config("spark.hadoop.fs.s3a.access.key",
                os.getenv("S3_ACCESS_KEY", ""))
        .config("spark.hadoop.fs.s3a.secret.key",
                os.getenv("S3_SECRET_KEY", ""))
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl",
                "org.apache.hadoop.fs.s3a.S3AFileSystem")
        # Streaming config
        .config("spark.streaming.stopGracefullyOnShutdown", "true")
        .config("spark.sql.shuffle.partitions", "12")
        .getOrCreate()
    )


def ensure_iceberg_table(spark: SparkSession):
    """Create the Iceberg table if it doesn't exist."""
    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS iceberg.healthpoint.idr_disputes (
            id STRING NOT NULL,
            case_number STRING,
            status STRING,
            provider_id STRING,
            payer_id STRING,
            idr_entity_id STRING,
            billed_amount DOUBLE,
            qpa_amount DOUBLE,
            determination_amount DOUBLE,
            service_code STRING,
            service_description STRING,
            service_date TIMESTAMP,
            facility_type STRING,
            batched_dispute BOOLEAN,
            batch_id STRING,
            created_at TIMESTAMP,
            updated_at TIMESTAMP,
            open_negotiation_deadline TIMESTAMP,
            determination_deadline TIMESTAMP,
            payment_deadline TIMESTAMP,
            tenant_id STRING,
            _ingested_at TIMESTAMP,
            _operation STRING
        )
        USING iceberg
        PARTITIONED BY (
            days(created_at),
            status,
            tenant_id
        )
        TBLPROPERTIES (
            'write.format.default' = 'parquet',
            'write.parquet.compression-codec' = 'zstd',
            'write.metadata.compression-codec' = 'gzip',
            'history.expire.max-snapshot-age-ms' = '604800000',
            'write.target-file-size-bytes' = '134217728',
            'read.split.target-size' = '134217728'
        )
    """)


def process_batch(df, batch_id: int):
    """Process a micro-batch: upsert disputes into Iceberg."""
    spark = df.sparkSession

    if df.isEmpty():
        return

    # Add ingestion metadata
    df_with_meta = df.withColumn("_ingested_at", F.current_timestamp())

    # Separate inserts/updates from deletes
    upserts = df_with_meta.filter(F.col("_operation").isin(["INSERT", "UPDATE"]))
    deletes = df_with_meta.filter(F.col("_operation") == "DELETE")

    # MERGE INTO for upserts
    if not upserts.isEmpty():
        upserts.createOrReplaceTempView("dispute_upserts")
        spark.sql("""
            MERGE INTO iceberg.healthpoint.idr_disputes AS target
            USING (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
                    FROM dispute_upserts
                ) WHERE rn = 1
            ) AS source
            ON target.id = source.id
            WHEN MATCHED THEN UPDATE SET *
            WHEN NOT MATCHED THEN INSERT *
        """)

    # Soft-delete (mark as deleted rather than physical delete for audit)
    if not deletes.isEmpty():
        deletes.createOrReplaceTempView("dispute_deletes")
        spark.sql("""
            MERGE INTO iceberg.healthpoint.idr_disputes AS target
            USING dispute_deletes AS source
            ON target.id = source.id
            WHEN MATCHED THEN UPDATE SET target.status = 'DELETED', target._operation = 'DELETE',
                                         target._ingested_at = source._ingested_at
        """)


def main():
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")

    ensure_iceberg_table(spark)

    kafka_bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")

    # Read from Kafka
    raw_stream = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", kafka_bootstrap)
        .option("subscribe", "lakehouse-ingestion")
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .option("kafka.group.id", "spark-idr-disputes-ingestion")
        .option("maxOffsetsPerTrigger", 50000)
        .load()
    )

    # Parse event envelope
    parsed = (
        raw_stream
        .select(F.from_json(F.col("value").cast("string"), EVENT_SCHEMA).alias("event"))
        .select("event.*")
        .filter(F.col("table") == "idr_disputes")
    )

    # Parse the nested data JSON into dispute columns
    disputes = (
        parsed
        .withColumn("data_parsed", F.from_json(F.col("data"), DISPUTE_SCHEMA))
        .select(
            F.col("data_parsed.*"),
            F.col("operation").alias("_operation"),
        )
        .withColumn("updated_at", F.coalesce(
            F.col("updated_at"),
            F.to_timestamp(F.lit(None))
        ))
    )

    # Write stream with foreachBatch for MERGE INTO support
    query = (
        disputes.writeStream
        .foreachBatch(process_batch)
        .option("checkpointLocation",
                os.getenv("CHECKPOINT_LOCATION",
                          "s3a://healthpoint-lakehouse/checkpoints/idr-disputes"))
        .trigger(processingTime="30 seconds")
        .start()
    )

    query.awaitTermination()


if __name__ == "__main__":
    main()
