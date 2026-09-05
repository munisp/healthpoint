/**
 * Response shapes consumed by the mobile app.
 *
 * These are hand-maintained because the server's AppRouter type is not
 * published as a shared package (see README "known gaps"). Each type was
 * verified against server/routers.ts / server/db.ts on
 * branch assurance/remediation-2026-09-05.
 */

export interface DisputeListItem {
  id: string;
  referenceNumber: string;
  status: string;
  currentStep?: string | null;
  serviceType?: string | null;
  serviceDate?: string | Date | null;
  /** Decimal-dollar string, e.g. "1234.56". */
  billedAmount?: string | number | null;
  initiatingPartyName?: string | null;
  respondingPartyName?: string | null;
  createdAt?: string | Date | null;
}

export interface DisputeListPage {
  items: DisputeListItem[];
  total: number;
}

export interface DisputeEventItem {
  id: string;
  step: string;
  eventType?: string | null;
  description?: string | null;
  performedByName?: string | null;
  createdAt?: string | Date | null;
}

export interface DisputeOfferItem {
  id: string;
  offerType: string;
  amount: string | number;
  rationale?: string | null;
  isAccepted?: boolean | null;
  submittedAt?: string | Date | null;
}

export interface DisputeDocumentItem {
  id: string;
  fileName: string;
  documentType?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  uploadedAt?: string | Date | null;
}

export interface DisputeDetail extends DisputeListItem {
  qpaAmount?: string | number | null;
  initiatingPartyOffer?: string | number | null;
  respondingPartyOffer?: string | number | null;
  determinationAmount?: string | number | null;
  patientState?: string | null;
  facilityState?: string | null;
  idrEntityName?: string | null;
  cptCodes?: string[] | null;
  notes?: string | null;
  openNegotiationDeadline?: string | Date | null;
  offerSubmissionDeadline?: string | Date | null;
  determinationDeadline?: string | Date | null;
  paymentDeadline?: string | Date | null;
  closedAt?: string | Date | null;
  events?: DisputeEventItem[];
  offers?: DisputeOfferItem[];
  documents?: DisputeDocumentItem[];
}

/** One entry of disputes.getTimeline's `timeline` array. */
export interface TimelineEntry {
  step: string;
  stepNumber: number;
  label: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isPending: boolean;
  event: DisputeEventItem | null;
}

export interface DisputeTimelineResponse {
  timeline: TimelineEntry[];
  dispute: DisputeDetail;
  offers: DisputeOfferItem[];
}

export interface NotificationItem {
  id: string;
  disputeId?: string | null;
  notificationType?: string | null;
  title?: string | null;
  message?: string | null;
  isRead: boolean;
  dueDate?: string | Date | null;
  createdAt?: string | Date | null;
}

/** Shape of auth.me (the users table row) — null when unauthenticated. */
export interface MeUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  loginMethod?: string | null;
  lastSignedIn?: string | Date | null;
}

/** Shape of profiles.get (userProfiles row). */
export interface UserProfile {
  orgName?: string | null;
  orgType?: string | null;
  stakeholderRole?: string | null;
  npi?: string | null;
  phone?: string | null;
  preferredContact?: string | null;
  onboardingCompleted?: boolean | null;
}
