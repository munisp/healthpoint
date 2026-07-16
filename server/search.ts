/**
 * server/search.ts
 * Full-text search service using Fuse.js with an OpenSearch-compatible interface.
 *
 * In production this would call the OpenSearch REST API.
 * Here we implement the same query interface in-process using Fuse.js,
 * providing a drop-in replacement that can be swapped for OpenSearch
 * without changing callers.
 *
 * Indexed entity types:
 *   - disputes: id, referenceNumber, patientName, payerName, serviceType, status, cptCodes
 *   - documents: id, fileName, disputeId, extractedFields
 *   - audit_log: id, action, entityType, entityId, userId
 */

import Fuse from "fuse.js";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { getDb } from "./db";
import { disputes, disputeDocuments, auditLog } from "../drizzle/schema";
import { desc } from "drizzle-orm";

// ── OpenSearch client (optional — falls back to Fuse.js when OPENSEARCH_URL not set) ──

let _osClient: OpenSearchClient | null = null;

function getOpenSearchClient(): OpenSearchClient | null {
  const url = process.env.OPENSEARCH_URL;
  if (!url) return null;
  if (_osClient) return _osClient;
  try {
    _osClient = new OpenSearchClient({
      node: url,
      auth: process.env.OPENSEARCH_USER
        ? { username: process.env.OPENSEARCH_USER, password: process.env.OPENSEARCH_PASSWORD || "" }
        : undefined,
      ssl: { rejectUnauthorized: false },
    });
    return _osClient;
  } catch {
    return null;
  }
}

