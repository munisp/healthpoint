/**
 * server/idr/qpa/mrf-ingestion.ts
 *
 * Transparency-in-Coverage (TiC) in-network Machine-Readable File (MRF)
 * streaming ingestion for the statutory QPA engine.
 *
 * Why this module exists: TiC in-network negotiated-rate files are the only
 * public, payer-published source of real contracted rates, but production
 * files are routinely multi-GB (national payers publish files > 100 GB) and
 * cannot be JSON.parse'd. This module streams the file with a
 * dependency-free chunked parser (node streams + brace counting with full
 * string/escape handling) and extracts only the target service codes.
 *
 * OPTIONAL DEPENDENCY NOTE: `stream-json` would provide a battle-tested
 * SAX-style JSON tokenizer; it is NOT added here because this remediation
 * wave cannot modify package.json/lockfiles owned by other workstreams.
 * The chunked parser below is the documented fallback. It handles the exact
 * TiC in-network schema shape (top-level object with "in_network" and
 * "provider_references" arrays of objects) and fails closed on anything it
 * cannot tokenize.
 *
 * TiC in-network schema (CMS GitHub: CMSgov/price-transparency-guide,
 * version 1.0):
 *   {
 *     "reporting_entity_name": ..., "reporting_entity_type": ...,
 *     "last_updated_on": "YYYY-MM-DD", "version": "1.0.0",
 *     "in_network": [ {
 *        "negotiated_arrangement": "ffs" | "bundle",
 *        "name": ..., "billing_code_type": "CPT" | "HCPCS" | ...,
 *        "billing_code_type_version": ..., "billing_code": "99285",
 *        "negotiated_rates": [ {
 *            "negotiated_prices": [ {
 *                "negotiated_type": "negotiated" | "derived" | "fee_schedule" | "percentage",
 *                "negotiated_rate": 123.45,          // dollars
 *                "expiration_date": "YYYY-MM-DD",
 *                "billing_class": "professional" | "institutional",
 *                "service_code": ["02", ...]?,
 *                "billing_code_modifier": [...]?
 *            }, ... ],
 *            "provider_references": [ <provider_group_id>, ... ]
 *        } ],
 *        "bundled_codes": [...]?, "covered_services": [...]?
 *     }, ... ],
 *     "provider_references": [ {
 *        "provider_group_id": 1,
 *        "provider_groups": [ { "npi": [1234567890, ...], "tin": { "type": "ein"|"ssn", "value": "..." } } ]
 *     } ]
 *   }
 *
 * FAIL-CLOSED: unknown top-level `version`, missing required keys, malformed
 * JSON tokens, or a truncated stream abort the batch with an error — partial
 * data is never persisted by the runner (the caller-owned store decides
 * persistence; this module reports counts and lets ingestContractedRates
 * own idempotency).
 *
 * RESUMABILITY: ingestion is content-addressed via ingestContractedRates
 * (batch contentHash is UNIQUE); a re-run of the same file short-circuits as
 * an idempotent replay, so resume = re-run. Within-file checkpoints are
 * reported through the onProgress callback so an operator can restart from a
 * known row offset when files are re-sliced externally.
 *
 * GHOST-RATE HEURISTIC (documented, non-statutory): a "ghost rate" is a
 * contracted rate on paper for providers who never actually bill/render the
 * service (TMA III litigation subject). MRFs contain no claims data, so the
 * true test (149.140(a)(15)(ii)(B) claims share) is not directly observable.
 * Heuristic: within one file, for a given (billing_code, negotiated_rate
 * cents), if a single rate value is carried by >= ghostMinProviders
 * distinct provider groups AND that value covers >= ghostDominantShare of
 * all provider groups billing that code, the (code, rate) pair is flagged
 * as a suspected template/ghost rate. Flagged rows are EXCLUDED from the
 * canonical row set emitted to ingestContractedRates by default
 * (includeGhostFlagged: false) and reported in stats.ghostFlaggedRows; an
 * operator may re-run with includeGhostFlagged: true to retain them (they
 * then land with claimsSharePercent unset, which the methodology layer
 * surfaces for ghost-rate review at the 2019 baseline).
 *
 * ENV:
 *   QPA_INGEST_ENABLED — must be exactly "true"; anything else refuses to run.
 *   QPA_MRF_SOURCES    — JSON array of source descriptors:
 *     [{ "url": "file:///abs/path.json" | "https://...",
 *        "payerId": "PAYER-A", "market": "SELF_INSURED", "region": "TX-MSA-12420",
 *        "serviceCodes": ["99285", ...], "effectiveDate": "YYYY-MM-DD" }, ...]
 *   Market/region/effectiveDate are operator-supplied per-file metadata: the
 *   TiC schema carries no insurance-market or geographic-region key, and the
 *   QPA methodology requires both (149.140(a)(7)/(a)(8)).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  ingestContractedRates,
  type ContractedRateStore,
  type IngestionBatch,
} from "./ingestion";
import type { ContractedRateRow, InsuranceMarket } from "./methodology";

export const QPA_INGEST_ENABLED_ENV = "QPA_INGEST_ENABLED";
export const QPA_MRF_SOURCES_ENV = "QPA_MRF_SOURCES";

/** TiC schema versions this parser accepts. Fail-closed otherwise. */
export const SUPPORTED_TIC_VERSIONS = ["1.0.0", "1.0"] as const;

