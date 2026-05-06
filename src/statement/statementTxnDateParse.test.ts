import { describe, expect, it } from "vitest";
import { parseStatementTxnDate } from "./statementTxnDateParse";

describe("parseStatementTxnDate", () => {
  it("parses DD/MM/YYYY", () => {
    const d = parseStatementTxnDate("15/03/2025");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it("parses DD-MM-YYYY", () => {
    const d = parseStatementTxnDate("01-12-2024");
    expect(d!.getMonth()).toBe(11);
    expect(d!.getDate()).toBe(1);
  });

  it("parses YYYY-MM-DD", () => {
    const d = parseStatementTxnDate("2025-01-31");
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(31);
  });

  it("expands two-digit year", () => {
    const d = parseStatementTxnDate("01/01/26");
    expect(d!.getFullYear()).toBe(2026);
  });

  it("returns null for empty", () => {
    expect(parseStatementTxnDate("")).toBeNull();
    expect(parseStatementTxnDate("   ")).toBeNull();
  });

  it("returns null for impossible calendar date", () => {
    expect(parseStatementTxnDate("31/02/2025")).toBeNull();
  });
});
