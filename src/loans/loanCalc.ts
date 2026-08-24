import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";
import { parseStatementMoneyAmount } from "../statement/statementMoneyParse";
import { parseStatementTxnDate } from "../statement/statementTxnDateParse";

export function parseLoanMoney(raw: string): number {
  return parseStatementMoneyAmount(raw);
}

export type LoanScheduleAnalytics = {
  installmentCount: number;
  totalInstallmentAmount: number;
  totalInterest: number;
  totalPrincipal: number;
  openingPrincipal: number | null;
  closingBalance: number | null;
  avgEmi: number;
  nextDueDate: string | null;
  nextInstallmentNo: string | null;
  nextEmiAmount: number | null;
  remainingInstallments: number;
};

function parseDueDateToMs(raw: string): number | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;

  const direct = parseStatementTxnDate(t);
  if (direct) return direct.getTime();

  const embedded =
    t.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/) ?? t.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/);
  if (embedded) {
    const d = parseStatementTxnDate(embedded[1] ?? embedded[0]);
    if (d) return d.getTime();
  }

  return null;
}

function dueDateMsForScheduleRow(row: LoanScheduleRow): number | null {
  const fromDueCol = parseDueDateToMs(row.dueDate);
  if (fromDueCol != null) return fromDueCol;
  for (const part of [
    row.installmentNo,
    row.installmentAmount,
    row.interest,
    row.principal,
    row.balancePrincipal,
  ]) {
    const ms = parseDueDateToMs(part);
    if (ms != null) return ms;
  }
  return null;
}

/** Cap rows used for UI so bad PDF extracts cannot freeze the browser. */
export const MAX_SCHEDULE_ROWS_FOR_UI = 600;
/** Stop scanning raw parsed rows beyond this (garbage PDF text above the table). */
export const MAX_RAW_ROWS_SCAN = 8000;

export function prepareScheduleRowsForUi(
  rows: LoanScheduleRow[],
  reportedRowCount?: number,
): {
  rows: LoanScheduleRow[];
  truncated: boolean;
  originalCount: number;
} {
  const source = rows.length > MAX_RAW_ROWS_SCAN ? rows.slice(0, MAX_RAW_ROWS_SCAN) : rows;
  const valid: LoanScheduleRow[] = [];
  for (const r of source) {
    if (!isLoanScheduleRowEmpty(r)) valid.push(r);
    if (valid.length >= MAX_SCHEDULE_ROWS_FOR_UI) break;
  }

  const truncated =
    valid.length >= MAX_SCHEDULE_ROWS_FOR_UI ||
    source.length < rows.length ||
    (typeof reportedRowCount === "number" && reportedRowCount > valid.length);

  const originalCount =
    typeof reportedRowCount === "number" && reportedRowCount > 0
      ? reportedRowCount
      : valid.length;

  return {
    rows: valid.slice(0, MAX_SCHEDULE_ROWS_FOR_UI),
    truncated,
    originalCount,
  };
}

export function isLoanScheduleRowEmpty(row: LoanScheduleRow): boolean {
  return (
    !row.installmentNo.trim() &&
    !row.dueDate.trim() &&
    !row.installmentAmount.trim() &&
    !row.interest.trim() &&
    !row.principal.trim() &&
    !row.balancePrincipal.trim()
  );
}

export function sortedScheduleRows(rows: LoanScheduleRow[]): LoanScheduleRow[] {
  const valid = rows.filter((r) => !isLoanScheduleRowEmpty(r));
  return [...valid].sort((a, b) => {
    const da = dueDateMsForScheduleRow(a);
    const db = dueDateMsForScheduleRow(b);
    if (da != null && db != null && da !== db) return da - db;
    const na = Number.parseInt(a.installmentNo.trim(), 10);
    const nb = Number.parseInt(b.installmentNo.trim(), 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return 0;
  });
}

export function inferOpeningPrincipal(sorted: LoanScheduleRow[]): number | null {
  return openingBalanceForRow(sorted, 0);
}

/** Opening principal before EMI on row `index`. */
export function openingBalanceForRow(
  sorted: LoanScheduleRow[],
  index: number,
  balanceMeaning?: "closing" | "opening",
): number | null {
  if (index < 0 || index >= sorted.length) return null;
  const row = sorted[index]!;
  const principal = parseLoanMoney(row.principal);
  const balance = parseLoanMoney(row.balancePrincipal);
  const meaning = balanceMeaning ?? detectBalanceColumnMeaning(sorted);

  if (meaning === "opening") {
    return balance > 0 ? balance : null;
  }

  if (index === 0) {
    const opening = balance + principal;
    return opening > 0 ? opening : null;
  }
  const prevClosing = parseLoanMoney(sorted[index - 1]!.balancePrincipal);
  return prevClosing > 0 ? prevClosing : null;
}

/** Detect whether balance column is closing (after EMI) or opening (before EMI). */
export function detectBalanceColumnMeaning(sorted: LoanScheduleRow[]): "closing" | "opening" {
  if (sorted.length < 2) return "closing";
  let closingVotes = 0;
  let openingVotes = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevBal = parseLoanMoney(sorted[i - 1]!.balancePrincipal);
    const prevPrin = parseLoanMoney(sorted[i - 1]!.principal);
    const curBal = parseLoanMoney(sorted[i]!.balancePrincipal);
    const curPrin = parseLoanMoney(sorted[i]!.principal);
    if (prevBal > 0 && curPrin > 0) {
      if (Math.abs(prevBal - curPrin - curBal) < 2) closingVotes += 1;
      if (Math.abs(prevBal - prevPrin - curBal) < 2) openingVotes += 1;
    }
  }
  return openingVotes > closingVotes ? "opening" : "closing";
}

