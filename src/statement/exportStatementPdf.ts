import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { formatStatementInrMoney, parseStatementMoneyAmount, sumStatementWdDpRows } from "./statementMoneyParse";

const FOOTER_RESERVE_MM = 22;

function profitLossLabel(net: number): string {
  if (net > 0) return "Profit";
  if (net < 0) return "Loss";
  return "Even";
}

export type StatementPdfExportSection = {
  source: "firebase" | "local";
  fileName: string;
  rows: StatementWdDpRow[];
};

export type StatementPdfExportInput = {
  generatedAt: Date;
  transactionFilterRaw: string | null;
  dateRangeSummary: string | null;
  sections: StatementPdfExportSection[];
};

type MoneyPair = { withdrawals: number; deposits: number };

class ExportPdfPageTracker {
  private readonly perPage = new Map<number, MoneyPair>();
  private readonly seenRows = new Set<string>();

  addRow(pageNumber: number, rowKey: string, withdrawals: number, deposits: number) {
    if (this.seenRows.has(rowKey)) return;
    this.seenRows.add(rowKey);
    const bucket = this.perPage.get(pageNumber) ?? { withdrawals: 0, deposits: 0 };
    bucket.withdrawals += withdrawals;
    bucket.deposits += deposits;
    this.perPage.set(pageNumber, bucket);
  }

  pageTotal(pageNumber: number): MoneyPair {
    return this.perPage.get(pageNumber) ?? { withdrawals: 0, deposits: 0 };
  }

  runningTotalThrough(pageNumber: number): MoneyPair {
    let withdrawals = 0;
    let deposits = 0;
    for (const [page, sums] of this.perPage) {
      if (page <= pageNumber) {
        withdrawals += sums.withdrawals;
        deposits += sums.deposits;
      }
    }
    return { withdrawals, deposits };
  }

  hasRowsOnPage(pageNumber: number): boolean {
    const sums = this.perPage.get(pageNumber);
    return sums != null && (sums.withdrawals > 0 || sums.deposits > 0);
  }
}

function lastAutoTableBottom(doc: jsPDF): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return typeof last?.finalY === "number" ? last.finalY : 0;
}

function ensureSpace(doc: jsPDF, y: number, neededMm: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + neededMm > pageH - FOOTER_RESERVE_MM) {
    doc.addPage();
    return 18;
  }
  return y;
}

const TABLE_STYLES = {
  fontSize: 7,
  cellPadding: 1.2,
  textColor: [15, 23, 42] as [number, number, number],
  lineColor: [226, 232, 240] as [number, number, number],
  lineWidth: 0.1,
};

const TABLE_HEAD_STYLES = {
  fillColor: [241, 245, 249] as [number, number, number],
  textColor: [71, 85, 105] as [number, number, number],
  fontStyle: "bold" as const,
  fontSize: 7,
};

const TRANSACTION_COLUMN_STYLES = {
  0: { cellWidth: 9, halign: "right" as const },
  1: { cellWidth: 10, halign: "center" as const },
  2: { cellWidth: 22 },
  3: { cellWidth: "auto" as const },
  4: { cellWidth: 24, halign: "right" as const },
  5: { cellWidth: 24, halign: "right" as const },
};

