# Lakehouse spatial query — honest architecture note (Phase 15 FB / audit B5)

`USChoroplethMap.tsx` previously fetched `/api/trpc/lakehouse.spatialQuery`
claiming "server-side Sedona via JDBC". **No Sedona code, dependency, or
infrastructure ever existed in this repository** — the endpoint did not exist
and the overlay silently failed.

## Decision

Apache Sedona (and GeoLibre) are **NOT adopted**. Rationale:

- No geometry/geography columns exist in the schema; the platform's spatial
  dimension is state-level (`disputes.facilityState` / `patientState`).
- State-level rollups are a plain `GROUP BY` — a distributed spatial SQL
  engine would be unjustified complexity at this scale.
- Postgres (optionally PostGIS later) is sufficient for foreseeable needs.

## What exists now

`lakehouse.spatialQuery` (server/routers.ts) is a real, Postgres-native tRPC
procedure. `queryType: "dispute_density_by_state"` returns
`[{ stateCode, count }]` aggregated live from the `disputes` table.

If true geospatial analytics are ever required (point-in-polygon provider
catchments, distance queries), the honest path is PostGIS on the existing
Postgres cluster; Sedona would only be reconsidered if a Spark/Iceberg
lakehouse (see services/lakehouse) becomes a scheduled production pipeline.
