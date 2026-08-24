import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";
import {
  emiFromAnnualRate,
  generateAmortizationSchedule,
  type LoanPartPayment,
} from "./loanCalc";

export type PartPaymentDraft = {
  id: string;
  date: string;
  amount: string;
};

export function parsePartPaymentDrafts(drafts: PartPaymentDraft[]): LoanPartPayment[] {
  const out: LoanPartPayment[] = [];
  for (const p of drafts) {
    const amount = parseMoneyInput(p.amount);
    if (amount == null || amount <= 0) continue;
    const d = p.date.trim();
    if (!d) continue;
    const ms = new Date(`${d}T12:00:00`).getTime();
    if (Number.isNaN(ms)) continue;
    out.push({ dateMs: ms, amount });
  }
  return out.sort((a, b) => a.dateMs - b.dateMs);
}

export function partPaymentRecordsFromDrafts(
  drafts: PartPaymentDraft[],
): { date: string; amount: number }[] {
  return parsePartPaymentDrafts(drafts).map((p) => ({
    date: new Date(p.dateMs).toISOString().slice(0, 10),
    amount: p.amount,
  }));
}

export function partPaymentsFromRecords(
  records: { date: string; amount: number }[],
): LoanPartPayment[] {
  const out: LoanPartPayment[] = [];
  for (const r of records) {
    const ms = new Date(`${r.date.trim()}T12:00:00`).getTime();
    if (!Number.isNaN(ms) && r.amount > 0) out.push({ dateMs: ms, amount: r.amount });
  }
  return out.sort((a, b) => a.dateMs - b.dateMs);
}

export function parseBoundedInt(raw: string, min: number, max: number, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseMoneyInput(raw: string): number | null {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function isoDateFromDueDateText(dueDate: string): string {
  const t = dueDate.trim();
  const dmy = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const ymd = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, "0")}-${ymd[3]!.padStart(2, "0")}`;
  return "";
}

export function previewLoanTerms(
  principalInput: string,
  rateInput: string,
  tenureInput: string,
  startDate: string,
  partPaymentDrafts?: PartPaymentDraft[],
): {
  principal: number;
  rate: number;
  tenure: number;
  emi: number;
  rows: LoanScheduleRow[];
  partPaymentCount: number;
  partPaymentTotal: number;
} | null {
  const principal = parseMoneyInput(principalInput);
  const rate = parseMoneyInput(rateInput);
  const tenure = parseBoundedInt(tenureInput, 1, 600, 0);
  if (principal == null || principal <= 0 || rate == null || rate < 0 || tenure <= 0) {
    return null;
  }
  const start =
    startDate.trim() !== "" ? new Date(`${startDate.trim()}T12:00:00`) : undefined;
  const startValid = start && !Number.isNaN(start.getTime()) ? start : undefined;
  const partPayments = parsePartPaymentDrafts(partPaymentDrafts ?? []);
  const rows = generateAmortizationSchedule(
    principal,
    rate,
    tenure,
    startValid,
    partPayments.length > 0 ? partPayments : undefined,
  );
  return {
    principal,
    rate,
    tenure,
    emi: emiFromAnnualRate(principal, rate, tenure),
    rows,
    partPaymentCount: partPayments.length,
    partPaymentTotal: partPayments.reduce((s, p) => s + p.amount, 0),
  };
}
