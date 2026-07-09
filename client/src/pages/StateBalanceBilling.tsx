import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Search, ExternalLink, AlertTriangle, CheckCircle2, Info,
  MapPin, Scale, FileText, TrendingUp, Filter, Download,
  BookOpen, RefreshCw, Star, ChevronDown, ChevronUp
} from "lucide-react";

type ProtectionLevel = "strong" | "moderate" | "limited" | "none";

interface StateLaw {
  state: string;
  code: string;
  hasLaw: boolean;
  lawName?: string;
  effectiveDate?: string;
  lastUpdated?: string;
  scope: string;
  idrProcess: string;
  nsaInteraction: string;
  keyProvisions: string[];
  referenceUrl?: string;
  protectionLevel: ProtectionLevel;
  emergencyProtection: boolean;
  nonEmergencyProtection: boolean;
  idrThreshold?: string;
  patientNoticeRequired: boolean;
  penaltyForViolation: boolean;
  georgetownRating?: "A" | "B" | "C" | "D" | "F" | "N/A";
  recentChanges?: string;
}

const STATE_LAWS: Record<string, StateLaw> = {
  AL: { state: "Alabama", code: "AL", hasLaw: false, scope: "No state surprise billing law — NSA is primary protection", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is the sole protection for all plan types in Alabama.", keyProvisions: ["NSA applies to all self-funded ERISA plans", "State-regulated fully-insured plans have no additional state protections"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  AK: { state: "Alaska", code: "AK", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA governs. Alaska has no state-level surprise billing law.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  AZ: { state: "Arizona", code: "AZ", hasLaw: true, lawName: "HB 2339 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated fully-insured health plans", idrProcess: "Arizona Department of Insurance mediation process", nsaInteraction: "Arizona law covers state-regulated plans. NSA covers ERISA self-funded plans. Dual-track compliance required.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation available for disputed amounts", "Provider must accept payment as payment in full"], referenceUrl: "https://insurance.az.gov/consumers/health-insurance/surprise-billing", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "C" },
  AR: { state: "Arkansas", code: "AR", hasLaw: false, scope: "No comprehensive state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Arkansas.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  CA: { state: "California", code: "CA", hasLaw: true, lawName: "AB 72 (2017) / SB 1021 (2022)", effectiveDate: "July 1, 2017", lastUpdated: "2022", scope: "All commercial plans regulated by DMHC or CDI, including HMOs and PPOs", idrProcess: "Independent Dispute Resolution (IDR) via DMHC or CDI — binding arbitration for disputed amounts", nsaInteraction: "California law applies to state-regulated plans; NSA applies to self-funded ERISA plans. Dual-track compliance required.", keyProvisions: ["Patients pay only in-network cost-sharing for emergency and involuntary out-of-network services", "Providers must accept payment + patient cost-sharing as payment in full", "IDR available for disputes between $750 and $750,000", "Hold harmless protections for patients", "30-day open negotiation period before IDR"], referenceUrl: "https://www.dmhc.ca.gov/HealthCareinCalifornia/HealthPlanInformation/BalanceBilling.aspx", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, idrThreshold: "$750–$750,000", patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A", recentChanges: "SB 1021 (2022) expanded protections to align more closely with NSA" },
  CO: { state: "Colorado", code: "CO", hasLaw: true, lawName: "SB 20-230 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated commercial health insurance plans", idrProcess: "Colorado Division of Insurance IDR process", nsaInteraction: "Colorado law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Comprehensive surprise billing protections for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "30-day open negotiation period", "Independent dispute resolution for unresolved claims", "Penalties for non-compliant providers"], referenceUrl: "https://doi.colorado.gov/consumers/surprise-billing", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  CT: { state: "Connecticut", code: "CT", hasLaw: true, lawName: "PA 19-117 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Connecticut Insurance Department arbitration", nsaInteraction: "Connecticut law applies to state-regulated plans. NSA governs ERISA self-funded plans.", keyProvisions: ["Surprise billing ban for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "Arbitration for disputed amounts", "30-day negotiation period"], referenceUrl: "https://portal.ct.gov/CID/Health-Insurance/Surprise-Billing", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  DE: { state: "Delaware", code: "DE", hasLaw: true, lawName: "HB 100 (2018)", effectiveDate: "January 1, 2019", lastUpdated: "2019", scope: "State-regulated health insurance plans", idrProcess: "Delaware Department of Insurance mediation", nsaInteraction: "Delaware law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation available for disputed amounts"], referenceUrl: "https://insurance.delaware.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  DC: { state: "District of Columbia", code: "DC", hasLaw: true, lawName: "Surprise Billing Consumer Protection Amendment Act (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans in DC", idrProcess: "DC Department of Insurance, Securities and Banking IDR", nsaInteraction: "DC law applies to state-regulated plans. NSA governs ERISA self-funded plans.", keyProvisions: ["Comprehensive surprise billing protections", "Patient cost-sharing at in-network rates", "IDR process for disputed amounts", "Provider notice requirements"], referenceUrl: "https://disb.dc.gov/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  FL: { state: "Florida", code: "FL", hasLaw: true, lawName: "Florida Balance Billing Protection Act (2016)", effectiveDate: "July 1, 2016", lastUpdated: "2016", scope: "Fully-insured HMO and PPO plans regulated by Florida OIR", idrProcess: "Mediation through Florida Department of Financial Services", nsaInteraction: "Florida law applies to state-regulated plans. NSA governs ERISA self-funded plans.", keyProvisions: ["Prohibits balance billing for emergency services", "Requires notice and consent for non-emergency out-of-network services", "Mediation available for disputed amounts", "Penalties for non-compliant providers"], referenceUrl: "https://www.myfloridacfo.com/division/consumers/balance-billing", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "B" },
  GA: { state: "Georgia", code: "GA", hasLaw: false, scope: "No state surprise billing law — NSA is primary protection", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is the sole protection for all plan types in Georgia.", keyProvisions: ["NSA applies to all self-funded ERISA plans", "State-regulated plans have limited state-level protections"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  HI: { state: "Hawaii", code: "HI", hasLaw: true, lawName: "HB 1010 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Hawaii Insurance Division mediation", nsaInteraction: "Hawaii law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://insurance.hawaii.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  ID: { state: "Idaho", code: "ID", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Idaho.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  IL: { state: "Illinois", code: "IL", hasLaw: true, lawName: "Surprise Billing Protection Act (2021)", effectiveDate: "January 1, 2022", lastUpdated: "2022", scope: "State-regulated commercial health insurance plans", idrProcess: "Illinois Department of Insurance IDR process", nsaInteraction: "Illinois law aligns closely with NSA. For state-regulated plans, Illinois IDR applies.", keyProvisions: ["Comprehensive surprise billing protections mirroring NSA", "Patient cost-sharing at in-network rates", "30-day open negotiation period", "Independent dispute resolution for unresolved claims"], referenceUrl: "https://insurance.illinois.gov/Consumers/SurpriseBilling.aspx", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  IN: { state: "Indiana", code: "IN", hasLaw: true, lawName: "HB 1004 (2020)", effectiveDate: "July 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Indiana Department of Insurance mediation", nsaInteraction: "Indiana law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.in.gov/idoi/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  IA: { state: "Iowa", code: "IA", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Iowa.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  KS: { state: "Kansas", code: "KS", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Kansas.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  KY: { state: "Kentucky", code: "KY", hasLaw: false, scope: "No comprehensive state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA governs. Kentucky has limited state-level provisions.", keyProvisions: ["NSA applies to ERISA self-funded plans"], protectionLevel: "limited", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "D" },
  LA: { state: "Louisiana", code: "LA", hasLaw: true, lawName: "HB 633 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans", idrProcess: "Louisiana Department of Insurance mediation", nsaInteraction: "Louisiana law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.ldi.la.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "C" },
  ME: { state: "Maine", code: "ME", hasLaw: true, lawName: "LD 1504 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Maine Bureau of Insurance arbitration", nsaInteraction: "Maine law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "Arbitration for disputed amounts"], referenceUrl: "https://www.maine.gov/pfr/insurance/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  MD: { state: "Maryland", code: "MD", hasLaw: true, lawName: "HB 1782 (2018)", effectiveDate: "January 1, 2019", lastUpdated: "2019", scope: "State-regulated health insurance plans", idrProcess: "Maryland Insurance Administration IDR process", nsaInteraction: "Maryland law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Comprehensive surprise billing protections", "Patient cost-sharing at in-network rates", "IDR for disputed amounts", "Provider notice requirements"], referenceUrl: "https://insurance.maryland.gov/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  MA: { state: "Massachusetts", code: "MA", hasLaw: true, lawName: "Chapter 224 (2012) / Chapter 260 (2020)", effectiveDate: "January 1, 2013", lastUpdated: "2020", scope: "State-regulated health insurance plans and hospitals", idrProcess: "Massachusetts Division of Insurance arbitration", nsaInteraction: "Massachusetts law predates NSA and covers state-regulated plans. NSA governs ERISA self-funded plans.", keyProvisions: ["Surprise billing ban for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "Arbitration for disputed amounts", "Hospital price transparency requirements"], referenceUrl: "https://www.mass.gov/info-details/surprise-medical-bills", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  MI: { state: "Michigan", code: "MI", hasLaw: true, lawName: "PA 234 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans", idrProcess: "Michigan Department of Insurance and Financial Services IDR", nsaInteraction: "Michigan law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "IDR for disputed amounts"], referenceUrl: "https://www.michigan.gov/difs/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  MN: { state: "Minnesota", code: "MN", hasLaw: true, lawName: "SF 2744 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Minnesota Department of Commerce mediation", nsaInteraction: "Minnesota law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://mn.gov/commerce/consumers/your-insurance/health/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  MS: { state: "Mississippi", code: "MS", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Mississippi.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  MO: { state: "Missouri", code: "MO", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Missouri.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  MT: { state: "Montana", code: "MT", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Montana.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  NE: { state: "Nebraska", code: "NE", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Nebraska.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  NV: { state: "Nevada", code: "NV", hasLaw: true, lawName: "AB 469 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Nevada Division of Insurance mediation", nsaInteraction: "Nevada law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://doi.nv.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "C" },
  NH: { state: "New Hampshire", code: "NH", hasLaw: true, lawName: "HB 1280 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "New Hampshire Insurance Department mediation", nsaInteraction: "New Hampshire law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.nh.gov/insurance/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  NJ: { state: "New Jersey", code: "NJ", hasLaw: true, lawName: "Out-of-Network Consumer Protection Act (2018)", effectiveDate: "August 30, 2018", lastUpdated: "2018", scope: "State-regulated health insurance plans", idrProcess: "New Jersey Department of Banking and Insurance arbitration", nsaInteraction: "New Jersey law covers state-regulated plans. NSA covers ERISA self-funded plans. NJ IDR win rate for providers: 66% (Georgetown 2025 data).", keyProvisions: ["Comprehensive surprise billing protections", "Patient cost-sharing at in-network rates", "Binding arbitration for disputed amounts", "Provider notice requirements", "Penalties for violations"], referenceUrl: "https://www.state.nj.us/dobi/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A", recentChanges: "Provider IDR win rate 66% per Georgetown 2025 data" },
  NM: { state: "New Mexico", code: "NM", hasLaw: true, lawName: "HB 71 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans", idrProcess: "New Mexico Office of Superintendent of Insurance mediation", nsaInteraction: "New Mexico law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.osi.state.nm.us/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "C" },
  NY: { state: "New York", code: "NY", hasLaw: true, lawName: "NY Financial Services Law § 603-a (2015)", effectiveDate: "March 31, 2015", lastUpdated: "2015", scope: "State-regulated commercial health insurance plans", idrProcess: "Independent Dispute Resolution Organization (IDRO) — binding arbitration", nsaInteraction: "NY law predates NSA. For state-regulated plans, NY IDR applies. For ERISA self-funded plans, NSA applies. NY provider IDR win rate: 81% (Georgetown 2025 data).", keyProvisions: ["Surprise billing protections for emergency and non-emergency out-of-network services", "Patient cost-sharing capped at in-network amounts", "30-day open negotiation period before IDR", "Baseball-style arbitration for disputed amounts"], referenceUrl: "https://www.dfs.ny.gov/consumers/health_insurance/balance_billing", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A", recentChanges: "Provider IDR win rate 81% per Georgetown 2025 data — highest in nation" },
  NC: { state: "North Carolina", code: "NC", hasLaw: true, lawName: "SB 257 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "North Carolina Department of Insurance mediation", nsaInteraction: "North Carolina law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.ncdoi.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  ND: { state: "North Dakota", code: "ND", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in North Dakota.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  OH: { state: "Ohio", code: "OH", hasLaw: false, scope: "No comprehensive state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA governs. Ohio has limited state-level provisions.", keyProvisions: ["NSA applies to ERISA self-funded plans", "Limited state protections for fully-insured plans"], protectionLevel: "limited", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "D" },
  OK: { state: "Oklahoma", code: "OK", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Oklahoma.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  OR: { state: "Oregon", code: "OR", hasLaw: true, lawName: "SB 1067 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health insurance plans", idrProcess: "Oregon Insurance Division arbitration", nsaInteraction: "Oregon law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Comprehensive surprise billing protections for emergency and non-emergency services", "Patient cost-sharing at in-network rates", "Arbitration for disputed amounts", "Provider notice requirements"], referenceUrl: "https://dfr.oregon.gov/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  PA: { state: "Pennsylvania", code: "PA", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Pennsylvania.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  RI: { state: "Rhode Island", code: "RI", hasLaw: true, lawName: "RIGL § 27-18.9 (2018)", effectiveDate: "January 1, 2019", lastUpdated: "2019", scope: "State-regulated health insurance plans", idrProcess: "Rhode Island Department of Business Regulation mediation", nsaInteraction: "Rhode Island law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://dbr.ri.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  SC: { state: "South Carolina", code: "SC", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in South Carolina.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  SD: { state: "South Dakota", code: "SD", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in South Dakota.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  TN: { state: "Tennessee", code: "TN", hasLaw: true, lawName: "SB 1869 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans", idrProcess: "Tennessee Department of Commerce and Insurance mediation", nsaInteraction: "Tennessee law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://www.tn.gov/commerce/insurance.html", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "C" },
  TX: { state: "Texas", code: "TX", hasLaw: true, lawName: "HB 1941 (2019) / SB 1264 (2021)", effectiveDate: "January 1, 2020", lastUpdated: "2021", scope: "State-regulated fully-insured health benefit plans", idrProcess: "Texas Department of Insurance (TDI) IDR — independent arbitration", nsaInteraction: "Texas state law covers state-regulated plans. NSA covers ERISA self-funded plans. Providers must track which framework applies per claim.", keyProvisions: ["Surprise billing ban for emergency services and certain non-emergency out-of-network services", "Patient cost-sharing at in-network rates", "Mediation available for claims $500+", "Arbitration for claims $5,000+ (physicians) or $75,000+ (facilities)"], referenceUrl: "https://www.tdi.texas.gov/medical-billing/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, idrThreshold: "$500+ mediation / $5,000+ arbitration", patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A" },
  UT: { state: "Utah", code: "UT", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Utah.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  VT: { state: "Vermont", code: "VT", hasLaw: true, lawName: "H.524 (2018)", effectiveDate: "January 1, 2019", lastUpdated: "2019", scope: "State-regulated health insurance plans", idrProcess: "Vermont Department of Financial Regulation mediation", nsaInteraction: "Vermont law covers state-regulated plans. NSA covers ERISA self-funded plans.", keyProvisions: ["Surprise billing protections for emergency services", "Patient cost-sharing at in-network rates", "Mediation for disputed amounts"], referenceUrl: "https://dfr.vermont.gov/", protectionLevel: "moderate", emergencyProtection: true, nonEmergencyProtection: false, patientNoticeRequired: true, penaltyForViolation: false, georgetownRating: "B" },
  VA: { state: "Virginia", code: "VA", hasLaw: true, lawName: "HB 1251 (2020) / SB 172 (2020)", effectiveDate: "January 1, 2021", lastUpdated: "2021", scope: "State-regulated health insurance plans (opt-in for self-funded)", idrProcess: "State Corporation Commission (SCC) arbitration", nsaInteraction: "Virginia law covers state-regulated plans and allows self-funded plans to opt in. NSA covers non-opted ERISA self-funded plans.", keyProvisions: ["Comprehensive surprise billing protections", "Patient cost-sharing at in-network rates", "Arbitration for disputed amounts", "Self-funded plan opt-in option", "Provider notice requirements"], referenceUrl: "https://www.scc.virginia.gov/regulated-industries/companies/life-health-companies/balance-billing/", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A", recentChanges: "Unique opt-in mechanism for self-funded plans — expands state law coverage beyond typical state jurisdiction" },
  WA: { state: "Washington", code: "WA", hasLaw: true, lawName: "SB 5526 (2019)", effectiveDate: "January 1, 2020", lastUpdated: "2020", scope: "State-regulated health plans", idrProcess: "Office of the Insurance Commissioner (OIC) arbitration", nsaInteraction: "Washington state law applies to state-regulated plans. NSA applies to self-funded ERISA plans. WA provider IDR win rate: 60% (Georgetown 2025 data).", keyProvisions: ["Surprise billing protections for emergency and non-emergency services", "Patient cost-sharing capped at in-network amounts", "Arbitration for disputes between providers and payers"], referenceUrl: "https://www.insurance.wa.gov/surprise-billing", protectionLevel: "strong", emergencyProtection: true, nonEmergencyProtection: true, patientNoticeRequired: true, penaltyForViolation: true, georgetownRating: "A", recentChanges: "Provider IDR win rate 60% per Georgetown 2025 data" },
  WV: { state: "West Virginia", code: "WV", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in West Virginia.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  WI: { state: "Wisconsin", code: "WI", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Wisconsin.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
  WY: { state: "Wyoming", code: "WY", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Wyoming.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none", emergencyProtection: false, nonEmergencyProtection: false, patientNoticeRequired: false, penaltyForViolation: false, georgetownRating: "F" },
};

const LEVEL_CONFIG: Record<ProtectionLevel, { label: string; color: string; bg: string }> = {
  strong:   { label: "Strong",   color: "text-green-700",  bg: "bg-green-100 border-green-300" },
  moderate: { label: "Moderate", color: "text-blue-700",   bg: "bg-blue-100 border-blue-300" },
  limited:  { label: "Limited",  color: "text-amber-700",  bg: "bg-amber-100 border-amber-300" },
  none:     { label: "None",     color: "text-red-700",    bg: "bg-red-100 border-red-300" },
};

const RATING_COLOR: Record<string, string> = {
  A: "bg-green-600 text-white", B: "bg-blue-500 text-white", C: "bg-amber-500 text-white",
  D: "bg-orange-500 text-white", F: "bg-red-600 text-white", "N/A": "bg-slate-300 text-slate-700",
};

export default function StateBalanceBilling() {
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<ProtectionLevel | "all">("all");
  const [filterHasLaw, setFilterHasLaw] = useState<"all" | "yes" | "no">("all");
  const [selected, setSelected] = useState<StateLaw | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [compareStates, setCompareStates] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"browser" | "table" | "compare" | "insights">("browser");

  const aiMutation = trpc.ai.askAssistant.useMutation();

  const allStates = useMemo(() => Object.values(STATE_LAWS).sort((a, b) => a.state.localeCompare(b.state)), []);

  const filtered = useMemo(() => allStates.filter(s => {
    if (search && !s.state.toLowerCase().includes(search.toLowerCase()) && !s.code.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterLevel !== "all" && s.protectionLevel !== filterLevel) return false;
    if (filterHasLaw === "yes" && !s.hasLaw) return false;
    if (filterHasLaw === "no" && s.hasLaw) return false;
    return true;
  }), [allStates, search, filterLevel, filterHasLaw]);

  const stats = useMemo(() => ({
    total: allStates.length,
    hasLaw: allStates.filter(s => s.hasLaw).length,
    strong: allStates.filter(s => s.protectionLevel === "strong").length,
    moderate: allStates.filter(s => s.protectionLevel === "moderate").length,
    limited: allStates.filter(s => s.protectionLevel === "limited").length,
    none: allStates.filter(s => s.protectionLevel === "none").length,
    aRated: allStates.filter(s => s.georgetownRating === "A").length,
  }), [allStates]);

  const handleAIAnalysis = async (code: string) => {
    const law = STATE_LAWS[code];
    if (!law) return;
    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const result = await aiMutation.mutateAsync({
        question: `Provide a concise compliance analysis for a healthcare provider operating in ${law.state}: How does ${law.hasLaw ? law.lawName : "the NSA"} interact with the federal No Surprises Act? What are the key compliance obligations and most common pitfalls? Comment on the Georgetown CHIR rating of "${law.georgetownRating}" for this state.`,
        disputeId: undefined,
      });
      const r = result as { answer?: string };
      setAiAnalysis(r.answer || "Analysis unavailable.");
    } catch {
      setAiAnalysis("AI analysis is temporarily unavailable. Please try again later.");
    }
    setAiLoading(false);
  };

  const toggleCompare = (code: string) => {
    setCompareStates(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : prev.length < 3 ? [...prev, code] : prev
    );
  };

  const exportCSV = () => {
    const rows = [
      ["State","Code","Has Law","Law Name","Effective Date","Protection Level","Georgetown Rating","Emergency","Non-Emergency","Patient Notice","Penalty","IDR Process"],
      ...allStates.map(s => [s.state, s.code, s.hasLaw?"Yes":"No", s.lawName||"N/A", s.effectiveDate||"N/A", s.protectionLevel, s.georgetownRating||"N/A", s.emergencyProtection?"Yes":"No", s.nonEmergencyProtection?"Yes":"No", s.patientNoticeRequired?"Yes":"No", s.penaltyForViolation?"Yes":"No", s.idrProcess]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "state-balance-billing-laws.csv"; a.click();
    toast.success("CSV exported successfully");
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-blue-600 rounded-lg"><Scale size={18} className="text-white" /></div>
              <h1 className="text-2xl font-bold text-slate-900">State Balance Billing Laws</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">All 50 states + DC — Georgetown CHIR ratings, NSA interaction analysis, and AI compliance guidance</p>
            <div className="flex items-center gap-2 mt-2 ml-11">
              <Badge variant="outline" className="text-xs text-blue-700 border-blue-300"><BookOpen size={10} className="mr-1" />Georgetown CHIR Rated</Badge>
              <Badge variant="outline" className="text-xs text-green-700 border-green-300">{stats.hasLaw} states with laws</Badge>
              <Badge variant="outline" className="text-xs text-slate-500">Updated: July 2026</Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5"><Download size={14} />Export CSV</Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-slate-700" },
            { label: "Have Laws", value: stats.hasLaw, color: "text-blue-700" },
            { label: "Strong", value: stats.strong, color: "text-green-700" },
            { label: "Moderate", value: stats.moderate, color: "text-blue-600" },
            { label: "Limited", value: stats.limited, color: "text-amber-700" },
            { label: "None", value: stats.none, color: "text-red-700" },
            { label: "Georgetown A", value: stats.aRated, color: "text-green-700" },
          ].map(({ label, value, color }) => (
            <Card key={label} className="text-center py-3">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {(["browser","table","compare","insights"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab===tab?"border-blue-600 text-blue-600":"border-transparent text-slate-500 hover:text-slate-700"}`}>
              {tab==="browser"?"State Browser":tab==="compare"?"Compare States":tab==="insights"?"Georgetown Insights":"Full Table"}
            </button>
          ))}
        </div>

        {/* State Browser */}
        {activeTab === "browser" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input placeholder="Search states..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 text-sm h-8" />
                </div>
                <select value={filterLevel} onChange={e => setFilterLevel(e.target.value as ProtectionLevel | "all")} className="text-xs border border-slate-200 rounded-md px-2 h-8 bg-white">
                  <option value="all">All levels</option>
                  <option value="strong">Strong</option>
                  <option value="moderate">Moderate</option>
                  <option value="limited">Limited</option>
                  <option value="none">None</option>
                </select>
                <select value={filterHasLaw} onChange={e => setFilterHasLaw(e.target.value as "all"|"yes"|"no")} className="text-xs border border-slate-200 rounded-md px-2 h-8 bg-white">
                  <option value="all">All</option>
                  <option value="yes">Has law</option>
                  <option value="no">No law</option>
                </select>
              </div>
              <p className="text-xs text-slate-400">{filtered.length} of {allStates.length} states</p>
              <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                {filtered.map(s => {
                  const cfg = LEVEL_CONFIG[s.protectionLevel];
                  return (
                    <button key={s.code} onClick={() => { setSelected(s); setAiAnalysis(null); }}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-all text-sm ${selected?.code===s.code?"border-blue-400 bg-blue-50":"border-slate-100 hover:border-slate-300 bg-white"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500 w-6">{s.code}</span>
                          <span className="font-medium text-slate-700">{s.state}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {s.georgetownRating && s.georgetownRating !== "N/A" && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${RATING_COLOR[s.georgetownRating]}`}>{s.georgetownRating}</span>
                          )}
                          <Badge variant="outline" className={`text-xs ${cfg.color} ${cfg.bg}`}>{cfg.label}</Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-2 space-y-4">
              {!selected ? (
                <Card className="flex items-center justify-center h-64">
                  <div className="text-center text-slate-400">
                    <MapPin size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Select a state to view its balance billing law details</p>
                  </div>
                </Card>
              ) : (
                <>
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{selected.state}</CardTitle>
                          {selected.hasLaw && selected.lawName && <p className="text-sm text-slate-500 mt-0.5">{selected.lawName}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          {selected.georgetownRating && (
                            <div className="text-center">
                              <div className={`text-lg font-bold px-3 py-1 rounded-lg ${RATING_COLOR[selected.georgetownRating]}`}>{selected.georgetownRating}</div>
                              <p className="text-xs text-slate-400 mt-0.5">Georgetown</p>
                            </div>
                          )}
                          <Badge variant="outline" className={`${LEVEL_CONFIG[selected.protectionLevel].color} ${LEVEL_CONFIG[selected.protectionLevel].bg}`}>
                            {LEVEL_CONFIG[selected.protectionLevel].label} Protection
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          { label: "Emergency", value: selected.emergencyProtection },
                          { label: "Non-Emergency", value: selected.nonEmergencyProtection },
                          { label: "Patient Notice", value: selected.patientNoticeRequired },
                          { label: "Penalties", value: selected.penaltyForViolation },
                        ].map(({ label, value }) => (
                          <div key={label} className={`text-center p-2 rounded-lg border text-xs ${value?"bg-green-50 border-green-200 text-green-700":"bg-slate-50 border-slate-200 text-slate-400"}`}>
                            {value ? <CheckCircle2 size={12} className="mx-auto mb-1" /> : <span className="block text-lg leading-none">—</span>}
                            {label}
                          </div>
                        ))}
                      </div>

                      {selected.effectiveDate && (
                        <div className="text-sm">
                          <span className="font-medium text-slate-600">Effective:</span>{" "}
                          <span className="text-slate-700">{selected.effectiveDate}</span>
                          {selected.lastUpdated && <span className="text-slate-400 ml-2">(last updated {selected.lastUpdated})</span>}
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Scope</p>
                        <p className="text-sm text-slate-700">{selected.scope}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">IDR Process</p>
                        <p className="text-sm text-slate-700">{selected.idrProcess}</p>
                        {selected.idrThreshold && <p className="text-xs text-slate-500 mt-0.5">Threshold: {selected.idrThreshold}</p>}
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-amber-800 mb-1">NSA Interaction</p>
                            <p className="text-sm text-amber-700">{selected.nsaInteraction}</p>
                          </div>
                        </div>
                      </div>

                      {selected.recentChanges && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <TrendingUp size={13} className="text-blue-600 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-blue-800 mb-1">Recent Changes / Georgetown Data</p>
                              <p className="text-sm text-blue-700">{selected.recentChanges}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Key Provisions</p>
                        <ul className="space-y-1.5">
                          {selected.keyProvisions.map((p, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <CheckCircle2 size={12} className="text-blue-500 mt-0.5 shrink-0" />{p}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
                        {selected.referenceUrl && (
                          <a href={selected.referenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                            <ExternalLink size={12} />Official Reference
                          </a>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleAIAnalysis(selected.code)} disabled={aiLoading} className="text-purple-600 border-purple-200 hover:bg-purple-50 gap-1.5">
                          {aiLoading ? <RefreshCw size={12} className="animate-spin" /> : <Star size={12} />}
                          AI Compliance Analysis
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => toggleCompare(selected.code)} className="gap-1.5">
                          {compareStates.includes(selected.code) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {compareStates.includes(selected.code) ? "Remove from Compare" : "Add to Compare"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {aiAnalysis && (
                    <Card className="border-purple-200 bg-purple-50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                          <Info size={13} />AI Compliance Analysis — {selected.state}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{aiAnalysis}</p>
                        <p className="text-xs text-purple-400 mt-3">Generated by IDRAssistantAgent. For informational purposes only.</p>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Full Table */}
        {activeTab === "table" && (
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["State","Code","Has Law","Law Name","Effective","Protection","Georgetown","Emergency","Non-Emerg.","Notice","Penalties"].map(h => (
                        <th key={h} className="text-left py-2 pr-3 font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {allStates.map(s => {
                      const cfg = LEVEL_CONFIG[s.protectionLevel];
                      return (
                        <tr key={s.code} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setSelected(s); setActiveTab("browser"); setAiAnalysis(null); }}>
                          <td className="py-2 pr-3 font-medium text-slate-700">{s.state}</td>
                          <td className="py-2 pr-3 font-mono text-slate-500">{s.code}</td>
                          <td className="py-2 pr-3">{s.hasLaw ? <CheckCircle2 size={12} className="text-green-600" /> : <span className="text-slate-300">—</span>}</td>
                          <td className="py-2 pr-3 text-slate-600 max-w-[140px] truncate">{s.lawName||"—"}</td>
                          <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{s.effectiveDate?.split(" ").slice(-1)[0]||"—"}</td>
                          <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${cfg.color} ${cfg.bg}`}>{cfg.label}</span></td>
                          <td className="py-2 pr-3">{s.georgetownRating && <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${RATING_COLOR[s.georgetownRating]}`}>{s.georgetownRating}</span>}</td>
                          <td className="py-2 pr-3 text-center">{s.emergencyProtection?"✅":"—"}</td>
                          <td className="py-2 pr-3 text-center">{s.nonEmergencyProtection?"✅":"—"}</td>
                          <td className="py-2 pr-3 text-center">{s.patientNoticeRequired?"✅":"—"}</td>
                          <td className="py-2 pr-3 text-center">{s.penaltyForViolation?"✅":"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Compare States */}
        {activeTab === "compare" && (
          <div className="space-y-4">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Info size={14} className="text-blue-600 shrink-0" />
                  <p className="text-sm text-blue-700">Select up to 3 states from the State Browser to compare side-by-side.{compareStates.length > 0 && ` Currently: ${compareStates.join(", ")}`}</p>
                </div>
              </CardContent>
            </Card>
            {compareStates.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Scale size={32} className="mx-auto mb-2 opacity-30" />
                <p>No states selected. Go to State Browser and click "Add to Compare".</p>
              </div>
            ) : (
              <div className={`grid gap-4 grid-cols-${compareStates.length}`}>
                {compareStates.map(code => {
                  const s = STATE_LAWS[code];
                  if (!s) return null;
                  const cfg = LEVEL_CONFIG[s.protectionLevel];
                  return (
                    <Card key={code}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{s.state}</CardTitle>
                          {s.georgetownRating && <span className={`text-sm font-bold px-2 py-0.5 rounded ${RATING_COLOR[s.georgetownRating]}`}>{s.georgetownRating}</span>}
                        </div>
                        <Badge variant="outline" className={`w-fit text-xs ${cfg.color} ${cfg.bg}`}>{cfg.label}</Badge>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <div><span className="font-medium">Law:</span> {s.lawName||"No state law"}</div>
                        <div><span className="font-medium">Effective:</span> {s.effectiveDate||"N/A"}</div>
                        <div><span className="font-medium">IDR:</span> {s.idrProcess}</div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          {[{label:"Emergency",v:s.emergencyProtection},{label:"Non-Emergency",v:s.nonEmergencyProtection},{label:"Patient Notice",v:s.patientNoticeRequired},{label:"Penalties",v:s.penaltyForViolation}].map(({label,v}) => (
                            <div key={label} className={`p-1.5 rounded text-center ${v?"bg-green-50 text-green-700":"bg-slate-50 text-slate-400"}`}>{v?"✅":"—"} {label}</div>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500">{s.nsaInteraction}</p>
                        <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => toggleCompare(code)}>Remove</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Georgetown Insights */}
        {activeTab === "insights" && (
          <div className="space-y-6">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <BookOpen size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800 mb-1">About Georgetown CHIR Ratings</p>
                    <p className="text-sm text-blue-700">Georgetown University Center on Health Insurance Reforms (CHIR) evaluates state surprise billing laws on a letter-grade scale (A–F) based on: comprehensiveness (emergency + non-emergency), patient cost-sharing limits, IDR process quality, provider notice requirements, and enforcement. States with no law receive F. Source: CHIR research publications and NCSL state tracker (33+ states with some protections as of 2025).</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Georgetown Rating Distribution</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(["A","B","C","D","F"] as const).map(grade => {
                    const count = allStates.filter(s => s.georgetownRating === grade).length;
                    const pct = Math.round((count / allStates.length) * 100);
                    return (
                      <div key={grade} className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded font-bold text-sm flex items-center justify-center ${RATING_COLOR[grade]}`}>{grade}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div className={`h-2 rounded-full ${grade==="A"?"bg-green-500":grade==="B"?"bg-blue-500":grade==="C"?"bg-amber-500":grade==="D"?"bg-orange-500":"bg-red-500"}`} style={{width:`${pct}%`}} />
                        </div>
                        <span className="text-sm text-slate-600 w-20">{count} states ({pct}%)</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Key Georgetown 2025 Findings</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {[
                    { stat: "81%", desc: "Provider IDR win rate in New York state — highest in nation" },
                    { stat: "66%", desc: "Provider IDR win rate in New Jersey state IDR" },
                    { stat: "60%", desc: "Provider IDR win rate in Washington state IDR" },
                    { stat: "33+", desc: "States with some form of consumer surprise billing protection" },
                    { stat: "18", desc: "States that fully meet Georgetown's comprehensive criteria (A-rated)" },
                    { stat: "$885M", desc: "Total disputed amount in federal IDR in 2025 Q1 alone" },
                    { stat: "45%", desc: "Federal NSA provider win rate in 2025 Q1 — down from 85% in 2024" },
                  ].map(({ stat, desc }) => (
                    <div key={stat} className="flex items-start gap-3">
                      <span className="font-bold text-blue-700 text-base w-12 shrink-0">{stat}</span>
                      <p className="text-slate-600">{desc}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Georgetown A-Rated States — Strongest Protections</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allStates.filter(s => s.georgetownRating === "A").map(s => (
                    <button key={s.code} onClick={() => { setSelected(s); setActiveTab("browser"); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-300 rounded-lg text-sm text-green-800 hover:bg-green-100 transition-colors">
                      <span className="font-bold">{s.code}</span>
                      <span>{s.state}</span>
                      {s.recentChanges && <TrendingUp size={11} className="text-green-600" />}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Georgetown F-Rated States — NSA Only</CardTitle>
                <p className="text-xs text-slate-500">These states rely entirely on the federal NSA. Providers here face a single-track federal IDR process.</p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allStates.filter(s => s.georgetownRating === "F").map(s => (
                    <button key={s.code} onClick={() => { setSelected(s); setActiveTab("browser"); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 hover:bg-red-100 transition-colors">
                      <span className="font-bold">{s.code}</span>
                      <span>{s.state}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