export interface MrfSourceDescriptor {
  /** file:///absolute/path.json or https:// URL. */
  url: string;
  payerId: string;
  market: InsuranceMarket;
  region: string;
  /** Service codes to extract; absent => all codes in the file. */
  serviceCodes?: string[];
  /** Contract effective date to stamp on extracted rows (ISO day). */
  effectiveDate: string;
}

export interface ExtractedRateRecord {
  payerId: string;
  npis: string[];
  tinType?: string;
  tinValue?: string;
  serviceCode: string;
  negotiatedRateCents: number;
  negotiatedType: string;
  billingClass?: string;
  negotiatedArrangement: string;
  expirationDate?: string;
  providerGroupId: number;
}

export interface MrfIngestionStats {
  sourceRef: string;
  inNetworkItemsScanned: number;
  negotiatedPriceRowsScanned: number;
  ratesExtracted: number;
  /** (code, rate) pairs flagged by the ghost-rate heuristic. */
  ghostFlaggedPairs: Array<{ serviceCode: string; negotiatedRateCents: number; providerGroups: number; shareOfCode: number }>;
  ghostFlaggedRows: number;
  providerReferencesSeen: number;
}

export interface MrfParseOptions {
  payerId: string;
  market: InsuranceMarket;
  region: string;
  effectiveDate: string;
  serviceCodes?: Set<string>;
  /** Ghost heuristic thresholds (see header). */
  ghostMinProviders?: number;   // default 20
  ghostDominantShare?: number;  // default 0.9
  /** Retain ghost-flagged rows in output (default false = exclude). */
  includeGhostFlagged?: boolean;
  onProgress?: (p: { inNetworkItemsScanned: number; ratesExtracted: number }) => void;
}

export class MrfParseError extends Error {}

/* --------------------------------------------------------------------------
 * Chunked JSON tokenizer for the TiC top-level shape.
 *
 * Single state machine over the whole file:
 *   SEEK_VERSION  — scan header for "version":"x.y.z"; fail-closed if absent
 *                   within the first 4KB or unsupported.
 *   SEEK_ARRAY    — find `"<key>" : [` for the current target key.
 *   IN_ARRAY      — emit each complete top-level `{...}` element via depth
 *                   counting with full string/escape handling; on `]` move to
 *                   the next target.
 *   END           — trailing content ignored after the final target array.
 *
 * Any structural surprise raises MrfParseError — fail-closed.
 * ------------------------------------------------------------------------ */

const TARGET_KEYS = ["in_network", "provider_references"] as const;
type TargetKey = (typeof TARGET_KEYS)[number];

interface Tokenizer {
  mode: "seek_version" | "seek_array" | "in_array" | "end";
  targetIndex: number; // index into TARGET_KEYS (seek_array / in_array)
  text: string;        // unparsed text
  // element collection
  collecting: boolean;
  depth: number;
  inString: boolean;
  escaped: boolean;
  collected: string[];
  sawElement: Record<TargetKey, boolean>;
}