function rowImpliedAnnualRate(sorted: LoanScheduleRow[], index: number): number | null {
  const meaning = detectBalanceColumnMeaning(sorted);
  const opening = openingBalanceForRow(sorted, index, meaning);
  if (opening == null || opening <= 0) return null;
  const interest = parseLoanMoney(sorted[index]!.interest);
  if (interest <= 0) return null;
  const annual = (interest / opening) * 12 * 100;
  return annual > 0.05 && annual <= 30 ? annual : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Most frequent EMI in the schedule (home loans are usually flat EMI). */
export function typicalEmiFromSchedule(rows: LoanScheduleRow[]): number {
  const sorted = sortedScheduleRows(rows);
  const counts = new Map<number, number>();
  for (const r of sorted) {
    const emi = parseLoanMoney(r.installmentAmount);
    if (emi <= 0) continue;
    const key = Math.round(emi * 100);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = 0;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  if (bestKey > 0) return bestKey / 100;
  const first = sorted[0];
  return first ? parseLoanMoney(first.installmentAmount) : 0;
}

/**
 * Estimate annual % from the schedule itself: median imputed rate per row,
 * with EMI formula fallback when tenure is known.
 */
export function estimateAnnualRateFromSchedule(
  rows: LoanScheduleRow[],
  tenureMonths?: number,
): number | null {
  const sorted = sortedScheduleRows(rows);
  if (sorted.length === 0) return null;

  const rowRates: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const rate = rowImpliedAnnualRate(sorted, i);
    if (rate != null) rowRates.push(rate);
  }
  const fromRows = median(rowRates);

  const opening = inferOpeningPrincipal(sorted);
  const emi = typicalEmiFromSchedule(sorted);
  const months = tenureMonths != null && tenureMonths > 0 ? tenureMonths : sorted.length;
  const fromFormula =
    opening != null && emi > 0 && months > 0
      ? estimateAnnualInterestRate(opening, emi, months)
      : null;

  if (fromRows != null && fromFormula != null) {
    if (Math.abs(fromRows - fromFormula) <= 1.5) return (fromRows + fromFormula) / 2;
    return fromRows;
  }
  return fromRows ?? fromFormula;
}

export function computeLoanScheduleAnalytics(rows: LoanScheduleRow[]): LoanScheduleAnalytics {
  const valid = sortedScheduleRows(rows);
  let totalInstallmentAmount = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;
  const todayMs = Date.now();

  for (const r of valid) {
    totalInstallmentAmount += parseLoanMoney(r.installmentAmount);
    totalInterest += parseLoanMoney(r.interest);
    totalPrincipal += parseLoanMoney(r.principal);
  }

  const openingPrincipal = inferOpeningPrincipal(valid);
  const lastBalance = [...valid].reverse().find((r) => r.balancePrincipal.trim());
  const closingBalance = lastBalance ? parseLoanMoney(lastBalance.balancePrincipal) : null;

  let nextDueDate: string | null = null;
  let nextInstallmentNo: string | null = null;
  let nextEmiAmount: number | null = null;
  let remainingInstallments = 0;

  for (const r of valid) {
    const dueMs = dueDateMsForScheduleRow(r);
    const balance = parseLoanMoney(r.balancePrincipal);
    if (dueMs != null && dueMs >= todayMs - 86400000) {
      remainingInstallments += 1;
      if (!nextDueDate) {
        nextDueDate = r.dueDate.trim();
        nextInstallmentNo = r.installmentNo.trim() || null;
        const emi = parseLoanMoney(r.installmentAmount);
        nextEmiAmount = emi > 0 ? emi : null;
      }
    } else if (balance > 0 && !r.dueDate.trim()) {
      remainingInstallments += 1;
    }
  }

  const installmentCount = valid.length;
  const avgEmi = installmentCount > 0 ? totalInstallmentAmount / installmentCount : 0;

  return {
    installmentCount,
    totalInstallmentAmount,
    totalInterest,
    totalPrincipal,
    openingPrincipal,
    closingBalance,
    avgEmi,
    nextDueDate,
    nextInstallmentNo,
    nextEmiAmount,
    remainingInstallments,
  };
}

export function formatLoanInr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export function formatLoanRate(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export type LoanProgressAnalytics = {
  totalInstallments: number;
  paidInstallments: number;
  paidByDueDate: number;
  emisRemaining: number;
  completionPercent: number;
  principalPaid: number;
  interestPaid: number;
  totalPaid: number;
  principalRemaining: number;
  interestRemaining: number;
  totalRemaining: number;
  estimatedAnnualRate: number | null;
  currentBalance: number | null;
};

function countPaidInstallmentsByDueDate(rows: LoanScheduleRow[]): number {
  const todayMs = Date.now();
  let paid = 0;
  for (const r of rows) {
    const dueMs = dueDateMsForScheduleRow(r);
    if (dueMs != null && dueMs < todayMs - 86400000) paid += 1;
  }
  return paid;
}

function emiFromRate(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate <= 1e-12) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
}

export function emiFromAnnualRate(
  principal: number,
  annualRatePercent: number,
  months: number,
): number {
  return emiFromRate(principal, annualRatePercent / 100 / 12, months);
}

export type LoanPartPayment = {
  dateMs: number;
  amount: number;
};

function formatScheduleAmount(n: number): string {
  return n.toFixed(2);
}

/** Build a full amortization schedule from loan terms (no PDF). */
export function generateAmortizationSchedule(
  principal: number,
  annualRatePercent: number,
  tenureMonths: number,
  startDate?: Date,
  partPayments?: LoanPartPayment[],
): LoanScheduleRow[] {
  if (principal <= 0 || tenureMonths <= 0) return [];
  const months = Math.min(Math.round(tenureMonths), MAX_SCHEDULE_ROWS_FOR_UI);
  const mr = annualRatePercent / 100 / 12;
  const emi = emiFromRate(principal, mr, tenureMonths);
  let balance = principal;
  const rows: LoanScheduleRow[] = [];
  const base = startDate ?? new Date();
  const anchor = new Date(base.getFullYear(), base.getMonth(), base.getDate());

  const extras = [...(partPayments ?? [])]
    .filter((p) => p.amount > 0 && Number.isFinite(p.dateMs))
    .sort((a, b) => a.dateMs - b.dateMs);
  let extraIdx = 0;

  // Part payments before the first EMI due date reduce opening balance.
  while (extraIdx < extras.length && extras[extraIdx]!.dateMs < anchor.getTime()) {
    const applied = Math.min(extras[extraIdx]!.amount, balance);
    balance = Math.max(0, balance - applied);
    extraIdx += 1;
  }

  for (let i = 0; i < months; i++) {
    if (balance <= 0.01) break;

    const interest = balance * mr;
    const principalPart = Math.min(balance, Math.max(0, emi - interest));
    const installment = interest + principalPart;
    balance = Math.max(0, balance - principalPart);

    const due = new Date(anchor.getFullYear(), anchor.getMonth() + i, anchor.getDate());
    const dueMs = due.getTime();
    const dd = String(due.getDate()).padStart(2, "0");
    const mm = String(due.getMonth() + 1).padStart(2, "0");
    const yyyy = due.getFullYear();

    let partPaidThisMonth = 0;
    while (extraIdx < extras.length && extras[extraIdx]!.dateMs <= dueMs) {
      const applied = Math.min(extras[extraIdx]!.amount, balance);
      balance = Math.max(0, balance - applied);
      partPaidThisMonth += applied;
      extraIdx += 1;
    }

    rows.push({
      page: 1,
      installmentNo: String(i + 1),
      dueDate: `${dd}-${mm}-${yyyy}`,
      installmentAmount: formatScheduleAmount(installment),
      interest: formatScheduleAmount(interest),
      principal: formatScheduleAmount(principalPart),
      balancePrincipal: formatScheduleAmount(balance),
      partPayment:
        partPaidThisMonth > 0 ? formatScheduleAmount(partPaidThisMonth) : undefined,
    });
    if (balance <= 0.01) break;
  }
  return rows;
}

function estimateAnnualInterestRate(
  principal: number,
  emi: number,
  months: number,
): number | null {
  if (principal <= 0 || emi <= 0 || months <= 0) return null;
  if (emi * months < principal * 0.99) return null;

  let low = 0;
  let high = 0.02;
  while (emiFromRate(principal, high, months) > emi && high < 0.5) high *= 2;
  if (emiFromRate(principal, high, months) < emi) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (emiFromRate(principal, mid, months) > emi) high = mid;
    else low = mid;
  }
  const annual = low * 12 * 100;
  return annual > 0.05 && annual <= 30 ? annual : null;
}

