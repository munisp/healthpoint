/**
 * validators.ts
 *
 * Format and sanity validators for IDR submission data. Previously the
 * package-builder did presence-only checks; these validators add:
 *
 * - NPI: 10 digits + Luhn check per the CMS standard (NPI is validated with
 *   the constant prefix "80840" prepended before the Luhn algorithm, per the
 *   HIPAA NPI Final Rule / ISO 7812 check-digit scheme).
 * - TIN/EIN: exactly 9 digits.
 * - CMS dispute reference number: configurable regex via env CMS_REF_REGEX,
 *   default ^[A-Z0-9-]{6,32}$. FAIL-CLOSED: an unparseable env regex rejects
 *   every value rather than silently permitting them.
 * - Date sanity: date of service not in the future (configurable tolerance via
 *   CMS_SERVICE_DATE_FUTURE_TOLERANCE_DAYS, default 0); open-negotiation
 *   initiation date must be on/after the date of service.
 */

export const DEFAULT_CMS_REF_REGEX = "^[A-Z0-9-]{6,32}$";

/** Luhn check over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * NPI per CMS standard: 10 digits, and the string "80840" + npi passes Luhn
 * (the 80840 prefix identifies the issuing agency for the check digit).
 */
export function isValidNpi(npi: string): boolean {
  const v = (npi ?? "").trim();
  if (!/^\d{10}$/.test(v)) return false;
  return luhnValid("80840" + v);
}

/** TIN/EIN: exactly 9 digits. */
export function isValidTin(tin: string): boolean {
  return /^\d{9}$/.test((tin ?? "").trim());
}

/**
 * CMS dispute reference number against CMS_REF_REGEX (default
 * ^[A-Z0-9-]{6,32}$). Fail-closed: if the configured regex is invalid, or the
 * value is not a string, returns false.
 */
export function isValidCmsDisputeReference(ref: string, regexSource?: string): boolean {
  if (typeof ref !== "string") return false;
  const source = (regexSource ?? process.env.CMS_REF_REGEX ?? DEFAULT_CMS_REF_REGEX).trim();
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch {
    return false; // fail-closed on misconfiguration
  }
  return re.test(ref.trim());
}

function parseIsoDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return isNaN(t) ? null : t;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date-of-service sanity: must be a parseable ISO date and not in the future
 * beyond `toleranceDays` (env CMS_SERVICE_DATE_FUTURE_TOLERANCE_DAYS, default 0).
 */
export function isServiceDateSane(
  dateOfService: string,
  now?: Date,
  toleranceDays?: number
): boolean {
  const svc = parseIsoDay(dateOfService);
  if (svc === null) return false;
  const tol =
    toleranceDays ??
    (() => {
      const raw = process.env.CMS_SERVICE_DATE_FUTURE_TOLERANCE_DAYS;
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })();
  const nowMs = (now ?? new Date()).getTime();
  return svc <= nowMs + tol * DAY_MS;
}

/** Open-negotiation initiation date must be on/after the date of service. */
export function isOnInitiationAfterService(
  onInitiationDate: string,
  dateOfService: string
): boolean {
  const on = parseIsoDay(onInitiationDate);
  const svc = parseIsoDay(dateOfService);
  if (on === null || svc === null) return false;
  return on >= svc;
}

/** strictMode resolution: explicit option wins, else SUBMISSION_STRICT=1. */
export function resolveStrictMode(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  return process.env.SUBMISSION_STRICT === "1" || process.env.SUBMISSION_STRICT === "true";
}

export interface SubmissionFieldProblems {
  warnings: string[];
}

/**
 * Validate the format/sanity fields of a dispute submission input. Returns
 * warning strings (callers decide blocking policy via strictMode).
 */
export function validateSubmissionFields(input: {
  initiatingPartyNpi?: string;
  initiatingPartyTin?: string;
  respondingPartyTin?: string;
  cmsDisputeReferenceNumber?: string;
  dateOfService?: string;
  openNegotiationInitiationDate?: string;
  now?: Date;
}): SubmissionFieldProblems {
  const warnings: string[] = [];
  if (input.initiatingPartyNpi != null && input.initiatingPartyNpi.trim() !== "") {
    if (!isValidNpi(input.initiatingPartyNpi)) {
      warnings.push(
        `Initiating party NPI '${input.initiatingPartyNpi}' fails the CMS NPI format/Luhn check.`
      );
    }
  }
  if (input.initiatingPartyTin != null && input.initiatingPartyTin.trim() !== "") {
    if (!isValidTin(input.initiatingPartyTin)) {
      warnings.push(`Initiating party TIN must be exactly 9 digits (got '${input.initiatingPartyTin}').`);
    }
  }
  if (input.respondingPartyTin != null && input.respondingPartyTin.trim() !== "") {
    if (!isValidTin(input.respondingPartyTin)) {
      warnings.push(`Responding party TIN must be exactly 9 digits (got '${input.respondingPartyTin}').`);
    }
  }
  if (input.cmsDisputeReferenceNumber != null && input.cmsDisputeReferenceNumber.trim() !== "") {
    if (!isValidCmsDisputeReference(input.cmsDisputeReferenceNumber)) {
      warnings.push(
        `CMS dispute reference number '${input.cmsDisputeReferenceNumber}' does not match the configured format.`
      );
    }
  }
  if (input.dateOfService != null && input.dateOfService.trim() !== "") {
    if (!isServiceDateSane(input.dateOfService, input.now)) {
      warnings.push(
        `Date of service '${input.dateOfService}' is not a parseable past/current date.`
      );
    }
  }
  if (
    input.openNegotiationInitiationDate != null &&
    input.openNegotiationInitiationDate.trim() !== "" &&
    input.dateOfService != null &&
    input.dateOfService.trim() !== ""
  ) {
    if (!isOnInitiationAfterService(input.openNegotiationInitiationDate, input.dateOfService)) {
      warnings.push(
        `Open negotiation initiation date '${input.openNegotiationInitiationDate}' precedes the date of service '${input.dateOfService}'.`
      );
    }
  }
  return { warnings };
}
