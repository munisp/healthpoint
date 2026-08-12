import { dispatchOutboxBatch } from "./outbox";

const OUTBOX_INTERVAL_MS = Math.max(1_000, Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS ?? 5_000));
let timer: NodeJS.Timeout | undefined;
let dispatching = false;

export async function runOutboxWorkerOnce(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    let result = await dispatchOutboxBatch();
    // Drain a bounded burst to reduce reconciliation delay without monopolizing
    // the event loop during a backlog.
    let batches = 1;
    while (result.claimed > 0 && batches < 10) {
      result = await dispatchOutboxBatch();
      batches++;
    }
  } catch (error) {
    console.error("[outbox] worker cycle failed", error);
  } finally {
    dispatching = false;
  }
}

export function startOutboxWorker(): void {
  if (timer) return;
  void runOutboxWorkerOnce();
  timer = setInterval(() => void runOutboxWorkerOnce(), OUTBOX_INTERVAL_MS);
  timer.unref();
}

export function stopOutboxWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