export function rowPartPaymentAmount(row: LoanScheduleRow): number {
  const explicit = parseLoanMoney(row.partPayment ?? "");
  return explicit > 0 ? explicit : 0;
}

export function rowTotalPrincipal(row: LoanScheduleRow): number {
  return parseLoanMoney(row.principal) + rowPartPaymentAmount(row);
}

/** Split legacy rows where part payment was merged into installment/principal columns. */
export function repairLegacyPartPaymentRows(
  rows: LoanScheduleRow[],
  emiAmount: number | null,
): { rows: LoanScheduleRow[]; partPayments: LoanPartPayment[] } {
  if (!emiAmount || emiAmount <= 0) return { rows, partPayments: [] };
  const partPayments: LoanPartPayment[] = [];
  const out = rows.map((r) => {
    if (r.partPayment?.trim()) return r;
    const installment = parseLoanMoney(r.installmentAmount);
    const extra = installment - emiAmount;
    if (extra < 50) return r;
    const dueMs = dueDateMsForScheduleRow(r);
    if (dueMs != null) partPayments.push({ dateMs: dueMs, amount: extra });
    const principal = parseLoanMoney(r.principal);
    const emiPrincipal = Math.max(0, principal - extra);
    return {
      ...r,
      installmentAmount: formatScheduleAmount(emiAmount),
      principal: formatScheduleAmount(emiPrincipal),
      partPayment: formatScheduleAmount(extra),
    };
  });
  return { rows: out, partPayments };
}

export type LoanProgressSimulationInput = {
  openingPrincipal: number;
  annualRatePercent: number;
  emi: number;
  tenureMonths: number;
  startDateMs?: number | null;
  partPayments?: LoanPartPayment[];
  asOfMs?: number;
};

