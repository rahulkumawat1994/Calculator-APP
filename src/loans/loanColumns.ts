/** Repayment schedule column fields (user-configurable order). */
export type LoanColumnId =
  | "installmentNo"
  | "dueDate"
  | "installmentAmount"
  | "interest"
  | "principal"
  | "balancePrincipal";

export const ALL_LOAN_COLUMNS: LoanColumnId[] = [
  "installmentNo",
  "dueDate",
  "installmentAmount",
  "interest",
  "principal",
  "balancePrincipal",
];

export const LOAN_COLUMN_LABELS: Record<LoanColumnId, string> = {
  installmentNo: "Installment no.",
  dueDate: "Due date",
  installmentAmount: "Installment amount",
  interest: "Interest",
  principal: "Principal",
  balancePrincipal: "Balance principal",
};

/** Header text patterns used to locate column X positions in PDF. */
export const LOAN_COLUMN_HEADER_PATTERNS: Record<LoanColumnId, RegExp> = {
  installmentNo:
    /\b(?:INSTALLMENT\s*NO\.?|INST\.?\s*NO\.?|SR\.?\s*NO\.?|S\.?\s*NO\.?|#\s*NO\.?)\b/i,
  dueDate: /\b(?:DUE\s*DATE|SCH\.?\s*DATE|REPAYMENT\s*DATE)\b/i,
  installmentAmount:
    /\b(?:INSTALLMENT\s*(?:AMT\.?|AMOUNT)|EMI\s*AMT\.?|EMI\s*AMOUNT|TOTAL\s*EMI)\b/i,
  interest: /\b(?:INTEREST|INT\.?)\b/i,
  principal: /\b(?:PRINCIPAL|PRIN\.?)\b(?!\s*BALANCE)/i,
  balancePrincipal:
    /\b(?:BALANCE\s*PRINCIPAL|OUTSTANDING|OS\s*BAL\.?|PRINCIPAL\s*BALANCE|BAL\.?\s*PRINCIPAL|CLOSING\s*BAL)\b/i,
};

export const DEFAULT_LOAN_COLUMN_ORDER: LoanColumnId[] = [...ALL_LOAN_COLUMNS];
