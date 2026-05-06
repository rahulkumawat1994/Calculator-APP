import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { filterStatementRowsByDateRange, isStatementDateRangeInverted } from "./statementDateRangeFilter";

const row = (txnDate: string): StatementWdDpRow => ({
  page: 1,
  txnDate,
  transaction: "x",
  withdrawals: "",
  deposits: "",
});

describe("isStatementDateRangeInverted", () => {
  it("is false when either side empty", () => {
    expect(isStatementDateRangeInverted("", "2025-01-02")).toBe(false);
    expect(isStatementDateRangeInverted("2025-01-02", "")).toBe(false);
  });

  it("detects from after to", () => {
    expect(isStatementDateRangeInverted("2025-02-01", "2025-01-01")).toBe(true);
  });
});

describe("filterStatementRowsByDateRange", () => {
  const rows = [
    row("01/01/2025"),
    row("15/01/2025"),
    row("01/02/2025"),
    row(""), // unparseable — kept
  ];

  it("returns all when no bounds", () => {
    expect(filterStatementRowsByDateRange(rows, "", "")).toEqual(rows);
  });

  it("filters by from only", () => {
    const out = filterStatementRowsByDateRange(rows, "2025-01-10", "");
    expect(out.map((r) => r.txnDate)).toEqual(["15/01/2025", "01/02/2025", ""]);
  });

  it("filters by to only", () => {
    const out = filterStatementRowsByDateRange(rows, "", "2025-01-20");
    expect(out.map((r) => r.txnDate)).toEqual(["01/01/2025", "15/01/2025", ""]);
  });

  it("filters inclusive range", () => {
    const out = filterStatementRowsByDateRange(rows, "2025-01-01", "2025-01-31");
    expect(out.map((r) => r.txnDate)).toEqual(["01/01/2025", "15/01/2025", ""]);
  });

  it("swaps inverted bounds", () => {
    const out = filterStatementRowsByDateRange(rows, "2025-01-31", "2025-01-01");
    expect(out.map((r) => r.txnDate)).toEqual(["01/01/2025", "15/01/2025", ""]);
  });
});
