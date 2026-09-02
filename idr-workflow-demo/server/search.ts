/**
 * Durable full-text search service backed exclusively by OpenSearch.
 *
 * HealthPoint does not maintain an in-process search index. A missing, insecure, or
 * unavailable OpenSearch service raises SearchUnavailableError so callers cannot
 * present stale or partial process-local results as an authoritative search response.
 */
import fs from "node:fs";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";

export type SearchEntityType =
  | "dispute"
  | "document"
  | "audit"
  | "payer_contact"
  | "idr_entity"
  | "expert"
  | "regulatory"
  | "qpa_benchmark";

export interface SearchHit<T = Record<string, unknown>> {
  id: string;
  entityType: SearchEntityType;
  score: number;
  item: T;
  highlights?: Record<string, string[]>;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  query: string;
  entityTypes: SearchEntityType[];
  took: number;
}

export class SearchUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SearchUnavailableError";
    this.cause = cause;
  }
}

const ENTITY_INDEX_MAP: Record<SearchEntityType, string> = {
  dispute: "idr-disputes",
  document: "idr-documents",
  audit: "idr-audit",
  payer_contact: "idr-payer-contacts",
  idr_entity: "idr-entities",
  expert: "idr-expert-panel",
  regulatory: "idr-regulatory",
  qpa_benchmark: "idr-qpa-benchmarks",
};

const ALL_ENTITY_TYPES: SearchEntityType[] = Object.keys(ENTITY_INDEX_MAP) as SearchEntityType[];
let client: OpenSearchClient | undefined;

function configuredClient(): OpenSearchClient {
  if (client) return client;
  const node = process.env.OPENSEARCH_URL?.trim();
  const username = process.env.OPENSEARCH_USER?.trim();
  const password = process.env.OPENSEARCH_PASSWORD;
  const caPath = process.env.OPENSEARCH_CA_PATH?.trim();
  const production = process.env.NODE_ENV === "production";
  if (!node) throw new SearchUnavailableError("OpenSearch is not configured");

  let parsed: URL;
  try {
    parsed = new URL(node);
  } catch (error) {
    throw new SearchUnavailableError("OPENSEARCH_URL is invalid", error);
  }
  if (production && parsed.protocol !== "https:") {
    throw new SearchUnavailableError("OPENSEARCH_URL must use https in production");
  }
  if (production && (!username || !password || !caPath)) {
    throw new SearchUnavailableError("OpenSearch requires username, password, and CA path in production");
  }
  let ca: string | undefined;
  if (caPath) {
    try {
      ca = fs.readFileSync(caPath, "utf8");
    } catch (error) {
      throw new SearchUnavailableError("OPENSEARCH_CA_PATH is unreadable", error);
    }
  }
  client = new OpenSearchClient({
    node: parsed.origin,
    auth: username && password ? { username, password } : undefined,
    ssl: { rejectUnauthorized: production || Boolean(ca), ...(ca ? { ca } : {}) },
  });
  return client;
}

function asEntityType(index: unknown): SearchEntityType {
  const value = String(index ?? "");
  if (value.includes("audit")) return "audit";
  if (value.includes("document")) return "document";
  if (value.includes("payer")) return "payer_contact";
  if (value.includes("entities")) return "idr_entity";
  if (value.includes("expert")) return "expert";
  if (value.includes("regulatory")) return "regulatory";
  if (value.includes("qpa")) return "qpa_benchmark";
  return "dispute";
}

export interface SearchQuery {
  q: string;
  entityTypes?: SearchEntityType[];
  limit?: number;
  userId?: string;
  userRole?: "user" | "admin";
}

