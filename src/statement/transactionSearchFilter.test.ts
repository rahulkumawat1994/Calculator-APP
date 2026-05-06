import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { filterStatementRowsByTransactionTerms, parseTransactionSearchTerms } from "./transactionSearchFilter";

const row = (transaction: string): StatementWdDpRow => ({
  page: 1,
  txnDate: "",
  transaction,
  withdrawals: "",
  deposits: "",
});

describe("parseTransactionSearchTerms", () => {
  it("splits on commas and trims", () => {
    expect(parseTransactionSearchTerms("BHOOPENDRA, BABU, AJAY")).toEqual([
      "bhoopendra",
      "babu",
      "ajay",
    ]);
  });

  it("splits on semicolons and newlines", () => {
    expect(parseTransactionSearchTerms("a;b\nc")).toEqual(["a", "b", "c"]);
  });

  it("returns empty when blank", () => {
    expect(parseTransactionSearchTerms("  ,  , ")).toEqual([]);
  });
});

describe("filterStatementRowsByTransactionTerms", () => {
  it("returns all rows when no terms", () => {
    const rows = [row("UPI/BHOOPENDRA"), row("Other")];
    expect(filterStatementRowsByTransactionTerms(rows, [])).toEqual(rows);
  });

  it("matches any term (OR)", () => {
    const rows = [row("UPI/BHOOPENDRA"), row("BABU CASH"), row("none")];
    const t = parseTransactionSearchTerms("BHOOPENDRA, BABU");
    expect(filterStatementRowsByTransactionTerms(rows, t).map((r) => r.transaction)).toEqual([
      "UPI/BHOOPENDRA",
      "BABU CASH",
    ]);
  });

  it("is case-insensitive", () => {
    const rows = [row("UPI/babu/pay")];
    const terms = parseTransactionSearchTerms("BABU");
    expect(filterStatementRowsByTransactionTerms(rows, terms)).toHaveLength(1);
  });
});
