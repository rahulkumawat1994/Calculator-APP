import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";

/** DD/MM/YYYY, D/M/YYYY, and ISO-style dates in schedule cells. */
export const LOAN_SCHEDULE_DATE_RE =
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/;

/** Indian lakh grouping (5,88,802), western thousands, plain integers. */
export const LOAN_SCHEDULE_AMOUNT_RE =
  /\b(?:\d{1,3}(?:,\d{2,3})*(?:,\d{3})?|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b/;

export const LOAN_SCHEDULE_INST_NO_RE = /^\d{1,4}$/;

export function loanScheduleRowLooksLikeData(row: LoanScheduleRow): boolean {
  const inst = row.installmentNo.trim();
  const full = [
    row.installmentNo,
    row.dueDate,
    row.installmentAmount,
    row.interest,
    row.principal,
    row.balancePrincipal,
  ].join(" ");

  if (LOAN_SCHEDULE_INST_NO_RE.test(inst)) {
    if (LOAN_SCHEDULE_DATE_RE.test(full) || LOAN_SCHEDULE_AMOUNT_RE.test(full)) return true;
  }

  if (!LOAN_SCHEDULE_DATE_RE.test(full)) return false;

  if (LOAN_SCHEDULE_DATE_RE.test(row.dueDate.trim())) return true;
  if (LOAN_SCHEDULE_AMOUNT_RE.test(row.installmentAmount)) return true;
  if (LOAN_SCHEDULE_AMOUNT_RE.test(row.interest)) return true;
  if (LOAN_SCHEDULE_AMOUNT_RE.test(row.principal)) return true;
  if (LOAN_SCHEDULE_AMOUNT_RE.test(row.balancePrincipal)) return true;
  if (LOAN_SCHEDULE_INST_NO_RE.test(inst)) return true;

  return LOAN_SCHEDULE_AMOUNT_RE.test(full);
}