function drawExportPageFooters(
  doc: jsPDF,
  tracker: ExportPdfPageTracker,
  margin: number,
  finalTotals: MoneyPair & { net: number },
) {
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    if (!tracker.hasRowsOnPage(page)) continue;
    doc.setPage(page);
    const pageH = doc.internal.pageSize.getHeight();
    const pageTotal = tracker.pageTotal(page);
    const isLastPage = page === totalPages;
    const running = tracker.runningTotalThrough(page);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);

    let y = pageH - FOOTER_RESERVE_MM + 4;
    doc.text(
      `Page ${page} total — Withdrawals ${formatStatementInrMoney(pageTotal.withdrawals)} · Deposits ${formatStatementInrMoney(pageTotal.deposits)}`,
      margin,
      y,
    );
    y += 4;

    if (isLastPage) {
      doc.text(
        `Final total — Withdrawals ${formatStatementInrMoney(finalTotals.withdrawals)} · Deposits ${formatStatementInrMoney(finalTotals.deposits)} · Net ${formatStatementInrMoney(finalTotals.net)} (${profitLossLabel(finalTotals.net)})`,
        margin,
        y,
      );
    } else {
      doc.text(
        `Running total — Withdrawals ${formatStatementInrMoney(running.withdrawals)} · Deposits ${formatStatementInrMoney(running.deposits)}`,
        margin,
        y,
      );
    }
  }
}

/** Builds a PDF matching visible rows and triggers a browser download. */
export function downloadStatementExtractPdf(input: StatementPdfExportInput): void {
  const { generatedAt, transactionFilterRaw, dateRangeSummary, sections } = input;
  if (sections.length === 0) return;

  const filtersActive =
    Boolean(transactionFilterRaw?.trim()) || Boolean(dateRangeSummary?.trim());

  let finalWithdrawals = 0;
  let finalDeposits = 0;
  for (const sec of sections) {
    const sums = sumStatementWdDpRows(sec.rows);
    finalWithdrawals += sums.withdrawals;
    finalDeposits += sums.deposits;
  }
  const finalTotals = {
    withdrawals: finalWithdrawals,
    deposits: finalDeposits,
    net: finalDeposits - finalWithdrawals,
  };

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  const tracker = new ExportPdfPageTracker();
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(26, 58, 92);
  doc.text("Statement extract", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated ${generatedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    margin,
    y,
  );
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

  for (let s = 0; s < sections.length; s += 1) {
    const sec = sections[s]!;
    const rowSums = sumStatementWdDpRows(sec.rows);
    const net = rowSums.deposits - rowSums.withdrawals;
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
    doc.text(
      `${sec.rows.length} row${sec.rows.length === 1 ? "" : "s"} · Deposits ${formatStatementInrMoney(rowSums.deposits)} · Withdrawals ${formatStatementInrMoney(rowSums.withdrawals)} · Net ${formatStatementInrMoney(net)}`,
      margin,
      y,
    );
    y += 6;

    const rowKeys = sec.rows.map((row, index) => `${sec.fileName}|${s}|${index}|${row.page}|${row.transaction}`);
    const rowAmounts = sec.rows.map((row) => ({
      withdrawals: parseStatementMoneyAmount(row.withdrawals),
      deposits: parseStatementMoneyAmount(row.deposits),
    }));

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: FOOTER_RESERVE_MM },
      head: [["#", "Pg", "Txn date", "Transaction", "Withdrawals", "Deposits"]],
      body: sec.rows.map((r, index) => [
        String(index + 1),
        String(r.page),
        r.txnDate || "—",
        r.transaction || "—",
        r.withdrawals || "—",
        r.deposits || "—",
      ]),
      styles: TABLE_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: TRANSACTION_COLUMN_STYLES,
      showHead: "everyPage",
      tableLineColor: [226, 232, 240],
      tableLineWidth: 0.1,
      didDrawCell: (data: CellHookData) => {
        if (data.section !== "body" || data.column.index !== 0) return;
        const amt = rowAmounts[data.row.index];
        const key = rowKeys[data.row.index];
        if (!amt || !key) return;
        tracker.addRow(data.pageNumber, key, amt.withdrawals, amt.deposits);
      },
    });

    y = lastAutoTableBottom(doc) + (s < sections.length - 1 ? 10 : 6);
  }

  drawExportPageFooters(doc, tracker, margin, finalTotals);

  const stamp = generatedAt.toISOString().slice(0, 10);
  const filterSuffix = filtersActive ? "-filtered" : "";
  doc.save(`statement-extract-${stamp}${filterSuffix}.pdf`);
}
