import { describe, expect, it } from "vitest";
import { DEFAULT_LOAN_COLUMN_ORDER } from "./loanColumns";
import { resolveLoanTableRegion } from "./extractLoanScheduleFromPdf";

type Piece = { str: string; x: number; y: number; w: number };

function line(text: string, y: number, x = 40): Piece[] {
  return text.split(/\s+/).map((str, i) => ({
    str,
    x: x + i * 80,
    y,
    w: str.length * 5,
  }));
}

describe("resolveLoanTableRegion", () => {
  it("skips loan summary and starts at schedule header", () => {
    const clusters: Piece[][] = [
      line("LOAN AMOUNT 5000000.00", 700),
      line("INTEREST RATE 8.5 PRINCIPAL OUTSTANDING", 660),
      line("INSTALLMENT NO DUE DATE EMI INTEREST PRINCIPAL BALANCE PRINCIPAL", 500),
      line("1 01-01-2026 10000.00 5000.00 5000.00 95000.00", 460),
    ];

    const region = resolveLoanTableRegion(clusters, DEFAULT_LOAN_COLUMN_ORDER);
    expect(region.dataStart).toBe(3);
    expect(region.tableTopPdfY).not.toBeNull();
  });

  it("falls back to first installment row when header is missing", () => {
    const clusters: Piece[][] = [
      line("Some narrative text without headers", 700),
      line("1 01-02-2026 10000.00 5000.00 5000.00 95000.00", 460),
    ];

    const region = resolveLoanTableRegion(clusters, DEFAULT_LOAN_COLUMN_ORDER);
    expect(region.dataStart).toBe(1);
  });
});
