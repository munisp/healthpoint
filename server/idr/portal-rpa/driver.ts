/**
 * driver.ts — stepwise, fail-closed browser-automation engine for the CMS
 * federal IDR portal (nsa-idr.cms.gov). CMS operates NO submission API;
 * this driver is the audited browser workaround.
 *
 * Safety invariants:
 *  - Default mode is DRY_RUN. LIVE requires BOTH env RPA_LIVE_ENABLED=true
 *    and RPA_TOS_ACKNOWLEDGED=true; otherwise the run returns BLOCKED.
 *  - DRY_RUN executes every step EXCEPT the final submit click.
 *  - Before every step the page URL must match the step's urlPattern and
 *    every field selector must resolve to EXACTLY ONE element; any mismatch
 *    HALTS with CHECKPOINT_REQUIRED + evidence (screenshot ref).
 *  - login.gov MFA / CAPTCHA indicators produce CHECKPOINT_REQUIRED
 *    (kind MFA|CAPTCHA) and the run parks with a resume token.
 *  - SUBMIT is never retried (never double-file). After LIVE submit, the
 *    CMS dispute reference number MUST be captured; if not found the run
 *    ends SUBMITTED_UNCONFIRMED and nothing is auto-acknowledged.
 *  - Credentials are never stored or logged: they are resolved at run time
 *    through an injected CredentialResolver and sensitive field values are
 *    redacted in every log line.
 *  - Idempotent: a completed run for the same submissionId returns the
 *    prior result without re-executing.
 *
 * Browser access goes through the minimal `PageLike` interface. Production
 * wiring uses Playwright (see `createPlaywrightPage`, lazy-imported so this
 * module loads without playwright installed); tests drive a local fake
 * portal page (test-harness/fake-portal.ts — TEST HARNESS ONLY, not the
 * real portal).
 */
import { createHash, randomUUID } from "node:crypto";
import type { PortalFieldDef, PortalMap, PortalStepDef, SelectorStrategy } from "./config";

// ---------------------------------------------------------------------------
// Page abstraction
// ---------------------------------------------------------------------------

/** Minimal page surface used by the driver. Implemented by Playwright and by
 * the test-harness fake page. */
export interface PageLike {
  url(): string;
  /** Current full HTML (for DOM snapshot hashing). */
  content(): Promise<string>;
  goto(url: string): Promise<void>;
  /** Number of elements matching a CSS selector. */
  count(css: string): Promise<number>;
  /** Number of elements matching an XPath expression (optional capability). */
  countXPath?(xpath: string): Promise<number>;
  /** Number of elements whose accessible label matches (optional). */
  countByLabel?(label: string): Promise<number>;
  fill(css: string, value: string): Promise<void>;
  click(css: string): Promise<void>;
  /** Set file(s) on an <input type=file>. */
  setFiles?(css: string, paths: string[]): Promise<void>;
  /** Visible text of the first match, or null. */
  text(css: string): Promise<string | null>;
  textByLabel?(label: string): Promise<string | null>;
  screenshot(): Promise<Buffer>;
  /** Serialized storage state for parking/resuming a run (optional). */
  storageState?(): Promise<string>;
}

/** Lazy Playwright adapter. Never imported at module load; production only. */
export async function createPlaywrightPage(startUrl: string): Promise<{ page: PageLike; close(): Promise<void> }> {
  const pw = (await import("playwright")) as typeof import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const like: PageLike = {
    url: () => page.url(),
    content: () => page.content(),
    goto: (u) => page.goto(u).then(() => undefined),
    count: (css) => page.locator(css).count(),
    countXPath: (xp) => page.locator(`xpath=${xp}`).count(),
    countByLabel: (l) => page.getByLabel(l).count(),
    fill: (css, v) => page.locator(css).fill(v),
    click: (css) => page.locator(css).click(),
    setFiles: (css, paths) => page.locator(css).setInputFiles(paths),
    text: async (css) => {
      // Never wait for an absent element — check count first (fail-closed fast).
      if ((await page.locator(css).count()) === 0) return null;
      return page.locator(css).first().textContent().catch(() => null);
    },
    textByLabel: async (l) => (await page.getByLabel(l).first().textContent().catch(() => null)),
    screenshot: () => page.screenshot({ fullPage: true }),
    storageState: () => ctx.storageState().then((s) => JSON.stringify(s)),
  };
  await page.goto(startUrl);
  return { page: like, close: () => browser.close().then(() => undefined) };
}