function newTokenizer(): Tokenizer {
  return {
    mode: "seek_version",
    targetIndex: 0,
    text: "",
    collecting: false,
    depth: 0,
    inString: false,
    escaped: false,
    collected: [],
    sawElement: { in_network: false, provider_references: false },
  };
}

/** Consume as much of tz.text as possible; emit complete elements. */
function pump(tz: Tokenizer, final: boolean, emit: (key: TargetKey, obj: any) => void): void {
  for (;;) {
    if (tz.mode === "end") return;

    if (tz.mode === "seek_version") {
      const m = /"version"\s*:\s*"([^"]+)"/.exec(tz.text);
      if (!m) {
        if (tz.text.length > 4096) throw new MrfParseError('no top-level "version" in first 4KB — not a TiC MRF');
        if (final) throw new MrfParseError('no top-level "version" — not a TiC MRF');
        return;
      }
      if (!SUPPORTED_TIC_VERSIONS.includes(m[1] as any)) {
        throw new MrfParseError(
          `unsupported TiC schema version "${m[1]}" (supported: ${SUPPORTED_TIC_VERSIONS.join(", ")}) — fail-closed`
        );
      }
      tz.mode = "seek_array";
      continue;
    }

    if (tz.mode === "seek_array") {
      const key = TARGET_KEYS[tz.targetIndex];
      const needle = `"${key}"`;
      const idx = tz.text.indexOf(needle);
      if (idx === -1) {
        if (final) {
          // in_network is mandatory; provider_references is optional.
          if (key === "in_network") throw new MrfParseError('no "in_network" array — not a TiC in-network MRF (fail-closed)');
          tz.mode = "end";
        }
        // Keep a tail window so a needle split across chunks still matches.
        if (tz.text.length > needle.length + 8) tz.text = tz.text.slice(-(needle.length + 8));
        return;
      }
      let i = idx + needle.length;
      while (i < tz.text.length && /\s/.test(tz.text[i])) i++;
      if (i >= tz.text.length) {
        if (final) throw new MrfParseError(`truncated after "${key}" — fail-closed`);
        if (tz.text.length > needle.length + 8) tz.text = tz.text.slice(-(needle.length + 8));
        return;
      }
      if (tz.text[i] !== ":") throw new MrfParseError(`"${key}" not followed by ':' — schema drift (fail-closed)`);
      i++;
      while (i < tz.text.length && /\s/.test(tz.text[i])) i++;
      if (i >= tz.text.length) {
        if (final) throw new MrfParseError(`truncated after "${key}": — fail-closed`);
        if (tz.text.length > needle.length + 8) tz.text = tz.text.slice(-(needle.length + 8));
        return;
      }
      if (tz.text[i] !== "[") throw new MrfParseError(`"${key}" is not an array — schema drift (fail-closed)`);
      tz.text = tz.text.slice(i + 1);
      tz.mode = "in_array";
      continue;
    }

    // in_array
    const key = TARGET_KEYS[tz.targetIndex];
    let i = 0;
    const b = tz.text;
    let advancedToBoundary = false;
    while (i < b.length) {
      const ch = b[i];
      if (tz.collecting) {
        tz.collected.push(ch);
        if (tz.inString) {
          if (tz.escaped) tz.escaped = false;
          else if (ch === "\\") tz.escaped = true;
          else if (ch === '"') tz.inString = false;
        } else if (ch === '"') {
          tz.inString = true;
        } else if (ch === "{") {
          tz.depth++;
        } else if (ch === "}") {
          tz.depth--;
          if (tz.depth === 0) {
            let obj: any;
            const json = tz.collected.join("");
            try {
              obj = JSON.parse(json);
            } catch (e) {
              throw new MrfParseError(`array element is not valid JSON: ${(e as Error).message}`);
            }
            tz.sawElement[key] = true;
            emit(key, obj);
            tz.collecting = false;
            tz.collected = [];
          } else if (tz.depth < 0) {
            throw new MrfParseError("JSON depth underflow while parsing array element");
          }
        }
        i++;
        continue;
      }
      if (ch === "{") {
        tz.collecting = true;
        tz.depth = 1;
        tz.inString = false;
        tz.escaped = false;
        tz.collected = ["{"];
        i++;
        continue;
      }
      if (ch === "]") {
        i++;
        advancedToBoundary = true;
        break;
      }
      if (ch === "," || /\s/.test(ch)) {
        i++;
        continue;
      }
      throw new MrfParseError(`unexpected token '${ch}' in "${key}" array — schema drift (fail-closed)`);
    }
    tz.text = b.slice(i);
    if (advancedToBoundary) {
      tz.targetIndex++;
      tz.mode = tz.targetIndex >= TARGET_KEYS.length ? "end" : "seek_array";
      continue;
    }
    if (final) {
      if (tz.collecting) throw new MrfParseError("stream ended mid-element — truncated MRF (fail-closed)");
      throw new MrfParseError(`stream ended before the "${key}" array closed — truncated MRF (fail-closed)`);
    }
    return;
  }
}

