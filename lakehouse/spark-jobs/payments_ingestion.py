"""
Spark Structured Streaming Job: Payments + TigerBeetle Ledger → Apache Iceberg

Reads from Kafka 'lakehouse-ingestion' (filtered for payments and payment_ledger),
writes to Iceberg tables for financial analytics and regulatory reporting.
"""
import os
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType,
    TimestampType, LongType, BooleanType
)

PAYMENT_SCHEMA = StructType([
    StructField("id", StringType(), False),
    StructField("dispute_id", StringType(), True),
    StructField("claim_id", StringType(), True),
    StructField("payer_id", StringType(), True),
    StructField("provider_id", StringType(), True),
    StructField("amount", DoubleType(), True),
    StructField("currency", StringType(), True),
    StructField("status", StringType(), True),
    StructField("payment_type", StringType(), True),
    StructField("payment_method", StringType(), True),
    StructField("tigerbeetle_transfer_id", LongType(), True),
    StructField("tigerbeetle_debit_account", LongType(), True),
    StructField("tigerbeetle_credit_account", LongType(), True),
    StructField("mojaloop_transfer_id", StringType(), True),
    StructField("late_payment_interest", DoubleType(), True),
    StructField("due_date", TimestampType(), True),
    StructField("paid_at", TimestampType(), True),
    StructField("created_at", TimestampType(), True),
    StructField("tenant_id", StringType(), True),
])

LEDGER_SCHEMA = StructType([
    StructField("transfer_id", LongType(), False),
    StructField("debit_account_id", LongType(), False),
    StructField("credit_account_id", LongType(), False),
    StructField("amount", LongType(), False),  # in cents
    StructField("currency_code", LongType(), True),
    StructField("transfer_flags", LongType(), True),
    StructField("pending_id", LongType(), True),
    StructField("user_data_128", LongType(), True),
    StructField("user_data_64", LongType(), True),
    StructField("user_data_32", LongType(), True),
    StructField("ledger", LongType(), True),
    StructField("code", LongType(), True),
    StructField("timestamp", LongType(), True),  # nanoseconds
    StructField("payment_id", StringType(), True),
    StructField("dispute_id", StringType(), True),
    StructField("tenant_id", StringType(), True),
])


