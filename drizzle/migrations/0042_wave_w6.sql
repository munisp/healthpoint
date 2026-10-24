-- wave-w6 (data/interop remediation)
-- Columns/tables added here are accessed via raw SQL in server code;
-- drizzle/schema.ts is owned by another wave and intentionally NOT edited.

-- W6-2: per-field provenance on disputes. Records, per dispute field, whether
-- the current value came from an EMR pull ("emr") or a manual edit
-- ("manual"), so EMR re-pulls never silently overwrite manual edits.
-- Shape: { "fields": { "<field>": "emr"|"manual" }, "lastEmrPullAt": iso }
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "fieldProvenance" jsonb;
