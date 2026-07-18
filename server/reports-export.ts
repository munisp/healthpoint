/**
 * HealthPoint IDR Reports Export
 * Generates a multi-section PDF report with:
 *   - Cover page with KPI summary
 *   - Dispute Volume by Month table
 *   - Financial Summary by Service Type table
 *   - Outcome Analysis table
 *   - Timeline Compliance table
 *   - Full dispute list
 */
import PDFDocument from "pdfkit";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ReportSummaryData {
  totalDisputes: number;
  totalAmount: number;
  avgDetermination: number;
  winRate: number;
  avgDaysToClose: number;
  byServiceType: Array<{ type: string; count: number }>;
  byMonth: Array<{ month: string; open_negotiation: number; idr_active: number; closed: number; ineligible: number }>;
  financialByServiceType: Array<{ serviceType: string; avgBilled: number; avgQPA: number; avgDetermination: number }>;
  outcomeByMonth: Array<{ month: string; won: number; lost: number; pending: number }>;
  avgDaysByStep: Array<{ step: string; avgDays: number }>;
}

export interface DisputeRowForExport {
  referenceNumber: string;
  status: string | null;
  currentStep: string | null;
  serviceType: string | null;
  serviceDate: Date | null;
  initiatingPartyName: string;
  respondingPartyName: string | null;
  billedAmount: string | null;
  qpaAmount: string | null;
  determinationAmount: string | null;
  patientState: string | null;
  facilityState: string | null;
  openNegotiationDeadline: Date | null;
  offerSubmissionDeadline: Date | null;
  paymentDeadline: Date | null;
  createdAt: Date | null;
  closedAt: Date | null;
}

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  primary: "#1e40af",
  secondary: "#3b82f6",
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  text: "#1e293b",
  muted: "#64748b",
  border: "#e2e8f0",
  bg: "#f1f5f9",
  white: "#ffffff",
};

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// ─── Helper: draw a horizontal rule ──────────────────────────────────────────
function hRule(doc: PDFKit.PDFDocument, y?: number) {
  const yPos = y ?? doc.y;
  doc.moveTo(PAGE_MARGIN, yPos).lineTo(PAGE_WIDTH - PAGE_MARGIN, yPos).strokeColor(C.border).lineWidth(0.5).stroke();
}

// ─── Helper: section header ───────────────────────────────────────────────────
function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(0.5);
  doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 22).fill(C.primary);
  doc.fillColor(C.white).fontSize(10).font("Helvetica-Bold")
    .text(title.toUpperCase(), PAGE_MARGIN + 8, doc.y - 17, { width: CONTENT_WIDTH - 16 });
  doc.fillColor(C.text).moveDown(0.8);
}

// ─── Helper: simple table ─────────────────────────────────────────────────────
function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  colWidths: number[],
) {
  const ROW_H = 18;
  const startX = PAGE_MARGIN;

  // Header row
  let x = startX;
  doc.rect(startX, doc.y, CONTENT_WIDTH, ROW_H).fill(C.bg);
  headers.forEach((h, i) => {
    doc.fillColor(C.text).fontSize(8).font("Helvetica-Bold")
      .text(h, x + 4, doc.y - ROW_H + 5, { width: colWidths[i] - 8, lineBreak: false });
    x += colWidths[i];
  });
  doc.moveDown(0.05);
  hRule(doc);

  // Data rows
  rows.forEach((row, ri) => {
    if (doc.y + ROW_H > 760) {
      doc.addPage();
      // Repeat header on new page
      let hx = startX;
      doc.rect(startX, doc.y, CONTENT_WIDTH, ROW_H).fill(C.bg);
      headers.forEach((h, i) => {
        doc.fillColor(C.text).fontSize(8).font("Helvetica-Bold")
          .text(h, hx + 4, doc.y - ROW_H + 5, { width: colWidths[i] - 8, lineBreak: false });
        hx += colWidths[i];
      });
      doc.moveDown(0.05);
      hRule(doc);
    }
    const rowY = doc.y;
    if (ri % 2 === 0) doc.rect(startX, rowY, CONTENT_WIDTH, ROW_H).fill("#f8fafc");
    let cx = startX;
    row.forEach((cell, i) => {
      doc.fillColor(C.text).fontSize(7.5).font("Helvetica")
        .text(cell, cx + 4, rowY + 5, { width: colWidths[i] - 8, lineBreak: false });
      cx += colWidths[i];
    });
    doc.y = rowY + ROW_H;
    hRule(doc);
  });
  doc.moveDown(0.5);
}