def create_spark_session() -> SparkSession:
    return (
        SparkSession.builder
        .appName("healthpoint-payments-ingestion")
        .config("spark.sql.extensions",
                "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.iceberg", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.iceberg.type", "rest")
        .config("spark.sql.catalog.iceberg.uri",
                os.getenv("ICEBERG_REST_CATALOG_URL", "http://iceberg-rest-catalog:8181"))
        .config("spark.sql.catalog.iceberg.warehouse",
                os.getenv("ICEBERG_WAREHOUSE", "s3a://healthpoint-lakehouse/warehouse"))
        .config("spark.hadoop.fs.s3a.endpoint",
                os.getenv("S3_ENDPOINT", "http://minio:9000"))
        .config("spark.hadoop.fs.s3a.access.key", os.getenv("S3_ACCESS_KEY", ""))
        .config("spark.hadoop.fs.s3a.secret.key", os.getenv("S3_SECRET_KEY", ""))
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.streaming.stopGracefullyOnShutdown", "true")
        .config("spark.sql.shuffle.partitions", "12")
        .getOrCreate()
    )


def ensure_iceberg_tables(spark: SparkSession):
    spark.sql("""
        CREATE TABLE IF NOT EXISTS iceberg.healthpoint.payments (
            id STRING NOT NULL,
            dispute_id STRING,
            claim_id STRING,
            payer_id STRING,
            provider_id STRING,
            amount DOUBLE,
            currency STRING,
            status STRING,
            payment_type STRING,
            payment_method STRING,
            tigerbeetle_transfer_id LONG,
            tigerbeetle_debit_account LONG,
            tigerbeetle_credit_account LONG,
            mojaloop_transfer_id STRING,
            late_payment_interest DOUBLE,
            due_date TIMESTAMP,
            paid_at TIMESTAMP,
            created_at TIMESTAMP,
            tenant_id STRING,
            _ingested_at TIMESTAMP,
            _operation STRING
        )
        USING iceberg
        PARTITIONED BY (months(created_at), status, tenant_id)
        TBLPROPERTIES (
            'write.format.default' = 'parquet',
            'write.parquet.compression-codec' = 'zstd',
            'history.expire.max-snapshot-age-ms' = '2592000000'
        )
    """)

    spark.sql("""
        CREATE TABLE IF NOT EXISTS iceberg.healthpoint.payment_ledger (
            transfer_id LONG NOT NULL,
            debit_account_id LONG NOT NULL,
            credit_account_id LONG NOT NULL,
            amount LONG NOT NULL,
            currency_code LONG,
            transfer_flags LONG,
            pending_id LONG,
            user_data_128 LONG,
            user_data_64 LONG,
            user_data_32 LONG,
            ledger LONG,
            code LONG,
            timestamp_ns LONG,
            timestamp_ts TIMESTAMP,
            payment_id STRING,
            dispute_id STRING,
            tenant_id STRING,
            _ingested_at TIMESTAMP
        )
        USING iceberg
        PARTITIONED BY (days(timestamp_ts), tenant_id)
        TBLPROPERTIES (
            'write.format.default' = 'parquet',
            'write.parquet.compression-codec' = 'zstd',
            'history.expire.max-snapshot-age-ms' = '31536000000'
        )
    """)


def process_payments_batch(df, batch_id: int):
    spark = df.sparkSession
    if df.isEmpty():
        return

    df.withColumn("_ingested_at", F.current_timestamp()) \
      .createOrReplaceTempView("payment_upserts")

    spark.sql("""
        MERGE INTO iceberg.healthpoint.payments AS target
        USING (
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY created_at DESC) AS rn
                FROM payment_upserts
            ) WHERE rn = 1
        ) AS source
        ON target.id = source.id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)


def process_ledger_batch(df, batch_id: int):
    spark = df.sparkSession
    if df.isEmpty():
        return

    df_with_ts = df.withColumn(
        "timestamp_ts",
        F.to_timestamp(F.col("timestamp_ns") / 1e9)
    ).withColumn("_ingested_at", F.current_timestamp())

    df_with_ts.createOrReplaceTempView("ledger_inserts")

    # Ledger entries are immutable — INSERT ONLY (no updates)
    spark.sql("""
        INSERT INTO iceberg.healthpoint.payment_ledger
        SELECT * FROM ledger_inserts
        WHERE NOT EXISTS (
            SELECT 1 FROM iceberg.healthpoint.payment_ledger
            WHERE transfer_id = ledger_inserts.transfer_id
        )
    """)


def main():
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")
    ensure_iceberg_tables(spark)

    kafka_bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")

    EVENT_SCHEMA = StructType([
        StructField("table", StringType(), False),
        StructField("namespace", StringType(), False),
        StructField("operation", StringType(), False),
        StructField("record_id", StringType(), False),
        StructField("event_time", StringType(), False),
        StructField("data", StringType(), True),
    ])

    raw_stream = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", kafka_bootstrap)
        .option("subscribe", "lakehouse-ingestion")
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .option("kafka.group.id", "spark-payments-ingestion")
        .option("maxOffsetsPerTrigger", 50000)
        .load()
    )

    parsed = (
        raw_stream
        .select(F.from_json(F.col("value").cast("string"), EVENT_SCHEMA).alias("event"))
        .select("event.*")
    )

    # Payments stream
    payments_stream = (
        parsed.filter(F.col("table") == "payments")
        .withColumn("data_parsed", F.from_json(F.col("data"), PAYMENT_SCHEMA))
        .select(F.col("data_parsed.*"), F.col("operation").alias("_operation"))
    )

    # Ledger stream
    ledger_stream = (
        parsed.filter(F.col("table") == "payment_ledger")
        .withColumn("data_parsed", F.from_json(F.col("data"), LEDGER_SCHEMA))
        .select(F.col("data_parsed.*"), F.col("operation").alias("_operation"))
    )

    payments_query = (
        payments_stream.writeStream
        .foreachBatch(process_payments_batch)
        .option("checkpointLocation",
                os.getenv("CHECKPOINT_PAYMENTS",
                          "s3a://healthpoint-lakehouse/checkpoints/payments"))
        .trigger(processingTime="30 seconds")
        .start()
    )

    ledger_query = (
        ledger_stream.writeStream
        .foreachBatch(process_ledger_batch)
        .option("checkpointLocation",
                os.getenv("CHECKPOINT_LEDGER",
                          "s3a://healthpoint-lakehouse/checkpoints/payment-ledger"))
        .trigger(processingTime="30 seconds")
        .start()
    )

    spark.streams.awaitAnyTermination()


if __name__ == "__main__":
    main()
