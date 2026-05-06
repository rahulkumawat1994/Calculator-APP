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
