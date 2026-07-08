/**
 * NSA IDR Dispute PDF Export
 * Generates a formatted PDF summary of a dispute including the full 19-step timeline,
 * all offers, financial summary, parties, and determination.
 */

import PDFDocument from "pdfkit";
import { Readable } from "stream";

// ─── Types (mirrors DB schema) ────────────────────────────────────────────────

interface DisputeForPDF {
  referenceNumber: string;
  status: string;
  currentStep: string;
  serviceType: string;
  serviceDate?: Date | null;
  patientState?: string | null;
  facilityState?: string | null;
  cptCodes?: string[] | null;
  billedAmount?: string | null;
  qpaAmount?: string | null;
  initiatingPartyOffer?: string | null;
  respondingPartyOffer?: string | null;
  determinationAmount?: string | null;
  determinationBasis?: string | null;
  initiatingPartyName: string;
  initiatingPartyType?: string | null;
  initiatingPartyNpi?: string | null;
  respondingPartyName?: string | null;
  respondingPartyType?: string | null;
  idrEntityName?: string | null;
  createdAt?: Date | null;
  openNegotiationDeadline?: Date | null;
  idrInitiationDeadline?: Date | null;
  offerSubmissionDeadline?: Date | null;
  determinationDeadline?: Date | null;
  paymentDeadline?: Date | null;
  closedAt?: Date | null;
  events: Array<{
    step: string;
    eventType: string;
    description: string;
    performedByName?: string | null;
    createdAt?: Date | null;
  }>;
  offers: Array<{
    offerType: string;
    amount: string;
    rationale?: string | null;
    isAccepted: boolean;
    submittedAt?: Date | null;
  }>;
  documents: Array<{
    title?: string | null;
    documentType: string;
    fileName: string;
    fileSize?: number | null;
    uploadedAt?: Date | null;
  }>;
}

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = {
  primary: "#1e40af",
  secondary: "#3b82f6",
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  text: "#1e293b",
  muted: "#64748b",
  border: "#e2e8f0",
  bg: "#f8fafc",
};

// ─── PDF generation ───────────────────────────────────────────────────────────