/** Execute a durable OpenSearch query. Authorization filtering remains the caller's responsibility. */
export async function search(query: SearchQuery): Promise<SearchResult> {
  const q = query.q.trim();
  const entityTypes = query.entityTypes?.length ? query.entityTypes : ALL_ENTITY_TYPES;
  const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
  if (q.length < 2) return { total: 0, hits: [], query: q, entityTypes, took: 0 };
  const start = Date.now();
  try {
    const response = await configuredClient().search({
      index: entityTypes.map((entityType) => ENTITY_INDEX_MAP[entityType]).join(","),
      body: {
        size: limit,
        query: {
          multi_match: {
            query: q,
            fields: ["referenceNumber^3", "name^2", "title^2", "status", "action", "category", "specialty"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
        highlight: { fields: { title: {}, description: {}, summary: {} } },
      },
    });
    const raw = (response.body.hits?.hits ?? []) as Array<Record<string, unknown>>;
    const totalRaw = response.body.hits?.total;
    const total = typeof totalRaw === "object" && totalRaw ? Number((totalRaw as { value?: number }).value ?? raw.length) : Number(totalRaw ?? raw.length);
    return {
      total,
      query: q,
      entityTypes,
      took: Date.now() - start,
      hits: raw.map((hit) => ({
        id: String(hit._id ?? ""),
        entityType: asEntityType(hit._index),
        score: Number(hit._score ?? 0),
        item: (hit._source ?? {}) as Record<string, unknown>,
        highlights: (hit.highlight ?? {}) as Record<string, string[]>,
      })),
    };
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw error;
    throw new SearchUnavailableError("OpenSearch query failed", error);
  }
}

/** Index a durable business record. Failures are surfaced so a durable caller can retry. */
export async function indexDocument(entityType: SearchEntityType, id: string, payload: Record<string, unknown>): Promise<void> {
  if (!id) throw new Error("Search document ID is required");
  try {
    await configuredClient().index({
      index: ENTITY_INDEX_MAP[entityType],
      id,
      body: { ...payload, updatedAt: new Date().toISOString() },
      refresh: false,
    });
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw error;
    throw new SearchUnavailableError(`OpenSearch index write failed for ${entityType}`, error);
  }
}

export async function indexDispute(disputeId: string, payload: Record<string, unknown>): Promise<void> {
  await indexDocument("dispute", disputeId, { disputeId, ...payload });
}

export async function deleteFromIndex(entityType: SearchEntityType, id: string): Promise<void> {
  try {
    await configuredClient().delete({ index: ENTITY_INDEX_MAP[entityType], id, refresh: false });
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw error;
    const statusCode = (error as { meta?: { statusCode?: number } })?.meta?.statusCode;
    if (statusCode === 404) return;
    throw new SearchUnavailableError(`OpenSearch delete failed for ${entityType}`, error);
  }
}

/** Retained only as a compatibility no-op: there is no process-local index to invalidate. */
export function invalidateSearchIndex(): void {}


export interface SuggestResult {
  text: string;
  score: number;
  entityType: SearchEntityType;
}

/** OpenSearch completion suggestions only; unavailable search is an explicit error. */
export async function suggest(prefix: string, limit = 8): Promise<SuggestResult[]> {
  const normalized = prefix.trim();
  if (normalized.length < 2) return [];
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  try {
    const response = await configuredClient().search({
      index: Object.values(ENTITY_INDEX_MAP).join(","),
      body: {
        suggest: {
          entity_suggest: {
            prefix: normalized,
            completion: { field: "suggest", size: boundedLimit, skip_duplicates: true, fuzzy: { fuzziness: "AUTO" } },
          },
        },
      },
    });
    const options = (response.body.suggest?.entity_suggest?.[0]?.options ?? []) as Array<{ text?: string; _score?: number; _index?: string }>;
    return options.slice(0, boundedLimit).flatMap((option) => {
      const text = option.text?.trim();
      return text ? [{ text, score: Number(option._score ?? 0), entityType: asEntityType(option._index) }] : [];
    });
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw error;
    throw new SearchUnavailableError("OpenSearch suggestion query failed", error);
  }
}

const INDEX_MAPPINGS: Record<string, object> = Object.fromEntries(
  Object.values(ENTITY_INDEX_MAP).map((indexName) => [indexName, {
    settings: { number_of_shards: 1, number_of_replicas: 1 },
    mappings: { dynamic: "strict", properties: {
      id: { type: "keyword" },
      disputeId: { type: "keyword" },
      referenceNumber: { type: "keyword" },
      status: { type: "keyword" },
      currentStep: { type: "keyword" },
      name: { type: "text", fields: { keyword: { type: "keyword" } } },
      title: { type: "text" },
      description: { type: "text" },
      summary: { type: "text" },
      updatedAt: { type: "date" },
      createdAt: { type: "date" },
      suggest: { type: "completion", analyzer: "simple", max_input_length: 50 },
    } },
  }]),
);

/** Idempotently create the strict OpenSearch indices required by active routes. */
export async function bootstrapOpenSearchIndices(): Promise<void> {
  const os = configuredClient();
  for (const [index, body] of Object.entries(INDEX_MAPPINGS)) {
    try {
      const exists = await os.indices.exists({ index });
      if (!exists.body) await os.indices.create({ index, body });
    } catch (error) {
      throw new SearchUnavailableError(`OpenSearch bootstrap failed for ${index}`, error);
    }
  }
}

export interface LakehouseExportOptions {
  tables: Array<"disputes" | "documents" | "audit" | "ledger" | "events">;
  format: "ndjson" | "csv";
  since?: Date;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build a bounded export exclusively from PostgreSQL tables. This is an export
 * formatter, not a local data store; it throws on any requested-table failure
 * rather than returning an incomplete dataset as a successful lakehouse export.
 */
export async function generateLakehouseExport(options: LakehouseExportOptions): Promise<{ content: string; rowCount: number; tables: string[] }> {
  const { getDb } = await import("./db");
  const { disputes, disputeDocuments, auditLog, ledgerEntries, eventLog } = await import("../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is required for Lakehouse export");
  const requested = Array.from(new Set(options.tables));
  if (requested.length === 0) throw new Error("At least one Lakehouse table is required");
  const rowsByTable: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  for (const table of requested) {
    let rows: Record<string, unknown>[];
    if (table === "disputes") rows = (await db.select().from(disputes).limit(50_000)) as Record<string, unknown>[];
    else if (table === "documents") rows = (await db.select().from(disputeDocuments).limit(50_000)) as Record<string, unknown>[];
    else if (table === "audit") rows = (await db.select().from(auditLog).limit(100_000)) as Record<string, unknown>[];
    else if (table === "ledger") rows = (await db.select().from(ledgerEntries).limit(100_000)) as Record<string, unknown>[];
    else rows = (await db.select().from(eventLog).limit(100_000)) as Record<string, unknown>[];
    rowsByTable.push({ table, rows });
  }
  const exportedAt = new Date().toISOString();
  if (options.format === "ndjson") {
    const lines = rowsByTable.flatMap(({ table, rows }) => rows.map((row) => JSON.stringify({ _table: table, _exported_at: exportedAt, ...row })));
    return { content: lines.join("\n"), rowCount: lines.length, tables: requested };
  }
  const lines: string[] = [];
  for (const { table, rows } of rowsByTable) {
    if (rows.length === 0) continue;
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    lines.push(["_table", "_exported_at", ...columns].join(","));
    for (const row of rows) lines.push([table, exportedAt, ...columns.map((column) => csvCell(row[column]))].join(","));
  }
  return { content: lines.join("\n"), rowCount: rowsByTable.reduce((total, item) => total + item.rows.length, 0), tables: requested };
}
