/**
 * server/emr/vendors.ts
 *
 * Phase 17 (E4): data-driven vendor connection profiles.
 *
 * HONESTY LABELS (important):
 *  - Only GENERIC FHIR R4 connectivity is implemented and exercised
 *    (capability fetch, Patient search, bulk $export state machine, SMART
 *    Backend Services token acquisition).
 *  - These profiles are CONFIGURATION TEMPLATES assembled from public vendor
 *    documentation; no live vendor sandbox has been tested from this stack.
 *    Per-vendor verification status is therefore STATIC-ONLY until a
 *    connection is tested against a real endpoint (fhirCapability.fetch).
 *  - `authType: "none-known"` means we could not confirm a supported auth
 *    pattern from public docs — fail closed, do not assume connectivity.
 */

export type VendorAuthType = "smart-backend-services" | "smart-standalone" | "csv-only" | "none-known";
export type BulkSupportTier = "system-and-group" | "group-only" | "patient-only" | "none-known";

export interface VendorProfile {
  /** Canonical key stored in emr_connections.emrSystem. */
  key: string;
  displayName: string;
  /** Documented FHIR base-url pattern ({tenant} placeholders literal). */
  fhirBaseUrlPattern: string | null;
  authType: VendorAuthType;
  bulkSupport: BulkSupportTier;
  /** Documented quirks relevant to claim extraction / bulk export. */
  knownQuirks: string[];
  /** Public developer documentation URL. */
  docsUrl: string;
  /** Always "static-only" today — see module header. */
  verification: "static-only";
}

export const VENDOR_PROFILES: VendorProfile[] = [
  {
    key: "epic",
    displayName: "Epic",
    fhirBaseUrlPattern: "https://{host}/interconnect-fhir-oauth/api/FHIR/R4",
    authType: "smart-backend-services",
    bulkSupport: "system-and-group",
    knownQuirks: [
      "Backend-services app registration requires a public JWK uploaded to Epic's App Orchard; client assertion must carry the registered kid.",
      "Bulk $export typically requires a Group id (Group/{id}/$export) provisioned by the customer; system-level export availability varies by tenant.",
      "Sandbox (open.epic.com) public tenants do not include claims/financial resources for most app types.",
    ],
    docsUrl: "https://fhir.epic.com/",
    verification: "static-only",
  },
  {
    key: "oracle-health",
    displayName: "Oracle Health (Cerner)",
    fhirBaseUrlPattern: "https://fhir-ehr-code.cerner.com/r4/{tenant-id}",
    authType: "smart-backend-services",
    bulkSupport: "group-only",
    knownQuirks: [
      "Millennium system accounts use client-credentials with a JWKS URL registered in the Oracle code console.",
      "Bulk data access is group-scoped; tenants provision groups case-by-case.",
      "Claim/ExplanationOfBenefit resource support is limited versus clinical resources.",
    ],
    docsUrl: "https://docs.oracle.com/en/industries/health/millennium-platform-apis/",
    verification: "static-only",
  },
  {
    key: "athenahealth",
    displayName: "athenahealth (athenaOne)",
    fhirBaseUrlPattern: "https://api.preview.platform.athenahealth.com/fhir/r4",
    authType: "smart-standalone",
    bulkSupport: "patient-only",
    knownQuirks: [
      "FHIR R4 access is patient-facing/standalone-oriented; practice-scoped backend bulk export is not generally self-serve.",
      "Financial/claims data is historically exposed via athena's proprietary APIs rather than FHIR Claim.",
    ],
    docsUrl: "https://developer.athenahealth.com/",
    verification: "static-only",
  },
  {
    key: "eclinicalworks",
    displayName: "eClinicalWorks",
    fhirBaseUrlPattern: "https://{host}/eCW4/{tenant}/fhir/r4",
    authType: "smart-standalone",
    bulkSupport: "group-only",
    knownQuirks: [
      "FHIR endpoints are per-customer hosted instances; activation requires eCW developer-program onboarding.",
      "Bulk export group provisioning is customer-managed; financial resource coverage varies.",
    ],
    docsUrl: "https://fhir.eclinicalworks.com/",
    verification: "static-only",
  },
  {
    key: "veradigm",
    displayName: "Veradigm (Allscripts)",
    fhirBaseUrlPattern: "https://{host}/UnityFHIR/R4",
    authType: "none-known",
    bulkSupport: "none-known",
    knownQuirks: [
      "Public FHIR documentation is sparse post-Allscripts rebrand; connectivity must be confirmed per customer instance.",
    ],
    docsUrl: "https://developer.veradigm.com/",
    verification: "static-only",
  },
  {
    key: "meditech",
    displayName: "MEDITECH (Expanse)",
    fhirBaseUrlPattern: "https://{host}/MEDITECHPRD/FHIR/R4",
    authType: "smart-backend-services",
    bulkSupport: "group-only",
    knownQuirks: [
      "Expanse FHIR uses MEDITECH's Greenfield/Expanse app registration; bulk export availability is version-dependent.",
    ],
    docsUrl: "https://fhir.meditech.com/",
    verification: "static-only",
  },
];

/** Look up a profile by emrSystem key (case-insensitive); null when unknown. */
export function getVendorProfile(emrSystem: string): VendorProfile | null {
  const k = emrSystem.trim().toLowerCase();
  return VENDOR_PROFILES.find(p => p.key === k || p.displayName.toLowerCase() === k) ?? null;
}

export const VENDOR_PROFILES_META = {
  verificationNote:
    "Profiles are configuration templates from public vendor docs (STATIC-ONLY). " +
    "Only generic FHIR R4 connectivity is implemented; no live vendor sandbox has been tested.",
} as const;
