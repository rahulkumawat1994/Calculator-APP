import { describe, expect, it } from "vitest";
import {
  buildPrepaymentPlan,
  computeLoanDetailSummary,
  computeLoanScheduleAnalytics,
  emiFromAnnualRate,
  estimateAnnualRateFromSchedule,
  filterLoanScheduleRowsByDateRange,
  generateAmortizationSchedule,
  parseLoanMoney,
  simulateLoanProgressAsOf,
  summarizeLoanScheduleRows,
  typicalEmiFromSchedule,
} from "./loanCalc";
import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";

function emiForLoan(principal: number, annualRate: number, months: number): number {
  const mr = annualRate / 100 / 12;
  const factor = Math.pow(1 + mr, months);
  return (principal * mr * factor) / (factor - 1);
}

function buildAmortizationSchedule(
  principal: number,
  annualRate: number,
  months: number,
): LoanScheduleRow[] {
  const emi = emiForLoan(principal, annualRate, months);
  const mr = annualRate / 100 / 12;
  let balance = principal;
  const rows: LoanScheduleRow[] = [];
  for (let i = 0; i < months; i++) {
    const interest = balance * mr;
    const principalPart = emi - interest;
    balance = Math.max(0, balance - principalPart);
    rows.push({
      page: 1,
      installmentNo: String(i + 1),
      dueDate: `01-${String(((i % 12) + 1)).padStart(2, "0")}-${2020 + Math.floor(i / 12)}`,
      installmentAmount: emi.toFixed(2),
      interest: interest.toFixed(2),
      principal: principalPart.toFixed(2),
      balancePrincipal: balance.toFixed(2),
    });
    if (balance <= 0.01) break;
  }
  return rows;
}

const homeLoanRows = buildAmortizationSchedule(1000000, 8.5, 240);

const sampleRows: LoanScheduleRow[] = [
  {
    page: 1,
    installmentNo: "1",
    dueDate: "01-01-2020",
    installmentAmount: "10,000.00",
    interest: "5,000.00",
    principal: "5,000.00",
    balancePrincipal: "95,000.00",
  },
  {
    page: 1,
    installmentNo: "2",
    dueDate: "01-02-2020",
    installmentAmount: "10,000.00",
    interest: "4,750.00",
    principal: "5,250.00",
    balancePrincipal: "89,750.00",
  },
  {
    page: 1,
    installmentNo: "3",
    dueDate: "01-03-2028",
    installmentAmount: "10,000.00",
    interest: "4,500.00",
    principal: "5,500.00",
    balancePrincipal: "84,250.00",
  },
];

describe("computeLoanScheduleAnalytics", () => {
  it("sums principal and interest from schedule rows", () => {
    const a = computeLoanScheduleAnalytics(sampleRows);
    expect(a.installmentCount).toBe(3);
    expect(a.totalPrincipal).toBe(15750);
    expect(a.totalInterest).toBe(14250);
    expect(a.avgEmi).toBe(10000);
    expect(a.closingBalance).toBe(84250);
    expect(a.openingPrincipal).toBe(100000);
  });
});

describe("estimateAnnualRateFromSchedule", () => {
  it("matches stated rate on a realistic amortization schedule", () => {
    const rate = estimateAnnualRateFromSchedule(homeLoanRows, 240);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(8.2);
    expect(rate!).toBeLessThan(8.8);
  });

  it("uses typical flat EMI", () => {
    const emi = typicalEmiFromSchedule(homeLoanRows);
    expect(emi).toBeCloseTo(emiForLoan(1000000, 8.5, 240), 1);
  });
});

describe("computeLoanDetailSummary", () => {
  it("computes paid vs remaining and estimated rate", () => {
    const { analytics, progress } = computeLoanDetailSummary(sampleRows);
    expect(analytics.installmentCount).toBe(3);
    expect(progress.totalInstallments).toBe(3);
    expect(progress.paidByDueDate).toBe(2);
    expect(progress.principalPaid).toBe(10250);
    expect(progress.interestPaid).toBe(9750);
    expect(progress.principalRemaining).toBe(89750);
    expect(progress.interestRemaining).toBe(4500);
    expect(progress.interestPaid + progress.interestRemaining).toBe(analytics.totalInterest);
    expect(progress.principalPaid + progress.principalRemaining).toBe(
      analytics.openingPrincipal ?? analytics.totalPrincipal,
    );
    expect(computeLoanDetailSummary(sampleRows, null, 8.5).progress.estimatedAnnualRate).toBe(8.5);
  });

  it("respects paid installments override", () => {
    const { progress } = computeLoanDetailSummary(sampleRows, 1);
    expect(progress.paidInstallments).toBe(1);
    expect(progress.principalPaid).toBe(5000);
    expect(progress.interestPaid).toBe(5000);
  });

  it("uses tenureMonths for total installments when longer than loaded rows", () => {
    const { progress } = computeLoanDetailSummary(sampleRows, 0, null, 240);
    expect(progress.totalInstallments).toBe(240);
    expect(progress.emisRemaining).toBe(240);
  });

  it("counts paid by due date when date is embedded in due date cell text", () => {
    const rows: LoanScheduleRow[] = [
      {
        page: 1,
        installmentNo: "1",
        dueDate: "01-01-2020 EMI",
        installmentAmount: "10,000.00",
        interest: "5,000.00",
        principal: "5,000.00",
        balancePrincipal: "95,000.00",
      },
      {
        page: 1,
        installmentNo: "2",
        dueDate: "01/02/2020",
        installmentAmount: "10,000.00",
        interest: "4,750.00",
        principal: "5,250.00",
        balancePrincipal: "89,750.00",
      },
    ];
    expect(computeLoanDetailSummary(rows).progress.paidByDueDate).toBe(2);
  });
});

