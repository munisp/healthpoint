/**
 * shared/i18n/notices.ts — typed dictionary of statutory notice & consent
 * document text blocks (No Surprises Act, 45 CFR 149.410–450 notice-and-consent
 * exception; 45 CFR 149.610 Good Faith Estimate for uninsured/self-pay).
 *
 * No i18n framework: a minimal typed dictionary keyed by language code. The
 * dictionary keys mirror the required-element identifiers enforced by
 * server/notice-consent/waiver.ts (REQUIRED_NOTICE_ELEMENTS) and
 * server/gfe-ppdr/gfe-clock.ts (REQUIRED_GFE_ELEMENTS) so a document composed
 * from this dictionary satisfies the content validators by construction.
 *
 * Sources:
 *  - English: HHS/CMS standard "Surprise Billing Protection Notice and Consent"
 *    (notice-and-consent model document, 45 CFR 149.420(c)-(d)) and the GFE
 *    standard notice under 45 CFR 149.610(b). Paraphrased to the required
 *    elements; verify against current model documents before production use.
 *  - Spanish: machine-drafted professional translation (legal-medical
 *    register) of the English blocks. PROVENANCE: machine translation,
 *    human legal review REQUIRED before production use (CMS publishes an
 *    official Spanish model notice; substitute it when available).
 */

export const NOTICE_LANGUAGES = ["en", "es"] as const;
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number];
export const DEFAULT_NOTICE_LANGUAGE: NoticeLanguage = "en";

export function isNoticeLanguage(v: unknown): v is NoticeLanguage {
  return typeof v === "string" && (NOTICE_LANGUAGES as readonly string[]).includes(v);
}

/** Notice & consent required-element keys (mirror REQUIRED_NOTICE_ELEMENTS). */
export type NoticeElementKey =
  | "OON_PROVIDER_STATEMENT"
  | "GFE_GOOD_FAITH_ESTIMATE"
  | "PRIOR_AUTHORIZATION_STATEMENT"
  | "IN_NETWORK_OPTION_STATEMENT"
  | "CONSENT_OPTIONAL_STATEMENT"
  | "ITEMS_SERVICES_LIST"
  | "COST_SHARING_DISCLAIMER"
  | "PLAN_CONTACT_INFO";

/** GFE required-element keys (mirror REQUIRED_GFE_ELEMENTS). */
export type GfeElementKey =
  | "PATIENT_IDENTIFYING_INFO"
  | "ITEMIZED_SERVICES_WITH_CODES"
  | "EXPECTED_CHARGES"
  | "PROVIDER_FACILITY_INFO"
  | "COPROVIDER_DISCLAIMER"
  | "PPDR_DISCLAIMER"
  | "NOT_A_CONTRACT_DISCLAIMER";

export interface NoticeDocumentBlocks {
  documentTitle: string;
  consentSectionTitle: string;
  elements: Record<NoticeElementKey, string>;
  consentAttestation: string;
  revocationNotice: string;
  signaturePrompt: string;
}

export interface GfeDocumentBlocks {
  documentTitle: string;
  elements: Record<GfeElementKey, string>;
  /** Aggregation rule statement: total = convening provider + Σ co-providers. */
  coProviderAggregationRule: string;
}

export interface NoticeLanguagePack {
  noticeConsent: NoticeDocumentBlocks;
  gfe: GfeDocumentBlocks;
}

/* ── English ─────────────────────────────────────────────────────────────── */

