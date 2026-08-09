import { describe, expect, it } from "vitest";
import {
  clusterLineHasDateOrAmounts,
  dropEmptyStatementRows,
  hasHorizontalRuleBetween,
  isNoiseTransaction,
  isStatementRowEmpty,
  lineLooksLikeClosingBalanceLine,
  lineLooksLikeDisclaimerLine,
  lineLooksLikeOpeningBalanceLine,
  lineLooksLikePageTotalLine,
  lineLooksLikeStatementColumnHeader,
  narrationStartsNewTransaction,
  narrationLooksLikeWrappedContinuation,
  simplifyMisfitStatementRows,
  splitMergedUpiNarrations,
  splitStatementRowColumns,
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

  it("matches tran date + narration layout (withdrawal before narration)", () => {
    const s =
      "Tran Date Withdrawal Deposit Balance Alpha CHQ. NO. Narration Additional Info";
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

describe("lineLooksLikePageTotalLine", () => {
  it("matches page total label", () => {
    expect(lineLooksLikePageTotalLine("Page Total")).toBe(true);
  });

  it("matches page total with amounts", () => {
    expect(lineLooksLikePageTotalLine("Page Total 12,345.67 8,000.00")).toBe(true);
    expect(lineLooksLikePageTotalLine("Page Total 100587.00 96490.00")).toBe(true);
  });

  it("matches grand total footer", () => {
    expect(lineLooksLikePageTotalLine("Grand 4461394.2 4470312.00")).toBe(true);
    expect(lineLooksLikePageTotalLine("Grand Total")).toBe(true);
  });

  it("rejects narration containing page total as substring", () => {
    expect(lineLooksLikePageTotalLine("Payment for page total reconciliation")).toBe(false);
  });
});

describe("splitStatementRowColumns", () => {
  const withdrawalFirstLayout = {
    txnDateX: 50,
    narrativeX: 420,
    withdrawalX: 120,
    depositX: 180,
    balanceX: 240,
    alphaX: 300,
    chqX: 360,
    additionalX: 500,
    isWithdrawalBeforeNarration: true,
  };

  it("keeps narration separate from additional info and amount columns", () => {
    const zeroDeltas = {
      txnDateDeltaLeft: 0,
      txnDateDeltaRight: 0,
      transactionDeltaLeft: 0,
      transactionDeltaRight: 0,
      withdrawalDeltaLeft: 0,
      withdrawalDeltaRight: 0,
      depositDeltaLeft: 0,
      depositDeltaRight: 0,
    };
    const cols = splitStatementRowColumns(
      [
        { str: "01-01-2024", x: 50, y: 100, w: 40 },
        { str: "100.00", x: 120, y: 100, w: 30 },
        { str: "5,000.00", x: 240, y: 100, w: 40 },
        { str: "UPI/PAYMENT", x: 420, y: 100, w: 80 },
        { str: "REF123", x: 510, y: 100, w: 40 },
      ],
      withdrawalFirstLayout,
      600,
      { columnBandDeltas: zeroDeltas },
    );
    expect(cols.txnDate).toBe("01-01-2024");
    expect(cols.withdrawals).toBe("100.00");
    expect(cols.transaction).toBe("UPI/PAYMENT");
    expect(cols.transaction).not.toContain("REF123");
    expect(cols.deposits).toBe("");
  });
});

describe("clusterLineHasDateOrAmounts", () => {
  it("detects date on full line even when column slice is empty", () => {
    expect(clusterLineHasDateOrAmounts("01-02-2024 UPI/foo", "", "", "")).toBe(true);
  });

  it("detects amounts on full line", () => {
    expect(clusterLineHasDateOrAmounts("UPI/foo 1,250.00", "", "", "")).toBe(true);
  });

  it("returns false for narration-only continuation", () => {
    expect(clusterLineHasDateOrAmounts("continued narration text", "", "", "")).toBe(false);
  });
});

describe("narrationStartsNewTransaction", () => {
  it("detects new UPI row", () => {
    expect(
      narrationStartsNewTransaction("UPI/883562672391/P2V/divyak161997@okhdfcbank/DIVYA"),
    ).toBe(true);
  });

  it("detects NEFT rows", () => {
    expect(narrationStartsNewTransaction("NEFT IN::AXNGG08009316904/GOOGLE INDIA DIGITAL")).toBe(
      true,
    );
  });

  it("does not treat SERVICE continuation as a new row", () => {
    expect(narrationStartsNewTransaction("SERVICE:UTIB0000553")).toBe(false);
    expect(narrationStartsNewTransaction("S:UTIB0000553")).toBe(false);
  });

  it("rejects continuation phrase", () => {
    expect(narrationStartsNewTransaction("continued reference text")).toBe(false);
  });
});

describe("narrationLooksLikeWrappedContinuation", () => {
  it("detects SERVICE reference line", () => {
    expect(narrationLooksLikeWrappedContinuation("SERVICE:UTIB0000553")).toBe(true);
    expect(narrationLooksLikeWrappedContinuation("S:UTIB0000553")).toBe(true);
  });

  it("rejects primary narrations", () => {
    expect(narrationLooksLikeWrappedContinuation("NEFT IN::AXNGG08009316904")).toBe(false);
  });
});

describe("simplifyMisfitStatementRows", () => {
  it("merges SERVICE continuation up and uplifts amounts to the next row", () => {
    const rows = simplifyMisfitStatementRows([
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "NEFT IN::UTIBN62025121533747299/GOOGLE INDIA DIGITAL",
        withdrawals: "",
        deposits: "1525.00",
      },
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "S:UTIB0000553",
        withdrawals: "460.00",
        deposits: "",
      },
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "UPI/foo@okaxis/NEXT",
        withdrawals: "",
        deposits: "",
      },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]!.transaction).toContain("NEFT IN::");
    expect(rows[0]!.transaction).toContain("S:UTIB0000553");
    expect(rows[0]!.deposits).toBe("1525.00");
    expect(rows[0]!.withdrawals).toBe("");
    expect(rows[1]!.transaction).toContain("UPI/foo");
    expect(rows[1]!.withdrawals).toBe("460.00");
  });

  it("pairs narration-only row with following amounts", () => {
    const rows = simplifyMisfitStatementRows([
      {
        page: 1,
        txnDate: "01-01-2025",
        transaction: "NEFT IN::REF123",
        withdrawals: "",
        deposits: "",
      },
      {
        page: 1,
        txnDate: "01-01-2025",
        transaction: "",
        withdrawals: "",
        deposits: "500.00",
      },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.transaction).toBe("NEFT IN::REF123");
    expect(rows[0]!.deposits).toBe("500.00");
  });

  it("merges narration-only continuation into the row above", () => {
    const rows = simplifyMisfitStatementRows([
      {
        page: 1,
        txnDate: "01-01-2025",
        transaction: "NEFT IN::REF123",
        withdrawals: "",
        deposits: "100.00",
      },
      {
        page: 1,
        txnDate: "",
        transaction: "extra narration line",
        withdrawals: "",
        deposits: "",
      },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.transaction).toContain("extra narration line");
    expect(rows[0]!.deposits).toBe("100.00");
  });

  it("keeps separate UPI rows when narration-only is a new transaction", () => {
    const rows = simplifyMisfitStatementRows([
      {
        page: 1,
        txnDate: "01-01-2025",
        transaction: "UPI/first@okaxis/ONE",
        withdrawals: "100.00",
        deposits: "",
      },
      {
        page: 1,
        txnDate: "01-01-2025",
        transaction: "UPI/second@okaxis/TWO",
        withdrawals: "",
        deposits: "",
      },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]!.transaction).toContain("first");
    expect(rows[1]!.transaction).toContain("second");
  });

  it("does not drop uplifted amounts when the next row already has amounts", () => {
    const rows = simplifyMisfitStatementRows([
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "NEFT IN::REF",
        withdrawals: "",
        deposits: "1000.00",
      },
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "S:UTIB0000553",
        withdrawals: "460.00",
        deposits: "",
      },
      {
        page: 1,
        txnDate: "15-12-2025",
        transaction: "UPI/next@okaxis/NEXT",
        withdrawals: "200.00",
        deposits: "",
      },
    ]);
    expect(rows.length).toBe(3);
    const amountOnly = rows.find((r) => !r.transaction.trim() && r.withdrawals === "460.00");
    expect(amountOnly).toBeDefined();
    expect(rows.find((r) => r.transaction.includes("UPI/next"))!.withdrawals).toBe("200.00");
  });
});

