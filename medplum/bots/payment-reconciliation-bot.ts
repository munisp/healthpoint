/**
 * HealthPoint Medplum Bot: Payment Reconciliation
 * ================================================
 * Triggered by Subscription on PaymentReconciliation creation.
 * Updates the linked ExplanationOfBenefit outcome and adjudication amounts.
 * Sends Kafka event to payment_processing_service for TigerBeetle ledger posting.
 */

import {
  BotEvent,
  MedplumClient,
  PaymentReconciliation,
  ExplanationOfBenefit,
} from "@medplum/fhirtypes";

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<PaymentReconciliation>
): Promise<void> {
  const pr = event.input;

  if (!pr.id) {
    throw new Error("PaymentReconciliation has no ID.");
  }

  const status = pr.status;
  if (status !== "active") {
    console.log(`Skipping PaymentReconciliation/${pr.id}: status=${status}`);
    return;
  }

  // Find the linked EOB via the request reference
  const requestRef = pr.request?.reference ?? "";
  if (!requestRef) {
    console.warn(
      `PaymentReconciliation/${pr.id} has no request reference — cannot link to EOB.`
    );
    return;
  }

  // The request reference points to a Claim; find the EOB for that Claim
  const eobs = await medplum.searchResources("ExplanationOfBenefit", {
    claim: requestRef,
  });

  if (eobs.length === 0) {
    console.warn(
      `No ExplanationOfBenefit found for ${requestRef}. Cannot update.`
    );
    return;
  }

  const eob = eobs[0];

  // Calculate total payment amount from detail lines
  const totalPaid = pr.detail?.reduce(
    (sum, detail) => sum + (detail.amount?.value ?? 0),
    0
  ) ?? 0;

  // Extract IDR determination result from PR extensions
  const determinationExt = pr.extension?.find(
    (e) =>
      e.url ===
      "http://healthpoint.local/fhir/StructureDefinition/idr-determination-result"
  );
  const determinationResult = determinationExt?.valueCode ?? "complete";

  // Update the EOB with the final payment amounts and determination result
  const updatedEOB: ExplanationOfBenefit = {
    ...eob,
    status: "active",
    outcome: "complete",
    payment: {
      type: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/ex-paymenttype",
            code: "complete",
            display: "Complete",
          },
        ],
      },
      amount: { value: totalPaid, currency: "USD" },
      date: new Date().toISOString().split("T")[0],
    },
    extension: [
      ...(eob.extension?.filter(
        (e) =>
          e.url !==
          "http://healthpoint.local/fhir/StructureDefinition/idr-determination-result"
      ) ?? []),
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/idr-determination-result",
        valueCode: determinationResult,
      },
      {
        url: "http://healthpoint.local/fhir/StructureDefinition/payment-reconciliation-ref",
        valueString: `PaymentReconciliation/${pr.id}`,
      },
    ],
  };

  await medplum.updateResource(updatedEOB);
  console.log(
    `Updated ExplanationOfBenefit/${eob.id} with payment $${totalPaid.toFixed(2)}, ` +
    `determination: ${determinationResult}`
  );

  // Update the linked Task to completed
  const tasks = await medplum.searchResources("Task", {
    focus: requestRef,
    status: "requested,in-progress",
  });

  for (const task of tasks) {
    await medplum.updateResource({
      ...task,
      status: "completed",
      lastModified: new Date().toISOString(),
      output: [
        ...(task.output ?? []),
        {
          type: {
            coding: [
              {
                system:
                  "http://healthpoint.local/fhir/CodeSystem/idr-output-type",
                code: "payment-amount",
              },
            ],
          },
          valueQuantity: {
            value: totalPaid,
            unit: "USD",
            system: "urn:iso:std:iso:4217",
            code: "USD",
          },
        },
      ],
    });
    console.log(`Completed Task/${task.id}`);
  }
}
