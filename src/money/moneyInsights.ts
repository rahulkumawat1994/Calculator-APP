import type { CategoryBreakdown, MonthlyBreakdown, MoneyAnalyticsContext } from "./moneyAnalytics";
import { isLoanTransaction, isTransferTransaction } from "./moneyAnalytics";
import type { MoneyTransaction } from "./moneyTypes";

export type LoanPaymentGroup = {
  label: string;
  monthlyAvg: number;
  totalPaid: number;
  paymentCount: number;
  typicalEmi: number;
};

export type SavingsOpportunity = {
  category: string;
  monthlyAvg: number;
  pctOfSpending: number;
  trimPct: number;
  potentialMonthlySave: number;
};

export type InsightRecommendation = {
  tone: "positive" | "warning" | "action";
  title: string;
  detail: string;
};

export type LoanMonthlyPoint = {
  month: string;
  amount: number;
};

export type MoneyInsights = {
  monthCount: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  avgMonthlyNet: number;
  avgMonthlyLoanPayments: number;
  loanShareOfIncomePct: number;
  loanGroups: LoanPaymentGroup[];
  loanMonthly: LoanMonthlyPoint[];
  savingsOpportunities: SavingsOpportunity[];
  recommendations: InsightRecommendation[];
  monthlyTrend: "improving" | "worsening" | "stable";
  suggestedExtraLoanPayment: number;
  projectedAnnualSavings: number;
};

const SKIP_SAVINGS_CATEGORY_RE =
  /\btransfer\b|\bloan\b|\bemi\b|\bmortgage\b|\btax\b|\bsalary\b|\bpayroll\b|\bincome\b|\binsurance\b|\brent\b|\butility\b|\bbill\b|\binterest earned\b/i;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function effectiveExpense(t: MoneyTransaction, ctx: MoneyAnalyticsContext): number {
  const isCreditCard = ctx.creditCardAccounts?.has(t.account.trim()) ?? false;
  if (isCreditCard) return t.payment;
  return t.payment;
}

function loanLabel(t: MoneyTransaction): string {
  const tx = t.transaction.trim();
  if (tx) return tx;
  return t.category.trim() || "Loan payment";
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function computeLoanGroups(
  rows: MoneyTransaction[],
  monthCount: number,
): LoanPaymentGroup[] {
  const map = new Map<string, { amounts: number[]; total: number }>();

  for (const r of rows) {
    if (!isLoanTransaction(r)) continue;
    const label = loanLabel(r);
    let entry = map.get(label);
    if (!entry) {
      entry = { amounts: [], total: 0 };
      map.set(label, entry);
    }
    entry.amounts.push(r.payment);
    entry.total += r.payment;
  }

  const months = Math.max(monthCount, 1);
  return [...map.entries()]
    .map(([label, { amounts, total }]) => ({
      label,
      monthlyAvg: total / months,
      totalPaid: total,
      paymentCount: amounts.length,
      typicalEmi: median(amounts),
    }))
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg);
}

export function computeLoanMonthly(
  rows: MoneyTransaction[],
): LoanMonthlyPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!isLoanTransaction(r) || !r.date) continue;
    const key = monthKey(r.date);
    map.set(key, (map.get(key) ?? 0) + r.payment);
  }
  return [...map.entries()]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function monthlyTrend(monthly: MonthlyBreakdown[]): "improving" | "worsening" | "stable" {
  if (monthly.length < 4) return "stable";
  const recent = monthly.slice(-3);
  const prior = monthly.slice(-6, -3);
  if (prior.length === 0) return "stable";
  const recentAvg = recent.reduce((s, m) => s + m.net, 0) / recent.length;
  const priorAvg = prior.reduce((s, m) => s + m.net, 0) / prior.length;
  const delta = recentAvg - priorAvg;
  if (Math.abs(delta) < 500) return "stable";
  return delta > 0 ? "improving" : "worsening";
}

