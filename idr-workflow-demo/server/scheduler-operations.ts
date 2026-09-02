import { listHeartbeatJobs } from "./_core/heartbeat";

/**
 * Returns durable desired schedules. `scheduler: external` means an approved
 * Kubernetes CronJob or Temporal Schedule must invoke the protected endpoint;
 * this query is intentionally not evidence that a scheduler has been deployed.
 */
export async function listSchedulerJobs() {
  return listHeartbeatJobs();
}
