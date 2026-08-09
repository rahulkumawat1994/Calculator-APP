import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";

/**
 * Parse a single cell from Withdrawals / Deposits columns into a number.
 * Strips commas (Indian grouping), spaces, ₹, and leading "Rs."; ignores non-parsable text.
 */
export function parseStatementMoneyAmount(raw: string): number {
  const trimmed = raw.replace(/\u00a0/g, " ").trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return 0;
  const noGrouping = trimmed.replace(/,/g, "");
  const cleaned = noGrouping
    .replace(/[₹\s]/g, "")
    .replace(/^rs\.?/i, "")
    .trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function sumStatementWdDpRows(rows: StatementWdDpRow[]): {
  withdrawals: number;
  deposits: number;
} {
  let withdrawals = 0;
  let deposits = 0;
  for (const r of rows) {
    withdrawals += parseStatementMoneyAmount(r.withdrawals);
    deposits += parseStatementMoneyAmount(r.deposits);
  }
  return { withdrawals, deposits };
}

export type StatementPageTotals = {
  page: number;
  withdrawals: number;
  deposits: number;
};

export function sumStatementWdDpRowsByPage(rows: StatementWdDpRow[]): StatementPageTotals[] {
  const map = new Map<number, { withdrawals: number; deposits: number }>();
  for (const r of rows) {
    const bucket = map.get(r.page) ?? { withdrawals: 0, deposits: 0 };
    bucket.withdrawals += parseStatementMoneyAmount(r.withdrawals);
    bucket.deposits += parseStatementMoneyAmount(r.deposits);
    map.set(r.page, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, sums]) => ({ page, ...sums }));
}

export type StatementTableItem =
  | { kind: "row"; row: StatementWdDpRow; rowNumber: number }
  | { kind: "pageTotal"; page: number; withdrawals: number; deposits: number };

/** Visible rows grouped by PDF page with a computed total after each page. */
export function buildStatementTableItems(
  rows: StatementWdDpRow[],
  options?: { onlyPageTotals?: boolean },
): StatementTableItem[] {
  const pages = [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b);
  if (options?.onlyPageTotals) {
    return pages.map((page) => {
      const sums = sumStatementWdDpRows(rows.filter((r) => r.page === page));
      return { kind: "pageTotal", page, withdrawals: sums.withdrawals, deposits: sums.deposits };
    });
  }
  const items: StatementTableItem[] = [];
  let rowNumber = 0;
  for (const page of pages) {
    const pageRows = rows.filter((r) => r.page === page);
    for (const row of pageRows) {
      rowNumber += 1;
      items.push({ kind: "row", row, rowNumber });
    }
    const sums = sumStatementWdDpRows(pageRows);
    items.push({ kind: "pageTotal", page, withdrawals: sums.withdrawals, deposits: sums.deposits });
  }
  return items;
}

export type StatementRowMoneyKind = "withdrawal" | "deposit" | "both" | "none";

/** Parsed amounts and flow for one table row (deposits − withdrawals). */
export function describeStatementRowMoney(r: StatementWdDpRow): {
  withdrawalNum: number;
  depositNum: number;
  rowNet: number;
  kind: StatementRowMoneyKind;
} {
  const withdrawalNum = parseStatementMoneyAmount(r.withdrawals);
  const depositNum = parseStatementMoneyAmount(r.deposits);
  const rowNet = depositNum - withdrawalNum;
  let kind: StatementRowMoneyKind;
  if (withdrawalNum > 0 && depositNum > 0) kind = "both";
  else if (withdrawalNum > 0) kind = "withdrawal";
  else if (depositNum > 0) kind = "deposit";
  else kind = "none";
  return { withdrawalNum, depositNum, rowNet, kind };
}

export function formatStatementInrMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
