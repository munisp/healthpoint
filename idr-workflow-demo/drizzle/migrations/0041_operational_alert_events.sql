CREATE TABLE IF NOT EXISTS "operational_alert_events" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "alertFingerprint" varchar(128) NOT NULL,
  "alertName" varchar(128) NOT NULL,
  "service" varchar(128) NOT NULL,
  "severity" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL,
  "startsAt" timestamp NOT NULL,
  "endsAt" timestamp,
  "receivedAt" timestamp DEFAULT now() NOT NULL,
  "payloadSha256" varchar(64) NOT NULL,
  CONSTRAINT "operational_alert_events_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical')),
  CONSTRAINT "operational_alert_events_status_check" CHECK ("status" IN ('firing', 'resolved')),
  CONSTRAINT "operational_alert_events_fingerprint_check" CHECK ("alertFingerprint" ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT "operational_alert_events_name_check" CHECK ("alertName" ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT "operational_alert_events_service_check" CHECK ("service" ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT "operational_alert_events_hash_check" CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operational_alert_event_dedup_idx"
  ON "operational_alert_events" USING btree ("alertFingerprint", "status", "startsAt", "payloadSha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_alert_events_received_idx"
  ON "operational_alert_events" USING btree ("receivedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_alert_events_active_idx"
  ON "operational_alert_events" USING btree ("status", "severity", "service");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "healthpoint_prevent_operational_alert_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'operational alert receipt records are immutable';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "operational_alert_events_immutable" ON "operational_alert_events";
CREATE TRIGGER "operational_alert_events_immutable"
BEFORE UPDATE OR DELETE ON "operational_alert_events"
FOR EACH ROW EXECUTE FUNCTION "healthpoint_prevent_operational_alert_mutation"();