export async function generateDisputePDF(dispute: DisputeForPDF): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: `NSA IDR Dispute Summary — ${dispute.referenceNumber}`,
        Author: "IDR Workflow Platform",
        Subject: "No Surprises Act Independent Dispute Resolution",
        Creator: "IDR Workflow Platform v1.0",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover header ──────────────────────────────────────────────────────────
    doc
      .rect(60, 60, doc.page.width - 120, 80)
      .fill(COLORS.primary);

    doc
      .fillColor("#ffffff")
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("NSA IDR Dispute Summary", 80, 80, { width: doc.page.width - 160 });

    doc
      .fontSize(11)
      .font("Helvetica")
      .text("No Surprises Act — Federal Independent Dispute Resolution", 80, 106);

    doc.fillColor(COLORS.text).moveDown(2);

    // ── Reference + status banner ─────────────────────────────────────────────
    const statusColor = dispute.status === "closed" ? COLORS.success :
      dispute.status === "under_arbitration" ? COLORS.danger : COLORS.secondary;

    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor(COLORS.text)
      .text(dispute.referenceNumber, 60, 165);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor(statusColor)
      .text(
        dispute.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        60, 185
      );

    doc.fillColor(COLORS.muted)
      .text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 60, 200);

    doc.moveDown(1);
    drawHRule(doc);

    // ── Parties ───────────────────────────────────────────────────────────────
    sectionHeader(doc, "Parties");

    const col1 = 60, col2 = 320;
    const partyY = doc.y;

    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.muted).text("INITIATING PARTY", col1, partyY);
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.text)
      .text(dispute.initiatingPartyName, col1, partyY + 14);
    doc.fontSize(9).fillColor(COLORS.muted)
      .text(
        [
          dispute.initiatingPartyType?.replace(/_/g, " "),
          dispute.initiatingPartyNpi ? `NPI: ${dispute.initiatingPartyNpi}` : null,
        ].filter(Boolean).join(" · "),
        col1, partyY + 28
      );

    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.muted).text("RESPONDING PARTY", col2, partyY);
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.text)
      .text(dispute.respondingPartyName ?? "Not yet identified", col2, partyY + 14);
    if (dispute.respondingPartyType) {
      doc.fontSize(9).fillColor(COLORS.muted)
        .text(dispute.respondingPartyType.replace(/_/g, " "), col2, partyY + 28);
    }

    doc.y = partyY + 50;

    if (dispute.idrEntityName) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.muted).text("CERTIFIED IDR ENTITY");
      doc.font("Helvetica").fontSize(11).fillColor(COLORS.text).text(dispute.idrEntityName);
      doc.moveDown(0.5);
    }

    drawHRule(doc);

    // ── Service Details ───────────────────────────────────────────────────────
    sectionHeader(doc, "Service Details");

    const serviceRows: [string, string][] = [
      ["Service Type", dispute.serviceType?.replace(/_/g, " ") ?? "—"],
      ["Service Date", dispute.serviceDate ? new Date(dispute.serviceDate).toLocaleDateString() : "—"],
      ["Patient State", dispute.patientState ?? "—"],
      ["Facility State", dispute.facilityState ?? "—"],
      ["CPT Codes", Array.isArray(dispute.cptCodes) ? dispute.cptCodes.join(", ") : (dispute.cptCodes ?? "—")],
      ["Filed Date", dispute.createdAt ? new Date(dispute.createdAt).toLocaleDateString() : "—"],
    ];

    twoColTable(doc, serviceRows);
    drawHRule(doc);

    // ── Financial Summary ─────────────────────────────────────────────────────
    sectionHeader(doc, "Financial Summary");

    const financialRows: [string, string, boolean?][] = [
      ["Billed Amount", dispute.billedAmount ? `$${Number(dispute.billedAmount).toLocaleString()}` : "—"],
      ["Qualifying Payment Amount (QPA)", dispute.qpaAmount ? `$${Number(dispute.qpaAmount).toLocaleString()}` : "—"],
      ["Initiating Party Offer", dispute.initiatingPartyOffer ? `$${Number(dispute.initiatingPartyOffer).toLocaleString()}` : "—"],
      ["Responding Party Offer", dispute.respondingPartyOffer ? `$${Number(dispute.respondingPartyOffer).toLocaleString()}` : "—"],
      ["Determination Amount", dispute.determinationAmount ? `$${Number(dispute.determinationAmount).toLocaleString()}` : "Pending", true],
    ];

    financialRows.forEach(([label, value, highlight]) => {
      const rowY = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(label, 60, rowY, { width: 240 });
      doc.font(highlight ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .fillColor(highlight ? COLORS.primary : COLORS.text)
        .text(value, 320, rowY, { width: 200, align: "right" });
      doc.y = rowY + 18;
    });

    if (dispute.determinationBasis) {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("DETERMINATION BASIS");
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.text).text(dispute.determinationBasis, { width: doc.page.width - 120 });
    }

    drawHRule(doc);

    // ── NSA Deadlines ─────────────────────────────────────────────────────────
    sectionHeader(doc, "NSA Regulatory Deadlines");

    const deadlines: [string, Date | null | undefined][] = [
      ["Open Negotiation Deadline", dispute.openNegotiationDeadline],
      ["IDR Initiation Deadline", dispute.idrInitiationDeadline],
      ["Offer Submission Deadline", dispute.offerSubmissionDeadline],
      ["Determination Deadline", dispute.determinationDeadline],
      ["Payment Deadline", dispute.paymentDeadline],
      ["Dispute Closed", dispute.closedAt],
    ].filter(([, d]) => d != null) as [string, Date][];

    if (deadlines.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text("No deadlines recorded.");
    } else {
      twoColTable(doc, deadlines.map(([label, d]) => [
        label,
        new Date(d as Date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      ] as [string, string]));
    }

    drawHRule(doc);

    // ── Offer History ─────────────────────────────────────────────────────────
    if (dispute.offers.length > 0) {
      sectionHeader(doc, "Offer Negotiation History");

      dispute.offers.forEach((offer, i) => {
        const offerY = doc.y;
        const typeLabel = {
          initiating_party: "Initiating Party Offer",
          responding_party: "Responding Party Offer",
          qpa: "Qualifying Payment Amount",
          determination: "IDR Determination",
        }[offer.offerType] ?? offer.offerType;

        doc
          .rect(60, offerY, doc.page.width - 120, offer.rationale ? 60 : 44)
          .fillAndStroke(offer.isAccepted ? "#f0fdf4" : "#f8fafc", COLORS.border);

        doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text)
          .text(`${i + 1}. ${typeLabel}`, 72, offerY + 8);

        doc.font("Helvetica-Bold").fontSize(14).fillColor(offer.isAccepted ? COLORS.success : COLORS.primary)
          .text(`$${Number(offer.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 72, offerY + 22);

        if (offer.isAccepted) {
          doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.success)
            .text("✓ ACCEPTED", doc.page.width - 140, offerY + 8, { width: 80, align: "right" });
        }

        if (offer.submittedAt) {
          doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
            .text(new Date(offer.submittedAt).toLocaleDateString(), doc.page.width - 140, offerY + 22, { width: 80, align: "right" });
        }

        if (offer.rationale) {
          doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
            .text(offer.rationale.slice(0, 200), 72, offerY + 40, { width: doc.page.width - 164 });
        }

        doc.y = offerY + (offer.rationale ? 68 : 52);
      });

      drawHRule(doc);
    }

    // ── 19-Step Timeline ──────────────────────────────────────────────────────
    sectionHeader(doc, "19-Step IDR Workflow Timeline");

    const IDR_STEPS = [
      "STEP_01_OPEN_NEGOTIATION_INITIATED", "STEP_02_OPEN_NEGOTIATION_PERIOD",
      "STEP_03_OPEN_NEGOTIATION_FAILED", "STEP_04_IDR_INITIATED",
      "STEP_05_IDR_NOTICE_SENT", "STEP_06_IDR_ENTITY_SELECTION",
      "STEP_07_IDR_ENTITY_SELECTED", "STEP_08_ELIGIBILITY_REVIEW",
      "STEP_09_OFFER_SUBMISSION", "STEP_10_QPA_DISCLOSURE",
      "STEP_11_ADDITIONAL_INFORMATION", "STEP_12_ARBITRATION_REVIEW",
      "STEP_13_DETERMINATION_ISSUED", "STEP_14_PAYMENT_DETERMINATION",
      "STEP_15_PAYMENT_MADE", "STEP_16_ADMINISTRATIVE_FEE_PAID",
      "STEP_17_DISPUTE_CLOSED", "STEP_18_APPEAL_FILED", "STEP_19_APPEAL_RESOLVED",
    ];

    const currentIdx = IDR_STEPS.indexOf(dispute.currentStep);

    IDR_STEPS.forEach((step, idx) => {
      const event = dispute.events.find(e => e.step === step);
      const isCompleted = idx < currentIdx;
      const isCurrent = step === dispute.currentStep;

      const label = step.replace(/^STEP_\d+_/, "").replace(/_/g, " ");
      const stepY = doc.y;

      // Step indicator circle
      const circleX = 75, circleY = stepY + 6;
      if (isCompleted) {
        doc.circle(circleX, circleY, 6).fill(COLORS.success);
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#fff").text("✓", circleX - 4, circleY - 4, { width: 8, align: "center" });
      } else if (isCurrent) {
        doc.circle(circleX, circleY, 6).fill(COLORS.primary);
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#fff").text(`${idx + 1}`, circleX - 4, circleY - 4, { width: 8, align: "center" });
      } else {
        doc.circle(circleX, circleY, 6).fillAndStroke(COLORS.bg, COLORS.border);
        doc.font("Helvetica").fontSize(7).fillColor(COLORS.muted).text(`${idx + 1}`, circleX - 4, circleY - 4, { width: 8, align: "center" });
      }

      // Step label
      doc.font(isCurrent ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .fillColor(isCompleted ? COLORS.success : isCurrent ? COLORS.primary : COLORS.muted)
        .text(label, 92, stepY, { width: doc.page.width - 152 });

      if (event) {
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
          .text(
            `${event.description}${event.createdAt ? ` · ${new Date(event.createdAt).toLocaleDateString()}` : ""}`,
            92, stepY + 13, { width: doc.page.width - 152 }
          );
        doc.y = stepY + 28;
      } else {
        doc.y = stepY + 16;
      }

      // Connector line (skip last)
      if (idx < IDR_STEPS.length - 1) {
        doc.moveTo(circleX, circleY + 6).lineTo(circleX, doc.y).stroke(COLORS.border);
      }
    });

    drawHRule(doc);

    // ── Evidence Documents ────────────────────────────────────────────────────
    if (dispute.documents.length > 0) {
      sectionHeader(doc, "Attached Evidence Documents");

      dispute.documents.forEach((d, i) => {
        const docY = doc.y;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text)
          .text(`${i + 1}. ${d.title ?? d.fileName}`, 60, docY);
        doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
          .text(
            [
              d.documentType.replace(/_/g, " "),
              d.fileName,
              d.fileSize ? `${(d.fileSize / 1024).toFixed(1)} KB` : null,
              d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : null,
            ].filter(Boolean).join(" · "),
            60, docY + 13
          );
        doc.y = docY + 28;
      });

      drawHRule(doc);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        `This document was generated by the IDR Workflow Platform on ${new Date().toLocaleString()}. ` +
        `For regulatory guidance, refer to 45 CFR §149.510 and the CMS No Surprises Act resources at cms.gov/nosurprises.`,
        60, doc.page.height - 80,
        { width: doc.page.width - 120, align: "center" }
      );

    doc.end();
  });
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function drawHRule(doc: InstanceType<typeof PDFDocument>) {
  doc.moveDown(0.5);
  doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).stroke(COLORS.border);
  doc.moveDown(0.5);
}

function sectionHeader(doc: InstanceType<typeof PDFDocument>, title: string) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.primary).text(title);
  doc.moveDown(0.3);
}

function twoColTable(doc: InstanceType<typeof PDFDocument>, rows: [string, string][]) {
  rows.forEach(([label, value]) => {
    const rowY = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(label, 60, rowY, { width: 200 });
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.text).text(value, 280, rowY, { width: 240 });
    doc.y = rowY + 16;
  });
  doc.moveDown(0.3);
}
