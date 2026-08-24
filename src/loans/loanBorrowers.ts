const LS_BORROWERS_KEY = "loan-borrowers-v1";
const LS_ACTIVE_BORROWER_KEY = "loan-active-borrower-v1";

export type LoanBorrower = {
  id: string;
  name: string;
};

export const DEFAULT_LOAN_BORROWER_ID = "me";

const DEFAULT_BORROWERS: LoanBorrower[] = [{ id: "me", name: "Me" }];

function slugifyBorrowerId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "borrower";
}

function newBorrowerId(name: string, existing: LoanBorrower[]): string {
  const base = slugifyBorrowerId(name);
  if (!existing.some((b) => b.id === base)) return base;
  let n = 2;
  while (existing.some((b) => b.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function loadLoanBorrowers(): LoanBorrower[] {
  if (typeof window === "undefined") return [...DEFAULT_BORROWERS];
  try {
    const raw = localStorage.getItem(LS_BORROWERS_KEY);
    if (!raw) return [...DEFAULT_BORROWERS];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [...DEFAULT_BORROWERS];
    const out: LoanBorrower[] = [];
    for (const x of data) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.name === "string" && o.id.length > 0) {
        out.push({ id: o.id, name: o.name.trim() || o.id });
      }
    }
    if (!out.some((b) => b.id === DEFAULT_LOAN_BORROWER_ID)) {
      out.unshift({ id: DEFAULT_LOAN_BORROWER_ID, name: "Me" });
    }
    return out;
  } catch {
    return [...DEFAULT_BORROWERS];
  }
}

export function persistLoanBorrowers(borrowers: LoanBorrower[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_BORROWERS_KEY, JSON.stringify(borrowers));
  } catch {
    /* quota */
  }
}

export function loadActiveLoanBorrowerId(): string {
  if (typeof window === "undefined") return DEFAULT_LOAN_BORROWER_ID;
  try {
    const raw = localStorage.getItem(LS_ACTIVE_BORROWER_KEY);
    if (raw && raw.trim().length > 0) return raw.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_LOAN_BORROWER_ID;
}

export function persistActiveLoanBorrowerId(borrowerId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_ACTIVE_BORROWER_KEY, borrowerId);
  } catch {
    /* quota */
  }
}

export function resolveActiveLoanBorrowerId(
  borrowers: LoanBorrower[],
  preferredId?: string,
): string {
  if (borrowers.length === 0) return DEFAULT_LOAN_BORROWER_ID;
  const ids = new Set(borrowers.map((b) => b.id));
  const pref = preferredId?.trim();
  if (pref && ids.has(pref)) return pref;
  if (ids.has(DEFAULT_LOAN_BORROWER_ID)) return DEFAULT_LOAN_BORROWER_ID;
  return borrowers[0]!.id;
}

export function addLoanBorrower(
  borrowers: LoanBorrower[],
  name: string,
): { borrowers: LoanBorrower[]; newId: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name." };
  const id = newBorrowerId(trimmed, borrowers);
  const next = [...borrowers, { id, name: trimmed }];
  persistLoanBorrowers(next);
  return { borrowers: next, newId: id };
}

export function renameLoanBorrower(
  borrowers: LoanBorrower[],
  borrowerId: string,
  name: string,
): { borrowers: LoanBorrower[] } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name." };
  if (!borrowers.some((b) => b.id === borrowerId)) return { error: "Person not found." };
  const next = borrowers.map((b) => (b.id === borrowerId ? { ...b, name: trimmed } : b));
  persistLoanBorrowers(next);
  return { borrowers: next };
}

export function removeLoanBorrower(
  borrowers: LoanBorrower[],
  borrowerId: string,
): { borrowers: LoanBorrower[]; fallbackId: string } | { error: string } {
  if (borrowers.length <= 1) return { error: "Keep at least one person." };
  if (!borrowers.some((b) => b.id === borrowerId)) return { error: "Person not found." };
  const next = borrowers.filter((b) => b.id !== borrowerId);
  persistLoanBorrowers(next);
  return { borrowers: next, fallbackId: next[0]!.id };
}

const LS_COLUMN_BOUNDS_PREFIX = "loan-column-boundaries-v1";

export function persistLoanColumnBoundariesForLoan(loanDocId: string, boundaries: number[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LS_COLUMN_BOUNDS_PREFIX}:${loanDocId}`, JSON.stringify(boundaries));
  } catch {
    /* quota */
  }
}

const LS_EMIS_PAID_PREFIX = "loan-emis-paid-v1";

export function loadEmisPaidForLoan(loanDocId: string): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${LS_EMIS_PAID_PREFIX}:${loanDocId}`);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

export function persistEmisPaidForLoan(loanDocId: string, count: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LS_EMIS_PAID_PREFIX}:${loanDocId}`, String(Math.max(0, Math.round(count))));
  } catch {
    /* quota */
  }
}

export function clearEmisPaidForLoan(loanDocId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(`${LS_EMIS_PAID_PREFIX}:${loanDocId}`);
  } catch {
    /* ignore */
  }
}
