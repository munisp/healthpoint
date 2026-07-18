/**
 * HealthPoint IDR — Reports PDF & CSV Export
 * Generates a formatted multi-section PDF report and CSV export from live DB data.
 * Supports an optional AI-generated executive summary prepended as the first section.
 */
import PDFDocument from "pdfkit";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ReportMetrics {
  totalDisputes: number;
  closed: number;
  winRate: number;
  avgDetermination: number;
  avgDaysToClose: number;
  totalBilled: number;
  totalQPA: number;
  inProgress: number;
  ineligible: number;
}

export interface ReportData {
  dateRangeLabel: string;
  generatedAt: string;
  executiveSummary?: string;
  metrics: ReportMetrics;
  byMonth: Array<{ month: string; open_negotiation: number; idr_active: number; closed: number; ineligible: number }>;
  financialByServiceType: Array<{ serviceType: string; avgBilled: number; avgQPA: number; avgDetermination: number }>;
  outcomeByMonth: Array<{ month: string; won: number; lost: number; pending: number }>;
  avgDaysByStep: Array<{ step: string; avgDays: number }>;
  byServiceType: Array<{ type: string; count: number }>;
  disputes: Array<{
    referenceNumber: string;
    status: string;
    serviceType: string;
    initiatingPartyName: string;
    respondingPartyName?: string | null;
    billedAmount?: string | null;
    qpaAmount?: string | null;
    determinationAmount?: string | null;
    createdAt?: Date | null;
    closedAt?: Date | null;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BRAND_BLUE = "#1d4ed8";
const BRAND_DARK = "#1e293b";
const GRAY = "#64748b";
const LIGHT_GRAY = "#f1f5f9";
const TABLE_HEADER_BG = "#e2e8f0";

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function drawPageHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 56).fill(BRAND_BLUE);
  doc.fillColor("#ffffff").fontSize(16).font("Helvetica-Bold").text("HealthPoint IDR", 40, 14);
  doc.fillColor("#93c5fd").fontSize(9).font("Helvetica").text("NSA No Surprises Act Platform", 40, 33);
  doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold").text(title, 200, 14, { align: "center", width: doc.page.width - 400 });
  doc.fillColor("#bfdbfe").fontSize(9).font("Helvetica").text(subtitle, 200, 33, { align: "center", width: doc.page.width - 400 });
  doc.fillColor(BRAND_DARK);
}

function drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number, totalPages: number) {
  const y = doc.page.height - 28;
  doc.rect(0, y - 4, doc.page.width, 32).fill("#f8fafc");
  doc.fillColor(GRAY).fontSize(8).font("Helvetica")
    .text(`CONFIDENTIAL — HealthPoint IDR Platform`, 40, y + 2)
    .text(`Page ${pageNum} of ${totalPages}`, 0, y + 2, { align: "right", width: doc.page.width - 40 });
  doc.fillColor(BRAND_DARK);
}

function tableRow(doc: PDFKit.PDFDocument, y: number, cols: string[], widths: number[], startX: number, isHeader = false, isAlt = false) {
  const rowH = 18;
  if (isHeader) {
    doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), rowH).fill(TABLE_HEADER_BG);
  } else if (isAlt) {
    doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), rowH).fill(LIGHT_GRAY);
  }
  let x = startX;
  cols.forEach((col, i) => {
    doc.fillColor(isHeader ? BRAND_DARK : GRAY)
      .fontSize(isHeader ? 8 : 7.5)
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .text(col, x + 4, y + 4, { width: widths[i] - 8, ellipsis: true, lineBreak: false });
    x += widths[i];
  });
  doc.fillColor(BRAND_DARK);
  return y + rowH;
}

