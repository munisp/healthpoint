/**
 * package-builder.ts
 *
 * Builds a "portal-ready submission package" for the federal IDR portal
 * (idr.cms.gov, Salesforce-based, human-driven). CMS operates NO public
 * submission API; this module therefore produces a completeness-checked,
 * copy-ready field set for assisted-manual entry — it never transmits
 * anything.
 *
 * Required elements are aligned to the IDR initiation data elements of
 * 45 CFR 149.510(b). Fail-closed: any missing required element yields
 * complete=false. There is no "partial-ready" state.
 */

export interface DisputeInput {
  disputeId?: string;
  tenantId?: string;
  initiatingPartyName?: string;
  initiatingPartyContactEmail?: string;
  initiatingPartyContactPhone?: string;
  initiatingPartyNpi?: string;
  initiatingPartyTin?: string;
  respondingPartyName?: string;
  respondingPartyContactEmail?: string;
  respondingPartyContactPhone?: string;
  respondingPartyTin?: string;
  claimNumber?: string;
  serviceCode?: string;
  dateOfService?: string;
  billedCharge?: number;
  qualifyingPaymentAmount?: number;
  initialPlanPayment?: number;
  openNegotiationInitiationDate?: string;
  openNegotiationNoticeProofRef?: string;
  certificationAttestedAt?: string;
  certificationAttestorName?: string;
  supportingDocuments?: string[];
  initiatingOffer?: number;
  initiatingPartyType?: 'provider' | 'facility' | 'oqp' | 'plan' | 'issuer';
  /** Admin fee per party; CMS-9897-F (2026) set it at $15 for standard disputes. */
  adminFeeAmount?: number;
  now?: Date;
}

export interface ChecklistElement {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  value: string | null;
}

export interface SubmissionPackage {
  complete: boolean;
  missing: string[];
  warnings: string[];
  portalFields: Record<string, string>;
  checklist: ChecklistElement[];
  generatedAt: string;
}

const NONEMPTY = (v: unknown): boolean =>
  typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;

function fmt(v: unknown): string | null {
  if (!NONEMPTY(v)) return null;
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

const REQUIRED_ELEMENTS: Array<{
  key: keyof DisputeInput;
  label: string;
}> = [
  { key: 'initiatingPartyName', label: 'Initiating party name' },
  { key: 'initiatingPartyContactEmail', label: 'Initiating party contact email' },
  { key: 'initiatingPartyContactPhone', label: 'Initiating party contact phone' },
  { key: 'respondingPartyName', label: 'Responding party name' },
  { key: 'respondingPartyContactEmail', label: 'Responding party contact email' },
  { key: 'respondingPartyContactPhone', label: 'Responding party contact phone' },
  { key: 'initiatingPartyTin', label: 'Initiating party TIN' },
  { key: 'claimNumber', label: 'Per-item/service claim number' },
  { key: 'serviceCode', label: 'Service code (CPT/HCPCS/DRG)' },
  { key: 'dateOfService', label: 'Date of service' },
  { key: 'billedCharge', label: 'Billed charge' },
  { key: 'qualifyingPaymentAmount', label: 'Qualifying payment amount (QPA)' },
  { key: 'initialPlanPayment', label: 'Initial plan payment or denial' },
  { key: 'openNegotiationInitiationDate', label: 'Open negotiation initiation date' },
  { key: 'openNegotiationNoticeProofRef', label: 'Proof of open negotiation notice' },
  { key: 'certificationAttestedAt', label: 'Dispute certification/attestation date' },
  { key: 'certificationAttestorName', label: 'Dispute certification/attestation attestor' },
];

function todayIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildSubmissionPackage(input: DisputeInput): SubmissionPackage {
  const now = input.now ?? new Date();

  const checklist: ChecklistElement[] = REQUIRED_ELEMENTS.map((e) => {
    const value = fmt(input[e.key]);
    return {
      key: e.key,
      label: e.label,
      required: true,
      present: value !== null,
      value,
    };
  });

  // Supporting documents list: required as an element; an empty array is absent.
  const docs = input.supportingDocuments ?? [];
  checklist.push({
    key: 'supportingDocuments',
    label: 'Supporting documents list',
    required: true,
    present: docs.length > 0,
    value: docs.length > 0 ? docs.join('; ') : null,
  });

  const missing = checklist.filter((c) => c.required && !c.present).map((c) => c.label);

  const warnings: string[] = [];

  const billed = input.billedCharge;
  const qpa = input.qualifyingPaymentAmount;
  const offer = input.initiatingOffer;
  const fee = input.adminFeeAmount ?? 15;

  // CMS-9897-F: $15 administrative fee — disputes below the fee are economically suspect.
  if (typeof billed === 'number' && billed < fee) {
    warnings.push(
      `Total disputed amount ($${billed}) is below the $${fee} administrative fee (CMS-9897-F); submission may not be economical.`
    );
  }
  if (typeof offer === 'number' && typeof qpa === 'number' && qpa > 0) {
    const dist = Math.abs(offer - qpa) / qpa;
    if (dist <= 0.2) {
      warnings.push(
        `Initiating offer ($${offer}) is within 20% of QPA ($${qpa}); IDRE selection of a near-QPA offer is statistically likely — confirm strategic intent.`
      );
    }
  }
  if (NONEMPTY(input.certificationAttestedAt)) {
    const certDate = String(input.certificationAttestedAt).slice(0, 10);
    if (certDate !== todayIso(now)) {
      warnings.push(
        `Certification date (${certDate}) is not today (${todayIso(now)}); re-attest at time of portal entry.`
      );
    }
  }
  if (
    (input.initiatingPartyType === 'provider' || input.initiatingPartyType === 'facility') &&
    !NONEMPTY(input.initiatingPartyNpi)
  ) {
    warnings.push('Missing initiating-party NPI for provider/facility initiating party.');
  }

  const portalFields: Record<string, string> = {};
  for (const c of checklist) {
    if (c.present && c.value !== null) portalFields[c.key] = c.value;
  }
  if (typeof offer === 'number') portalFields['initiatingOffer'] = String(offer);
  if (NONEMPTY(input.respondingPartyTin)) portalFields['respondingPartyTin'] = String(input.respondingPartyTin).trim();
  if (NONEMPTY(input.initiatingPartyNpi)) portalFields['initiatingPartyNpi'] = String(input.initiatingPartyNpi).trim();

  return {
    complete: missing.length === 0,
    missing,
    warnings,
    portalFields,
    checklist,
    generatedAt: now.toISOString(),
  };
}
