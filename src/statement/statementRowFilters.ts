import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { filterStatementRowsByDateRange } from "./statementDateRangeFilter";
import { filterStatementRowsByTransactionTerms } from "./transactionSearchFilter";

export type StatementVisibleRowParams = {
  transactionTermsLower: string[];
  /** `<input type="date">` value (`YYYY-MM-DD`) or empty */
  dateFrom: string;
  dateTo: string;
};

/** AND of transaction search (OR terms) and optional Txn date range. */
export function filterStatementVisibleRows(
  rows: StatementWdDpRow[],
  p: StatementVisibleRowParams,
): StatementWdDpRow[] {
  const byTerms = filterStatementRowsByTransactionTerms(rows, p.transactionTermsLower);
  return filterStatementRowsByDateRange(byTerms, p.dateFrom, p.dateTo);
}