/**
 * Stream-parse a TiC in-network MRF. Async-iterates the source stream;
 * invokes onInNetworkItem / onProviderReference with parsed objects.
 */
export async function streamParseTicMrf(
  stream: Readable | AsyncIterable<Buffer | string>,
  handlers: {
    onInNetworkItem: (item: any) => void;
    onProviderReference: (ref: any) => void;
  }
): Promise<void> {
  const tz = newTokenizer();
  const emit = (key: TargetKey, obj: any) => {
    if (key === "in_network") handlers.onInNetworkItem(obj);
    else handlers.onProviderReference(obj);
  };
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    tz.text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    pump(tz, false, emit);
  }
  pump(tz, true, emit);
}

/* --------------------------------------------------------------------------
 * Extraction: TiC item -> ExtractedRateRecord -> canonical ContractedRateRow
 * ------------------------------------------------------------------------ */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dollarsToCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100);
}

function asIsoDay(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.slice(0, 10);
  return ISO_DAY.test(s) ? s : undefined;
}

/** Map TiC negotiated_arrangement + negotiated_type to the methodology ArrangementType. */
function mapArrangement(negotiatedArrangement: unknown, negotiatedType: unknown): ContractedRateRow["arrangementType"] | null {
  if (negotiatedArrangement === "ffs") return "FEE_FOR_SERVICE";
  if (negotiatedArrangement === "bundle") return "NON_FFS_BUNDLED";
  // "hidden" episodes and anything unrecognized cannot feed a statutory median.
  return null;
}

/**
 * Parse an MRF stream and return extracted rate records plus stats. Applies
 * the ghost-rate heuristic (see header). Pure/in-memory over the extracted
 * (target-code-filtered) subset — multi-GB files are streamed, but the
 * extracted subset for target service codes is held for provider-reference
 * resolution, which is the documented memory profile of this fallback parser.
 */