const en: NoticeLanguagePack = {
  noticeConsent: {
    documentTitle: "Surprise Billing Protection Notice and Consent",
    consentSectionTitle: "Consent to Waive Balance-Billing Protections",
    elements: {
      OON_PROVIDER_STATEMENT:
        "This provider or facility is NOT in your health plan's network. " +
        "Out-of-network providers and facilities may bill you for the difference " +
        "between what your plan pays and the full amount charged (balance billing).",
      GFE_GOOD_FAITH_ESTIMATE:
        "Attached is a good faith estimate of the amount you may be charged for " +
        "the items and services described, based on information known at the time " +
        "this notice was prepared.",
      PRIOR_AUTHORIZATION_STATEMENT:
        "Your health plan may require prior authorization or apply other care " +
        "management limitations before covering these items or services.",
      IN_NETWORK_OPTION_STATEMENT:
        "You have the option to receive these items or services from a provider " +
        "or facility in your health plan's network, in which case your " +
        "balance-billing protections apply and you may pay less.",
      CONSENT_OPTIONAL_STATEMENT:
        "Giving consent is optional. You are not required to sign this document. " +
        "If you sign, you give up your protections against balance billing for " +
        "these items and services. You may revoke your consent in writing at any " +
        "time before the items or services are furnished.",
      ITEMS_SERVICES_LIST:
        "The items and services covered by this notice are listed in the attached " +
        "schedule, including the provider or facility furnishing each item or service.",
      COST_SHARING_DISCLAIMER:
        "The estimate provided is not a contract. Your actual charges may be " +
        "higher or lower than the good faith estimate depending on the items and " +
        "services actually furnished.",
      PLAN_CONTACT_INFO:
        "Contact your health plan at the telephone number on your member ID card " +
        "for help finding an in-network provider or facility, or with questions " +
        "about your coverage and cost sharing.",
    },
    consentAttestation:
      "I have read this notice and the attached good faith estimate. I understand " +
      "that this provider or facility is out of network, that I am giving up my " +
      "federal protections against balance billing for the listed items and " +
      "services, and that I may be responsible for charges above my plan's " +
      "in-network cost sharing.",
    revocationNotice:
      "You may revoke this consent in writing at any time before the items or " +
      "services are furnished (45 CFR 149.420(f)).",
    signaturePrompt: "Patient or authorized representative signature",
  },
  gfe: {
    documentTitle: "Good Faith Estimate of Expected Charges",
    elements: {
      PATIENT_IDENTIFYING_INFO:
        "Patient name and date of birth, as recorded by the convening provider " +
        "or facility.",
      ITEMIZED_SERVICES_WITH_CODES:
        "An itemized list of the items and services reasonably expected to be " +
        "furnished, grouped by provider or facility, with applicable service " +
        "codes (CPT/HCPCS/DRG).",
      EXPECTED_CHARGES:
        "The expected charges for each listed item or service, including expected " +
        "facility fees.",
      PROVIDER_FACILITY_INFO:
        "The name, National Provider Identifier (NPI), Tax Identification Number " +
        "(TIN), and location of the convening provider or facility and of each " +
        "co-provider or co-facility listed.",
      COPROVIDER_DISCLAIMER:
        "Co-providers and co-facilities reasonably expected to furnish items or " +
        "services in connection with the primary service are listed separately. " +
        "You may receive a separate good faith estimate (or estimate section) from " +
        "each co-provider or co-facility, and you may be billed separately by each.",
      PPDR_DISCLAIMER:
        "If you are uninsured (or self-pay) and your billed charges from a " +
        "provider or facility are at least $400 more than that provider's or " +
        "facility's total on this good faith estimate, you may initiate the " +
        "patient-provider dispute resolution (PPDR) process within 120 calendar " +
        "days of the initial bill (45 CFR 149.620).",
      NOT_A_CONTRACT_DISCLAIMER:
        "This good faith estimate is not a contract and does not obligate you to " +
        "obtain the listed items or services. Your actual charges may differ from " +
        "this estimate based on the items and services actually furnished.",
    },
    coProviderAggregationRule:
      "The total expected charges equal the convening provider's or facility's " +
      "expected charges PLUS the sum of all listed co-provider and co-facility " +
      "expected charges (total = convening + Σ co-providers).",
  },
};

/* ── Español (machine-drafted; human legal review required) ──────────────── */

