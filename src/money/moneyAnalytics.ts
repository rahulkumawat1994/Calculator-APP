import type { MoneyTransaction } from "./moneyTypes";
import { isDateInRange } from "./moneyDateFilter";

export type MoneyAnalyticsContext = {
  creditCardAccounts?: ReadonlySet<string>;
};

function effectiveFlow(
  t: MoneyTransaction,
  ctx: MoneyAnalyticsContext,
): { expense: number; income: number } {
  const isCreditCard = ctx.creditCardAccounts?.has(t.account.trim()) ?? false;
  if (isCreditCard) {
    // Card charges = debits; credits on card = bill payments, not income.
    return { expense: t.payment, income: 0 };
  }
  return { expense: t.payment, income: t.deposit };
}

export type MoneySummary = {
  totalIncome: number;
  totalExpenses: number;
  net: number;
  transactionCount: number;
  expenseCount: number;
  incomeCount: number;
  avgExpense: number;
  avgIncome: number;
  dateRange: { from: Date | null; to: Date | null };
};

export type CategoryBreakdown = {
  category: string;
  expenses: number;
  income: number;
  net: number;
  count: number;
};

export type MonthlyBreakdown = {
  month: string;
  expenses: number;
  income: number;
  net: number;
  count: number;
};

export type AccountBreakdown = {
  account: string;
  expenses: number;
  income: number;
  net: number;
  count: number;
  isCreditCard: boolean;
  /** Bill payments on credit cards (raw deposits, excluded from income totals). */
  cardPayments: number;
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Account-to-account moves — category, payee, or memo usually says "transfer". */
export function isTransferTransaction(t: MoneyTransaction): boolean {
  const cat = t.category.trim();
  if (/\btransfer\b/i.test(cat)) return true;
  if (/^\[[^\]]+\]$/.test(cat)) return true;
  const hay = `${t.transaction} ${t.memo}`.trim();
  if (/\btransfer\b|\bxfr\b/i.test(hay)) return true;
  return false;
}

export function countTransferTransactions(rows: MoneyTransaction[]): number {
  return rows.reduce((n, r) => (isTransferTransaction(r) ? n + 1 : n), 0);
}

const LOAN_HAY_RE =
  /\bloan\b|\bemi\b|\bmortgage\b|\bhousing loan\b|\bhome loan\b|\bcar loan\b|\bauto loan\b|\bpersonal loan\b|\beducation loan\b|\bstudent loan\b|\bhl\b|\bpl\b/i;

export function isLoanTransaction(t: MoneyTransaction): boolean {
  if (isTransferTransaction(t)) return false;
  if (t.payment <= 0) return false;
  const cat = t.category.trim();
  if (/^(loan|loans|debt|emi)\b/i.test(cat)) return true;
  const hay = `${cat} ${t.transaction} ${t.memo}`;
  return LOAN_HAY_RE.test(hay);
}

export function computeMoneySummary(
  rows: MoneyTransaction[],
  ctx: MoneyAnalyticsContext = {},
): MoneySummary {
  let totalIncome = 0;
  let totalExpenses = 0;
  let expenseCount = 0;
  let incomeCount = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const r of rows) {
    const { expense, income } = effectiveFlow(r, ctx);
    totalExpenses += expense;
    totalIncome += income;
    if (expense > 0) expenseCount++;
    if (income > 0) incomeCount++;
    if (r.date) {
      if (!minDate || r.date < minDate) minDate = r.date;
      if (!maxDate || r.date > maxDate) maxDate = r.date;
    }
  }

  return {
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    transactionCount: rows.length,
    expenseCount,
    incomeCount,
    avgExpense: expenseCount > 0 ? totalExpenses / expenseCount : 0,
    avgIncome: incomeCount > 0 ? totalIncome / incomeCount : 0,
    dateRange: { from: minDate, to: maxDate },
  };
}