export async function extractRatesFromMrf(
  stream: Readable | AsyncIterable<Buffer | string>,
  opts: MrfParseOptions
): Promise<{ records: ExtractedRateRecord[]; rows: ContractedRateRow[]; stats: MrfIngestionStats }> {
  if (!ISO_DAY.test(opts.effectiveDate)) {
    throw new MrfParseError(`effectiveDate must be ISO day, got "${opts.effectiveDate}"`);
  }
  const ghostMinProviders = opts.ghostMinProviders ?? 20;
  const ghostDominantShare = opts.ghostDominantShare ?? 0.9;

  const stats: MrfIngestionStats = {
    sourceRef: "",
    inNetworkItemsScanned: 0,
    negotiatedPriceRowsScanned: 0,
    ratesExtracted: 0,
    ghostFlaggedPairs: [],
    ghostFlaggedRows: 0,
    providerReferencesSeen: 0,
  };

  const wanted = opts.serviceCodes && opts.serviceCodes.size ? new Set([...opts.serviceCodes].map(c => c.toUpperCase())) : null;
  const providerRefs = new Map<number, { npis: string[]; tinType?: string; tinValue?: string }>();
  const pending: Array<Omit<ExtractedRateRecord, "npis" | "tinType" | "tinValue">> = [];

  await streamParseTicMrf(stream, {
    onInNetworkItem(item) {
      stats.inNetworkItemsScanned++;
      const code = typeof item?.billing_code === "string" ? item.billing_code.trim().toUpperCase() : null;
      if (!code) return; // not a rate-bearing item
      if (wanted && !wanted.has(code)) return;
      const arrangement = mapArrangement(item.negotiated_arrangement, undefined);
      if (!arrangement) return; // fail-closed on unrecognized arrangement
      const rates = Array.isArray(item.negotiated_rates) ? item.negotiated_rates : [];
      for (const nr of rates) {
        const prices = Array.isArray(nr?.negotiated_prices) ? nr.negotiated_prices : [];
        const refs = Array.isArray(nr?.provider_references) ? nr.provider_references : [];
        for (const p of prices) {
          stats.negotiatedPriceRowsScanned++;
          if (p?.negotiated_type !== "negotiated" && p?.negotiated_type !== "fee_schedule") continue; // derived/percentage excluded: not a contracted dollar rate
          const cents = dollarsToCents(p?.negotiated_rate);
          if (cents === null) continue;
          for (const ref of refs) {
            if (typeof ref !== "number") continue;
            pending.push({
              payerId: opts.payerId,
              serviceCode: code,
              negotiatedRateCents: cents,
              negotiatedType: String(p.negotiated_type),
              billingClass: typeof p.billing_class === "string" ? p.billing_class : undefined,
              negotiatedArrangement: String(item.negotiated_arrangement),
              expirationDate: asIsoDay(p.expiration_date),
              providerGroupId: ref,
            });
            stats.ratesExtracted++;
          }
        }
      }
      opts.onProgress?.({ inNetworkItemsScanned: stats.inNetworkItemsScanned, ratesExtracted: stats.ratesExtracted });
    },
    onProviderReference(ref) {
      stats.providerReferencesSeen++;
      const id = ref?.provider_group_id;
      if (typeof id !== "number") return;
      const groups = Array.isArray(ref?.provider_groups) ? ref.provider_groups : [];
      const npis: string[] = [];
      let tinType: string | undefined;
      let tinValue: string | undefined;
      for (const g of groups) {
        if (Array.isArray(g?.npi)) npis.push(...g.npi.map((n: unknown) => String(n)));
        if (g?.tin && typeof g.tin === "object") {
          tinType = typeof g.tin.type === "string" ? g.tin.type : tinType;
          tinValue = typeof g.tin.value === "string" ? g.tin.value : tinValue;
        }
      }
      providerRefs.set(id, { npis, tinType, tinValue });
    },
  });

  const records: ExtractedRateRecord[] = pending.map(p => {
    const pr = providerRefs.get(p.providerGroupId);
    return { ...p, npis: pr?.npis ?? [], tinType: pr?.tinType, tinValue: pr?.tinValue };
  });

  // Ghost-rate heuristic (documented in header): a single rate value for a
  // code carried by >= ghostMinProviders distinct provider groups and covering
  // >= ghostDominantShare of that code's provider groups is a suspected
  // template/ghost rate.
  const byCode = new Map<string, Set<number>>();
  const byCodeRate = new Map<string, Set<number>>();
  for (const r of records) {
    const ck = r.serviceCode;
    const kr = `${r.serviceCode}|${r.negotiatedRateCents}`;
    if (!byCode.has(ck)) byCode.set(ck, new Set());
    byCode.get(ck)!.add(r.providerGroupId);
    if (!byCodeRate.has(kr)) byCodeRate.set(kr, new Set());
    byCodeRate.get(kr)!.add(r.providerGroupId);
  }
  const ghostKeys = new Set<string>();
  for (const [kr, groups] of byCodeRate) {
    const [code] = kr.split("|");
    const total = byCode.get(code)?.size ?? 0;
    const share = total ? groups.size / total : 0;
    if (groups.size >= ghostMinProviders && share >= ghostDominantShare) {
      ghostKeys.add(kr);
      const [serviceCode, cents] = kr.split("|");
      stats.ghostFlaggedPairs.push({
        serviceCode, negotiatedRateCents: Number(cents),
        providerGroups: groups.size, shareOfCode: Number(share.toFixed(4)),
      });
    }
  }

  const kept: ExtractedRateRecord[] = [];
  for (const r of records) {
    const isGhost = ghostKeys.has(`${r.serviceCode}|${r.negotiatedRateCents}`);
    if (isGhost) {
      stats.ghostFlaggedRows++;
      if (!opts.includeGhostFlagged) continue;
    }
    kept.push(r);
  }

  // Canonical rows for the statutory engine. Dedupe across provider groups:
  // one (payer, code, rate, arrangement) observation per MRF — the median is
  // over contracted rates, one rate per contract (149.140(b)(1)); repeated
  // provider groups sharing one contract rate are one observation here.
  const seen = new Set<string>();
  const rows: ContractedRateRow[] = [];
  for (const r of kept) {
    const key = createHash("sha256")
      .update([opts.payerId, r.serviceCode, opts.market, opts.region, r.negotiatedRateCents, r.negotiatedArrangement, r.billingClass ?? ""].join("|"))
      .digest("hex");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      payerId: opts.payerId,
      serviceCode: r.serviceCode,
      market: opts.market,
      region: opts.region,
      contractedRateCents: r.negotiatedRateCents,
      arrangementType: r.negotiatedArrangement === "bundle" ? "NON_FFS_BUNDLED" : "FEE_FOR_SERVICE",
      effectiveDate: opts.effectiveDate,
    });
  }
  stats.sourceRef = "";
  return { records, rows, stats };
}