describe("schedule date filter", () => {
  it("filters rows by due date and sums interest and principal", () => {
    const filtered = filterLoanScheduleRowsByDateRange(sampleRows, "2020-01-01", "2020-02-29");
    expect(filtered.length).toBe(2);
    const summary = summarizeLoanScheduleRows(filtered);
    expect(summary.totalInterest).toBe(9750);
    expect(summary.totalPrincipal).toBe(10250);
    expect(summary.totalEmi).toBe(20000);
  });
});

describe("schedule-based summary", () => {
  it("reads cumulative interest without summing every row", () => {
    const rows: LoanScheduleRow[] = sampleRows.map((r, i) => ({
      ...r,
      interest: String((i + 1) * 5000),
    }));
    rows.push({
      page: 1,
      installmentNo: "4",
      dueDate: "01-04-2028",
      installmentAmount: "10,000.00",
      interest: "20000",
      principal: "5,500.00",
      balancePrincipal: "78,750.00",
    });
    const { analytics, progress } = computeLoanDetailSummary(rows, 2);
    expect(analytics.totalInterest).toBe(20000);
    expect(progress.interestPaid).toBe(10000);
    expect(progress.interestRemaining).toBe(10000);
  });

  it("principal paid sums principal column through paid EMI count", () => {
    const rows = buildAmortizationSchedule(2500000, 13.91, 120).slice(0, 55);
    const { progress } = computeLoanDetailSummary(rows, 54, 13.91, 120);
    expect(progress.principalPaid).toBeGreaterThan(50000);
    expect(progress.interestPaid).toBeGreaterThan(1000000);
    expect(progress.interestPaid + progress.principalPaid).toBeCloseTo(
      progress.totalPaid,
      0,
    );
  });
});