/** Balance and paid totals as of a date — EMIs by due date plus part payments on their actual dates. */
export function simulateLoanProgressAsOf(input: LoanProgressSimulationInput): {
  balance: number;
  principalPaid: number;
  interestPaid: number;
  emisPaidByDueDate: number;
} {
  const asOf = input.asOfMs ?? Date.now();
  const opening = input.openingPrincipal;
  if (opening <= 0 || input.emi <= 0 || input.tenureMonths <= 0) {
    return { balance: opening, principalPaid: 0, interestPaid: 0, emisPaidByDueDate: 0 };
  }

  const mr = input.annualRatePercent / 100 / 12;
  let balance = opening;
  let principalPaid = 0;
  let interestPaid = 0;
  let emisPaidByDueDate = 0;

  const extras = [...(input.partPayments ?? [])]
    .filter((p) => p.amount > 0 && Number.isFinite(p.dateMs))
    .sort((a, b) => a.dateMs - b.dateMs);
  let extraIdx = 0;

  const applyExtra = (amount: number) => {
    const applied = Math.min(amount, balance);
    balance = Math.max(0, balance - applied);
    principalPaid += applied;
  };

  const base = input.startDateMs != null ? new Date(input.startDateMs) : new Date();
  const anchor = new Date(base.getFullYear(), base.getMonth(), base.getDate());

  while (extraIdx < extras.length && extras[extraIdx]!.dateMs < anchor.getTime()) {
    if (extras[extraIdx]!.dateMs <= asOf) applyExtra(extras[extraIdx]!.amount);
    extraIdx += 1;
  }

  for (let i = 0; i < input.tenureMonths && balance > 0.5; i++) {
    const due = new Date(anchor.getFullYear(), anchor.getMonth() + i, anchor.getDate());
    const dueMs = due.getTime();

    if (dueMs > asOf) {
      while (extraIdx < extras.length && extras[extraIdx]!.dateMs <= asOf) {
        applyExtra(extras[extraIdx]!.amount);
        extraIdx += 1;
        if (balance <= 0.5) break;
      }
      break;
    }

    const interest = balance * mr;
    const principalPart = Math.min(balance, Math.max(0, input.emi - interest));
    balance = Math.max(0, balance - principalPart);
    principalPaid += principalPart;
    interestPaid += interest;
    emisPaidByDueDate += 1;

    while (
      extraIdx < extras.length &&
      extras[extraIdx]!.dateMs <= dueMs &&
      extras[extraIdx]!.dateMs <= asOf
    ) {
      applyExtra(extras[extraIdx]!.amount);
      extraIdx += 1;
      if (balance <= 0.5) break;
    }

    if (balance <= 0.5) break;
  }

  return { balance, principalPaid, interestPaid, emisPaidByDueDate };
}

export type LoanDetailSummaryOptions = {
  emiAmount?: number | null;
  openingPrincipal?: number | null;
  partPayments?: LoanPartPayment[];
};

/**
 * Summary on capped UI rows (sorted by due date / installment no).
 */