async function searchOpenSearch(
  q: string,
  entityTypes: SearchEntityType[],
  limit: number
): Promise<SearchResult | null> {
  const client = getOpenSearchClient();
  if (!client) return null;
  try {
    const indices: string[] = [];
    if (entityTypes.includes("dispute")) indices.push("idr-disputes");
    if (entityTypes.includes("audit")) indices.push("idr-audit");
    if (!indices.length) return null;
    const start = Date.now();
    const response = await client.search({
      index: indices.join(","),
      body: {
        size: limit,
        query: {
          multi_match: {
            query: q,
            fields: ["disputeId^2", "description^1.5", "notes", "status", "action", "resourceType"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
        highlight: { fields: { description: {}, notes: {} } },
      },
    });
    const rawHits = (response.body.hits?.hits || []) as Array<Record<string, unknown>>;
    const hits: SearchHit[] = rawHits.map(h => ({
      id: (h._id as string) || "",
      entityType: ((h._index as string).includes("audit") ? "audit" : "dispute") as SearchEntityType,
      score: (h._score as number) || 0,
      item: (h._source as Record<string, unknown>) || {},
      highlights: (h.highlight as Record<string, string[]>) || {},
    }));
    return {
      total: (typeof response.body.hits?.total === 'object' ? (response.body.hits.total as { value: number }).value : response.body.hits?.total as number) || hits.length,
      hits,
      query: q,
      entityTypes,
      took: Date.now() - start,
    };
  } catch (err) {
    console.warn("[search] OpenSearch error, falling back to Fuse.js:", err);
    return null;
  }
}

/**
 * Index a single dispute document into OpenSearch.
 * Called from dispute mutation procedures to keep the index current.
 */
export async function indexDispute(
  disputeId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  try {
    await client.index({
      index: "idr-disputes",
      id: disputeId,
      body: { disputeId, ...payload, updatedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.warn("[search] OpenSearch index error:", err);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type SearchEntityType = "dispute" | "document" | "audit";

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
  took: number; // ms
}

// ── Index cache ───────────────────────────────────────────────────────────────

interface IndexCache {
  disputes: Fuse<Record<string, unknown>>;
  documents: Fuse<Record<string, unknown>>;
  audit: Fuse<Record<string, unknown>>;
  lastRefreshed: Date;
}

let _cache: IndexCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

// ── Fuse.js configuration ─────────────────────────────────────────────────────

const DISPUTE_FUSE_KEYS = [
  { name: "referenceNumber", weight: 2.0 },
  { name: "patientName", weight: 1.5 },
  { name: "payerName", weight: 1.5 },
  { name: "serviceType", weight: 1.0 },
  { name: "status", weight: 0.5 },
  { name: "cptCodes", weight: 1.0 },
  { name: "icd10Codes", weight: 0.8 },
  { name: "providerName", weight: 1.0 },
  { name: "notes", weight: 0.5 },
];

const DOCUMENT_FUSE_KEYS = [
  { name: "fileName", weight: 2.0 },
  { name: "documentType", weight: 1.0 },
  { name: "extractedText", weight: 0.5 },
];

const AUDIT_FUSE_KEYS = [
  { name: "action", weight: 2.0 },
  { name: "entityType", weight: 1.0 },
  { name: "entityId", weight: 1.5 },
  { name: "userId", weight: 1.0 },
  { name: "newValue", weight: 0.5 },
];

const FUSE_OPTIONS = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

// ── Index building ────────────────────────────────────────────────────────────

async function buildIndex(): Promise<IndexCache> {
  const db = await getDb();

  let disputeData: Record<string, unknown>[] = [];
  let documentData: Record<string, unknown>[] = [];
  let auditData: Record<string, unknown>[] = [];

  if (db) {
    try {
      const disputeRows = await db
        .select()
        .from(disputes)
        .orderBy(desc(disputes.createdAt))
        .limit(5000);

      disputeData = disputeRows.map(d => ({
        id: d.id,
        referenceNumber: d.referenceNumber ?? "",
        patientName: (d as Record<string, unknown>).patientName as string ?? "",
        payerName: d.respondingPartyName ?? "",
        serviceType: d.serviceType ?? "",
        status: d.status ?? "",
        cptCodes: Array.isArray(d.cptCodes) ? (d.cptCodes as string[]).join(" ") : "",
        icd10Codes: Array.isArray(d.icd10Codes) ? (d.icd10Codes as string[]).join(" ") : "",
        providerName: d.initiatingPartyName ?? "",
        notes: d.notes ?? "",
        billedAmount: d.billedAmount ?? "",
        currentStep: d.currentStep ?? "",
      }));
    } catch (err) {
      console.warn("[Search] Failed to index disputes:", err);
    }

    try {
      const docRows = await db
        .select()
        .from(disputeDocuments)
        .orderBy(desc(disputeDocuments.uploadedAt))
        .limit(5000);

      documentData = docRows.map(d => ({
        id: d.id,
        disputeId: d.disputeId ?? "",
        fileName: d.fileName ?? "",
        documentType: d.documentType ?? "",
        extractedText: "",
      }));
    } catch (err) {
      console.warn("[Search] Failed to index documents:", err);
    }

    try {
      const auditRows = await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(10000);

      auditData = auditRows.map(a => ({
        id: a.id,
        action: a.action ?? "",
        entityType: a.entityType ?? "",
        entityId: a.entityId ?? "",
        userId: a.userId ?? "",
        newValue: typeof a.newValue === "string" ? a.newValue.slice(0, 200) : "",
      }));
    } catch (err) {
      console.warn("[Search] Failed to index audit log:", err);
    }
  }

  return {
    disputes: new Fuse(disputeData, { ...FUSE_OPTIONS, keys: DISPUTE_FUSE_KEYS }),
    documents: new Fuse(documentData, { ...FUSE_OPTIONS, keys: DOCUMENT_FUSE_KEYS }),
    audit: new Fuse(auditData, { ...FUSE_OPTIONS, keys: AUDIT_FUSE_KEYS }),
    lastRefreshed: new Date(),
  };
}

async function getIndex(): Promise<IndexCache> {
  if (!_cache || Date.now() - _cache.lastRefreshed.getTime() > CACHE_TTL_MS) {
    _cache = await buildIndex();
  }
  return _cache;
}

/**
 * Invalidate the search index cache (call after mutations).
 */
export function invalidateSearchIndex(): void {
  _cache = null;
}

// ── Search API ────────────────────────────────────────────────────────────────

export interface SearchQuery {
  q: string;
  entityTypes?: SearchEntityType[];
  limit?: number;
  userId?: string;
  userRole?: "user" | "admin";
}

/**
 * Execute a full-text search across all indexed entity types.
 * Returns results ranked by relevance score.
 */
export async function search(query: SearchQuery): Promise<SearchResult> {
  const start = Date.now();
  const {
    q,
    entityTypes = ["dispute", "document", "audit"],
    limit = 20,
  } = query;

  if (!q || q.trim().length < 2) {
    return { total: 0, hits: [], query: q, entityTypes, took: 0 };
  }

  // Try OpenSearch first
  const osResult = await searchOpenSearch(q, entityTypes, limit);
  if (osResult) return osResult;

  // Fall back to Fuse.js
  const index = await getIndex();
  const hits: SearchHit[] = [];

  if (entityTypes.includes("dispute")) {
    const results = index.disputes.search(q, { limit });
    for (const r of results) {
      hits.push({
        id: r.item.id as string,
        entityType: "dispute",
        score: 1 - (r.score ?? 0),
        item: r.item,
        highlights: extractHighlights(r.matches),
      });
    }
  }

  if (entityTypes.includes("document")) {
    const results = index.documents.search(q, { limit });
    for (const r of results) {
      hits.push({
        id: r.item.id as string,
        entityType: "document",
        score: 1 - (r.score ?? 0),
        item: r.item,
        highlights: extractHighlights(r.matches),
      });
    }
  }

  if (entityTypes.includes("audit")) {
    const results = index.audit.search(q, { limit });
    for (const r of results) {
      hits.push({
        id: r.item.id as string,
        entityType: "audit",
        score: 1 - (r.score ?? 0),
        item: r.item,
        highlights: extractHighlights(r.matches),
      });
    }
  }

  // Sort by score descending
  hits.sort((a, b) => b.score - a.score);

  return {
    total: hits.length,
    hits: hits.slice(0, limit),
    query: q,
    entityTypes,
    took: Date.now() - start,
  };
}

function extractHighlights(
  matches?: readonly { key?: string; value?: string; indices?: readonly [number, number][] }[]
): Record<string, string[]> {
  if (!matches) return {};
  const highlights: Record<string, string[]> = {};
  for (const match of matches) {
    if (match.key && match.value) {
      highlights[match.key] = [match.value];
    }
  }
  return highlights;
}

// ── Lakehouse export ──────────────────────────────────────────────────────────

export interface LakehouseExportOptions {
  tables: Array<"disputes" | "documents" | "audit" | "ledger" | "events">;
  format: "ndjson" | "csv";
  since?: Date;
}

/**
 * Generate a Lakehouse-ready NDJSON or CSV export of platform data.
 * Compatible with Apache Iceberg, Delta Lake, and Hudi table formats.
 * Each line is a complete JSON object (NDJSON) or CSV row.
 */
export async function generateLakehouseExport(
  options: LakehouseExportOptions
): Promise<{ content: string; rowCount: number; tables: string[] }> {
  const db = await getDb();
  if (!db) return { content: "", rowCount: 0, tables: [] };

  const lines: string[] = [];
  const exportedTables: string[] = [];
  let rowCount = 0;

  for (const table of options.tables) {
    try {
      let rows: Record<string, unknown>[] = [];

      if (table === "disputes") {
        rows = (await db.select().from(disputes).limit(50000)) as Record<string, unknown>[];
      } else if (table === "documents") {
        rows = (await db.select().from(disputeDocuments).limit(50000)) as Record<string, unknown>[];
      } else if (table === "audit") {
        rows = (await db.select().from(auditLog).limit(100000)) as Record<string, unknown>[];
      }

      if (options.format === "ndjson") {
        for (const row of rows) {
          lines.push(JSON.stringify({ _table: table, _exported_at: new Date().toISOString(), ...row }));
        }
      } else {
        // CSV: header row + data rows
        if (rows.length > 0) {
          const headers = Object.keys(rows[0]);
          lines.push(headers.join(","));
          for (const row of rows) {
            lines.push(
              headers.map(h => {
                const v = row[h];
                if (v === null || v === undefined) return "";
                const s = typeof v === "object" ? JSON.stringify(v) : String(v);
                return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
              }).join(",")
            );
          }
        }
      }

      rowCount += rows.length;
      exportedTables.push(table);
    } catch (err) {
      console.warn(`[Lakehouse] Failed to export table ${table}:`, err);
    }
  }

  return {
    content: lines.join("\n"),
    rowCount,
    tables: exportedTables,
  };
}
