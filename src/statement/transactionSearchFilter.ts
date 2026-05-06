import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";

/** Split user input on commas, semicolons, or newlines; trim; drop empties; lowercase for matching. */
export function parseTransactionSearchTerms(raw: string): string[] {
  return raw
    .split(/[,;\n]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

/** OR semantics: keep a row if its Transaction contains any term (case-insensitive). Empty terms → all rows. */
export function filterStatementRowsByTransactionTerms(
  rows: StatementWdDpRow[],
  termsLower: string[],
): StatementWdDpRow[] {
  if (termsLower.length === 0) return rows;
  return rows.filter((r) => {
    const hay = r.transaction.toLowerCase();
    return termsLower.some((t) => hay.includes(t));
  });
}