export function computeLoanDetailSummary(
  rows: LoanScheduleRow[],
  paidInstallmentsOverride?: number | null,
  savedRate?: number | null,
  tenureMonths?: number,
  options?: LoanDetailSummaryOptions,
): { analytics: LoanScheduleAnalytics; progress: LoanProgressAnalytics } {
  const sorted = sortedScheduleRows(rows);
  const n = sorted.length;
  const totalInstallments =
    tenureMonths != null && tenureMonths > n ? tenureMonths : n;
  const paidByDueDate = countPaidInstallmentsByDueDate(sorted);
  const paidInstallments =
    paidInstallmentsOverride != null && Number.isFinite(paidInstallmentsOverride)
      ? Math.min(totalInstallments, Math.max(0, Math.round(paidInstallmentsOverride)))
      : paidByDueDate;

  let totalInstallmentAmount = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;
  const todayMs = Date.now();
  let nextDueDate: string | null = null;
  let nextInstallmentNo: string | null = null;
  let nextEmiAmount: number | null = null;
  let remainingInstallments = 0;
  const referenceEmi =
    options?.emiAmount != null && options.emiAmount > 0
      ? options.emiAmount
      : typicalEmiFromSchedule(sorted);

  for (let i = 0; i < n; i++) {
    const r = sorted[i]!;
    const emi = parseLoanMoney(r.installmentAmount);
    const partPay = rowPartPaymentAmount(r);
    const interest = parseLoanMoney(r.interest);
    const principal = rowTotalPrincipal(r);
    totalInstallmentAmount += emi + partPay;
    totalInterest += interest;
    totalPrincipal += principal;
    const dueMs = dueDateMsForScheduleRow(r);
    const balance = parseLoanMoney(r.balancePrincipal);
    if (dueMs != null && dueMs >= todayMs - 86400000) {
      remainingInstallments += 1;
      if (!nextDueDate) {
        nextDueDate = r.dueDate.trim();
        nextInstallmentNo = r.installmentNo.trim() || null;
        const nextEmi = referenceEmi > 0 ? referenceEmi : emi;
        nextEmiAmount = nextEmi > 0 ? nextEmi : null;
      }
    } else if (balance > 0 && !r.dueDate.trim()) {
      remainingInstallments += 1;
    }
  }

  const opening =
    options?.openingPrincipal != null && options.openingPrincipal > 0
      ? options.openingPrincipal
      : inferOpeningPrincipal(sorted);
  const lastRow = n > 0 ? sorted[n - 1] : null;
  const closingBalance = lastRow?.balancePrincipal.trim()
    ? parseLoanMoney(lastRow.balancePrincipal)
    : null;
  const avgEmi = referenceEmi > 0 ? referenceEmi : n > 0 ? totalInstallmentAmount / n : 0;
  const balanceMeaning = detectBalanceColumnMeaning(sorted);
  const estimatedAnnualRate =
    savedRate != null && savedRate > 0
      ? savedRate
      : estimateAnnualRateFromSchedule(sorted, tenureMonths ?? n);

  const startDateMs = sorted[0] ? dueDateMsForScheduleRow(sorted[0]) : null;
  let principalPaid = 0;
  let interestPaid = 0;
  let currentBalance: number | null = opening;

  if (
    opening != null &&
    opening > 0 &&
    referenceEmi > 0 &&
    estimatedAnnualRate != null &&
    estimatedAnnualRate > 0
  ) {
    const sim = simulateLoanProgressAsOf({
      openingPrincipal: opening,
      annualRatePercent: estimatedAnnualRate,
      emi: referenceEmi,
      tenureMonths: totalInstallments,
      startDateMs,
      partPayments: options?.partPayments,
    });
    principalPaid = sim.principalPaid;
    interestPaid = sim.interestPaid;
    currentBalance = sim.balance;
  } else {
    for (let i = 0; i < n; i++) {
      const r = sorted[i]!;
      const interest = parseLoanMoney(r.interest);
      const principal = rowTotalPrincipal(r);
      if (i < paidInstallments) {
        principalPaid += principal;
        interestPaid += interest;
      }
    }
    if (paidInstallments > 0 && paidInstallments <= n) {
      const row = sorted[paidInstallments - 1]!;
      const bal = parseLoanMoney(row.balancePrincipal);
      const prin = rowTotalPrincipal(row);
      currentBalance =
        balanceMeaning === "opening" ? Math.max(0, bal - prin) : bal;
    }
  }

  const principalRemaining = Math.max(0, totalPrincipal - principalPaid);
  const interestRemaining = Math.max(0, totalInterest - interestPaid);

  const emisRemaining = Math.max(0, totalInstallments - paidInstallments);
  const completionPercent =
    totalInstallments > 0 ? Math.round((paidInstallments / totalInstallments) * 100) : 0;

  const analytics: LoanScheduleAnalytics = {
    installmentCount: n,
    totalInstallmentAmount,
    totalInterest,
    totalPrincipal,
    openingPrincipal: opening,
    closingBalance,
    avgEmi,
    nextDueDate,
    nextInstallmentNo,
    nextEmiAmount,
    remainingInstallments,
  };

  const progress: LoanProgressAnalytics = {
    totalInstallments,
    paidInstallments,
    paidByDueDate,
    emisRemaining,
    completionPercent,
    principalPaid,
    interestPaid,
    totalPaid: principalPaid + interestPaid,
    principalRemaining,
    interestRemaining,
    totalRemaining: principalRemaining + interestRemaining,
    estimatedAnnualRate,
    currentBalance: currentBalance != null && currentBalance >= 0 ? currentBalance : opening,
  };

  return { analytics, progress };
}

export function deriveLoanMetaFromSchedule(rows: LoanScheduleRow[]): {
  principal: number | null;
  emiAmount: number | null;
  tenureMonths: number | null;
  interestRate: number | null;
} {
  const prepared = prepareScheduleRowsForUi(rows);
  if (prepared.rows.length === 0) {
    return { principal: null, emiAmount: null, tenureMonths: null, interestRate: null };
  }
  const analytics = computeLoanScheduleAnalytics(prepared.rows);
  const first = prepared.rows[0];
  const emi = first ? parseLoanMoney(first.installmentAmount) : typicalEmiFromSchedule(prepared.rows);
  const principal =
    analytics.openingPrincipal ??
    (analytics.closingBalance != null && analytics.totalPrincipal > 0
      ? analytics.closingBalance + analytics.totalPrincipal
      : analytics.totalPrincipal > 0
        ? analytics.totalPrincipal
        : null);
  const interestRate = estimateAnnualRateFromSchedule(
    prepared.rows,
    prepared.originalCount > prepared.rows.length ? prepared.originalCount : prepared.rows.length,
  );

  return {
    principal: principal != null && principal > 0 ? principal : null,
    emiAmount: emi > 0 ? emi : analytics.avgEmi > 0 ? analytics.avgEmi : null,
    tenureMonths:
      prepared.originalCount > 0
        ? prepared.originalCount
        : analytics.installmentCount > 0
          ? analytics.installmentCount
          : null,
    interestRate,
  };
}

export type PrepaymentRule = {
  afterInstallment: number;
  amount: number;
  /** 0 = once after that EMI; 1 = every month; 12 = yearly, etc. */
  everyMonths: number;
  closeLoan?: boolean;
};

export type PrepaymentPlanInput = {
  rules: PrepaymentRule[];
  annualRatePercent?: number | null;
  tenureMonths?: number;
};

export type PrepaymentPlanStep = {
  installmentNo: number;
  dueDate: string;
  openingBalance: number;
  emi: number;
  interest: number;
  principal: number;
  extraPrepay: number;
  closingBalance: number;
};