describe("lineLooksLikeDisclaimerLine", () => {
  it("matches disclaimer footer", () => {
    expect(
      lineLooksLikeDisclaimerLine(
        "Disclaimer: This is an Electronically Generated Statement in System.",
      ),
    ).toBe(true);
  });
});

describe("isNoiseTransaction", () => {
  it("treats S: fragment as noise", () => {
    expect(isNoiseTransaction("S:")).toBe(true);
    expect(isNoiseTransaction("DIGITAL S:")).toBe(true);
  });

  it("keeps truncated S:UTIB continuation", () => {
    expect(isNoiseTransaction("S:UTIB0000553")).toBe(false);
  });

  it("keeps real UPI narration", () => {
    expect(isNoiseTransaction("UPI/509359639397/P2V/balvinder35444-1@okaxis/BALVI")).toBe(false);
  });
});

describe("splitMergedUpiNarrations", () => {
  it("splits two UPI narrations merged in one cell", () => {
    const merged =
      "UPI/830702454365/P2V/ranjeetghotar@ibl/RANJEET UPI/883562672391/P2V/divyak161997@okhdfcbank/DIVYA";
    const rows = splitMergedUpiNarrations(1, "01-01-2024", merged, "100.00", "");
    expect(rows.length).toBe(2);
    expect(rows[0]!.transaction).toContain("ranjeetghotar");
    expect(rows[0]!.withdrawals).toBe("100.00");
    expect(rows[1]!.transaction).toContain("divyak161997");
    expect(rows[1]!.withdrawals).toBe("");
  });
});