// ─── PDF Generator ────────────────────────────────────────────────────────────
export async function generateReportsPDF(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const contentX = 40;
    const contentW = pageW - 80;

    // ── PAGE 1: Executive Summary (if provided) or Cover ──────────────────────
    if (data.executiveSummary) {
      drawPageHeader(doc, "Executive Summary", data.dateRangeLabel);

      // Generated date
      doc.fillColor(GRAY).fontSize(8).font("Helvetica")
        .text(`Generated: ${new Date(data.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, contentX, 70, { align: "right", width: contentW });

      // AI badge
      doc.rect(contentX, 84, 120, 18).fill("#dbeafe");
      doc.fillColor(BRAND_BLUE).fontSize(8).font("Helvetica-Bold")
        .text("✦  AI-Generated Analysis", contentX + 6, 89);

      // Summary text
      doc.fillColor(BRAND_DARK).fontSize(10).font("Helvetica")
        .text(data.executiveSummary, contentX, 114, { width: contentW, lineGap: 4, paragraphGap: 8 });

      // KPI strip at bottom of executive summary page
      const kpiY = Math.min(doc.y + 20, doc.page.height - 120);
      const kpis = [
        { label: "Total Disputes", value: String(data.metrics.totalDisputes) },
        { label: "Win Rate", value: `${data.metrics.winRate}%` },
        { label: "Avg. Determination", value: fmt$(data.metrics.avgDetermination) },
        { label: "Avg. Days to Close", value: `${data.metrics.avgDaysToClose}d` },
      ];
      const kpiW = contentW / kpis.length;
      doc.rect(contentX, kpiY, contentW, 52).fill("#eff6ff").stroke("#bfdbfe");
      kpis.forEach((kpi, i) => {
        const kx = contentX + i * kpiW + kpiW / 2;
        doc.fillColor(BRAND_BLUE).fontSize(16).font("Helvetica-Bold")
          .text(kpi.value, kx - kpiW / 2 + 4, kpiY + 8, { width: kpiW - 8, align: "center" });
        doc.fillColor(GRAY).fontSize(7.5).font("Helvetica")
          .text(kpi.label, kx - kpiW / 2 + 4, kpiY + 30, { width: kpiW - 8, align: "center" });
      });

      doc.addPage();
    }

    // ── PAGE: KPI Cover ────────────────────────────────────────────────────────
    drawPageHeader(doc, "IDR Performance Report", data.dateRangeLabel);

    doc.fillColor(GRAY).fontSize(8).font("Helvetica")
      .text(`Generated: ${new Date(data.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, contentX, 70, { align: "right", width: contentW });

    // 8-cell KPI grid
    const kpiGrid = [
      { label: "Total Disputes", value: String(data.metrics.totalDisputes), color: BRAND_BLUE },
      { label: "Closed / Resolved", value: String(data.metrics.closed), color: "#16a34a" },
      { label: "In Progress", value: String(data.metrics.inProgress), color: "#d97706" },
      { label: "Ineligible", value: String(data.metrics.ineligible), color: "#dc2626" },
      { label: "Win Rate", value: `${data.metrics.winRate}%`, color: BRAND_BLUE },
      { label: "Avg. Determination", value: fmt$(data.metrics.avgDetermination), color: "#16a34a" },
      { label: "Avg. Days to Close", value: `${data.metrics.avgDaysToClose}d`, color: "#d97706" },
      { label: "Total Billed", value: fmt$(data.metrics.totalBilled), color: BRAND_DARK },
    ];
    const cellW = contentW / 4;
    const cellH = 56;
    kpiGrid.forEach((kpi, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const kx = contentX + col * cellW;
      const ky = 86 + row * (cellH + 8);
      doc.rect(kx + 2, ky, cellW - 4, cellH).fill("#f8fafc").stroke("#e2e8f0");
      doc.fillColor(kpi.color).fontSize(20).font("Helvetica-Bold")
        .text(kpi.value, kx + 4, ky + 8, { width: cellW - 8, align: "center" });
      doc.fillColor(GRAY).fontSize(8).font("Helvetica")
        .text(kpi.label, kx + 4, ky + 34, { width: cellW - 8, align: "center" });
    });

    // Service type breakdown
    let y = 86 + 2 * (cellH + 8) + 16;
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold").text("Dispute Volume by Service Type", contentX, y);
    y += 16;
    const stCols = ["Service Type", "Count", "% of Total"];
    const stWidths = [240, 80, 80];
    y = tableRow(doc, y, stCols, stWidths, contentX, true);
    data.byServiceType.slice(0, 12).forEach((row, i) => {
      const pct = data.metrics.totalDisputes > 0 ? ((row.count / data.metrics.totalDisputes) * 100).toFixed(1) : "0.0";
      y = tableRow(doc, y, [row.type.replace(/_/g, " "), String(row.count), `${pct}%`], stWidths, contentX, false, i % 2 === 1);
    });

    doc.addPage();

    // ── PAGE: Volume by Month ──────────────────────────────────────────────────
    drawPageHeader(doc, "Dispute Volume by Month", data.dateRangeLabel);
    y = 76;
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold").text("Monthly Dispute Volume", contentX, y);
    y += 16;
    const volCols = ["Month", "Open Negotiation", "IDR Active", "Closed", "Ineligible", "Total"];
    const volWidths = [90, 90, 80, 70, 80, 60];
    y = tableRow(doc, y, volCols, volWidths, contentX, true);
    data.byMonth.forEach((row, i) => {
      const total = row.open_negotiation + row.idr_active + row.closed + row.ineligible;
      y = tableRow(doc, y, [row.month, String(row.open_negotiation), String(row.idr_active), String(row.closed), String(row.ineligible), String(total)], volWidths, contentX, false, i % 2 === 1);
    });

    doc.addPage();

    // ── PAGE: Financial Summary ────────────────────────────────────────────────
    drawPageHeader(doc, "Financial Summary by Service Type", data.dateRangeLabel);
    y = 76;
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold").text("Average Amounts by Service Type", contentX, y);
    y += 16;
    const finCols = ["Service Type", "Avg. Billed", "Avg. QPA", "Avg. Determination", "QPA vs Det."];
    const finWidths = [160, 80, 80, 100, 80];
    y = tableRow(doc, y, finCols, finWidths, contentX, true);
    data.financialByServiceType.forEach((row, i) => {
      const delta = row.avgDetermination - row.avgQPA;
      const deltaStr = `${delta >= 0 ? "+" : ""}${fmt$(delta)}`;
      y = tableRow(doc, y, [row.serviceType.replace(/_/g, " "), fmt$(row.avgBilled), fmt$(row.avgQPA), fmt$(row.avgDetermination), deltaStr], finWidths, contentX, false, i % 2 === 1);
    });

    // Financial totals
    y += 12;
    doc.rect(contentX, y, contentW, 28).fill("#eff6ff");
    doc.fillColor(BRAND_BLUE).fontSize(9).font("Helvetica-Bold")
      .text(`Total Billed: ${fmt$(data.metrics.totalBilled)}   |   Total QPA Benchmark: ${fmt$(data.metrics.totalQPA)}   |   Avg. Determination: ${fmt$(data.metrics.avgDetermination)}`, contentX + 8, y + 8, { width: contentW - 16 });

    doc.addPage();

    // ── PAGE: Outcome Analysis ─────────────────────────────────────────────────
    drawPageHeader(doc, "Outcome Analysis", data.dateRangeLabel);
    y = 76;
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold").text("Monthly Outcome Breakdown", contentX, y);
    y += 16;
    const outCols = ["Month", "Won", "Lost", "Pending", "Win Rate %", "Det. Rate %"];
    const outWidths = [90, 70, 70, 70, 80, 90];
    y = tableRow(doc, y, outCols, outWidths, contentX, true);
    data.outcomeByMonth.forEach((row, i) => {
      const total = row.won + row.lost + row.pending;
      const winPct = (row.won + row.lost) > 0 ? ((row.won / (row.won + row.lost)) * 100).toFixed(1) : "—";
      const detPct = total > 0 ? (((row.won + row.lost) / total) * 100).toFixed(1) : "—";
      y = tableRow(doc, y, [row.month, String(row.won), String(row.lost), String(row.pending), `${winPct}%`, `${detPct}%`], outWidths, contentX, false, i % 2 === 1);
    });

    doc.addPage();

    // ── PAGE: Timeline Compliance ──────────────────────────────────────────────
    drawPageHeader(doc, "Timeline Compliance", data.dateRangeLabel);
    y = 76;
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold").text("Average Days per IDR Step vs. Statutory Limit", contentX, y);
    y += 16;
    const tlCols = ["IDR Step", "Avg. Days", "Statutory Limit", "Status"];
    const tlWidths = [260, 80, 100, 80];
    y = tableRow(doc, y, tlCols, tlWidths, contentX, true);
    data.avgDaysByStep.forEach((row, i) => {
      const limit = 30;
      const status = row.avgDays === 0 ? "No data" : row.avgDays <= limit ? "✓ On time" : "⚠ Overdue";
      y = tableRow(doc, y, [row.step, row.avgDays === 0 ? "—" : String(row.avgDays), String(limit), status], tlWidths, contentX, false, i % 2 === 1);
    });

    doc.addPage();

    // ── PAGE(S): Dispute List ──────────────────────────────────────────────────
    drawPageHeader(doc, "Dispute List", data.dateRangeLabel);
    y = 76;
    const maxRows = 500;
    const listDisputes = data.disputes.slice(0, maxRows);
    doc.fillColor(BRAND_DARK).fontSize(11).font("Helvetica-Bold")
      .text(`All Disputes (${listDisputes.length}${data.disputes.length > maxRows ? ` of ${data.disputes.length} — truncated` : ""})`, contentX, y);
    y += 16;
    const listCols = ["Ref #", "Status", "Service Type", "Initiating Party", "Billed", "QPA", "Det.", "Filed"];
    const listWidths = [72, 68, 80, 100, 52, 52, 52, 58];
    y = tableRow(doc, y, listCols, listWidths, contentX, true);
    listDisputes.forEach((d, i) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        drawPageHeader(doc, "Dispute List (cont.)", data.dateRangeLabel);
        y = 76;
        y = tableRow(doc, y, listCols, listWidths, contentX, true);
      }
      y = tableRow(doc, y, [
        d.referenceNumber,
        (d.status ?? "").replace(/_/g, " "),
        (d.serviceType ?? "").replace(/_/g, " "),
        d.initiatingPartyName,
        d.billedAmount != null ? fmt$(Number(d.billedAmount)) : "—",
        d.qpaAmount != null ? fmt$(Number(d.qpaAmount)) : "—",
        d.determinationAmount != null ? fmt$(Number(d.determinationAmount)) : "—",
        d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—",
      ], listWidths, contentX, false, i % 2 === 1);
    });

    // ── Finalize: add page footers ─────────────────────────────────────────────
    const totalPages = (doc as any)._pageBuffer?.length ?? 1;
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }

    doc.end();
  });
}