export function computeCategoryBreakdown(
  rows: MoneyTransaction[],
  ctx: MoneyAnalyticsContext = {},
): CategoryBreakdown[] {
  const map = new Map<string, CategoryBreakdown>();

  for (const r of rows) {
    const { expense, income } = effectiveFlow(r, ctx);
    const cat = r.category.trim() || "Uncategorized";
    let entry = map.get(cat);
    if (!entry) {
      entry = { category: cat, expenses: 0, income: 0, net: 0, count: 0 };
      map.set(cat, entry);
    }
    entry.expenses += expense;
    entry.income += income;
    entry.net = entry.income - entry.expenses;
    entry.count++;
  }

  return [...map.values()].sort((a, b) => b.expenses - a.expenses);
}

export function computeMonthlyBreakdown(
  rows: MoneyTransaction[],
  ctx: MoneyAnalyticsContext = {},
): MonthlyBreakdown[] {
  const map = new Map<string, MonthlyBreakdown>();

  for (const r of rows) {
    if (!r.date) continue;
    const { expense, income } = effectiveFlow(r, ctx);
    const key = monthKey(r.date);
    let entry = map.get(key);
    if (!entry) {
      entry = { month: key, expenses: 0, income: 0, net: 0, count: 0 };
      map.set(key, entry);
    }
    entry.expenses += expense;
    entry.income += income;
    entry.net = entry.income - entry.expenses;
    entry.count++;
  }

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function computeAccountBreakdown(
  rows: MoneyTransaction[],
  ctx: MoneyAnalyticsContext = {},
): AccountBreakdown[] {
  const map = new Map<string, AccountBreakdown>();

  for (const r of rows) {
    const acct = r.account.trim() || "Unknown account";
    const isCreditCard = ctx.creditCardAccounts?.has(acct) ?? false;
    let entry = map.get(acct);
    if (!entry) {
      entry = {
        account: acct,
        expenses: 0,
        income: 0,
        net: 0,
        count: 0,
        isCreditCard,
        cardPayments: 0,
      };
      map.set(acct, entry);
    }
    const { expense, income } = effectiveFlow(r, ctx);
    entry.expenses += expense;
    entry.income += income;
    if (isCreditCard && r.deposit > 0) entry.cardPayments += r.deposit;
    entry.net = entry.income - entry.expenses;
    entry.count++;
  }

  return [...map.values()].sort((a, b) => b.expenses - a.expenses);
}

export function filterMoneyTransactions(
  rows: MoneyTransaction[],
  opts: {
    account?: string;
    category?: string;
    search?: string;
    from?: Date | null;
    to?: Date | null;
    type?: "all" | "expense" | "income";
    hideTransfers?: boolean;
    loansOnly?: boolean;
    excludeLoans?: boolean;
    minAmount?: number;
    maxAmount?: number;
  },
): MoneyTransaction[] {
  const q = opts.search?.trim().toLowerCase() ?? "";

  return rows.filter((r) => {
    if (opts.hideTransfers && isTransferTransaction(r)) return false;
    if (opts.loansOnly && !isLoanTransaction(r)) return false;
    if (opts.excludeLoans && isLoanTransaction(r)) return false;
    if (opts.account && opts.account !== "all" && r.account !== opts.account) return false;
    if (opts.category && opts.category !== "all" && r.category !== opts.category) return false;
    if (opts.type === "expense" && r.payment <= 0) return false;
    if (opts.type === "income" && r.deposit <= 0) return false;
    if ((opts.from || opts.to) && (!r.date || !isDateInRange(r.date, opts.from ?? null, opts.to ?? null))) {
      return false;
    }
    const rowAmount = Math.max(r.payment, r.deposit);
    if (opts.minAmount != null && opts.minAmount > 0 && rowAmount < opts.minAmount) return false;
    if (opts.maxAmount != null && opts.maxAmount > 0 && rowAmount > opts.maxAmount) return false;
    if (q) {
      const hay = `${r.transaction} ${r.memo} ${r.category} ${r.account} ${r.num}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function topExpenseCategories(
  breakdown: CategoryBreakdown[],
  limit = 8,
): CategoryBreakdown[] {
  return breakdown.filter((c) => c.expenses > 0).slice(0, limit);
}

export function largestExpenses(rows: MoneyTransaction[], limit = 10): MoneyTransaction[] {
  return [...rows]
    .filter((r) => r.payment > 0)
    .sort((a, b) => b.payment - a.payment)
    .slice(0, limit);
}
