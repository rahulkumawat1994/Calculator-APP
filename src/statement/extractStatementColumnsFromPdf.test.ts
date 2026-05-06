import { describe, expect, it } from "vitest";
import {
  lineLooksLikeClosingBalanceLine,
  lineLooksLikeOpeningBalanceLine,
  lineLooksLikeStatementColumnHeader,
} from "./extractStatementColumnsFromPdf";

describe("lineLooksLikeClosingBalanceLine", () => {
  it("matches closing balance label", () => {
    expect(lineLooksLikeClosingBalanceLine("Closing Balance")).toBe(true);
  });

  it("matches with amount on same line", () => {
    expect(lineLooksLikeClosingBalanceLine("Closing Balance 12,345.67")).toBe(true);
  });

  it("rejects narration", () => {
    expect(lineLooksLikeClosingBalanceLine("UPI/P2M/GROWW")).toBe(false);
  });

  it("rejects closing balance only as substring", () => {
    expect(lineLooksLikeClosingBalanceLine("Note about closing balance transfer")).toBe(false);
  });
});

describe("lineLooksLikeStatementColumnHeader", () => {
  it("matches typical bank header (one line)", () => {
    const s =
      "Txn Date Transaction Withdrawals Deposits Balance Other Information";
    expect(lineLooksLikeStatementColumnHeader(s)).toBe(true);
  });

  it("rejects random narration", () => {
    expect(lineLooksLikeStatementColumnHeader("UPI/P2M/GROWW INVEST")).toBe(false);
  });
});

describe("lineLooksLikeOpeningBalanceLine", () => {
  it("matches opening balance label", () => {
    expect(lineLooksLikeOpeningBalanceLine("Opening Balance")).toBe(true);
  });

  it("rejects non-opening narration", () => {
    expect(lineLooksLikeOpeningBalanceLine("UPI/P2M/GROWW INVEST")).toBe(false);
  });
});
