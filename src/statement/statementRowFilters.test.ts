import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { parseTransactionSearchTerms } from "./transactionSearchFilter";
import { filterStatementVisibleRows } from "./statementRowFilters";

const row = (txnDate: string, transaction: string): StatementWdDpRow => ({
  page: 1,
  txnDate,
  transaction,
  withdrawals: "",
  deposits: "",
});

describe("filterStatementVisibleRows", () => {
  it("applies transaction filter then date range", () => {
    const rows: StatementWdDpRow[] = [
      row("01/01/2025", "UPI A"),
      row("15/02/2025", "UPI B"),
      row("01/01/2025", "Cash"),
    ];
    const terms = parseTransactionSearchTerms("UPI");
    const out = filterStatementVisibleRows(rows, {
      transactionTermsLower: terms,
      dateFrom: "2025-02-01",
      dateTo: "",
    });
    expect(out.map((r) => r.transaction)).toEqual(["UPI B"]);
  });
});