// PROVENANCE: traducción automática de registro jurídico-médico; requiere
// revisión humana antes de uso en producción. Sustituir por el modelo oficial
// en español de CMS cuando esté disponible.
const es: NoticeLanguagePack = {
  noticeConsent: {
    documentTitle: "Aviso de Protección contra Facturación Sorpresa y Consentimiento",
    consentSectionTitle: "Consentimiento para Renunciar a las Protecciones contra la Facturación del Saldo",
    elements: {
      OON_PROVIDER_STATEMENT:
        "Este proveedor o centro NO pertenece a la red de su plan de salud. " +
        "Los proveedores y centros fuera de la red pueden facturarle la diferencia " +
        "entre lo que paga su plan y el monto total cargado (facturación del saldo).",
      GFE_GOOD_FAITH_ESTIMATE:
        "Se adjunta un estimado de buena fe de los cargos que podrían aplicarse " +
        "por los artículos y servicios descritos, con base en la información " +
        "disponible al momento de preparar este aviso.",
      PRIOR_AUTHORIZATION_STATEMENT:
        "Su plan de salud puede exigir autorización previa u aplicar otras " +
        "limitaciones de gestión de la atención antes de cubrir estos artículos o servicios.",
      IN_NETWORK_OPTION_STATEMENT:
        "Usted tiene la opción de recibir estos artículos o servicios de un " +
        "proveedor o centro dentro de la red de su plan de salud, en cuyo caso " +
        "se aplican sus protecciones contra la facturación del saldo y podría pagar menos.",
      CONSENT_OPTIONAL_STATEMENT:
        "Otorgar el consentimiento es opcional. Usted no está obligado a firmar " +
        "este documento. Si firma, renuncia a sus protecciones contra la " +
        "facturación del saldo para estos artículos y servicios. Puede revocar " +
        "su consentimiento por escrito en cualquier momento antes de que se " +
        "presten los artículos o servicios.",
      ITEMS_SERVICES_LIST:
        "Los artículos y servicios cubiertos por este aviso se enumeran en el " +
        "anexo adjunto, incluido el proveedor o centro que presta cada artículo o servicio.",
      COST_SHARING_DISCLAIMER:
        "El estimado proporcionado no constituye un contrato. Sus cargos reales " +
        "pueden ser mayores o menores que el estimado de buena fe, según los " +
        "artículos y servicios efectivamente prestados.",
      PLAN_CONTACT_INFO:
        "Comuníquese con su plan de salud al número de teléfono que figura en su " +
        "tarjeta de identificación de miembro para obtener ayuda para encontrar un " +
        "proveedor o centro dentro de la red, o si tiene preguntas sobre su " +
        "cobertura y costos compartidos.",
    },
    consentAttestation:
      "He leído este aviso y el estimado de buena fe adjunto. Entiendo que este " +
      "proveedor o centro está fuera de la red, que renuncio a mis protecciones " +
      "federales contra la facturación del saldo para los artículos y servicios " +
      "enumerados, y que puedo ser responsable de cargos superiores al costo " +
      "compartido dentro de la red de mi plan.",
    revocationNotice:
      "Usted puede revocar este consentimiento por escrito en cualquier momento " +
      "antes de que se presten los artículos o servicios (45 CFR 149.420(f)).",
    signaturePrompt: "Firma del paciente o representante autorizado",
  },
  gfe: {
    documentTitle: "Estimado de Buena Fe de los Cargos Previstos",
    elements: {
      PATIENT_IDENTIFYING_INFO:
        "Nombre del paciente y fecha de nacimiento, según consten en los registros " +
        "del proveedor o centro convocante.",
      ITEMIZED_SERVICES_WITH_CODES:
        "Una lista detallada de los artículos y servicios que razonablemente se " +
        "prevé prestar, agrupados por proveedor o centro, con los códigos de " +
        "servicio aplicables (CPT/HCPCS/DRG).",
      EXPECTED_CHARGES:
        "Los cargos previstos por cada artículo o servicio enumerado, incluidos " +
        "los cargos previstos del centro.",
      PROVIDER_FACILITY_INFO:
        "El nombre, el Identificador Nacional del Proveedor (NPI), el Número de " +
        "Identificación Fiscal (TIN) y la ubicación del proveedor o centro " +
        "convocante y de cada coproveedor o cocentro enumerado.",
      COPROVIDER_DISCLAIMER:
        "Los coproveedores y cocentros que razonablemente se prevé que presten " +
        "artículos o servicios relacionados con el servicio principal se enumeran " +
        "por separado. Usted podría recibir un estimado de buena fe (o una sección " +
        "del estimado) por separado de cada coproveedor o cocentro, y cada uno " +
        "podría facturarle por separado.",
      PPDR_DISCLAIMER:
        "Si usted no tiene seguro (o paga de su bolsillo) y los cargos facturados " +
        "por un proveedor o centro superan en al menos $400 el total de ese " +
        "proveedor o centro en este estimado de buena fe, usted puede iniciar el " +
        "proceso de resolución de disputas entre paciente y proveedor (PPDR) " +
        "dentro de los 120 días calendario siguientes a la factura inicial " +
        "(45 CFR 149.620).",
      NOT_A_CONTRACT_DISCLAIMER:
        "Este estimado de buena fe no es un contrato ni le obliga a obtener los " +
        "artículos o servicios enumerados. Sus cargos reales pueden diferir de " +
        "este estimado según los artículos y servicios efectivamente prestados.",
    },
    coProviderAggregationRule:
      "El total de los cargos previstos es igual a los cargos previstos del " +
      "proveedor o centro convocante MÁS la suma de los cargos previstos de todos " +
      "los coproveedores y cocentros enumerados (total = convocante + Σ coproveedores).",
  },
};

export const NOTICE_DICTIONARY: Record<NoticeLanguage, NoticeLanguagePack> = { en, es };

/** Fail-closed lookup: unknown language → English (statutory default). */
export function getNoticeLanguagePack(language?: string): NoticeLanguagePack {
  return NOTICE_DICTIONARY[isNoticeLanguage(language) ? language : DEFAULT_NOTICE_LANGUAGE];
}

/** Required notice element keys present for a language (all must be non-empty). */
export function availableNoticeElements(language?: string): NoticeElementKey[] {
  const pack = getNoticeLanguagePack(language);
  return (Object.keys(pack.noticeConsent.elements) as NoticeElementKey[]).filter(
    (k) => pack.noticeConsent.elements[k].trim().length > 0,
  );
}

