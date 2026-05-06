import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { parseStatementTxnDate } from "./statementTxnDateParse";

export function htmlDateValueToStartMs(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (![y, mo, d].every((n) => Number.isFinite(n))) return null;
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt.getTime();
}

export function htmlDateValueToEndMs(value: string): number | null {
  const start = htmlDateValueToStartMs(value);
  if (start == null) return null;
  const dt = new Date(start);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
}

/** True when both bounds are set and From is strictly after To (calendar days). */
export function isStatementDateRangeInverted(dateFrom: string, dateTo: string): boolean {
  const a = htmlDateValueToStartMs(dateFrom);
  const b = htmlDateValueToStartMs(dateTo);
  if (a == null || b == null) return false;
  return a > b;
}

/**
 * Keeps rows whose Txn date falls within the inclusive range.
 * Empty strings = open bound. Unparseable Txn dates are kept (same as “unknown”).
 * If both bounds are set but From is after To, bounds are swapped to span those two days.
 */
export function filterStatementRowsByDateRange(
  rows: StatementWdDpRow[],
  dateFrom: string,
  dateTo: string,
): StatementWdDpRow[] {
  let fromMs = htmlDateValueToStartMs(dateFrom);
  let toMs = htmlDateValueToEndMs(dateTo);
  if (fromMs != null && toMs != null && fromMs > toMs) {
    const lo = htmlDateValueToStartMs(dateTo);
    const hi = htmlDateValueToEndMs(dateFrom);
    if (lo != null && hi != null) {
      fromMs = lo;
      toMs = hi;
    }
  }
  if (fromMs == null && toMs == null) return rows;

  return rows.filter((r) => {
    const parsed = parseStatementTxnDate(r.txnDate);
    if (!parsed) return true;
    const ms = parsed.getTime();
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });
}