// ---------------------------------------------------------------------------
// Credentials — never stored, never logged
// ---------------------------------------------------------------------------

/** Resolves a credentials reference to live credential values at run time.
 * Production wiring: resolve an encrypted envelope from the vault and call
 * `decryptCredentials` from server/credential-crypto.ts. This module never
 * persists the resolved values. */
export interface CredentialResolver {
  resolve(ref: string): Promise<Record<string, string>>;
}

/** Reference implementation: credentials stored encrypted in an env var
 * named by the reference, decrypted via the existing credential-crypto. */
export async function createEnvCredentialResolver(): Promise<CredentialResolver> {
  const { decryptCredentials } = await import("../../credential-crypto");
  return {
    async resolve(ref) {
      const envelope = process.env[ref];
      if (!envelope) throw new RpaError("CREDENTIALS", `credential reference ${ref} is not set`);
      return decryptCredentials(envelope);
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvidenceArtifact {
  kind: "screenshot" | "dom-snapshot-hash" | "timeline" | "confirmation";
  ref: string;
}

export interface EvidenceSink {
  put(key: string, data: Buffer | string, contentType: string): Promise<string>;
}

/** Production sink: existing storage proxy (server/storage.ts storagePut). */
export function createStorageEvidenceSink(): EvidenceSink {
  return {
    async put(key, data, contentType) {
      const { storagePut } = await import("../../storage");
      const { key: storedKey } = await storagePut(key, data as Buffer | string, contentType);
      return storedKey;
    },
  };
}

/** Filesystem sink for tests and local dry runs. */
export function createFilesystemEvidenceSink(root: string): EvidenceSink {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  return {
    async put(key, data) {
      const full = path.join(root, key);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
      return `file://${full}`;
    },
  };
}

/** No-op sink used when no evidence storage is configured (still hashes DOM). */
export const nullEvidenceSink: EvidenceSink = { put: async (key) => `null://${key}` };

// ---------------------------------------------------------------------------
// Run store — in-memory now; persistence arrives via the concurrent
// persistence wave. The interface is the seam.
// ---------------------------------------------------------------------------

export type RunMode = "DRY_RUN" | "LIVE";
export type RunStatus =
  | "RUNNING"
  | "BLOCKED"
  | "DRY_RUN_COMPLETE"
  | "CHECKPOINT_REQUIRED"
  | "COMPLETED"
  | "SUBMITTED_UNCONFIRMED"
  | "FAILED";

export interface TimelineEntry {
  at: string;
  stepId: string;
  action: string;
  detail?: string;
}

export interface CheckpointInfo {
  kind: "MFA" | "CAPTCHA" | "DOM_MISMATCH" | "URL_MISMATCH" | "SELECTOR_AMBIGUOUS" | "SELECTOR_MISSING";
  reason: string;
  stepId: string;
  screenshotRef?: string;
}

export interface RunResult {
  runId: string;
  submissionId: string;
  mode: RunMode;
  status: RunStatus;
  /** FSM-ready attestation, present when a LIVE run reached CONFIRMATION. */
  attestation?: { actorId: string; attestedAt: string };
  /** Captured CMS dispute reference number (feeds FSM ACKNOWLEDGED). */
  cmsDisputeReferenceNumber?: string;
  checkpoint?: CheckpointInfo;
  /** Resume token issued when the run parks at a checkpoint. */
  resumeToken?: string;
  evidence: EvidenceArtifact[];
  /** Filled field keys (values NEVER included for sensitive fields). */
  filledFields: Array<{ stepId: string; portalFieldKey: string; value: string | "[REDACTED]" }>;
  timeline: TimelineEntry[];
  startedAt: string;
  completedAt?: string;
}

export interface RunRecord extends RunResult {
  /** Serialized browser storage state while parked at a checkpoint. */
  parkedStorageState?: string;
  /** Index of the next step to execute when resuming. */
  nextStepIndex?: number;
}

export interface RunStore {
  get(runId: string): Promise<RunRecord | undefined>;
  getBySubmission(submissionId: string): Promise<RunRecord | undefined>;
  getByResumeToken(token: string): Promise<RunRecord | undefined>;
  put(record: RunRecord): Promise<void>;
}

export class InMemoryRunStore implements RunStore {
  private byId = new Map<string, RunRecord>();
  async get(runId: string) { return this.byId.get(runId); }
  async getBySubmission(submissionId: string) {
    return [...this.byId.values()].find((r) => r.submissionId === submissionId);
  }
  async getByResumeToken(token: string) {
    return [...this.byId.values()].find((r) => r.resumeToken === token);
  }
  async put(record: RunRecord) { this.byId.set(record.runId, record); }
}

// ---------------------------------------------------------------------------
// Redaction & logging
// ---------------------------------------------------------------------------

// Word-level match: splits camelCase/kebab/snake keys into words so that
// "initiatingPartyName" does NOT match "tin" but "initiatingPartyTin" does.
const SENSITIVE_WORDS = new Set(["tin", "ssn", "password", "secret", "tax", "credential", "token"]);

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])(?=[A-Z])/g, "$1 ")
    .split(/[^a-zA-Z0-9]+|\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isSensitiveField(f: Pick<PortalFieldDef, "portalFieldKey" | "sensitive">): boolean {
  return f.sensitive === true || keyWords(f.portalFieldKey).some((w) => SENSITIVE_WORDS.has(w));
}

/** Log line with sensitive values stripped. */
export function redactValue(f: Pick<PortalFieldDef, "portalFieldKey" | "sensitive">, value: string): string | "[REDACTED]" {
  return isSensitiveField(f) ? "[REDACTED]" : value;
}

export class RpaError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RpaError";
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface RunInput {
  submissionId: string;
  portalFields: Record<string, string>;
  /** Document file paths for the DOCUMENT_UPLOAD file input. */
  documents?: string[];
  /** Opaque reference resolved via CredentialResolver (e.g. env var name). */
  credentialsRef: string;
  mode?: RunMode;
  /** Actor id used for the FSM attestation on a successful LIVE run. */
  actorId: string;
}

export interface DriverDeps {
  portalMap: PortalMap;
  credentialResolver: CredentialResolver;
  evidenceSink?: EvidenceSink;
  runStore?: RunStore;
  /** Supplies the page; production passes () => createPlaywrightPage(baseUrl). */
  pageFactory: () => Promise<{ page: PageLike; close(): Promise<void> }>;
  /** Injectable env for tests. */
  env?: Record<string, string | undefined>;
  defaultStepTimeoutMs?: number;
  onEvent?: (event: { type: string; runId: string; submissionId: string; detail?: Record<string, unknown> }) => void;
}

function envFlag(env: Record<string, string | undefined>, name: string): boolean {
  return env[name] === "true";
}

export function stepTimeoutMs(step: PortalStepDef, deps: DriverDeps): number {
  const env = deps.env ?? process.env;
  const fromEnv = Number(env.RPA_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return step.timeoutMs ?? deps.defaultStepTimeoutMs ?? 30_000;
}

async function resolveSelectorCount(page: PageLike, s: SelectorStrategy): Promise<number> {
  if (s.css) return page.count(s.css);
  if (s.xpath && page.countXPath) return page.countXPath(s.xpath);
  if (s.labelText && page.countByLabel) return page.countByLabel(s.labelText);
  // Strategy provided but the page cannot evaluate it → treat as missing (fail-closed).
  return 0;
}

async function extractText(page: PageLike, s: SelectorStrategy): Promise<string | null> {
  if (s.css) return page.text(s.css);
  if (s.labelText && page.textByLabel) return page.textByLabel(s.labelText);
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RpaError("TIMEOUT", `${what} exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const TERMINAL_STATUSES: RunStatus[] = ["COMPLETED", "SUBMITTED_UNCONFIRMED", "DRY_RUN_COMPLETE", "BLOCKED"];

export class PortalRpaDriver {
  constructor(private readonly deps: DriverDeps) {}

  private get store(): RunStore {
    return (this.deps.runStore ??= new InMemoryRunStore());
  }

  private get sink(): EvidenceSink {
    return this.deps.evidenceSink ?? nullEvidenceSink;
  }

  private emit(type: string, run: { runId: string; submissionId: string }, detail?: Record<string, unknown>): void {
    this.deps.onEvent?.({ type, runId: run.runId, submissionId: run.submissionId, detail });
  }

  private log(record: RunRecord, stepId: string, action: string, detail?: string): void {
    record.timeline.push({ at: new Date().toISOString(), stepId, action, detail });
  }

  async runPortalSubmission(input: RunInput): Promise<RunResult> {
    const env = (this.deps.env ?? process.env) as Record<string, string | undefined>;
    const mode: RunMode = input.mode ?? "DRY_RUN";

    // Idempotency: a finished run for this submission is authoritative.
    const prior = await this.store.getBySubmission(input.submissionId);
    if (prior && TERMINAL_STATUSES.includes(prior.status)) {
      return this.toResult(prior);
    }

    const record: RunRecord = {
      runId: randomUUID(),
      submissionId: input.submissionId,
      mode,
      status: "RUNNING",
      evidence: [],
      filledFields: [],
      timeline: [],
      startedAt: new Date().toISOString(),
    };

    // LIVE gating: BOTH flags required.
    if (mode === "LIVE" && (!envFlag(env, "RPA_LIVE_ENABLED") || !envFlag(env, "RPA_TOS_ACKNOWLEDGED"))) {
      record.status = "BLOCKED";
      record.completedAt = new Date().toISOString();
      this.log(record, "PRE_FLIGHT", "blocked", "LIVE mode requires RPA_LIVE_ENABLED=true AND RPA_TOS_ACKNOWLEDGED=true");
      await this.store.put(record);
      this.emit("rpa.run.blocked", record);
      return this.toResult(record);
    }

    // Credentials resolved in-memory only; never written to the record or logs.
    let credentials: Record<string, string>;
    try {
      credentials = await this.deps.credentialResolver.resolve(input.credentialsRef);
    } catch (err) {
      record.status = "FAILED";
      record.completedAt = new Date().toISOString();
      this.log(record, "PRE_FLIGHT", "credential-resolution-failed", err instanceof Error ? err.message : String(err));
      await this.store.put(record);
      return this.toResult(record);
    }

    let pageHandle: { page: PageLike; close(): Promise<void> } | undefined;
    try {
      pageHandle = await this.deps.pageFactory();
      await this.executeSteps(record, pageHandle.page, input, credentials, 0);
      return this.toResult(record);
    } catch (err) {
      record.status = "FAILED";
      record.completedAt = new Date().toISOString();
      this.log(record, "ENGINE", "error", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      await this.store.put(record);
      this.emit("rpa.run.failed", record);
      return this.toResult(record);
    } finally {
      await pageHandle?.close().catch(() => undefined);
    }
  }

  /** Continue a parked run. The caller must re-supply the original RunInput
   * (values are intentionally not persisted on the parked record — sensitive
   * values are never stored) plus, for MFA checkpoints, the human-supplied
   * mfaCode. */
  async resumeRun(
    resumeToken: string,
    input: RunInput,
    opts: { mfaCode?: string; pageFactory?: DriverDeps["pageFactory"] } = {}
  ): Promise<RunResult> {
    const record = await this.store.getByResumeToken(resumeToken);
    if (!record || record.status !== "CHECKPOINT_REQUIRED") {
      throw new RpaError("RESUME", "unknown or non-parked resume token");
    }
    if (record.checkpoint?.kind === "MFA" && !opts.mfaCode) {
      throw new RpaError("RESUME", "MFA checkpoint requires an mfaCode");
    }
    if (record.checkpoint?.kind === "CAPTCHA") {
      // CAPTCHA can never be solved programmatically; the human must clear it
      // out-of-band and the run simply re-validates on resume.
      this.log(record, record.checkpoint.stepId, "captcha-resume-attempt", "human indicated CAPTCHA cleared");
    }
    const credentials = await this.deps.credentialResolver.resolve(input.credentialsRef);
    const pageFactory = opts.pageFactory ?? this.deps.pageFactory;
    const pageHandle = await pageFactory();
    try {
      const { page } = pageHandle;
      const startIdx = record.nextStepIndex ?? 0;
      if (record.checkpoint?.kind === "MFA" && opts.mfaCode) {
        const inputSel = this.deps.portalMap.checkpoints.mfaCodeInput;
        if (!inputSel?.css) throw new RpaError("RESUME", "portal map has no mfaCodeInput selector configured");
        await page.fill(inputSel.css, opts.mfaCode);
        this.log(record, this.deps.portalMap.steps[startIdx]?.stepId ?? "MFA", "mfa-code-submitted", "[REDACTED]");
        // Submit the MFA form (harness + login.gov both expose a submit button).
        if ((await page.count("button[type='submit']")) === 1) {
          await page.click("button[type='submit']");
        }
      }
      record.status = "RUNNING";
      record.checkpoint = undefined;
      record.resumeToken = undefined;
      this.log(record, this.deps.portalMap.steps[startIdx]?.stepId ?? "RESUME", "resumed");
      await this.executeSteps(record, page, input, credentials, startIdx, record.mode === "LIVE" && startIdx > this.submitStepIndex());
      return this.toResult(record);
    } catch (err) {
      record.status = "FAILED";
      record.completedAt = new Date().toISOString();
      this.log(record, "ENGINE", "error", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      await this.store.put(record);
      this.emit("rpa.run.failed", record);
      return this.toResult(record);
    } finally {
      await pageHandle.close().catch(() => undefined);
    }
  }

  private submitStepIndex(): number {
    return this.deps.portalMap.steps.findIndex((s) => s.fields.some((f) => f.action === "submit"));
  }

  /**
   * Core stepwise loop, shared by run and resume. Persists the record at
   * every state change. `alreadySubmitted` carries the never-double-file
   * guard across a resume boundary.
   */
  private async executeSteps(
    record: RunRecord,
    page: PageLike,
    input: RunInput,
    credentials: Record<string, string>,
    startIdx: number,
    alreadySubmitted = false
  ): Promise<void> {
    const steps = this.deps.portalMap.steps;
    let submitted = alreadySubmitted;
    const submitIdx = this.submitStepIndex();

    for (let i = startIdx; i < steps.length; i++) {
      // DRY_RUN never reaches post-submit steps (there is no real
      // confirmation page to validate against).
      if (record.mode === "DRY_RUN" && submitIdx >= 0 && i > submitIdx) break;
      const step = steps[i];
      const timeout = stepTimeoutMs(step, this.deps);

      if (step.entryUrl && !new RegExp(step.urlPattern).test(page.url())) {
        await withTimeout(page.goto(step.entryUrl), timeout, `navigate ${step.stepId}`);
      }

      // MFA / CAPTCHA detection first: a challenge page (e.g. login.gov MFA)
      // legitimately does not match the upcoming step's URL pattern and must
      // park as MFA/CAPTCHA, not as a URL mismatch.
      const checkpoint = await this.detectCheckpoint(page);
      if (checkpoint) {
        await this.park(record, page, { ...checkpoint, stepId: step.stepId }, i);
        return;
      }

      // URL assertion — fail-closed.
      if (!new RegExp(step.urlPattern).test(page.url())) {
        await this.park(record, page, {
          kind: "URL_MISMATCH",
          reason: `page URL ${page.url()} does not match step pattern ${step.urlPattern}`,
          stepId: step.stepId,
        }, i);
        return;
      }

      // Selector assertions — each field selector must resolve to exactly one.
      for (const f of step.fields) {
        const count = await withTimeout(resolveSelectorCount(page, f.selectorStrategy), timeout, `resolve ${f.portalFieldKey}`);
        if (count === 0) {
          await this.park(record, page, {
            kind: "SELECTOR_MISSING",
            reason: `selector for field ${f.portalFieldKey} resolved 0 elements`,
            stepId: step.stepId,
          }, i);
          return;
        }
        if (count > 1) {
          await this.park(record, page, {
            kind: "SELECTOR_AMBIGUOUS",
            reason: `selector for field ${f.portalFieldKey} resolved ${count} elements (expected exactly 1)`,
            stepId: step.stepId,
          }, i);
          return;
        }
      }

      // Execute fields.
      for (const f of step.fields) {
        const css = f.selectorStrategy.css;
        if (f.action === "submit") {
          if (record.mode === "DRY_RUN") {
            this.log(record, step.stepId, "submit-skipped", "DRY_RUN: final submit click suppressed (would-submit evidence)");
            continue;
          }
          if (submitted) {
            throw new RpaError("DOUBLE_SUBMIT_GUARD", "submit already executed — refusing to double-file");
          }
          submitted = true;
          await withTimeout(page.click(css!), timeout, "submit click");
          this.log(record, step.stepId, "submit-clicked");
          continue;
        }
        if (f.inputType === "button") {
          await withTimeout(page.click(css!), timeout, `click ${f.portalFieldKey}`);
          this.log(record, step.stepId, "click", f.portalFieldKey);
          continue;
        }
        if (f.inputType === "checkbox") {
          await withTimeout(page.click(css!), timeout, `check ${f.portalFieldKey}`);
          this.log(record, step.stepId, "check", f.portalFieldKey);
          continue;
        }
        if (f.inputType === "file") {
          const docs = input.documents ?? [];
          if (docs.length > 0 && page.setFiles) {
            await withTimeout(page.setFiles(css!, docs), timeout, `upload ${f.portalFieldKey}`);
          }
          this.log(record, step.stepId, "upload", `${f.portalFieldKey} (${docs.length} document(s))`);
          continue;
        }
        // Value-bearing field.
        const value = f.portalFieldKey.startsWith("credential:")
          ? credentials[f.portalFieldKey.slice("credential:".length)]
          : input.portalFields[f.portalFieldKey];
        if (value === undefined || value === null) {
          await this.park(record, page, {
            kind: "DOM_MISMATCH",
            reason: `no value available for required portal field ${f.portalFieldKey}`,
            stepId: step.stepId,
          }, i);
          return;
        }
        await withTimeout(page.fill(css!, value), timeout, `fill ${f.portalFieldKey}`);
        const shown = redactValue(f, value);
        record.filledFields.push({ stepId: step.stepId, portalFieldKey: f.portalFieldKey, value: shown });
        this.log(record, step.stepId, "fill", `${f.portalFieldKey}=${shown}`);
      }

      // Evidence per step.
      if (step.evidenceRequired) {
        const shot = await page.screenshot().catch(() => Buffer.alloc(0));
        const ref = await this.sink.put(`rpa/${record.runId}/${step.stepId}.png`, shot, "image/png");
        record.evidence.push({ kind: "screenshot", ref });
        this.log(record, step.stepId, "evidence", `screenshot ${ref}`);
      }
      const domHash = createHash("sha256").update(await page.content()).digest("hex");
      record.evidence.push({ kind: "dom-snapshot-hash", ref: `sha256:${step.stepId}:${domHash}` });
    }

    // Confirmation capture (only LIVE runs submit; DRY_RUN skips submit and
    // therefore never reaches a real confirmation page — but the harness may
    // still be parked on a synthetic one, so only LIVE captures).
    if (record.mode === "LIVE") {
      const captured = await this.captureConfirmation(page);
      if (!captured) {
        record.status = "SUBMITTED_UNCONFIRMED";
        record.completedAt = new Date().toISOString();
        this.log(record, "CONFIRMATION", "reference-not-found", "fail-closed: no CMS dispute reference captured; NOT auto-acknowledging");
        await this.store.put(record);
        this.emit("rpa.run.unconfirmed", record);
        return;
      }
      record.cmsDisputeReferenceNumber = captured;
      record.attestation = { actorId: input.actorId, attestedAt: new Date().toISOString() };
      record.evidence.push({
        kind: "confirmation",
        ref: await this.sink.put(`rpa/${record.runId}/confirmation.txt`, captured, "text/plain"),
      });
      record.status = "COMPLETED";
      this.log(record, "CONFIRMATION", "reference-captured", captured);
    } else {
      record.status = "DRY_RUN_COMPLETE";
      this.log(record, "COMPLETE", "dry-run-complete", "all steps executed except final submit click");
    }
    record.completedAt = new Date().toISOString();
    const timelineRef = await this.sink.put(
      `rpa/${record.runId}/timeline.json`, JSON.stringify(record.timeline, null, 2), "application/json"
    );
    record.evidence.push({ kind: "timeline", ref: timelineRef });
    await this.store.put(record);
    this.emit(record.status === "COMPLETED" ? "rpa.run.completed" : "rpa.run.dry_run_complete", record);
  }

  private async detectCheckpoint(page: PageLike): Promise<Pick<CheckpointInfo, "kind" | "reason"> | null> {
    const { checkpoints } = this.deps.portalMap;
    for (const s of checkpoints.mfa) {
      if ((await resolveSelectorCount(page, s)) > 0) {
        return { kind: "MFA", reason: "login.gov MFA challenge detected" };
      }
    }
    for (const s of checkpoints.captcha) {
      if ((await resolveSelectorCount(page, s)) > 0) {
        return { kind: "CAPTCHA", reason: "CAPTCHA challenge detected" };
      }
    }
    return null;
  }

  private async park(record: RunRecord, page: PageLike, checkpoint: CheckpointInfo, nextStepIndex: number): Promise<void> {
    let screenshotRef: string | undefined;
    try {
      const shot = await page.screenshot();
      screenshotRef = await this.sink.put(`rpa/${record.runId}/checkpoint-${checkpoint.stepId}.png`, shot, "image/png");
      record.evidence.push({ kind: "screenshot", ref: screenshotRef });
    } catch { /* screenshot best-effort */ }
    record.status = "CHECKPOINT_REQUIRED";
    record.checkpoint = { ...checkpoint, screenshotRef };
    record.resumeToken = randomUUID();
    record.nextStepIndex = nextStepIndex;
    record.parkedStorageState = await page.storageState?.().catch(() => undefined);
    record.completedAt = new Date().toISOString();
    this.log(record, checkpoint.stepId, "checkpoint", checkpoint.reason);
    await this.store.put(record);
    this.emit("rpa.run.checkpoint", record, { kind: checkpoint.kind, stepId: checkpoint.stepId });
  }

  private async captureConfirmation(page: PageLike): Promise<string | null> {
    const pattern = new RegExp(this.deps.portalMap.confirmation.referencePattern);
    for (const s of this.deps.portalMap.confirmation.referenceSelectors) {
      const text = await extractText(page, s).catch(() => null);
      if (!text) continue;
      const m = text.match(pattern);
      if (m) return m[0];
    }
    return null;
  }

  private toResult(record: RunRecord): RunResult {
    const { parkedStorageState: _p, nextStepIndex: _n, ...result } = record;
    return result;
  }
}