export type PrepaymentPlanResult = {
  afterInstallment: number;
  interestSaved: number;
  monthsSaved: number;
  originalRemainingMonths: number;
  newRemainingMonths: number;
  originalTotalInterest: number;
  newTotalInterest: number;
  totalExtraPaid: number;
  foreclosureLumpSum: number | null;
  schedulePreview: PrepaymentPlanStep[];
};

const MAX_PLAN_PREVIEW_ROWS = 600;

type ScheduleDateProjection = {
  anchorInstallment: number;
  anchorMs: number;
  monthStepMs: number;
};

function formatDueDateDdMmYyyy(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function inferMonthlyDueDateStep(sorted: LoanScheduleRow[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = parseDueDateToMs(sorted[i - 1]!.dueDate);
    const b = parseDueDateToMs(sorted[i]!.dueDate);
    if (a != null && b != null && b > a) deltas.push(b - a);
  }
  if (deltas.length === 0) return 30 * 86400000;
  deltas.sort((x, y) => x - y);
  return deltas[Math.floor(deltas.length / 2)]!;
}

function dueDateForScheduleInstallment(sorted: LoanScheduleRow[], installmentNo: number): string {
  for (const r of sorted) {
    const n = Number.parseInt(r.installmentNo.trim(), 10);
    if (Number.isFinite(n) && n === installmentNo && r.dueDate.trim()) {
      return r.dueDate.trim();
    }
  }
  const idx = installmentNo - 1;
  if (idx >= 0 && idx < sorted.length) {
    const row = sorted[idx]!;
    if (row.dueDate.trim()) {
      const rowNo = Number.parseInt(row.installmentNo.trim(), 10);
      if (!row.installmentNo.trim() || rowNo === installmentNo) {
        return row.dueDate.trim();
      }
    }
  }
  return "";
}

function buildScheduleDateProjection(sorted: LoanScheduleRow[]): ScheduleDateProjection | null {
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const ms = parseDueDateToMs(r.dueDate);
    if (ms == null) continue;
    const n = Number.parseInt(r.installmentNo.trim(), 10);
    const anchorInstallment = Number.isFinite(n) && n > 0 ? n : i + 1;
    return {
      anchorInstallment,
      anchorMs: ms,
      monthStepMs: inferMonthlyDueDateStep(sorted),
    };
  }
  return null;
}

function projectedDueDate(
  installmentNo: number,
  sorted: LoanScheduleRow[],
  dateProjection: ScheduleDateProjection | null,
): string {
  const direct = dueDateForScheduleInstallment(sorted, installmentNo);
  if (direct) return direct;
  if (!dateProjection) return "";
  const offset = installmentNo - dateProjection.anchorInstallment;
  return formatDueDateDdMmYyyy(dateProjection.anchorMs + offset * dateProjection.monthStepMs);
}

function maxSimulationMonths(startInstallmentNo: number, tenureMonths?: number): number {
  if (tenureMonths != null && tenureMonths >= startInstallmentNo) {
    return Math.min(600, tenureMonths - startInstallmentNo + 1);
  }
  return 600;
}

function scheduleMonthlyRateAt(sorted: LoanScheduleRow[], rowIndex: number): number | null {
  if (rowIndex < 0 || rowIndex >= sorted.length) return null;
  const opening = openingBalanceForRow(sorted, rowIndex);
  if (opening == null || opening <= 0) return null;
  const interest = parseLoanMoney(sorted[rowIndex]!.interest);
  if (interest <= 0) return null;
  const monthly = interest / opening;
  return monthly > 0 && monthly < 0.05 ? monthly : null;
}

function medianMonthlyRateFromSchedule(sorted: LoanScheduleRow[]): number | null {
  const rates: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const mr = scheduleMonthlyRateAt(sorted, i);
    if (mr != null) rates.push(mr);
  }
  if (rates.length === 0) return null;
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 1 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
}

/** Forward simulation with optional extra payments after each EMI (same EMI, schedule rates). */
function simulateLoanWithPrepayments(
  sorted: LoanScheduleRow[],
  startBalance: number,
  startRowIndex: number,
  startInstallmentNo: number,
  emi: number,
  extraAtInstallment: (installmentNo: number, balanceAfterEmi: number) => number,
  fallbackMonthlyRate?: number | null,
  recordSteps = false,
  tenureMonths?: number,
  dateProjection?: ScheduleDateProjection | null,
): {
  months: number;
  totalInterest: number;
  totalExtraPaid: number;
  steps: PrepaymentPlanStep[];
} {
  let balance = startBalance;
  let totalInterest = 0;
  let totalExtraPaid = 0;
  let months = 0;
  const maxMonths = maxSimulationMonths(startInstallmentNo, tenureMonths);
  const fallbackMr = fallbackMonthlyRate ?? medianMonthlyRateFromSchedule(sorted);
  const steps: PrepaymentPlanStep[] = [];
  const dates = dateProjection ?? buildScheduleDateProjection(sorted);

  while (balance > 0.5 && months < maxMonths) {
    const rowIdx = startRowIndex + months;
    let mr = rowIdx < sorted.length ? scheduleMonthlyRateAt(sorted, rowIdx) : null;
    if (mr == null || mr <= 0) mr = fallbackMr ?? null;
    if (mr == null || mr <= 0) break;

    const openingBalance = balance;
    const interest = balance * mr;
    const principalPart = emi - interest;
    if (principalPart <= 0) break;

    totalInterest += interest;
    let principalPaid = principalPart;
    if (principalPart >= balance) {
      principalPaid = balance;
      balance = 0;
    } else {
      balance -= principalPart;
    }

    const installmentNo = startInstallmentNo + months;
    const extraRequested = Math.max(0, extraAtInstallment(installmentNo, balance));
    const extraApplied = extraRequested > 0 ? Math.min(extraRequested, balance) : 0;
    if (extraApplied > 0) {
      balance = Math.max(0, balance - extraApplied);
      totalExtraPaid += extraApplied;
    }

    if (recordSteps && steps.length < MAX_PLAN_PREVIEW_ROWS) {
      steps.push({
        installmentNo,
        dueDate: projectedDueDate(installmentNo, sorted, dates),
        openingBalance,
        emi,
        interest,
        principal: principalPaid,
        extraPrepay: extraApplied,
        closingBalance: balance,
      });
    }

    months += 1;
    if (balance <= 0.5) break;
  }

  return { months, totalInterest, totalExtraPaid, steps };
}

