/**
 * server/search.ts
 * Full-text search service using Fuse.js with an OpenSearch-compatible interface.
 *
 * In production this calls the OpenSearch REST API when OPENSEARCH_URL is set.
 * When OPENSEARCH_URL is not set it falls back to an in-process Fuse.js index
 * built from the live PostgreSQL database — a drop-in replacement that can be
 * swapped for OpenSearch without changing callers.
 *
 * Indexed entity types:
 *   - disputes        : id, referenceNumber, patientName, payerName, serviceType, status, cptCodes
 *   - documents       : id, fileName, disputeId, documentType
 *   - audit           : id, action, entityType, entityId, userId
 *   - payer_contacts  : id, payerName, contactName, email, notes
 *   - idr_entities    : id, name, certificationNumber, specialties, states
 *   - expert_panel    : id, name, credentials, specialty, bio
 *   - regulatory      : id, title, summary, category, impactLevel
 *   - qpa_benchmarks  : id, serviceType, cptCode, state, description
 */

import Fuse from "fuse.js";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { getDb } from "./db";
import {
  disputes,
  disputeDocuments,
  auditLog,
  payerContacts,
  idrEntities,
  expertPanel,
  regulatoryUpdates,
  qpaBenchmarks,
} from "../drizzle/schema";
import { desc } from "drizzle-orm";

// ── OpenSearch client (optional — falls back to Fuse.js when OPENSEARCH_URL not set) ──

let _osClient: OpenSearchClient | null = null;

/**
 * Resolve whether the OpenSearch client verifies TLS server certificates.
 * Default: verify in production. Development defaults to NOT verifying because
 * the docker-compose OpenSearch runs with the security plugin disabled over
 * plain HTTP / self-signed TLS. OPENSEARCH_VERIFY_TLS=false is honored ONLY
 * outside production — a mis-set env var must never silently disable
 * certificate verification in production (fail closed).
 */
function openSearchRejectUnauthorized(): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  const verifyTlsEnv = process.env.OPENSEARCH_VERIFY_TLS?.trim().toLowerCase();
  if (verifyTlsEnv === "true") return true;
  if (verifyTlsEnv === "false") {
    if (isProduction) {
      console.error("[search] OPENSEARCH_VERIFY_TLS=false is not allowed in production — TLS certificate verification stays ENABLED");
      return true;
    }
    return false;
  }
  return !isProduction;
}