describe("buildPrepaymentPlan", () => {
  it("returns interest saved for extra payment after an EMI", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 12, amount: 100000, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.interestSaved).toBeGreaterThan(0);
    expect(plan!.monthsSaved).toBeGreaterThan(0);
    expect(plan!.totalExtraPaid).toBe(100000);
  });

  it("tiny prepayment saves only a tiny amount of interest", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 55, amount: 1, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.interestSaved).toBeLessThan(50);
    expect(plan!.monthsSaved).toBe(0);
  });

  it("returns null without schedule rows", () => {
    expect(
      buildPrepaymentPlan([], {
        rules: [{ afterInstallment: 1, amount: 10000, everyMonths: 0 }],
        annualRatePercent: 8.5,
      }),
    ).toBeNull();
  });

  it("one-time prepayment includes extra in schedule preview", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 12, amount: 100000, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.schedulePreview.some((s) => s.extraPrepay > 0)).toBe(true);
  });

  it("projected schedule includes all EMIs until loan closes (not capped at 48)", () => {
    const baseline = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 1, amount: 1, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(baseline).not.toBeNull();
    expect(baseline!.schedulePreview.length).toBeGreaterThan(100);
    const last = baseline!.schedulePreview[baseline!.schedulePreview.length - 1]!;
    expect(last.closingBalance).toBeLessThanOrEqual(0.5);
    expect(last.installmentNo).toBeGreaterThan(103);
    expect(last.dueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it("projected schedule has due dates for extrapolated months beyond loaded rows", () => {
    const partial = homeLoanRows.slice(0, 135);
    const plan = buildPrepaymentPlan(partial, {
      rules: [{ afterInstallment: 1, amount: 1, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.schedulePreview.length).toBeGreaterThan(135);
    const last = plan!.schedulePreview[plan!.schedulePreview.length - 1]!;
    expect(last.installmentNo).toBeGreaterThan(135);
    expect(last.dueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    const beyondLoaded = plan!.schedulePreview.find((s) => s.installmentNo > 135);
    expect(beyondLoaded?.dueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it("recurring yearly prepayments reduce tenure and interest", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 12, amount: 50000, everyMonths: 12 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.interestSaved).toBeGreaterThan(0);
    expect(plan!.monthsSaved).toBeGreaterThan(0);
    expect(plan!.totalExtraPaid).toBeGreaterThan(50000);
    const firstExtra = plan!.schedulePreview.find((s) => s.extraPrepay > 0);
    expect(firstExtra).not.toBeUndefined();
    expect(firstExtra!.installmentNo).toBe(12);
  });

  it("first extra payment row includes EMI breakdown, not only extra amount", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 18, amount: 100000, everyMonths: 0 }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    const row18 = plan!.schedulePreview.find((s) => s.installmentNo === 18);
    expect(row18).not.toBeUndefined();
    expect(row18!.emi).toBeGreaterThan(0);
    expect(row18!.interest).toBeGreaterThan(0);
    expect(row18!.principal).toBeGreaterThan(0);
    expect(row18!.extraPrepay).toBe(100000);
    expect(row18!.closingBalance).toBeLessThan(
      row18!.openingBalance - row18!.principal - row18!.extraPrepay + 1,
    );
  });

  it("foreclosure closes loan with outstanding balance lump sum", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [{ afterInstallment: 24, amount: 0, everyMonths: 0, closeLoan: true }],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.newRemainingMonths).toBe(0);
    expect(plan!.newTotalInterest).toBeGreaterThan(0);
    expect(plan!.foreclosureLumpSum).toBeGreaterThan(0);
    expect(plan!.interestSaved).toBe(plan!.originalTotalInterest - plan!.newTotalInterest);
    expect(plan!.totalExtraPaid).toBe(plan!.foreclosureLumpSum);
    const closeStep = plan!.schedulePreview.find((s) => s.installmentNo === 24);
    expect(closeStep!.emi).toBeGreaterThan(0);
    expect(closeStep!.interest).toBeGreaterThan(0);
    expect(closeStep!.extraPrepay).toBe(plan!.foreclosureLumpSum);
  });

  it("combines one-time and recurring rules", () => {
    const plan = buildPrepaymentPlan(homeLoanRows, {
      rules: [
        { afterInstallment: 12, amount: 100000, everyMonths: 0 },
        { afterInstallment: 60, amount: 25000, everyMonths: 12 },
      ],
      annualRatePercent: 8.5,
      tenureMonths: 240,
    });
    expect(plan).not.toBeNull();
    expect(plan!.interestSaved).toBeGreaterThan(0);
    expect(plan!.totalExtraPaid).toBeGreaterThan(125000);
    const extras = plan!.schedulePreview.filter((s) => s.extraPrepay > 0);
    expect(extras.some((s) => s.installmentNo === 12 && s.extraPrepay === 100000)).toBe(true);
    expect(extras.some((s) => s.installmentNo === 60 && s.extraPrepay === 25000)).toBe(true);
  });
});

describe("generateAmortizationSchedule", () => {
  it("builds a full schedule from loan terms", () => {
    const rows = generateAmortizationSchedule(1000000, 8.5, 240);
    expect(rows.length).toBe(240);
    expect(rows[0]!.dueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(parseLoanMoney(rows[239]!.balancePrincipal)).toBeLessThanOrEqual(0.5);
    const emi = emiFromAnnualRate(1000000, 8.5, 240);
    expect(parseLoanMoney(rows[0]!.installmentAmount)).toBeCloseTo(emi, 1);
  });

  it("applies part payments by date and shortens the loan", () => {
    const start = new Date(2020, 0, 5);
    const rows = generateAmortizationSchedule(1000000, 8.5, 240, start, [
      { dateMs: new Date(2020, 5, 5).getTime(), amount: 200000 },
      { dateMs: new Date(2021, 5, 5).getTime(), amount: 100000 },
    ]);
    expect(rows.length).toBeLessThan(240);
    const june2020 = rows.find((r) => r.dueDate.endsWith("-06-2020"));
    expect(june2020).not.toBeUndefined();
    expect(parseLoanMoney(june2020!.partPayment ?? "")).toBe(200000);
    expect(parseLoanMoney(june2020!.installmentAmount)).toBeLessThan(200000);
    expect(parseLoanMoney(rows[rows.length - 1]!.balancePrincipal)).toBeLessThanOrEqual(0.5);
  });

  it("simulateLoanProgressAsOf applies past part payments by payment date", () => {
    const start = new Date(2020, 0, 5);
    const startMs = start.getTime();
    const without = simulateLoanProgressAsOf({
      openingPrincipal: 4000000,
      annualRatePercent: 8.45,
      emi: 32074.42,
      tenureMonths: 300,
      startDateMs: startMs,
      asOfMs: new Date(2026, 7, 15).getTime(),
    });
    const withPart = simulateLoanProgressAsOf({
      openingPrincipal: 4000000,
      annualRatePercent: 8.45,
      emi: 32074.42,
      tenureMonths: 300,
      startDateMs: startMs,
      partPayments: [{ dateMs: new Date(2026, 6, 15).getTime(), amount: 400000 }],
      asOfMs: new Date(2026, 7, 15).getTime(),
    });
    expect(withPart.balance).toBeLessThan(without.balance);
    expect(withPart.principalPaid).toBeGreaterThan(without.principalPaid);
  });
});
