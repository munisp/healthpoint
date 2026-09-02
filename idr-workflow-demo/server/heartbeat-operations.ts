import type { HeartbeatJobInfo } from "./_core/heartbeat";

export function summarizeHeartbeatOperations(jobs: HeartbeatJobInfo[]) {
  const enabled = jobs.filter(job => job.isEnable).length;
  const overdue = jobs.filter(job => !job.nextExecutionAt).length;
  return { total: jobs.length, enabled, paused: jobs.length - enabled, overdue };
}
