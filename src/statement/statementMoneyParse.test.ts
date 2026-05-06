import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import {
  describeStatementRowMoney,
  parseStatementMoneyAmount,
  sumStatementWdDpRows,
} from "./statementMoneyParse";

describe("parseStatementMoneyAmount", () => {
  it("parses comma-grouped amounts", () => {
    expect(parseStatementMoneyAmount("1,23,456.78")).toBe(123456.78);
    expect(parseStatementMoneyAmount("12,345")).toBe(12345);
  });

  it("handles rupee symbol and spaces", () => {
    expect(parseStatementMoneyAmount("₹ 1,000.50")).toBe(1000.5);
    expect(parseStatementMoneyAmount("Rs.500")).toBe(500);
  });

  it("returns 0 for empty or dash", () => {
    expect(parseStatementMoneyAmount("")).toBe(0);
    expect(parseStatementMoneyAmount("—")).toBe(0);
  });

  it("returns 0 for non-numeric junk", () => {
    expect(parseStatementMoneyAmount("NEFT")).toBe(0);
  });
});

describe("sumStatementWdDpRows", () => {
  it("sums withdrawals and deposits", () => {
    const rows: StatementWdDpRow[] = [
      { page: 1, txnDate: "", transaction: "a", withdrawals: "100", deposits: "" },
      { page: 1, txnDate: "", transaction: "b", withdrawals: "", deposits: "50.5" },
    ];
    expect(sumStatementWdDpRows(rows)).toEqual({ withdrawals: 100, deposits: 50.5 });
  });
});

describe("describeStatementRowMoney", () => {
  const row = (partial: Partial<StatementWdDpRow> & Pick<StatementWdDpRow, "withdrawals" | "deposits">) =>
    ({
      page: 1,
      txnDate: "",
      transaction: "",
      withdrawals: partial.withdrawals,
      deposits: partial.deposits,
    }) satisfies StatementWdDpRow;

  it("classifies withdrawal-only", () => {
    expect(describeStatementRowMoney(row({ withdrawals: "100", deposits: "" }))).toMatchObject({
      withdrawalNum: 100,
      depositNum: 0,
      rowNet: -100,
      kind: "withdrawal",
    });
  });

  it("classifies deposit-only", () => {
    expect(describeStatementRowMoney(row({ withdrawals: "", deposits: "200" }))).toMatchObject({
      kind: "deposit",
      rowNet: 200,
    });
  });

  it("classifies both columns", () => {
    expect(describeStatementRowMoney(row({ withdrawals: "50", deposits: "50" }))).toMatchObject({
      kind: "both",
      rowNet: 0,
    });
  });
});
