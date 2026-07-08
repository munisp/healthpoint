/**
 * HealthPoint Medplum Bot: IDR Workflow Automation
 * =================================================
 * Triggered by Medplum Subscription on Claim status changes.
 * Automatically creates ExplanationOfBenefit when an IDR determination is received.
 *
 * Deploy to Medplum via:
 *   medplum bot create idr-workflow-bot
 *   medplum bot deploy idr-workflow-bot
 */

import {
  BotEvent,
  MedplumClient,
  Claim,
  ExplanationOfBenefit,
  Task,
  PaymentReconciliation,
  Patient,
  Coverage,
  Organization,
  Practitioner,
  Bundle,
  BundleEntry,
  Reference,
  Extension,
} from "@medplum/fhirtypes";

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Claim>
): Promise<void> {
  const claim = event.input;

  if (!claim.id) {
    throw new Error("Claim has no ID — cannot process.");
  }

  const status = claim.status;
  const use = claim.use;

  // Only process NSA predetermination claims that have been submitted
  if (use !== "predetermination" || status !== "active") {
    console.log(
      `Skipping Claim/${claim.id}: use=${use}, status=${status} — not an active NSA predetermination.`
    );
    return;
  }

  // Check if an EOB already exists for this claim
  const existingEOBs = await medplum.searchResources("ExplanationOfBenefit", {
    claim: `Claim/${claim.id}`,
  });

  if (existingEOBs.length > 0) {
    console.log(
      `EOB already exists for Claim/${claim.id}: ExplanationOfBenefit/${existingEOBs[0].id}`
    );
    return;
  }

  // Extract NSA extensions from the Claim
  const qpaExtension = claim.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/qpa-amount"
  );
  const serviceCategoryExt = claim.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/nsa-service-category"
  );
  const idrCaseIdExt = claim.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/idr-case-id"
  );

  const qpaAmount = qpaExtension?.valueMoney?.value ?? 0;
  const serviceCategory = serviceCategoryExt?.valueCode ?? "emergency";
  const idrCaseId = idrCaseIdExt?.valueString ?? claim.id;

  // Retrieve the patient and coverage for the EOB
  const patientRef = claim.patient?.reference ?? "";
  const insuranceRef = claim.insurance?.[0]?.coverage?.reference ?? "";

  // Build the ExplanationOfBenefit
  const eob: ExplanationOfBenefit = {
    resourceType: "ExplanationOfBenefit",
    status: "active",
    type: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/claim-type",
          code: "professional",
          display: "Professional",
        },
      ],
    },
    use: "claim",
    patient: claim.patient!,
    created: new Date().toISOString(),
    insurer: claim.insurer!,
    provider: claim.provider!,
    claim: { reference: `Claim/${claim.id}` },
    outcome: "queued", // Will be updated when IDR entity issues determination
    insurance: claim.insurance!.map((ins) => ({
      focal: ins.focal ?? true,
      coverage: ins.coverage!,
    })),
    item: (claim.item ?? []).map((item, idx) => ({
      sequence: item.sequence,
      productOrService: item.productOrService!,
      servicedDate: item.servicedDate,
      servicedPeriod: item.servicedPeriod,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      adjudication: [
        {
          category: {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/adjudication",
                code: "submitted",
                display: "Submitted Amount",
              },
            ],
          },
          amount: item.unitPrice ?? { value: 0, currency: "USD" },
        },
        {
          category: {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/adjudication",
                code: "eligible",
                display: "Eligible Amount (QPA)",
              },
            ],
          },
          amount: { value: qpaAmount, currency: "USD" },
        },
      ],
    })),
    total: [
      {
        category: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/adjudication",
              code: "submitted",
              display: "Submitted Amount",
            },
          ],
        },
        amount: claim.total ?? { value: 0, currency: "USD" },
      },
      {
        category: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/adjudication",
              code: "eligible",
              display: "QPA Total",
            },
          ],
        },
        amount: { value: qpaAmount, currency: "USD" },
      },
    ],
    extension: [
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/idr-case-id",
        valueString: idrCaseId,
      },
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/nsa-service-category",
        valueCode: serviceCategory,
      },
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/qpa-amount",
        valueMoney: { value: qpaAmount, currency: "USD" },
      },
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/idr-determination-result",
        valueCode: "pending", // Will be updated by determination bot
      },
    ],
  };

  const createdEOB = await medplum.createResource(eob);
  console.log(
    `Created ExplanationOfBenefit/${createdEOB.id} for Claim/${claim.id} (IDR case: ${idrCaseId})`
  );

  // Create a Task to track the IDR workflow
  const task: Task = {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    priority: "routine",
    code: {
      coding: [
        {
          system: "http://healthpoint.local/fhir/CodeSystem/idr-task-type",
          code: "idr-determination-pending",
          display: "IDR Determination Pending",
        },
      ],
    },
    description: `IDR determination pending for case ${idrCaseId}. Service category: ${serviceCategory}. QPA: $${qpaAmount.toFixed(2)}.`,
    focus: { reference: `Claim/${claim.id}` },
    for: claim.patient,
    authoredOn: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    output: [
      {
        type: {
          coding: [
            {
              system: "http://healthpoint.local/fhir/CodeSystem/idr-output-type",
              code: "eob-reference",
            },
          ],
        },
        valueReference: { reference: `ExplanationOfBenefit/${createdEOB.id}` },
      },
    ],
    extension: [
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/idr-case-id",
        valueString: idrCaseId,
      },
    ],
  };

  const createdTask = await medplum.createResource(task);
  console.log(
    `Created Task/${createdTask.id} for IDR case ${idrCaseId}`
  );
}