function getOpenSearchClient(): OpenSearchClient | null {
  const url = process.env.OPENSEARCH_URL;
  if (!url) return null;
  if (_osClient) return _osClient;
  try {
    const rejectUnauthorized = openSearchRejectUnauthorized();
    if (!rejectUnauthorized && url.startsWith("https:")) {
      console.warn("[search] OpenSearch TLS certificate verification is DISABLED (development only — never deploy this configuration)");
    }
    _osClient = new OpenSearchClient({
      node: url,
      auth: process.env.OPENSEARCH_USER
        ? { username: process.env.OPENSEARCH_USER, password: process.env.OPENSEARCH_PASSWORD || "" }
        : undefined,
      ssl: { rejectUnauthorized },
    });
    return _osClient;
  } catch {
    return null;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

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
  took: number; // ms
}

// ── OpenSearch multi-index search ─────────────────────────────────────────────

const ENTITY_INDEX_MAP: Record<SearchEntityType, string> = {
  dispute:       "idr-disputes",
  document:      "idr-documents",
  audit:         "idr-audit",
  payer_contact: "idr-payer-contacts",
  idr_entity:    "idr-entities",
  expert:        "idr-expert-panel",
  regulatory:    "idr-regulatory",
  qpa_benchmark: "idr-qpa-benchmarks",
};

async function searchOpenSearch(
  q: string,
  entityTypes: SearchEntityType[],
  limit: number
): Promise<SearchResult | null> {
  const client = getOpenSearchClient();
  if (!client) return null;
  try {
    const indices = entityTypes.map(e => ENTITY_INDEX_MAP[e]).filter(Boolean);
    if (!indices.length) return null;
    const start = Date.now();
    const response = await client.search({
      index: indices.join(","),
      body: {
        size: limit,
        query: {
          multi_match: {
            query: q,
            fields: [
              "referenceNumber^3", "patientName^2", "payerName^2",
              "name^2", "title^2", "contactName^2",
              "description^1.5", "summary^1.5", "notes^1", "bio^1",
              "status", "action", "category", "specialty",
            ],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
        highlight: {
          fields: {
            description: {}, notes: {}, summary: {}, bio: {}, title: {},
          },
        },
      },
    });
    const rawHits = (response.body.hits?.hits || []) as Array<Record<string, unknown>>;
    const hits: SearchHit[] = rawHits.map(h => {
      const idx = h._index as string;
      let entityType: SearchEntityType = "dispute";
      if (idx.includes("audit"))          entityType = "audit";
      else if (idx.includes("document"))  entityType = "document";
      else if (idx.includes("payer"))     entityType = "payer_contact";
      else if (idx.includes("entities"))  entityType = "idr_entity";
      else if (idx.includes("expert"))    entityType = "expert";
      else if (idx.includes("regulatory")) entityType = "regulatory";
      else if (idx.includes("qpa"))       entityType = "qpa_benchmark";
      return {
        id: (h._id as string) || "",
        entityType,
        score: (h._score as number) || 0,
        item: (h._source as Record<string, unknown>) || {},
        highlights: (h.highlight as Record<string, string[]>) || {},
      };
    });
    return {
      total: (typeof response.body.hits?.total === "object"
        ? (response.body.hits.total as { value: number }).value
        : response.body.hits?.total as number) || hits.length,
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

// ── OpenSearch index helpers ──────────────────────────────────────────────────

/**
 * Index a single document into OpenSearch.
 * Called from mutation procedures to keep the index current.
 */
export async function indexDocument(
  entityType: SearchEntityType,
  id: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  const index = ENTITY_INDEX_MAP[entityType];
  if (!index) return;
  try {
    await client.index({
      index,
      id,
      body: { ...payload, updatedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.warn(`[search] OpenSearch index error (${entityType}):`, err);
  }
}

/** Convenience wrapper for dispute indexing (backward compat) */
export async function indexDispute(
  disputeId: string,
  payload: Record<string, unknown>
): Promise<void> {
  return indexDocument("dispute", disputeId, { disputeId, ...payload });
}

/** Remove a document from its OpenSearch index */
export async function deleteFromIndex(
  entityType: SearchEntityType,
  id: string
): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  const index = ENTITY_INDEX_MAP[entityType];
  if (!index) return;
  try {
    await client.delete({ index, id });
  } catch (err) {
    console.warn(`[search] OpenSearch delete error (${entityType}):`, err);
  }
}

// ── Index cache ───────────────────────────────────────────────────────────────

interface IndexCache {
  disputes:       Fuse<Record<string, unknown>>;
  documents:      Fuse<Record<string, unknown>>;
  audit:          Fuse<Record<string, unknown>>;
  payerContacts:  Fuse<Record<string, unknown>>;
  idrEntities:    Fuse<Record<string, unknown>>;
  expertPanel:    Fuse<Record<string, unknown>>;
  regulatory:     Fuse<Record<string, unknown>>;
  qpaBenchmarks:  Fuse<Record<string, unknown>>;
  lastRefreshed:  Date;
}

let _cache: IndexCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

// ── Fuse.js configuration ─────────────────────────────────────────────────────

const FUSE_OPTIONS = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

const DISPUTE_FUSE_KEYS = [
  { name: "referenceNumber", weight: 2.0 },
  { name: "patientName",     weight: 1.5 },
  { name: "payerName",       weight: 1.5 },
  { name: "serviceType",     weight: 1.0 },
  { name: "status",          weight: 0.5 },
  { name: "cptCodes",        weight: 1.0 },
  { name: "icd10Codes",      weight: 0.8 },
  { name: "providerName",    weight: 1.0 },
  { name: "notes",           weight: 0.5 },
];

const DOCUMENT_FUSE_KEYS = [
  { name: "fileName",     weight: 2.0 },
  { name: "documentType", weight: 1.0 },
  { name: "extractedText", weight: 0.5 },
];

const AUDIT_FUSE_KEYS = [
  { name: "action",     weight: 2.0 },
  { name: "entityType", weight: 1.0 },
  { name: "entityId",   weight: 1.5 },
  { name: "userId",     weight: 1.0 },
  { name: "newValue",   weight: 0.5 },
];

const PAYER_CONTACT_FUSE_KEYS = [
  { name: "payerName",    weight: 2.0 },
  { name: "contactName",  weight: 1.5 },
  { name: "email",        weight: 1.0 },
  { name: "phone",        weight: 0.8 },
  { name: "notes",        weight: 0.5 },
  { name: "address",      weight: 0.5 },
];

const IDR_ENTITY_FUSE_KEYS = [
  { name: "name",                  weight: 2.0 },
  { name: "certificationNumber",   weight: 1.5 },
  { name: "specialties",           weight: 1.0 },
  { name: "states",                weight: 0.8 },
  { name: "contactEmail",          weight: 0.5 },
];

const EXPERT_FUSE_KEYS = [
  { name: "name",        weight: 2.0 },
  { name: "credentials", weight: 1.5 },
  { name: "specialty",   weight: 1.0 },
  { name: "bio",         weight: 0.5 },
];

const REGULATORY_FUSE_KEYS = [
  { name: "title",       weight: 2.0 },
  { name: "summary",     weight: 1.5 },
  { name: "category",    weight: 1.0 },
  { name: "impactLevel", weight: 0.8 },
  { name: "tags",        weight: 0.5 },
];

const QPA_FUSE_KEYS = [
  { name: "serviceType",  weight: 2.0 },
  { name: "cptCode",      weight: 1.5 },
  { name: "state",        weight: 1.0 },
  { name: "description",  weight: 0.5 },
];

// ── Index building ────────────────────────────────────────────────────────────

async function buildIndex(): Promise<IndexCache> {
  const db = await getDb();

  let disputeData:      Record<string, unknown>[] = [];
  let documentData:     Record<string, unknown>[] = [];
  let auditData:        Record<string, unknown>[] = [];
  let payerContactData: Record<string, unknown>[] = [];
  let idrEntityData:    Record<string, unknown>[] = [];
  let expertData:       Record<string, unknown>[] = [];
  let regulatoryData:   Record<string, unknown>[] = [];
  let qpaData:          Record<string, unknown>[] = [];

  if (db) {
    // Disputes
    try {
      const rows = await db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(5000);
      disputeData = rows.map(d => ({
        id:             d.id,
        referenceNumber: d.referenceNumber ?? "",
        patientName:    (d as Record<string, unknown>).patientName as string ?? "",
        payerName:      d.respondingPartyName ?? "",
        serviceType:    d.serviceType ?? "",
        status:         d.status ?? "",
        cptCodes:       Array.isArray(d.cptCodes) ? (d.cptCodes as string[]).join(" ") : "",
        icd10Codes:     Array.isArray(d.icd10Codes) ? (d.icd10Codes as string[]).join(" ") : "",
        providerName:   d.initiatingPartyName ?? "",
        notes:          d.notes ?? "",
        billedAmount:   d.billedAmount ?? "",
        currentStep:    d.currentStep ?? "",
      }));
    } catch (err) { console.warn("[Search] disputes:", err); }

    // Documents
    try {
      const rows = await db.select().from(disputeDocuments).orderBy(desc(disputeDocuments.uploadedAt)).limit(5000);
      documentData = rows.map(d => ({
        id:           d.id,
        disputeId:    d.disputeId ?? "",
        fileName:     d.fileName ?? "",
        documentType: d.documentType ?? "",
        extractedText: "",
      }));
    } catch (err) { console.warn("[Search] documents:", err); }

    // Audit log
    try {
      const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(10000);
      auditData = rows.map(a => ({
        id:         a.id,
        action:     a.action ?? "",
        entityType: a.entityType ?? "",
        entityId:   a.entityId ?? "",
        userId:     a.userId ?? "",
        newValue:   typeof a.newValue === "string" ? a.newValue.slice(0, 200) : "",
      }));
    } catch (err) { console.warn("[Search] audit:", err); }

    // Payer contacts
    try {
      const rows = await db.select().from(payerContacts).orderBy(desc(payerContacts.createdAt)).limit(2000);
      payerContactData = rows.map(p => ({
        id:          p.id,
        payerName:   p.payerName ?? "",
        contactName: p.contactName ?? "",
        email:       p.email ?? "",
        phone:       p.phone ?? "",
        notes:       p.notes ?? "",
        address:     p.address ?? "",
      }));
    } catch (err) { console.warn("[Search] payer_contacts:", err); }

    // IDR entities
    try {
      const rows = await db.select().from(idrEntities).limit(1000);
      idrEntityData = rows.map(e => ({
        id:                   e.id,
        name:                 e.name ?? "",
        certificationNumber:  e.certificationNumber ?? "",
        specialties:          Array.isArray(e.specialties) ? (e.specialties as string[]).join(" ") : "",
        states:               Array.isArray(e.states) ? (e.states as string[]).join(" ") : "",
        contactEmail:         e.contactEmail ?? "",
      }));
    } catch (err) { console.warn("[Search] idr_entities:", err); }

    // Expert panel
    try {
      const rows = await db.select().from(expertPanel).limit(500);
      expertData = rows.map(e => ({
        id:          e.id,
        name:        e.name ?? "",
        credentials: e.credentials ?? "",
        specialty:   e.specialty ?? "",
        bio:         e.bio ?? "",
      }));
    } catch (err) { console.warn("[Search] expert_panel:", err); }

    // Regulatory updates
    try {
      const rows = await db.select().from(regulatoryUpdates).orderBy(desc(regulatoryUpdates.publishedAt)).limit(2000);
      regulatoryData = rows.map(r => ({
        id:          r.id,
        title:       r.title ?? "",
        summary:     r.summary ?? "",
        category:    r.category ?? "",
        impactLevel: r.impactLevel ?? "",
        tags:        r.tags ?? "",
      }));
    } catch (err) { console.warn("[Search] regulatory_updates:", err); }

    // QPA benchmarks
    try {
      const rows = await db.select().from(qpaBenchmarks).limit(5000);
      qpaData = rows.map(q => ({
        id:          q.id,
        serviceType: q.specialty ?? "",
        cptCode:     q.cptCode ?? "",
        state:       q.source ?? "",
        description: q.description ?? "",
      }));
    } catch (err) { console.warn("[Search] qpa_benchmarks:", err); }
  }

  return {
    disputes:      new Fuse(disputeData,      { ...FUSE_OPTIONS, keys: DISPUTE_FUSE_KEYS }),
    documents:     new Fuse(documentData,     { ...FUSE_OPTIONS, keys: DOCUMENT_FUSE_KEYS }),
    audit:         new Fuse(auditData,        { ...FUSE_OPTIONS, keys: AUDIT_FUSE_KEYS }),
    payerContacts: new Fuse(payerContactData, { ...FUSE_OPTIONS, keys: PAYER_CONTACT_FUSE_KEYS }),
    idrEntities:   new Fuse(idrEntityData,    { ...FUSE_OPTIONS, keys: IDR_ENTITY_FUSE_KEYS }),
    expertPanel:   new Fuse(expertData,       { ...FUSE_OPTIONS, keys: EXPERT_FUSE_KEYS }),
    regulatory:    new Fuse(regulatoryData,   { ...FUSE_OPTIONS, keys: REGULATORY_FUSE_KEYS }),
    qpaBenchmarks: new Fuse(qpaData,          { ...FUSE_OPTIONS, keys: QPA_FUSE_KEYS }),
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
 * Invalidate the search index cache (called automatically after mutations via tRPC middleware).
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

const ALL_ENTITY_TYPES: SearchEntityType[] = [
  "dispute", "document", "audit",
  "payer_contact", "idr_entity", "expert", "regulatory", "qpa_benchmark",
];

/**
 * Execute a full-text search across all indexed entity types.
 * Returns results ranked by relevance score.
 */
export async function search(query: SearchQuery): Promise<SearchResult> {
  const start = Date.now();
  const {
    q,
    entityTypes = ALL_ENTITY_TYPES,
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

  const fuseSearch = (
    fuse: Fuse<Record<string, unknown>>,
    entityType: SearchEntityType
  ) => {
    if (!entityTypes.includes(entityType)) return;
    const results = fuse.search(q, { limit });
    for (const r of results) {
      hits.push({
        id: r.item.id as string,
        entityType,
        score: 1 - (r.score ?? 0),
        item: r.item,
        highlights: extractHighlights(r.matches),
      });
    }
  };

  fuseSearch(index.disputes,      "dispute");
  fuseSearch(index.documents,     "document");
  fuseSearch(index.audit,         "audit");
  fuseSearch(index.payerContacts, "payer_contact");
  fuseSearch(index.idrEntities,   "idr_entity");
  fuseSearch(index.expertPanel,   "expert");
  fuseSearch(index.regulatory,    "regulatory");
  fuseSearch(index.qpaBenchmarks, "qpa_benchmark");

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

// ── OpenSearch index bootstrap ────────────────────────────────────────────────

const INDEX_MAPPINGS: Record<string, object> = {
  "idr-disputes": {
    mappings: {
      properties: {
        disputeId:    { type: "keyword" },
        status:       { type: "keyword" },
        currentStep:  { type: "keyword" },
        serviceType:  { type: "keyword" },
        description:  { type: "text", analyzer: "english" },
        notes:        { type: "text", analyzer: "english" },
        providerName: { type: "text", fields: { keyword: { type: "keyword" } } },
        payerName:    { type: "text", fields: { keyword: { type: "keyword" } } },
        patientName:  { type: "text", fields: { keyword: { type: "keyword" } } },
        billedAmount: { type: "float" },
        createdAt:    { type: "date" },
        updatedAt:    { type: "date" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          preserve_separators: true,
          preserve_position_increments: true,
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-audit": {
    mappings: {
      properties: {
        action:      { type: "keyword" },
        entityType:  { type: "keyword" },
        entityId:    { type: "keyword" },
        userId:      { type: "keyword" },
        description: { type: "text", analyzer: "english" },
        createdAt:   { type: "date" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-documents": {
    mappings: {
      properties: {
        fileName:     { type: "text", fields: { keyword: { type: "keyword" } } },
        documentType: { type: "keyword" },
        disputeId:    { type: "keyword" },
        extractedText: { type: "text", analyzer: "english" },
        uploadedAt:   { type: "date" },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-payer-contacts": {
    mappings: {
      properties: {
        payerName:   { type: "text", fields: { keyword: { type: "keyword" } } },
        contactName: { type: "text" },
        email:       { type: "keyword" },
        phone:       { type: "keyword" },
        notes:       { type: "text", analyzer: "english" },
        createdAt:   { type: "date" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-entities": {
    mappings: {
      properties: {
        name:                { type: "text", fields: { keyword: { type: "keyword" } } },
        certificationNumber: { type: "keyword" },
        specialties:         { type: "text" },
        states:              { type: "text" },
        contactEmail:        { type: "keyword" },
        isActive:            { type: "boolean" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-expert-panel": {
    mappings: {
      properties: {
        name:         { type: "text", fields: { keyword: { type: "keyword" } } },
        credentials:  { type: "text" },
        specialty:    { type: "keyword" },
        bio:          { type: "text", analyzer: "english" },
        availability: { type: "keyword" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-regulatory": {
    mappings: {
      properties: {
        title:       { type: "text", analyzer: "english" },
        summary:     { type: "text", analyzer: "english" },
        category:    { type: "keyword" },
        impactLevel: { type: "keyword" },
        tags:        { type: "text" },
        publishedAt: { type: "date" },
        suggest: {
          type: "completion",
          analyzer: "simple",
          max_input_length: 50,
        },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
  "idr-qpa-benchmarks": {
    mappings: {
      properties: {
        serviceType: { type: "keyword" },
        cptCode:     { type: "keyword" },
        state:       { type: "keyword" },
        description: { type: "text", analyzer: "english" },
        createdAt:   { type: "date" },
      },
    },
    settings: { number_of_shards: 1, number_of_replicas: 1 },
  },
};

/**
 * Bootstrap all OpenSearch indices with proper mappings on server startup.
 * Safe to call repeatedly — skips indices that already exist.
 */
export async function bootstrapOpenSearchIndices(): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  for (const [indexName, body] of Object.entries(INDEX_MAPPINGS)) {
    try {
      const exists = await client.indices.exists({ index: indexName });
      if (!exists.body) {
        await client.indices.create({ index: indexName, body });
        console.info(`[search] Created OpenSearch index: ${indexName}`);
      }
    } catch (err) {
      console.warn(`[search] Failed to bootstrap index ${indexName}:`, err);
    }
  }
}

// ── Autocomplete / Suggest ────────────────────────────────────────────────────

export interface SuggestResult {
  text: string;
  score: number;
  entityType: SearchEntityType;
}

/**
 * OpenSearch completion suggester for real-time autocomplete.
 * Falls back to a prefix-match on the in-memory Fuse.js index when
 * OpenSearch is not available.
 */
export async function suggest(
  prefix: string,
  limit = 8
): Promise<SuggestResult[]> {
  if (!prefix || prefix.trim().length < 2) return [];

  const client = getOpenSearchClient();
  if (client) {
    try {
      const response = await client.search({
        index: Object.values(ENTITY_INDEX_MAP).join(","),
        body: {
          suggest: {
            entity_suggest: {
              prefix: prefix.trim(),
              completion: {
                field: "suggest",
                size: limit,
                skip_duplicates: true,
                fuzzy: { fuzziness: "AUTO" },
              },
            },
          },
        },
      });
      const options = (
        response.body.suggest?.entity_suggest?.[0]?.options || []
      ) as Array<{ text: string; _score: number; _index: string }>;
      if (options.length > 0) {
        return options.map(o => {
          const idx = o._index || "";
          let entityType: SearchEntityType = "dispute";
          if (idx.includes("audit"))      entityType = "audit";
          else if (idx.includes("payer")) entityType = "payer_contact";
          else if (idx.includes("entities")) entityType = "idr_entity";
          else if (idx.includes("expert")) entityType = "expert";
          else if (idx.includes("regulatory")) entityType = "regulatory";
          else if (idx.includes("qpa"))   entityType = "qpa_benchmark";
          return { text: o.text, score: o._score || 0, entityType };
        });
      }
    } catch {
      // Fall through to Fuse.js prefix fallback
    }
  }

  // Fuse.js prefix fallback
  const index = await getIndex();
  const lower = prefix.toLowerCase().trim();
  const results: SuggestResult[] = [];
  const seen = new Set<string>();

  const prefixScan = (
    docs: Record<string, unknown>[],
    labelField: string,
    entityType: SearchEntityType
  ) => {
    for (const d of docs.slice(0, 500)) {
      const label = ((d[labelField] || d.id || "") as string).slice(0, 80);
      if (label.toLowerCase().startsWith(lower) && !seen.has(label)) {
        seen.add(label);
        results.push({ text: label, score: 1, entityType });
      }
      if (results.length >= limit) return;
    }
  };

  // Access internal Fuse docs via _docs (undocumented but stable)
  type FuseInternal = { _docs: Record<string, unknown>[] };
  prefixScan((index.disputes as unknown as FuseInternal)._docs ?? [], "referenceNumber", "dispute");
  prefixScan((index.payerContacts as unknown as FuseInternal)._docs ?? [], "payerName", "payer_contact");
  prefixScan((index.idrEntities as unknown as FuseInternal)._docs ?? [], "name", "idr_entity");
  prefixScan((index.expertPanel as unknown as FuseInternal)._docs ?? [], "name", "expert");

  return results.slice(0, limit);
}
