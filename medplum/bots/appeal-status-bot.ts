/**
 * HealthPoint Medplum Bot: Appeal Status Sync
 * ============================================
 * Triggered by Subscription on Task updates where the Task represents an appeal.
 * Syncs appeal status changes back to the HealthPoint PostgreSQL appeal_escalation table
 * via the appeal_escalation_service REST API.
 */

import { BotEvent, MedplumClient, Task } from "@medplum/fhirtypes";

const APPEAL_SERVICE_URL =
  process.env.APPEAL_SERVICE_URL ??
  "http://appeal-escalation-service:8000";

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Task>
): Promise<void> {
  const task = event.input;

  if (!task.id) {
    throw new Error("Task has no ID.");
  }

  // Only process appeal tasks
  const taskCode = task.code?.coding?.[0]?.code ?? "";
  if (!taskCode.startsWith("appeal-")) {
    console.log(
      `Skipping Task/${task.id}: code=${taskCode} — not an appeal task.`
    );
    return;
  }

  // Extract the IDR case ID and appeal ID from extensions
  const idrCaseIdExt = task.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/idr-case-id"
  );
  const appealIdExt = task.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/appeal-id"
  );

  const idrCaseId = idrCaseIdExt?.valueString;
  const appealId = appealIdExt?.valueString;

  if (!appealId) {
    console.warn(
      `Task/${task.id} has no appeal-id extension — cannot sync to PostgreSQL.`
    );
    return;
  }

  // Map FHIR Task status to HealthPoint appeal status
  const statusMap: Record<string, string> = {
    requested: "submitted",
    "in-progress": "under_review",
    completed: "resolved",
    cancelled: "withdrawn",
    rejected: "denied",
    "on-hold": "pending_information",
    failed: "failed",
  };

  const hpStatus = statusMap[task.status] ?? task.status;

  // Extract resolution details from task output
  const resolutionOutput = task.output?.find(
    (o) => o.type?.coding?.[0]?.code === "appeal-resolution"
  );
  const resolutionNote = resolutionOutput?.valueString ?? task.note?.[0]?.text ?? "";

  // Sync to HealthPoint appeal_escalation_service
  const payload = {
    appeal_id: appealId,
    idr_case_id: idrCaseId,
    fhir_task_id: task.id,
    status: hpStatus,
    resolution_note: resolutionNote,
    last_modified: task.lastModified ?? new Date().toISOString(),
    fhir_status: task.status,
  };

  const response = await fetch(
    `${APPEAL_SERVICE_URL}/appeals/${appealId}/fhir-sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": process.env.BOT_SHARED_SECRET ?? "",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to sync appeal ${appealId} to HealthPoint: HTTP ${response.status} — ${body}`
    );
  }

  console.log(
    `Synced appeal ${appealId} (Task/${task.id}): FHIR status=${task.status} → HP status=${hpStatus}`
  );
}
