/**
 * Public (non-secret) metadata re-exports for the practice-audit router.
 * Kept separate so the router file stays focused; no secrets here.
 */
import { REQUIRED_FIELDS } from "../eligibility/required-fields";
import { VENDOR_PROFILES, VENDOR_PROFILES_META } from "../emr/vendors";

export { REQUIRED_FIELDS };

export const VENDOR_PROFILES_PUBLIC = {
  profiles: VENDOR_PROFILES,
  meta: VENDOR_PROFILES_META,
} as const;
