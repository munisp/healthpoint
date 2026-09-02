import { eq } from "drizzle-orm";
import { settlementJobConfigs } from "../../drizzle/schema";
import { getDb } from "../db";

export type HeartbeatJob = {
  name: string;
  cron: string;
  path: string;
  method?: "POST";
  payload?: unknown;
  description?: string;
};

export type HeartbeatJobUpdate = Partial<Omit<HeartbeatJob, "name">> & {
  enable?: boolean;
};

export type HeartbeatJobInfo = {
  taskUid: string;
  name: string;
  description: string;
  cronExpression: string;
  callbackPath: string;
  callbackMethod: "POST";
  isEnable: boolean;
  lastExecutedAt?: string | null;
  nextExecutionAt: string | null;
  scheduler: "external";
};

const DEFINITIONS: Record<string, Omit<HeartbeatJobInfo, "cronExpression" | "isEnable" | "nextExecutionAt">> = {
  "daily-settlement-balance-proof": {
    taskUid: "local:daily-settlement-balance-proof",
    name: "daily-settlement-balance-proof",
    description: "Daily PostgreSQL settlement balance proof and exception alert review",
    callbackPath: "/api/scheduled/settlement-balance-proof",
    callbackMethod: "POST",
    scheduler: "external",
  },
};

function validateCron(cron: string): string {
  const normalized = cron.trim();
  if (normalized.length > 64 || normalized.split(/\s+/).length !== 6) {
    throw new Error("Scheduled job cron must contain exactly six UTC fields");
  }
  if (!/^[0-9*/?,\-\sA-Z]+$/i.test(normalized)) {
    throw new Error("Scheduled job cron contains unsupported characters");
  }
  return normalized;
}

function canonicalDefinition(job: HeartbeatJob): Omit<HeartbeatJobInfo, "cronExpression" | "isEnable" | "nextExecutionAt"> {
  const definition = DEFINITIONS[job.name];
  if (!definition || definition.callbackPath !== job.path || (job.method ?? "POST") !== definition.callbackMethod) {
    throw new Error("Only allow-listed scheduled jobs may be registered");
  }
  return definition;
}

/**
 * Records an approved schedule. It does not provision a background task:
 * Kubernetes CronJob, Temporal Schedule, or another approved scheduler must
 * invoke the protected endpoint with SCHEDULED_SECRET.
 */
export async function createHeartbeatJob(job: HeartbeatJob): Promise<HeartbeatJobInfo> {
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable; scheduler registry was not updated");
  const definition = canonicalDefinition(job);
  const cron = validateCron(job.cron);
  const now = new Date();
  await db.insert(settlementJobConfigs).values({
    id: job.name,
    name: job.name,
    cronExpression: cron,
    scheduleCronTaskUid: definition.taskUid,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: settlementJobConfigs.id,
    set: {
      cronExpression: cron,
      scheduleCronTaskUid: definition.taskUid,
      isEnabled: true,
      updatedAt: now,
    },
  });
  return { ...definition, cronExpression: cron, isEnable: true, nextExecutionAt: null };
}

export async function updateHeartbeatJob(taskUid: string, patch: HeartbeatJobUpdate): Promise<HeartbeatJobInfo> {
  const name = Object.keys(DEFINITIONS).find(key => DEFINITIONS[key].taskUid === taskUid);
  if (!name) throw new Error("Unknown local scheduler registry task");
  const definition = DEFINITIONS[name];
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable; scheduler registry was not updated");
  const [existing] = await db.select().from(settlementJobConfigs).where(eq(settlementJobConfigs.id, name)).limit(1);
  if (!existing) throw new Error("Scheduled job is not registered");
  const cron = patch.cron === undefined ? existing.cronExpression : validateCron(patch.cron);
  if (patch.path !== undefined && patch.path !== definition.callbackPath) throw new Error("Scheduled callback path is immutable");
  if (patch.method !== undefined && patch.method !== "POST") throw new Error("Scheduled callback method is immutable");
  const enabled = patch.enable ?? existing.isEnabled;
  await db.update(settlementJobConfigs).set({ cronExpression: cron, isEnabled: enabled, updatedAt: new Date() }).where(eq(settlementJobConfigs.id, name));
  return { ...definition, cronExpression: cron, isEnable: enabled, nextExecutionAt: null };
}

export async function deleteHeartbeatJob(taskUid: string): Promise<void> {
  const name = Object.keys(DEFINITIONS).find(key => DEFINITIONS[key].taskUid === taskUid);
  if (!name) return;
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable; scheduler registry was not updated");
  await db.update(settlementJobConfigs).set({ isEnabled: false, updatedAt: new Date() }).where(eq(settlementJobConfigs.id, name));
}

export async function listHeartbeatJobs(): Promise<{ total: number; jobs: HeartbeatJobInfo[] }> {
  const db = await getDb();
  if (!db) return { total: 0, jobs: [] };
  const rows = await db.select().from(settlementJobConfigs);
  const jobs = rows.flatMap(row => {
    const definition = DEFINITIONS[row.id];
    return definition ? [{ ...definition, cronExpression: row.cronExpression, isEnable: row.isEnabled, nextExecutionAt: null }] : [];
  });
  return { total: jobs.length, jobs };
}
