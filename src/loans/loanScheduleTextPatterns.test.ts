import { describe, expect, it } from "vitest";
import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";
import {
  LOAN_SCHEDULE_AMOUNT_RE,
  LOAN_SCHEDULE_DATE_RE,
  loanScheduleRowLooksLikeData,
} from "./loanScheduleTextPatterns";

function row(partial: Partial<LoanScheduleRow>): LoanScheduleRow {
  return {
    page: 1,
    installmentNo: "",
    dueDate: "",
    installmentAmount: "",
    interest: "",
    principal: "",
    balancePrincipal: "",
    ...partial,
  };
}

describe("loanScheduleTextPatterns", () => {
  it("recognizes Indian lakh amounts without decimals", () => {
    expect(LOAN_SCHEDULE_AMOUNT_RE.test("5,88,802")).toBe(true);
    expect(LOAN_SCHEDULE_AMOUNT_RE.test("1,00,000")).toBe(true);
    expect(LOAN_SCHEDULE_AMOUNT_RE.test("8678")).toBe(true);
    expect(LOAN_SCHEDULE_AMOUNT_RE.test("8678.23")).toBe(true);
  });

  it("recognizes schedule dates with single-digit day/month", () => {
    expect(LOAN_SCHEDULE_DATE_RE.test("7/11/2026")).toBe(true);
    expect(LOAN_SCHEDULE_DATE_RE.test("07/11/2026")).toBe(true);
  });

  it("accepts installment rows with Indian amounts", () => {
    expect(
      loanScheduleRowLooksLikeData(
        row({
          installmentNo: "18",
          dueDate: "07/11/2026",
          installmentAmount: "8678",
          interest: "4200",
          principal: "3878",
          balancePrincipal: "5,88,802",
        }),
      ),
    ).toBe(true);
  });
});