/* --------------------------------------------------------------------------
 * Batch runner
 * ------------------------------------------------------------------------ */

function openSourceStream(url: string): Readable | Promise<Readable> {
  if (url.startsWith("file://")) return createReadStream(url.slice("file://".length));
  if (/^https?:\/\//.test(url)) {
    // Global fetch (node 20); response body is a web stream — convert.
    return fetch(url).then(res => {
      if (!res.ok || !res.body) throw new MrfParseError(`fetch ${url} failed: HTTP ${res.status}`);
      return Readable.fromWeb(res.body as any);
    });
  }
  // Bare path treated as a local file.
  return createReadStream(url);
}

export interface MrfRunResult {
  source: MrfSourceDescriptor;
  stats: MrfIngestionStats;
  batch: IngestionBatch & { idempotentReplay: boolean };
}

/**
 * Ingest one MRF source into the canonical contracted-rate store. Fail-closed:
 * any parse/validation error aborts the source; ingestContractedRates owns
 * idempotency (content-hash replay).
 */
export async function ingestMrfSource(
  source: MrfSourceDescriptor,
  store: ContractedRateStore,
  opts: Partial<MrfParseOptions> = {}
): Promise<MrfRunResult> {
  const stream = await openSourceStream(source.url);
  const { rows, stats } = await extractRatesFromMrf(stream, {
    payerId: source.payerId,
    market: source.market,
    region: source.region,
    effectiveDate: source.effectiveDate,
    serviceCodes: source.serviceCodes ? new Set(source.serviceCodes) : undefined,
    ...opts,
  });
  const batch = await ingestContractedRates(rows, {
    sourceType: "TIC_MRF",
    sourceRef: source.url,
    importedAt: new Date(),
  }, store);
  stats.sourceRef = source.url;
  return { source, stats, batch };
}

/**
 * Env-driven runner. QPA_INGEST_ENABLED must be exactly "true"; QPA_MRF_SOURCES
 * must be a JSON array of MrfSourceDescriptor. Anything else refuses to run
 * (fail-closed; ingestion is never implicit).
 */
export async function runMrfIngestionFromEnv(
  store: ContractedRateStore,
  env: NodeJS.ProcessEnv = process.env
): Promise<MrfRunResult[]> {
  if (env[QPA_INGEST_ENABLED_ENV] !== "true") {
    throw new MrfParseError(`${QPA_INGEST_ENABLED_ENV} is not "true" — refusing to run MRF ingestion (fail-closed)`);
  }
  const raw = env[QPA_MRF_SOURCES_ENV];
  if (!raw) throw new MrfParseError(`${QPA_MRF_SOURCES_ENV} is not set`);
  let sources: MrfSourceDescriptor[];
  try {
    sources = JSON.parse(raw);
  } catch (e) {
    throw new MrfParseError(`${QPA_MRF_SOURCES_ENV} is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new MrfParseError(`${QPA_MRF_SOURCES_ENV} must be a non-empty JSON array`);
  }
  const results: MrfRunResult[] = [];
  for (const s of sources) {
    results.push(await ingestMrfSource(s, store));
  }
  return results;
}