describe("isStatementRowEmpty", () => {
  it("detects fully blank rows", () => {
    expect(
      isStatementRowEmpty({
        page: 1,
        txnDate: "",
        transaction: "",
        withdrawals: "",
        deposits: "",
      }),
    ).toBe(true);
  });

  it("keeps rows with any field populated", () => {
    expect(
      isStatementRowEmpty({
        page: 1,
        txnDate: "01/01/2025",
        transaction: "",
        withdrawals: "",
        deposits: "",
      }),
    ).toBe(false);
  });
});

describe("dropEmptyStatementRows", () => {
  it("removes blank rows from a list", () => {
    const rows = dropEmptyStatementRows([
      { page: 1, txnDate: "", transaction: "UPI/foo", withdrawals: "", deposits: "" },
      { page: 1, txnDate: "", transaction: "", withdrawals: "", deposits: "" },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.transaction).toBe("UPI/foo");
  });
});

describe("hasHorizontalRuleBetween", () => {
  it("detects rule between two row Y positions", () => {
    const rules = [100, 200, 300];
    expect(hasHorizontalRuleBetween(110, 90, rules)).toBe(true);
    expect(hasHorizontalRuleBetween(90, 110, rules)).toBe(true);
  });

  it("returns false when no rule in gap", () => {
    expect(hasHorizontalRuleBetween(50, 40, [100, 200])).toBe(false);
  });

  it("returns false for empty rules", () => {
    expect(hasHorizontalRuleBetween(100, 90, [])).toBe(false);
  });
});
