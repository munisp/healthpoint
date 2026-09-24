/**
 * server/emr/retry.ts
 *
 * Retry-with-backoff for EMR / AI-service calls and durable failure logging.
 *
 * Retry policy:
 *  - Up to `attempts` total tries (default 3).
 *  - Retries ONLY transient failures: HTTP 5xx, request timeouts, and
 *    network-level errors (ECONNREFUSED/ECONNRESET/UND_ERR_* etc.).
 *  - HTTP 4xx is a client/spec error — retried never (fail fast).
 *  - Backoff: baseDelayMs * 2^(attempt-1) (250ms, 500ms, ... by default).
 */

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Error shape carrying an HTTP status, when one was observed. */
export interface StatusError extends Error {
  status?: number;
  code?: string;
}

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET", "TimeoutError",
]);

/** True when the failure is transient (5xx/timeout/network) and retryable. */
export function isTransientError(err: unknown): boolean {
  const e = err as StatusError & { cause?: { code?: string } };
  if (!e) return false;
  const status = e.status ?? (e as any).statusCode;
  if (typeof status === "number") {
    if (status >= 400 && status < 500) return false; // 4xx: never retry
    if (status >= 500) return true;
  }
  const name = (e as any).name as string | undefined;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const code = e.code ?? e.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  // fetch() network failures surface as TypeError("fetch failed") with a cause.
  if (e instanceof TypeError && /fetch failed/i.test(e.message)) return true;
  return false;
}

/** Run `fn` with retry-on-transient and exponential backoff. */
export async function withEmrRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isTransientError(err)) throw err;
      await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

/**
 * Persist a failed-sync log row; if the insert itself fails, retry exactly
 * once after a short delay before giving up (never throws — logging must not
 * mask the underlying EMR failure).
 */
export async function persistSyncLogWithRetry(
  insert: () => Promise<unknown>,
  opts: RetryOptions = {},
): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  try {
    await insert();
  } catch {
    try {
      await sleep(opts.baseDelayMs ?? 100);
      await insert();
    } catch (retryErr) {
      console.warn("[emr] sync-log insert failed after one retry:", retryErr);
    }
  }
}
