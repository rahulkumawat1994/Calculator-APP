import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import {
  buildStatementTableItems,
  describeStatementRowMoney,
  parseStatementMoneyAmount,
  sumStatementWdDpRows,
  sumStatementWdDpRowsByPage,
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

describe("sumStatementWdDpRowsByPage", () => {
  it("groups totals by PDF page number", () => {
    const rows: StatementWdDpRow[] = [
      { page: 1, txnDate: "", transaction: "a", withdrawals: "100", deposits: "" },
      { page: 2, txnDate: "", transaction: "b", withdrawals: "", deposits: "50" },
      { page: 1, txnDate: "", transaction: "c", withdrawals: "", deposits: "25" },
    ];
    expect(sumStatementWdDpRowsByPage(rows)).toEqual([
      { page: 1, withdrawals: 100, deposits: 25 },
      { page: 2, withdrawals: 0, deposits: 50 },
    ]);
  });
});

describe("buildStatementTableItems", () => {
  it("inserts a page total after each page group", () => {
    const rows: StatementWdDpRow[] = [
      { page: 1, txnDate: "", transaction: "UPI/a", withdrawals: "10", deposits: "" },
      { page: 2, txnDate: "", transaction: "UPI/b", withdrawals: "", deposits: "20" },
      { page: 1, txnDate: "", transaction: "UPI/c", withdrawals: "", deposits: "5" },
    ];
    const items = buildStatementTableItems(rows);
    expect(items.map((i) => i.kind)).toEqual(["row", "row", "pageTotal", "row", "pageTotal"]);
    const page1Total = items.find((i) => i.kind === "pageTotal" && i.page === 1);
    expect(page1Total).toMatchObject({ withdrawals: 10, deposits: 5 });
  });
  it("returns only page totals when requested", () => {
    const rows: StatementWdDpRow[] = [
      { page: 1, txnDate: "", transaction: "UPI/a", withdrawals: "10", deposits: "" },
      { page: 2, txnDate: "", transaction: "UPI/b", withdrawals: "", deposits: "20" },
      { page: 1, txnDate: "", transaction: "UPI/c", withdrawals: "", deposits: "5" },
    ];
    const items = buildStatementTableItems(rows, { onlyPageTotals: true });
    expect(items.every((i) => i.kind === "pageTotal")).toBe(true);
    expect(items.length).toBe(2);
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
