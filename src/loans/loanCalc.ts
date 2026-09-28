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

function installmentIndexForRow(row: LoanScheduleRow, fallback: number): number {
  const n = Number.parseInt(row.installmentNo.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** One row per installment — avoids double-counting duplicate PDF rows. */
export function dedupeScheduleByInstallment(rows: LoanScheduleRow[]): LoanScheduleRow[] {
  const sorted = sortedScheduleRows(rows);
  const byInst = new Map<number, LoanScheduleRow>();
  let fallback = 0;
  for (const r of sorted) {
    fallback += 1;
    const n = installmentIndexForRow(r, fallback);
    const cur = byInst.get(n);
    if (!cur) {
      byInst.set(n, r);
      continue;
    }
    const score = (row: LoanScheduleRow) =>
      parseLoanMoney(row.installmentAmount) +
      parseLoanMoney(row.interest) +
      parseLoanMoney(row.principal) +
      rowPartPaymentAmount(row);
    if (score(r) >= score(cur)) byInst.set(n, r);
  }
  return [...byInst.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

function scheduleRowAtInstallment(
  sorted: LoanScheduleRow[],
  installmentNo: number,
): LoanScheduleRow | null {
  for (const r of sorted) {
    const n = Number.parseInt(r.installmentNo.trim(), 10);
    if (Number.isFinite(n) && n === installmentNo) return r;
  }
  if (installmentNo >= 1 && installmentNo <= sorted.length) {
    const r = sorted[installmentNo - 1];
    if (r && installmentIndexForRow(r, installmentNo) === installmentNo) return r;
  }
  return null;
}

export type ScheduleColumnAmountMeaning = "periodic" | "cumulative";

/** Detect running-total columns (common on bank PDF interest summaries). */
export function detectColumnAmountMeaning(
  sorted: LoanScheduleRow[],
  field: "interest" | "principal",
): ScheduleColumnAmountMeaning {
  if (field === "principal") return "periodic";
  if (sorted.length < 3) return "periodic";
  const vals: number[] = [];
  for (const r of sorted) {
    const v = parseLoanMoney(r[field]);
    if (v > 0) vals.push(v);
  }
  if (vals.length < 3) return "periodic";
  let increases = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i]! >= vals[i - 1]! - 0.01) increases += 1;
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  const last = vals[vals.length - 1]!;
  if (increases >= vals.length - 2 && last > sum * 0.45 && last > vals[0]! * 2) {
    return "cumulative";
  }
  if (increases >= vals.length - 2 && last < sum * 0.85 && last > vals[0]! * 1.5) {
    return "cumulative";
  }
  return "periodic";
}

function scheduleAmountTotal(
  sorted: LoanScheduleRow[],
  field: "interest" | "principal",
  meaning: ScheduleColumnAmountMeaning,
): number {
  if (meaning === "cumulative") {
    let last = 0;
    for (const r of sorted) {
      const v = parseLoanMoney(r[field]);
      if (v > last) last = v;
    }
    return last;
  }
  let total = 0;
  for (const r of sorted) {
    total +=
      field === "principal" ? rowTotalPrincipal(r) : parseLoanMoney(r[field]);
  }
  return total;
}

function scheduleAmountThroughInstallment(
  sorted: LoanScheduleRow[],
  throughInstallment: number,
  field: "interest" | "principal",
  meaning: ScheduleColumnAmountMeaning,
): number {
  if (meaning === "cumulative") {
    const row = scheduleRowAtInstallment(sorted, throughInstallment);
    if (row) {
      if (field === "principal") {
        return parseLoanMoney(row.principal) + rowPartPaymentAmount(row);
      }
      return parseLoanMoney(row[field]);
    }
  }
  let total = 0;
  for (let n = 1; n <= throughInstallment; n++) {
    const row = scheduleRowAtInstallment(sorted, n);
    if (!row) continue;
    total +=
      field === "principal" ? rowTotalPrincipal(row) : parseLoanMoney(row[field]);
  }
  return total;
}

function closingBalanceAfterRow(
  row: LoanScheduleRow,
  balanceMeaning: "closing" | "opening",
): number {
  const bal = parseLoanMoney(row.balancePrincipal);
  if (balanceMeaning === "opening") {
    return Math.max(0, bal - rowTotalPrincipal(row));
  }
  return bal;
}

function scheduleOpeningBalance(
  sorted: LoanScheduleRow[],
  balanceMeaning: "closing" | "opening",
): number | null {
  const row0 = sorted[0];
  if (!row0) return null;
  const row0Bal = parseLoanMoney(row0.balancePrincipal);
  const row1 = scheduleRowAtInstallment(sorted, 2);
  if (row0Bal > 0 && row1) {
    const row1Bal = parseLoanMoney(row1.balancePrincipal);
    const row0Prin = rowTotalPrincipal(row0);
    const tol = Math.max(2, row0Bal * 0.001);
    if (Math.abs(row0Bal - row0Prin - row1Bal) < tol) return row0Bal;
    if (Math.abs(row0Bal + row0Prin - row1Bal) < tol) return row0Bal + row0Prin;
  }
  return openingBalanceForRow(sorted, 0, balanceMeaning);
}

/** Outstanding principal after `installmentNo` EMIs have been paid. */
function outstandingBalanceAfterInstallment(
  sorted: LoanScheduleRow[],
  installmentNo: number,
  balanceMeaning: "closing" | "opening",
): number | null {
  if (installmentNo <= 0) {
    return scheduleOpeningBalance(sorted, balanceMeaning);
  }

  const paidRow = scheduleRowAtInstallment(sorted, installmentNo);
  const nextRow = scheduleRowAtInstallment(sorted, installmentNo + 1);
  if (paidRow && nextRow) {
    const paidBal = parseLoanMoney(paidRow.balancePrincipal);
    const nextBal = parseLoanMoney(nextRow.balancePrincipal);
    const paidThrough = rowTotalPrincipal(paidRow);
    const tol = Math.max(2, paidBal * 0.001);
    if (
      paidBal > 0 &&
      nextBal > 0 &&
      Math.abs(paidBal - paidThrough - nextBal) < tol
    ) {
      return nextBal;
    }
  }

  if (
    balanceMeaning === "opening" &&
    nextRow &&
    parseLoanMoney(nextRow.balancePrincipal) > 0
  ) {
    return parseLoanMoney(nextRow.balancePrincipal);
  }
  if (!paidRow) return null;
  return closingBalanceAfterRow(paidRow, balanceMeaning);
}

/** Paid vs remaining totals from parsed schedule rows (not re-simulated EMI math). */
function aggregateScheduleProgress(
  sorted: LoanScheduleRow[],
  paidInstallments: number,
  balanceMeaning: "closing" | "opening",
  interestMeaning: ScheduleColumnAmountMeaning,
  principalMeaning: ScheduleColumnAmountMeaning,
): {
  principalPaid: number;
  interestPaid: number;
  principalRemaining: number;
  interestRemaining: number;
  currentBalance: number | null;
  scheduleOpening: number | null;
} {
  const scheduleOpening = scheduleOpeningBalance(sorted, balanceMeaning);

  const interestPaid = scheduleAmountThroughInstallment(
    sorted,
    paidInstallments,
    "interest",
    interestMeaning,
  );

  const currentBalance = outstandingBalanceAfterInstallment(
    sorted,
    paidInstallments,
    balanceMeaning,
  );

  let principalPaid = scheduleAmountThroughInstallment(
    sorted,
    paidInstallments,
    "principal",
    principalMeaning,
  );
  if (
    principalPaid <= 0 &&
    scheduleOpening != null &&
    currentBalance != null
  ) {
    principalPaid = Math.max(0, scheduleOpening - currentBalance);
  }

  const totalInterest = scheduleAmountTotal(sorted, "interest", interestMeaning);
  const interestRemaining = Math.max(0, totalInterest - interestPaid);
  const principalRemaining =
    currentBalance != null
      ? currentBalance
      : scheduleOpening != null
        ? Math.max(0, scheduleOpening - principalPaid)
        : 0;

  return {
    principalPaid,
    interestPaid,
    principalRemaining,
    interestRemaining,
    currentBalance,
    scheduleOpening,
  };
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
  const byInst = dedupeScheduleByInstallment(sorted);
  if (byInst.length < 2) return "closing";
  let closingVotes = 0;
  let openingVotes = 0;
  for (let i = 1; i < byInst.length; i++) {
    const prev = byInst[i - 1]!;
    const cur = byInst[i]!;
    const prevN = installmentIndexForRow(prev, i);
    const curN = installmentIndexForRow(cur, i + 1);
    if (curN !== prevN + 1) continue;
    const prevBal = parseLoanMoney(prev.balancePrincipal);
    const prevPrin = rowTotalPrincipal(prev);
    const curBal = parseLoanMoney(cur.balancePrincipal);
    const curPrin = rowTotalPrincipal(cur);
    const tol = Math.max(2, prevBal * 0.001);
    if (prevBal > 0 && curPrin > 0) {
      if (Math.abs(prevBal - curPrin - curBal) < tol) closingVotes += 1;
      if (Math.abs(prevBal - prevPrin - curBal) < tol) openingVotes += 1;
    }
  }
  return openingVotes > closingVotes
    ? "opening"
    : closingVotes > openingVotes
      ? "closing"
      : "opening";
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
  const valid = dedupeScheduleByInstallment(rows);
  const interestMeaning = detectColumnAmountMeaning(valid, "interest");
  const principalMeaning = detectColumnAmountMeaning(valid, "principal");
  const balanceMeaning = detectBalanceColumnMeaning(valid);

  let totalInstallmentAmount = 0;
  for (const r of valid) {
    totalInstallmentAmount += parseLoanMoney(r.installmentAmount);
  }
  const totalInterest = scheduleAmountTotal(valid, "interest", interestMeaning);
  const totalPrincipal = scheduleAmountTotal(valid, "principal", principalMeaning);

  const scheduleOpening = scheduleOpeningBalance(valid, balanceMeaning);
  const openingPrincipal =
    scheduleOpening ?? inferOpeningPrincipal(valid) ?? null;
  const lastRow = valid.length > 0 ? valid[valid.length - 1] : null;
  const closingBalance = lastRow?.balancePrincipal.trim()
    ? closingBalanceAfterRow(lastRow, balanceMeaning)
    : null;

  const todayMs = Date.now();
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
  const scheduleEmi = typicalEmiFromSchedule(valid);
  const avgEmi =
    scheduleEmi > 0
      ? scheduleEmi
      : installmentCount > 0
        ? totalInstallmentAmount / installmentCount
        : 0;

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
  const deduped = dedupeScheduleByInstallment(rows);
  const todayMs = Date.now();
  let paid = 0;
  for (const r of deduped) {
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

export type LoanScheduleRangeSummary = {
  rowCount: number;
  totalEmi: number;
  totalInterest: number;
  totalPrincipal: number;
  totalPartPayment: number;
};

function isoDateStartMs(iso: string): number | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (![y, mo, d].every((n) => Number.isFinite(n))) return null;
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt.getTime();
}

function isoDateEndMs(iso: string): number | null {
  const start = isoDateStartMs(iso);
  if (start == null) return null;
  const dt = new Date(start);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
}

/** Keep rows whose due date falls within inclusive ISO date bounds (`YYYY-MM-DD`). */
export function filterLoanScheduleRowsByDateRange(
  rows: LoanScheduleRow[],
  dateFrom: string,
  dateTo: string,
): LoanScheduleRow[] {
  let fromMs = isoDateStartMs(dateFrom);
  let toMs = isoDateEndMs(dateTo);
  if (fromMs != null && toMs != null && fromMs > toMs) {
    const lo = isoDateStartMs(dateTo);
    const hi = isoDateEndMs(dateFrom);
    if (lo != null && hi != null) {
      fromMs = lo;
      toMs = hi;
    }
  }
  const sorted = sortedScheduleRows(rows);
  if (fromMs == null && toMs == null) return sorted;

  return sorted.filter((r) => {
    const ms = dueDateMsForScheduleRow(r);
    if (ms == null) return true;
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });
}

export function summarizeLoanScheduleRows(rows: LoanScheduleRow[]): LoanScheduleRangeSummary {
  const sorted = dedupeScheduleByInstallment(rows);
  let totalEmi = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;
  let totalPartPayment = 0;
  for (const r of sorted) {
    totalEmi += parseLoanMoney(r.installmentAmount);
    totalInterest += parseLoanMoney(r.interest);
    totalPrincipal += parseLoanMoney(r.principal);
    totalPartPayment += rowPartPaymentAmount(r);
  }
  return {
    rowCount: sorted.length,
    totalEmi,
    totalInterest,
    totalPrincipal,
    totalPartPayment,
  };
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
  const sorted = dedupeScheduleByInstallment(rows);
  const n = sorted.length;
  const maxInstOnSchedule =
    n > 0
      ? Math.max(...sorted.map((r, i) => installmentIndexForRow(r, i + 1)))
      : 0;
  const totalInstallments =
    tenureMonths != null && tenureMonths > maxInstOnSchedule
      ? tenureMonths
      : maxInstOnSchedule || n;
  const paidByDueDate = countPaidInstallmentsByDueDate(rows);
  const paidInstallments =
    paidInstallmentsOverride != null && Number.isFinite(paidInstallmentsOverride)
      ? Math.min(totalInstallments, Math.max(0, Math.round(paidInstallmentsOverride)))
      : paidByDueDate;

  const balanceMeaning = detectBalanceColumnMeaning(sorted);
  const interestMeaning = detectColumnAmountMeaning(sorted, "interest");
  const principalMeaning = detectColumnAmountMeaning(sorted, "principal");

  let totalInstallmentAmount = 0;
  const todayMs = Date.now();
  let nextDueDate: string | null = null;
  let nextInstallmentNo: string | null = null;
  let nextEmiAmount: number | null = null;
  let remainingInstallments = 0;
  const scheduleEmi = typicalEmiFromSchedule(sorted);

  for (const r of sorted) {
    totalInstallmentAmount += parseLoanMoney(r.installmentAmount);
    const dueMs = dueDateMsForScheduleRow(r);
    const balance = parseLoanMoney(r.balancePrincipal);
    if (dueMs != null && dueMs >= todayMs - 86400000) {
      remainingInstallments += 1;
      if (!nextDueDate) {
        nextDueDate = r.dueDate.trim();
        nextInstallmentNo = r.installmentNo.trim() || null;
        const emi = parseLoanMoney(r.installmentAmount);
        nextEmiAmount = emi > 0 ? emi : scheduleEmi > 0 ? scheduleEmi : null;
      }
    } else if (balance > 0 && !r.dueDate.trim()) {
      remainingInstallments += 1;
    }
  }

  const scheduleOpening = scheduleOpeningBalance(sorted, balanceMeaning);
  const savedOpening =
    options?.openingPrincipal != null && options.openingPrincipal > 0
      ? options.openingPrincipal
      : null;
  const displayOpening =
    scheduleOpening != null && scheduleOpening > 0
      ? scheduleOpening
      : savedOpening ?? inferOpeningPrincipal(sorted);

  const lastRow = n > 0 ? sorted[n - 1] : null;
  const closingBalance = lastRow?.balancePrincipal.trim()
    ? closingBalanceAfterRow(lastRow, balanceMeaning)
    : null;

  let totalInterest = scheduleAmountTotal(sorted, "interest", interestMeaning);
  let totalPrincipal = scheduleAmountTotal(sorted, "principal", principalMeaning);
  if (displayOpening != null && closingBalance != null) {
    totalPrincipal = Math.max(totalPrincipal, displayOpening - closingBalance);
  }

  const avgEmi =
    scheduleEmi > 0
      ? scheduleEmi
      : n > 0
        ? totalInstallmentAmount / n
        : options?.emiAmount != null && options.emiAmount > 0
          ? options.emiAmount
          : 0;

  const estimatedAnnualRate =
    savedRate != null && savedRate > 0
      ? savedRate
      : estimateAnnualRateFromSchedule(sorted, tenureMonths ?? n);

  const scheduleTotals = aggregateScheduleProgress(
    sorted,
    paidInstallments,
    balanceMeaning,
    interestMeaning,
    principalMeaning,
  );
  const {
    principalPaid,
    interestPaid,
    principalRemaining,
    interestRemaining,
    currentBalance,
  } = scheduleTotals;

  const emisRemaining = Math.max(0, totalInstallments - paidInstallments);
  const completionPercent =
    totalInstallments > 0 ? Math.round((paidInstallments / totalInstallments) * 100) : 0;

  const analytics: LoanScheduleAnalytics = {
    installmentCount: n,
    totalInstallmentAmount,
    totalInterest,
    totalPrincipal,
    openingPrincipal: displayOpening,
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
    currentBalance:
      currentBalance != null && currentBalance >= 0
        ? currentBalance
        : displayOpening,
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
  const emi = typicalEmiFromSchedule(prepared.rows);
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

function openingBalanceBeforeInstallment(
  sorted: LoanScheduleRow[],
  installmentNo: number,
  emi: number,
  fallbackMonthlyRate: number | null,
): number | null {
  if (installmentNo <= 1) return inferOpeningPrincipal(sorted);
  return balanceAfterInstallment(sorted, installmentNo - 1, emi, fallbackMonthlyRate);
}

function scheduleRowIndexForInstallmentStart(
  sorted: LoanScheduleRow[],
  installmentNo: number,
): number {
  if (installmentNo <= 1) return 0;
  return scheduleRowIndexAfterInstallment(sorted, installmentNo - 1);
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
  const simStartBalance = openingBalanceBeforeInstallment(
    sorted,
    anchor,
    emi,
    fallbackMonthlyRate,
  );
  if (simStartBalance == null || simStartBalance <= 0) return null;

  const dateProjection = buildScheduleDateProjection(sorted);
  const startRowIndex = scheduleRowIndexForInstallmentStart(sorted, anchor);

  const extraAtInstallment = (installmentNo: number, balanceAfterEmi: number) =>
    extraFromRules(installmentNo, balanceAfterEmi, rules);

  const baseline = simulateLoanWithPrepayments(
    sorted,
    simStartBalance,
    startRowIndex,
    anchor,
    emi,
    () => 0,
    fallbackMonthlyRate,
    false,
    tenure,
    dateProjection,
  );

  const withPlan = simulateLoanWithPrepayments(
    sorted,
    simStartBalance,
    startRowIndex,
    anchor,
    emi,
    extraAtInstallment,
    fallbackMonthlyRate,
    true,
    tenure,
    dateProjection,
  );

  const totalExtraPaid = withPlan.totalExtraPaid;
  let foreclosureLumpSum: number | null = null;
  const closeRule = rules.find((r) => r.closeLoan);
  if (closeRule) {
    const closeStep = withPlan.steps.find(
      (s) => s.installmentNo === closeRule.afterInstallment && s.extraPrepay > 0,
    );
    if (closeStep) foreclosureLumpSum = closeStep.extraPrepay;
  }

  const interestSaved = Math.max(0, baseline.totalInterest - withPlan.totalInterest);
  const monthsSaved = Math.max(0, baseline.months - withPlan.months);
  const lastStep = withPlan.steps[withPlan.steps.length - 1];
  const paidOffEarly =
    lastStep != null &&
    lastStep.closingBalance <= 0.5 &&
    withPlan.months < baseline.months;
  const newRemainingMonths = paidOffEarly ? 0 : withPlan.months;

  return {
    afterInstallment: anchor,
    interestSaved,
    monthsSaved,
    originalRemainingMonths: baseline.months,
    newRemainingMonths,
    originalTotalInterest: baseline.totalInterest,
    newTotalInterest: withPlan.totalInterest,
    totalExtraPaid,
    foreclosureLumpSum,
    schedulePreview: withPlan.steps,
  };
}