// ─── Helper: KPI card ─────────────────────────────────────────────────────────
function kpiCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, value: string, sub?: string) {
  doc.rect(x, y, w, 56).fill(C.bg);
  doc.rect(x, y, 3, 56).fill(C.secondary);
  doc.fillColor(C.muted).fontSize(7.5).font("Helvetica").text(label, x + 10, y + 8, { width: w - 14 });
  doc.fillColor(C.primary).fontSize(18).font("Helvetica-Bold").text(value, x + 10, y + 20, { width: w - 14 });
  if (sub) doc.fillColor(C.muted).fontSize(7).font("Helvetica").text(sub, x + 10, y + 43, { width: w - 14 });
}

// ─── Main export function ─────────────────────────────────────────────────────
export async function generateReportsPDF(
  summary: ReportSummaryData,
  disputes: DisputeRowForExport[],
  dateRangeLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const now = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    // ── Cover / KPI Page ──────────────────────────────────────────────────────
    // Header bar
    doc.rect(0, 0, PAGE_WIDTH, 80).fill(C.primary);
    doc.fillColor(C.white).fontSize(22).font("Helvetica-Bold")
      .text("HealthPoint IDR Platform", PAGE_MARGIN, 20, { width: CONTENT_WIDTH });
    doc.fillColor("#93c5fd").fontSize(12).font("Helvetica")
      .text("Reports & Analytics Export", PAGE_MARGIN, 48, { width: CONTENT_WIDTH });

    doc.y = 100;
    doc.fillColor(C.muted).fontSize(9).font("Helvetica")
      .text(`Generated: ${now}  ·  Period: ${dateRangeLabel}  ·  Total disputes in range: ${summary.totalDisputes}`,
        PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(1);
    hRule(doc);
    doc.moveDown(0.8);

    // KPI cards (2 per row)
    const cardW = (CONTENT_WIDTH - 12) / 2;
    const kpis = [
      { label: "Total Disputes", value: String(summary.totalDisputes), sub: "in selected period" },
      { label: "Overall Win Rate", value: `${summary.winRate}%`, sub: "provider-favorable determinations" },
      { label: "Avg. Determination Amount", value: summary.avgDetermination > 0 ? `$${summary.avgDetermination.toLocaleString()}` : "—", sub: "across closed disputes" },
      { label: "Avg. Days to Close", value: summary.avgDaysToClose > 0 ? `${summary.avgDaysToClose} days` : "—", sub: "from initiation to closure" },
    ];
    const kpiY = doc.y;
    kpis.forEach((k, i) => {
      const kx = PAGE_MARGIN + (i % 2) * (cardW + 12);
      const ky = kpiY + Math.floor(i / 2) * 68;
      kpiCard(doc, kx, ky, cardW, k.label, k.value, k.sub);
    });
    doc.y = kpiY + 2 * 68 + 12;
    doc.moveDown(0.5);

    // ── Volume by Month ───────────────────────────────────────────────────────
    sectionHeader(doc, "1. Dispute Volume by Month");
    if (summary.byMonth.length === 0) {
      doc.fillColor(C.muted).fontSize(9).text("No data available for the selected period.", PAGE_MARGIN, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(
        doc,
        ["Month", "Open Negotiation", "IDR Active", "Closed", "Ineligible", "Total"],
        summary.byMonth.map(r => [
          r.month,
          String(r.open_negotiation),
          String(r.idr_active),
          String(r.closed),
          String(r.ineligible),
          String(r.open_negotiation + r.idr_active + r.closed + r.ineligible),
        ]),
        [70, 95, 80, 70, 80, 70],
      );
    }

    // ── Financial Summary ─────────────────────────────────────────────────────
    sectionHeader(doc, "2. Financial Summary by Service Type");
    if (summary.financialByServiceType.length === 0) {
      doc.fillColor(C.muted).fontSize(9).text("No financial data available.", PAGE_MARGIN, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(
        doc,
        ["Service Type", "Avg. Billed", "Avg. QPA", "Avg. Determination", "QPA vs Det. Δ"],
        summary.financialByServiceType.map(r => [
          r.serviceType,
          r.avgBilled > 0 ? `$${r.avgBilled.toLocaleString()}` : "—",
          r.avgQPA > 0 ? `$${r.avgQPA.toLocaleString()}` : "—",
          r.avgDetermination > 0 ? `$${r.avgDetermination.toLocaleString()}` : "—",
          r.avgQPA > 0 && r.avgDetermination > 0
            ? `${r.avgDetermination >= r.avgQPA ? "+" : ""}$${(r.avgDetermination - r.avgQPA).toLocaleString()}`
            : "—",
        ]),
        [120, 80, 80, 100, 85],
      );
    }

    // ── Outcome Analysis ──────────────────────────────────────────────────────
    sectionHeader(doc, "3. Outcome Analysis by Month");
    if (summary.outcomeByMonth.length === 0) {
      doc.fillColor(C.muted).fontSize(9).text("No outcome data available — disputes have not yet reached determination.", PAGE_MARGIN, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(
        doc,
        ["Month", "Won", "Lost", "Pending", "Win Rate", "Det. Rate"],
        summary.outcomeByMonth.map(r => {
          const total = r.won + r.lost + r.pending;
          const closed = r.won + r.lost;
          return [
            r.month,
            String(r.won),
            String(r.lost),
            String(r.pending),
            closed > 0 ? `${Math.round((r.won / closed) * 100)}%` : "—",
            total > 0 ? `${Math.round((closed / total) * 100)}%` : "—",
          ];
        }),
        [70, 55, 55, 65, 70, 80],
      );
    }

    // ── Timeline Compliance ───────────────────────────────────────────────────
    sectionHeader(doc, "4. Timeline Compliance (Avg. Days per Step)");
    if (summary.avgDaysByStep.length === 0) {
      doc.fillColor(C.muted).fontSize(9).text("No timeline data available.", PAGE_MARGIN, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(
        doc,
        ["Step", "Avg. Days", "Statutory Limit", "Status"],
        summary.avgDaysByStep.map(r => {
          const limit = r.step.includes("Step 1") ? 30 : r.step.includes("Step 2") || r.step.includes("Step 3") ? 4 : r.step.includes("Step 4") ? 3 : 10;
          const status = r.avgDays === 0 ? "No data" : r.avgDays <= limit ? "✓ On time" : "⚠ Overdue";
          return [r.step, r.avgDays > 0 ? `${r.avgDays} days` : "—", `${limit} days`, status];
        }),
        [100, 80, 100, 185],
      );
    }

    // ── Full Dispute List ─────────────────────────────────────────────────────
    sectionHeader(doc, `5. Dispute List (${disputes.length} records)`);
    if (disputes.length === 0) {
      doc.fillColor(C.muted).fontSize(9).text("No disputes found for the selected period.", PAGE_MARGIN, doc.y);
    } else {
      const fmt = (d: Date | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";
      const money = (v: string | null) => v && Number(v) > 0 ? `$${Number(v).toLocaleString()}` : "—";
      drawTable(
        doc,
        ["Reference #", "Status", "Service Type", "Billed", "QPA", "Determination", "Created"],
        disputes.slice(0, 500).map(d => [
          d.referenceNumber,
          (d.status ?? "").replace(/_/g, " "),
          (d.serviceType ?? "").replace(/_/g, " "),
          money(d.billedAmount),
          money(d.qpaAmount),
          money(d.determinationAmount),
          fmt(d.createdAt),
        ]),
        [90, 80, 90, 60, 60, 80, 55],
      );
      if (disputes.length > 500) {
        doc.fillColor(C.muted).fontSize(8).font("Helvetica-Oblique")
          .text(`Note: Only the first 500 of ${disputes.length} disputes are shown. Use CSV export for the full dataset.`, PAGE_MARGIN, doc.y);
      }
    }

    // ── Footer on all pages ───────────────────────────────────────────────────
    const totalPages = (doc as any).bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.rect(0, 810, PAGE_WIDTH, 32).fill(C.primary);
      doc.fillColor(C.white).fontSize(7.5).font("Helvetica")
        .text(
          `HealthPoint IDR Platform  ·  Confidential  ·  Generated ${now}  ·  Page ${i + 1} of ${totalPages}`,
          PAGE_MARGIN, 819, { width: CONTENT_WIDTH, align: "center" }
        );
    }

    doc.end();
  });
}

// ─── CSV export ───────────────────────────────────────────────────────────────
export function generateReportsCSV(
  summary: ReportSummaryData,
  disputes: DisputeRowForExport[],
  dateRangeLabel: string,
): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (d: Date | null) => d ? new Date(d).toLocaleDateString("en-US") : "";
  const money = (v: string | null) => v && Number(v) > 0 ? Number(v).toFixed(2) : "";

  const sections: string[] = [];

  // Section 1: KPI Summary
  sections.push("SECTION: KPI Summary");
  sections.push(`Period,${esc(dateRangeLabel)}`);
  sections.push(`Total Disputes,${summary.totalDisputes}`);
  sections.push(`Win Rate,${summary.winRate}%`);
  sections.push(`Avg Determination Amount,$${summary.avgDetermination.toLocaleString()}`);
  sections.push(`Avg Days to Close,${summary.avgDaysToClose}`);
  sections.push("");

  // Section 2: Volume by Month
  sections.push("SECTION: Dispute Volume by Month");
  sections.push("Month,Open Negotiation,IDR Active,Closed,Ineligible,Total");
  summary.byMonth.forEach(r => {
    sections.push([r.month, r.open_negotiation, r.idr_active, r.closed, r.ineligible,
      r.open_negotiation + r.idr_active + r.closed + r.ineligible].map(esc).join(","));
  });
  sections.push("");

  // Section 3: Financial Summary
  sections.push("SECTION: Financial Summary by Service Type");
  sections.push("Service Type,Avg Billed,Avg QPA,Avg Determination,QPA vs Det Delta");
  summary.financialByServiceType.forEach(r => {
    const delta = r.avgQPA > 0 && r.avgDetermination > 0 ? r.avgDetermination - r.avgQPA : null;
    sections.push([r.serviceType, r.avgBilled > 0 ? r.avgBilled : "", r.avgQPA > 0 ? r.avgQPA : "",
      r.avgDetermination > 0 ? r.avgDetermination : "", delta != null ? delta : ""].map(esc).join(","));
  });
  sections.push("");

  // Section 4: Outcome Analysis
  sections.push("SECTION: Outcome Analysis by Month");
  sections.push("Month,Won,Lost,Pending,Win Rate,Determination Rate");
  summary.outcomeByMonth.forEach(r => {
    const closed = r.won + r.lost;
    const total = closed + r.pending;
    sections.push([r.month, r.won, r.lost, r.pending,
      closed > 0 ? `${Math.round((r.won / closed) * 100)}%` : "",
      total > 0 ? `${Math.round((closed / total) * 100)}%` : ""].map(esc).join(","));
  });
  sections.push("");

  // Section 5: Timeline Compliance
  sections.push("SECTION: Timeline Compliance");
  sections.push("Step,Avg Days,Statutory Limit (days)");
  summary.avgDaysByStep.forEach(r => {
    const limit = r.step.includes("Step 1") ? 30 : r.step.includes("Step 2") || r.step.includes("Step 3") ? 4 : r.step.includes("Step 4") ? 3 : 10;
    sections.push([r.step, r.avgDays > 0 ? r.avgDays : "", limit].map(esc).join(","));
  });
  sections.push("");

  // Section 6: Full Dispute List
  sections.push("SECTION: Dispute List");
  sections.push([
    "Reference #", "Status", "Current Step", "Service Type", "Service Date",
    "Initiating Party", "Responding Party", "Billed Amount", "QPA Amount",
    "Determination Amount", "Patient State", "Facility State",
    "Open Neg. Deadline", "Offer Sub. Deadline", "Payment Deadline",
    "Created At", "Closed At",
  ].map(esc).join(","));
  disputes.forEach(d => {
    sections.push([
      d.referenceNumber,
      (d.status ?? "").replace(/_/g, " "),
      (d.currentStep ?? "").replace(/^STEP_\d+_/, "").replace(/_/g, " ").toLowerCase(),
      (d.serviceType ?? "").replace(/_/g, " "),
      fmt(d.serviceDate),
      d.initiatingPartyName,
      d.respondingPartyName ?? "",
      money(d.billedAmount),
      money(d.qpaAmount),
      money(d.determinationAmount),
      d.patientState ?? "",
      d.facilityState ?? "",
      fmt(d.openNegotiationDeadline),
      fmt(d.offerSubmissionDeadline),
      fmt(d.paymentDeadline),
      fmt(d.createdAt),
      fmt(d.closedAt),
    ].map(esc).join(","));
  });

  return sections.join("\n");
}