/** Required GFE element keys present for a language. */
export function availableGfeElements(language?: string): GfeElementKey[] {
  const pack = getNoticeLanguagePack(language);
  return (Object.keys(pack.gfe.elements) as GfeElementKey[]).filter(
    (k) => pack.gfe.elements[k].trim().length > 0,
  );
}

export interface ComposedNoticeDocumentInput {
  /** Provider/facility display name inserted into the header. */
  providerName: string;
  /** Case reference. */
  caseId: string;
  /** Items/services covered by the notice (appended to ITEMS_SERVICES_LIST). */
  itemsAndServices?: readonly string[];
  /** Good-faith estimate total (USD) inserted into the GFE element. */
  gfeTotalUsd?: number;
  language?: string;
}

/**
 * Composes the full statutory notice & consent document text for a case in the
 * requested language. Every REQUIRED_NOTICE_ELEMENTS block is included, so the
 * composed document always satisfies validateNoticeContent for that language.
 */
export function composeNoticeDocument(input: ComposedNoticeDocumentInput): string {
  const pack = getNoticeLanguagePack(input.language);
  const b = pack.noticeConsent;
  const lines: string[] = [
    b.documentTitle.toUpperCase(),
    "",
    `${input.providerName} — ${b.elements.OON_PROVIDER_STATEMENT}`,
    "",
    b.elements.GFE_GOOD_FAITH_ESTIMATE +
      (input.gfeTotalUsd !== undefined ? ` ($${input.gfeTotalUsd.toFixed(2)})` : ""),
    "",
    `${b.elements.ITEMS_SERVICES_LIST}`,
  ];
  if (input.itemsAndServices && input.itemsAndServices.length > 0) {
    for (const item of input.itemsAndServices) lines.push(`  - ${item}`);
  }
  lines.push(
    "",
    b.elements.PRIOR_AUTHORIZATION_STATEMENT,
    "",
    b.elements.IN_NETWORK_OPTION_STATEMENT,
    "",
    b.elements.COST_SHARING_DISCLAIMER,
    "",
    b.elements.PLAN_CONTACT_INFO,
    "",
    b.consentSectionTitle.toUpperCase(),
    b.elements.CONSENT_OPTIONAL_STATEMENT,
    "",
    b.consentAttestation,
    "",
    b.revocationNotice,
    "",
    `${b.signaturePrompt}: ______________________    ${input.caseId}`,
  );
  return lines.join("\n");
}

export interface ComposedGfeDocumentInput {
  providerName: string;
  caseId: string;
  itemsAndServices?: readonly string[];
  conveningChargesUsd: number;
  coProviders?: readonly { name: string; npi?: string; expectedChargesUsd: number }[];
  language?: string;
}

/**
 * Composes the GFE document text. Enforces the aggregation rule: the printed
 * total is always computed (convening + Σ co-providers), never caller-supplied.
 */
export function composeGfeDocument(input: ComposedGfeDocumentInput): string {
  const pack = getNoticeLanguagePack(input.language);
  const g = pack.gfe;
  const co = input.coProviders ?? [];
  const coTotal = co.reduce((s, c) => s + c.expectedChargesUsd, 0);
  const total = input.conveningChargesUsd + coTotal;
  const lines: string[] = [
    g.documentTitle.toUpperCase(),
    "",
    g.elements.PATIENT_IDENTIFYING_INFO,
    "",
    g.elements.PROVIDER_FACILITY_INFO,
    `  ${input.providerName} — $${input.conveningChargesUsd.toFixed(2)}`,
    "",
    g.elements.ITEMIZED_SERVICES_WITH_CODES,
  ];
  if (input.itemsAndServices) for (const item of input.itemsAndServices) lines.push(`  - ${item}`);
  lines.push("", g.elements.EXPECTED_CHARGES, "");
  if (co.length > 0) {
    lines.push(g.elements.COPROVIDER_DISCLAIMER);
    for (const c of co) {
      lines.push(`  - ${c.name}${c.npi ? ` (NPI ${c.npi})` : ""}: $${c.expectedChargesUsd.toFixed(2)}`);
    }
    lines.push("", g.coProviderAggregationRule);
  } else {
    lines.push(g.elements.COPROVIDER_DISCLAIMER);
  }
  lines.push(
    "",
    `TOTAL: $${total.toFixed(2)}`,
    "",
    g.elements.NOT_A_CONTRACT_DISCLAIMER,
    "",
    g.elements.PPDR_DISCLAIMER,
    "",
    input.caseId,
  );
  return lines.join("\n");
}