function closingBalanceAfterEmi(
  sorted: LoanScheduleRow[],
  afterIdx: number,
  balanceMeaning: "closing" | "opening",
): number {
  const row = sorted[afterIdx]!;
  const bal = parseLoanMoney(row.balancePrincipal);
  const prin = parseLoanMoney(row.principal);
  return balanceMeaning === "opening" ? Math.max(0, bal - prin) : bal;
}

function installmentNoForRow(sorted: LoanScheduleRow[], index: number): number {
  const n = Number.parseInt(sorted[index]!.installmentNo.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : index + 1;
}

function rowIndexForInstallment(sorted: LoanScheduleRow[], installmentNo: number): number | null {
  for (let i = 0; i < sorted.length; i++) {
    const n = Number.parseInt(sorted[i]!.installmentNo.trim(), 10);
    if (Number.isFinite(n) && n === installmentNo) return i;
  }
  if (installmentNo >= 1 && installmentNo <= sorted.length) {
    const idx = installmentNo - 1;
    if (installmentNoForRow(sorted, idx) === installmentNo) return idx;
  }
  return null;
}

function balanceAfterInstallment(
  sorted: LoanScheduleRow[],
  afterInstallment: number,
  emi: number,
  fallbackMonthlyRate: number | null,
): number | null {
  if (sorted.length === 0) return null;
  const balanceMeaning = detectBalanceColumnMeaning(sorted);
  const onScheduleIdx = rowIndexForInstallment(sorted, afterInstallment);
  if (onScheduleIdx != null) {
    return closingBalanceAfterEmi(sorted, onScheduleIdx, balanceMeaning);
  }

  const lastIdx = sorted.length - 1;
  const lastInstallment = installmentNoForRow(sorted, lastIdx);
  if (afterInstallment <= lastInstallment) return null;

  let balance = closingBalanceAfterEmi(sorted, lastIdx, balanceMeaning);
  let currentInstallment = lastInstallment;
  let scheduleRowIdx = lastIdx + 1;
  const fallbackMr = fallbackMonthlyRate ?? medianMonthlyRateFromSchedule(sorted);

  while (currentInstallment < afterInstallment && balance > 0.5) {
    currentInstallment += 1;
    let mr =
      scheduleRowIdx < sorted.length ? scheduleMonthlyRateAt(sorted, scheduleRowIdx) : null;
    if (mr == null || mr <= 0) mr = fallbackMr ?? null;
    if (mr == null || mr <= 0) return null;

    const interest = balance * mr;
    const principalPart = emi - interest;
    if (principalPart <= 0) return null;
    balance = Math.max(0, balance - Math.min(principalPart, balance));
    scheduleRowIdx += 1;
  }

  return currentInstallment >= afterInstallment && balance > 0 ? balance : null;
}

function scheduleRowIndexAfterInstallment(
  sorted: LoanScheduleRow[],
  afterInstallment: number,
): number {
  const onScheduleIdx = rowIndexForInstallment(sorted, afterInstallment);
  if (onScheduleIdx != null) return onScheduleIdx + 1;
  const lastIdx = sorted.length - 1;
  const lastInstallment = installmentNoForRow(sorted, lastIdx);
  if (afterInstallment <= lastInstallment) {
    return onScheduleIdx != null ? onScheduleIdx + 1 : lastIdx + 1;
  }
  return lastIdx + 1 + (afterInstallment - lastInstallment);
}

function resolveFallbackMonthlyRate(
  sorted: LoanScheduleRow[],
  annualRatePercent?: number | null,
  tenureMonths?: number,
): number | null {
  const annual =
    annualRatePercent != null && annualRatePercent > 0
      ? annualRatePercent
      : estimateAnnualRateFromSchedule(sorted, tenureMonths ?? sorted.length);
  return annual != null && annual > 0 ? annual / 100 / 12 : null;
}

function clampInstallment(tenure: number, installment: number): number {
  return Math.min(tenure, Math.max(1, Math.round(installment)));
}

function normalizePrepaymentRules(rules: PrepaymentRule[], tenure: number): PrepaymentRule[] {
  return rules
    .map((r) => ({
      afterInstallment: clampInstallment(tenure, r.afterInstallment),
      amount: r.closeLoan ? 0 : Math.max(0, r.amount),
      everyMonths: r.closeLoan ? 0 : Math.max(0, Math.round(r.everyMonths ?? 0)),
      closeLoan: r.closeLoan ?? false,
    }))
    .filter((r) => r.closeLoan || r.amount > 0);
}

function extraFromRules(
  installmentNo: number,
  balanceAfterEmi: number,
  rules: PrepaymentRule[],
): number {
  if (balanceAfterEmi <= 0) return 0;
  for (const rule of rules) {
    if (rule.closeLoan && installmentNo === rule.afterInstallment) {
      return balanceAfterEmi;
    }
  }
  let remaining = balanceAfterEmi;
  let total = 0;
  for (const rule of rules) {
    if (rule.closeLoan) continue;
    if (installmentNo < rule.afterInstallment) continue;
    const offset = installmentNo - rule.afterInstallment;
    const every = rule.everyMonths;
    const applies =
      every <= 0
        ? installmentNo === rule.afterInstallment
        : offset >= 0 && offset % every === 0;
    if (!applies) continue;
    const applied = Math.min(rule.amount, remaining);
    if (applied > 0) {
      total += applied;
      remaining -= applied;
    }
  }
  return Math.min(total, balanceAfterEmi);
}

function applyAnchorUpfrontExtras(
  balance: number,
  anchor: number,
  rules: PrepaymentRule[],
): { balance: number; upfrontExtra: number; closed: boolean } {
  let b = balance;
  let upfrontExtra = 0;
  for (const rule of rules) {
    if (rule.afterInstallment !== anchor) continue;
    if (rule.closeLoan) {
      upfrontExtra += b;
      return { balance: 0, upfrontExtra, closed: true };
    }
    if (rule.everyMonths <= 0 && rule.amount > 0) {
      const applied = Math.min(rule.amount, b);
      b -= applied;
      upfrontExtra += applied;
    } else if (rule.everyMonths > 0 && rule.amount > 0) {
      const applied = Math.min(rule.amount, b);
      b -= applied;
      upfrontExtra += applied;
    }
  }
  return { balance: b, upfrontExtra, closed: b <= 0.5 };
}

export function buildPrepaymentPlan(
  rows: LoanScheduleRow[],
  input: PrepaymentPlanInput,
): PrepaymentPlanResult | null {
  if (rows.length === 0) return null;

  const sorted = sortedScheduleRows(rows);
  if (sorted.length === 0) return null;

  const tenure = input.tenureMonths ?? sorted.length;
  const rules = normalizePrepaymentRules(input.rules, tenure);
  if (rules.length === 0) return null;

  const anchor = Math.min(...rules.map((r) => r.afterInstallment));
  const emi = typicalEmiFromSchedule(sorted);
  if (emi <= 0) return null;

  const fallbackMonthlyRate = resolveFallbackMonthlyRate(
    sorted,
    input.annualRatePercent,
    tenure,
  );
  const startBalance = balanceAfterInstallment(
    sorted,
    anchor,
    emi,
    fallbackMonthlyRate,
  );
  if (startBalance == null || startBalance <= 0) return null;

  const dateProjection = buildScheduleDateProjection(sorted);
  const startRowIndex = scheduleRowIndexAfterInstallment(sorted, anchor);
  const nextInstallment = anchor + 1;

  const extraAtInstallment = (installmentNo: number, balanceAfterEmi: number) =>
    extraFromRules(installmentNo, balanceAfterEmi, rules);

  const baseline = simulateLoanWithPrepayments(
    sorted,
    startBalance,
    startRowIndex,
    nextInstallment,
    emi,
    () => 0,
    fallbackMonthlyRate,
    false,
    tenure,
    dateProjection,
  );

  const anchorUpfront = applyAnchorUpfrontExtras(startBalance, anchor, rules);
  let foreclosureLumpSum: number | null = null;
  if (anchorUpfront.closed) {
    foreclosureLumpSum = startBalance;
  }

  const withPlan =
    !anchorUpfront.closed && anchorUpfront.balance > 0.5
      ? simulateLoanWithPrepayments(
          sorted,
          anchorUpfront.balance,
          startRowIndex,
          nextInstallment,
          emi,
          extraAtInstallment,
          fallbackMonthlyRate,
          true,
          tenure,
          dateProjection,
        )
      : { months: 0, totalInterest: 0, totalExtraPaid: 0, steps: [] };

  const totalExtraPaid = anchorUpfront.upfrontExtra + withPlan.totalExtraPaid;
  const interestSaved = Math.max(0, baseline.totalInterest - withPlan.totalInterest);
  const monthsSaved = Math.max(0, baseline.months - withPlan.months);

  const schedulePreview: PrepaymentPlanStep[] = [];
  if (anchorUpfront.upfrontExtra > 0 || anchorUpfront.closed) {
    schedulePreview.push({
      installmentNo: anchor,
      dueDate: projectedDueDate(anchor, sorted, dateProjection),
      openingBalance: startBalance,
      emi: 0,
      interest: 0,
      principal: 0,
      extraPrepay: anchorUpfront.closed ? startBalance : anchorUpfront.upfrontExtra,
      closingBalance: anchorUpfront.closed ? 0 : anchorUpfront.balance,
    });
  }
  schedulePreview.push(...withPlan.steps);

  return {
    afterInstallment: anchor,
    interestSaved,
    monthsSaved,
    originalRemainingMonths: baseline.months,
    newRemainingMonths: withPlan.months,
    originalTotalInterest: baseline.totalInterest,
    newTotalInterest: withPlan.totalInterest,
    totalExtraPaid,
    foreclosureLumpSum,
    schedulePreview,
  };
}
