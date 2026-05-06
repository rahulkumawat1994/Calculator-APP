import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";

function formatInrMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function profitLossLabel(net: number): string {
  if (net > 0) return "Profit";
  if (net < 0) return "Loss";
  return "Even";
}

export type StatementPdfExportSection = {
  source: "firebase" | "local";
  fileName: string;
  rows: StatementWdDpRow[];
  deposits: number;
  withdrawals: number;
};

export type StatementPdfExportInput = {
  generatedAt: Date;
  /** Raw transaction search text, if any (mirrors on-screen filter). */
  transactionFilterRaw: string | null;
  /** Human-readable Txn date range line, if any. */
  dateRangeSummary: string | null;
  grandTotals: { deposits: number; withdrawals: number; net: number; scopeLabel: string } | null;
  sections: StatementPdfExportSection[];
};

function lastAutoTableBottom(doc: jsPDF): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return typeof last?.finalY === "number" ? last.finalY : 0;
}

function ensureSpace(doc: jsPDF, y: number, neededMm: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  const marginBottom = 16;
  if (y + neededMm > pageH - marginBottom) {
    doc.addPage();
    return 18;
  }
  return y;
}

/** Builds a PDF matching visible (filtered) rows and triggers a browser download. */
export function downloadStatementExtractPdf(input: StatementPdfExportInput): void {
  const { generatedAt, transactionFilterRaw, dateRangeSummary, grandTotals, sections } = input;
  if (sections.length === 0) return;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(26, 58, 92);
  doc.text("Statement extract", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Generated ${generatedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`, margin, y);
  y += 5;

  if (transactionFilterRaw?.trim()) {
    const filterLines = doc.splitTextToSize(`Transaction filter: ${transactionFilterRaw.trim()}`, 180);
    doc.text(filterLines, margin, y);
    y += 4 + filterLines.length * 4;
  } else {
    doc.text("Transaction filter: none (all rows)", margin, y);
    y += 6;
  }

  if (dateRangeSummary?.trim()) {
    const drLines = doc.splitTextToSize(dateRangeSummary.trim(), 180);
    doc.text(drLines, margin, y);
    y += 4 + drLines.length * 4;
  } else {
    doc.text("Txn date range: none", margin, y);
    y += 6;
  }

  y += 2;

  if (grandTotals) {
    y = ensureSpace(doc, y, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(`${grandTotals.scopeLabel} · visible rows`, margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const netLabel = profitLossLabel(grandTotals.net);
    doc.text(
      `Deposits ${formatInrMoney(grandTotals.deposits)} · Withdrawals ${formatInrMoney(grandTotals.withdrawals)} · Net ${formatInrMoney(grandTotals.net)} (${netLabel})`,
      margin,
      y,
    );
    y += 8;
  }

  for (let s = 0; s < sections.length; s += 1) {
    const sec = sections[s]!;
    const net = sec.deposits - sec.withdrawals;
    const badge = sec.source === "firebase" ? "Firebase" : "Local PDF";
    y = ensureSpace(doc, y, 22);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const nameLines = doc.splitTextToSize(`${badge}: ${sec.fileName}`, 182);
    doc.text(nameLines, margin, y);
    y += nameLines.length * 4.5 + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const sumLine = `Deposits ${formatInrMoney(sec.deposits)} · Withdrawals ${formatInrMoney(sec.withdrawals)} · Net ${formatInrMoney(net)} (${profitLossLabel(net)}) · ${sec.rows.length} row${sec.rows.length === 1 ? "" : "s"}`;
    doc.text(sumLine, margin, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["#", "Pg", "Txn date", "Transaction", "Withdrawals", "Deposits"]],
      body: sec.rows.map((r, i) => [
        String(i + 1),
        String(r.page),
        r.txnDate || "—",
        r.transaction || "—",
        r.withdrawals || "—",
        r.deposits || "—",
      ]),
      styles: { fontSize: 7, cellPadding: 1.2, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [71, 85, 105],
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 9, halign: "right" },
        1: { cellWidth: 10, halign: "center" },
        2: { cellWidth: 22 },
        3: { cellWidth: "auto" },
        4: { cellWidth: 24, halign: "right" },
        5: { cellWidth: 24, halign: "right" },
      },
      showHead: "everyPage",
      tableLineColor: [226, 232, 240],
      tableLineWidth: 0.1,
    });

    y = lastAutoTableBottom(doc) + (s < sections.length - 1 ? 10 : 6);
  }

  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`statement-extract-${stamp}.pdf`);
}