// ─── CSV Generator ────────────────────────────────────────────────────────────
export function generateReportsCSV(data: ReportData): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cols: unknown[]) => cols.map(esc).join(",");

  const sections: string[] = [];

  // Section 0: Executive Summary (if present)
  if (data.executiveSummary) {
    sections.push([
      "EXECUTIVE SUMMARY",
      `"Report Period: ${data.dateRangeLabel}"`,
      `"Generated: ${new Date(data.generatedAt).toLocaleDateString()}"`,
      "",
      `"${data.executiveSummary.replace(/"/g, '""')}"`,
      "",
    ].join("\n"));
  }

  // Section 1: KPI Summary
  sections.push([
    "KPI SUMMARY",
    row("Metric", "Value"),
    row("Total Disputes", data.metrics.totalDisputes),
    row("Closed / Resolved", data.metrics.closed),
    row("In Progress", data.metrics.inProgress),
    row("Ineligible", data.metrics.ineligible),
    row("Win Rate (%)", data.metrics.winRate),
    row("Avg. Determination ($)", data.metrics.avgDetermination),
    row("Avg. Days to Close", data.metrics.avgDaysToClose),
    row("Total Billed ($)", data.metrics.totalBilled),
    row("Total QPA ($)", data.metrics.totalQPA),
    "",
  ].join("\n"));

  // Section 2: Volume by Month
  sections.push([
    "DISPUTE VOLUME BY MONTH",
    row("Month", "Open Negotiation", "IDR Active", "Closed", "Ineligible", "Total"),
    ...data.byMonth.map(r => row(r.month, r.open_negotiation, r.idr_active, r.closed, r.ineligible, r.open_negotiation + r.idr_active + r.closed + r.ineligible)),
    "",
  ].join("\n"));

  // Section 3: Financial Summary
  sections.push([
    "FINANCIAL SUMMARY BY SERVICE TYPE",
    row("Service Type", "Avg. Billed ($)", "Avg. QPA ($)", "Avg. Determination ($)", "QPA vs Det. ($)"),
    ...data.financialByServiceType.map(r => row(r.serviceType.replace(/_/g, " "), r.avgBilled, r.avgQPA, r.avgDetermination, r.avgDetermination - r.avgQPA)),
    "",
  ].join("\n"));

  // Section 4: Outcome Analysis
  sections.push([
    "OUTCOME ANALYSIS BY MONTH",
    row("Month", "Won", "Lost", "Pending", "Win Rate (%)", "Determination Rate (%)"),
    ...data.outcomeByMonth.map(r => {
      const total = r.won + r.lost + r.pending;
      const winPct = (r.won + r.lost) > 0 ? ((r.won / (r.won + r.lost)) * 100).toFixed(1) : "";
      const detPct = total > 0 ? (((r.won + r.lost) / total) * 100).toFixed(1) : "";
      return row(r.month, r.won, r.lost, r.pending, winPct, detPct);
    }),
    "",
  ].join("\n"));

  // Section 5: Dispute List
  sections.push([
    "DISPUTE LIST",
    row("Reference #", "Status", "Service Type", "Initiating Party", "Responding Party", "Billed ($)", "QPA ($)", "Determination ($)", "Filed", "Closed"),
    ...data.disputes.slice(0, 10000).map(d => row(
      d.referenceNumber,
      (d.status ?? "").replace(/_/g, " "),
      (d.serviceType ?? "").replace(/_/g, " "),
      d.initiatingPartyName,
      d.respondingPartyName ?? "",
      d.billedAmount != null ? Number(d.billedAmount).toFixed(2) : "",
      d.qpaAmount != null ? Number(d.qpaAmount).toFixed(2) : "",
      d.determinationAmount != null ? Number(d.determinationAmount).toFixed(2) : "",
      d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "",
      d.closedAt ? new Date(d.closedAt).toLocaleDateString() : "",
    )),
  ].join("\n"));

  return sections.join("\n");
}