export function computeSavingsOpportunities(
  categories: CategoryBreakdown[],
  monthCount: number,
  totalExpenses: number,
): SavingsOpportunity[] {
  const months = Math.max(monthCount, 1);
  const total = totalExpenses > 0 ? totalExpenses : 1;

  return categories
    .filter((c) => c.expenses > 0 && !SKIP_SAVINGS_CATEGORY_RE.test(c.category))
    .map((c) => {
      const monthlyAvg = c.expenses / months;
      const pctOfSpending = (c.expenses / total) * 100;
      const trimPct = pctOfSpending >= 15 ? 15 : pctOfSpending >= 8 ? 10 : 5;
      return {
        category: c.category,
        monthlyAvg,
        pctOfSpending,
        trimPct,
        potentialMonthlySave: monthlyAvg * (trimPct / 100),
      };
    })
    .sort((a, b) => b.potentialMonthlySave - a.potentialMonthlySave)
    .slice(0, 6);
}

function buildRecommendations(input: {
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  avgMonthlyNet: number;
  avgMonthlyLoanPayments: number;
  loanShareOfIncomePct: number;
  loanGroups: LoanPaymentGroup[];
  savingsOpportunities: SavingsOpportunity[];
  monthlyTrend: MoneyInsights["monthlyTrend"];
  suggestedExtraLoanPayment: number;
  projectedAnnualSavings: number;
}): InsightRecommendation[] {
  const recs: InsightRecommendation[] = [];

  if (input.avgMonthlyIncome <= 0 && input.avgMonthlyExpenses > 0) {
    recs.push({
      tone: "warning",
      title: "No regular income detected",
      detail:
        "Credits look irregular in this period. Use Last 12 months or All time so salary deposits are included before following loan or savings advice.",
    });
  }

  if (input.avgMonthlyNet < 0) {
    recs.push({
      tone: "warning",
      title: "Spending is above income",
      detail: `You are short by about ${formatInsightMoney(-input.avgMonthlyNet)} per month on average. Pause new debt and trim discretionary categories before increasing loan payments.`,
    });
  } else if (input.avgMonthlyNet > 0) {
    recs.push({
      tone: "positive",
      title: "You have room to save",
      detail: `Average surplus is about ${formatInsightMoney(input.avgMonthlyNet)} per month after expenses. This is the pool you can use for extra loan payments or an emergency fund.`,
    });
  }

  if (input.loanGroups.length > 0) {
    if (input.loanShareOfIncomePct >= 40) {
      recs.push({
        tone: "warning",
        title: "Loans take a large share of income",
        detail: `Loan/EMI payments are about ${input.loanShareOfIncomePct.toFixed(0)}% of average monthly income. Target getting this below 35% by cutting discretionary spend or increasing income.`,
      });
    }

    const top = input.loanGroups[0]!;
    recs.push({
      tone: "action",
      title: "Focus extra payments on one loan",
      detail: `Your largest recurring payment looks like “${top.label}” (~${formatInsightMoney(top.typicalEmi || top.monthlyAvg)}/mo). Pay the minimum on others and put any extra toward this one (debt avalanche), or clear the smallest balance first for quick wins (debt snowball).`,
    });

    if (input.suggestedExtraLoanPayment > 0) {
      recs.push({
        tone: "action",
        title: "Suggested extra loan payment",
        detail: `Based on your surplus and trimmable spending, try an extra ${formatInsightMoney(input.suggestedExtraLoanPayment)}/month toward loans. Even small extra EMIs reduce total interest and shorten the payoff timeline.`,
      });
    }
  } else {
    recs.push({
      tone: "action",
      title: "No loan payments detected",
      detail:
        "Tag loan/EMI rows in your register with categories like “Loan” or payee names containing “EMI” so this section can track payoff progress.",
    });
  }

  if (input.savingsOpportunities.length > 0) {
    const top = input.savingsOpportunities[0]!;
    recs.push({
      tone: "action",
      title: "Easiest place to cut spending",
      detail: `“${top.category}” averages ${formatInsightMoney(top.monthlyAvg)}/mo (${top.pctOfSpending.toFixed(0)}% of spending). Trimming ~${top.trimPct}% saves about ${formatInsightMoney(top.potentialMonthlySave)}/month.`,
    });
  }

  if (input.projectedAnnualSavings > 0) {
    recs.push({
      tone: "positive",
      title: "Savings potential from history",
      detail: `If you apply modest cuts to top discretionary categories, you could free up about ${formatInsightMoney(input.projectedAnnualSavings)}/year for loans or savings.`,
    });
  }

  if (input.monthlyTrend === "improving") {
    recs.push({
      tone: "positive",
      title: "Trend is improving",
      detail: "Your net savings in recent months are better than the prior quarter. Keep the same discipline and route the improvement toward debt payoff.",
    });
  } else if (input.monthlyTrend === "worsening") {
    recs.push({
      tone: "warning",
      title: "Trend is worsening",
      detail: "Recent months save less (or overspend more) than before. Review the largest debit categories and set a fixed monthly spending cap.",
    });
  }

  return recs;
}

function formatInsightMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function computeMoneyInsights(
  rows: MoneyTransaction[],
  monthly: MonthlyBreakdown[],
  categories: CategoryBreakdown[],
  ctx: MoneyAnalyticsContext,
): MoneyInsights {
  const monthCount = Math.max(monthly.length, 1);
  const avgMonthlyIncome =
    monthly.reduce((s, m) => s + m.income, 0) / monthCount;
  const avgMonthlyExpenses =
    monthly.reduce((s, m) => s + m.expenses, 0) / monthCount;
  const avgMonthlyNet = avgMonthlyIncome - avgMonthlyExpenses;

  const loanRows = rows.filter(isLoanTransaction);
  const loanGroups = computeLoanGroups(loanRows, monthCount);
  const loanMonthly = computeLoanMonthly(loanRows);
  const totalLoanPaid = loanRows.reduce((s, r) => s + effectiveExpense(r, ctx), 0);
  const avgMonthlyLoanPayments = totalLoanPaid / monthCount;
  const loanShareOfIncomePct =
    avgMonthlyIncome > 0 ? (avgMonthlyLoanPayments / avgMonthlyIncome) * 100 : 0;

  const totalExpenses = categories.reduce((s, c) => s + c.expenses, 0);
  const savingsOpportunities = computeSavingsOpportunities(
    categories,
    monthCount,
    totalExpenses,
  );
  const projectedMonthlySavings = savingsOpportunities.reduce(
    (s, o) => s + o.potentialMonthlySave,
    0,
  );
  const projectedAnnualSavings = projectedMonthlySavings * 12;

  const surplus = Math.max(avgMonthlyNet, 0);
  const halfSurplus = surplus * 0.5;
  const trimPool = projectedMonthlySavings * 0.5;
  const suggestedExtraLoanPayment =
    loanGroups.length > 0 ? Math.round(Math.min(halfSurplus + trimPool, surplus + trimPool)) : 0;

  const trend = monthlyTrend(monthly);

  const recommendations = buildRecommendations({
    avgMonthlyIncome,
    avgMonthlyExpenses,
    avgMonthlyNet,
    avgMonthlyLoanPayments,
    loanShareOfIncomePct,
    loanGroups,
    savingsOpportunities,
    monthlyTrend: trend,
    suggestedExtraLoanPayment,
    projectedAnnualSavings,
  });

  return {
    monthCount,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    avgMonthlyNet,
    avgMonthlyLoanPayments,
    loanShareOfIncomePct,
    loanGroups,
    loanMonthly,
    savingsOpportunities,
    recommendations,
    monthlyTrend: trend,
    suggestedExtraLoanPayment,
    projectedAnnualSavings,
  };
}

export function mergeChartMonths(
  monthly: MonthlyBreakdown[],
  loanMonthly: LoanMonthlyPoint[],
): Array<MonthlyBreakdown & { loanPayments: number }> {
  const loanMap = new Map(loanMonthly.map((l) => [l.month, l.amount]));
  return monthly.map((m) => ({
    ...m,
    loanPayments: loanMap.get(m.month) ?? 0,
  }));
}
