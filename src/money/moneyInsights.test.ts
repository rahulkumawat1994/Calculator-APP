import { describe, expect, it } from "vitest";
import type { MoneyTransaction } from "./moneyTypes";
import { isLoanTransaction } from "./moneyAnalytics";
import type { CategoryBreakdown, MonthlyBreakdown } from "./moneyAnalytics";
import { computeLoanGroups, computeMoneyInsights } from "./moneyInsights";

function txn(partial: Partial<MoneyTransaction> & Pick<MoneyTransaction, "id">): MoneyTransaction {
  return {
    account: "",
    date: null,
    dateRaw: "",
    num: "",
    transaction: "",
    memo: "",
    category: "Uncategorized",
    payment: 0,
    deposit: 0,
    ...partial,
  };
}

describe("isLoanTransaction", () => {
  it("detects EMI and loan categories", () => {
    expect(
      isLoanTransaction(txn({ id: "1", category: "Loan", payment: 5000, transaction: "HDFC EMI" })),
    ).toBe(true);
    expect(isLoanTransaction(txn({ id: "2", category: "Food", payment: 100 }))).toBe(false);
    expect(
      isLoanTransaction(txn({ id: "3", category: "Transfer", payment: 5000, transaction: "Transfer" })),
    ).toBe(false);
  });
});

describe("computeLoanGroups", () => {
  it("groups recurring loan payees", () => {
    const rows = [
      txn({ id: "1", category: "Loan", payment: 10000, transaction: "Home EMI", date: new Date(2025, 0, 5) }),
      txn({ id: "2", category: "Loan", payment: 10000, transaction: "Home EMI", date: new Date(2025, 1, 5) }),
      txn({ id: "3", category: "Loan", payment: 3000, transaction: "Car EMI", date: new Date(2025, 0, 10) }),
    ];
    const groups = computeLoanGroups(rows, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe("Home EMI");
    expect(groups[0]?.typicalEmi).toBe(10000);
  });
});

describe("computeMoneyInsights", () => {
  it("builds loan and savings recommendations", () => {
    const rows = [
      txn({ id: "1", deposit: 80000, date: new Date(2025, 0, 1), category: "Salary" }),
      txn({ id: "2", payment: 15000, date: new Date(2025, 0, 5), category: "Loan", transaction: "Home EMI" }),
      txn({ id: "3", payment: 8000, date: new Date(2025, 0, 8), category: "Food" }),
      txn({ id: "4", deposit: 80000, date: new Date(2025, 1, 1), category: "Salary" }),
      txn({ id: "5", payment: 15000, date: new Date(2025, 1, 5), category: "Loan", transaction: "Home EMI" }),
      txn({ id: "6", payment: 9000, date: new Date(2025, 1, 8), category: "Food" }),
    ];
    const monthly: MonthlyBreakdown[] = [
      { month: "2025-01", income: 80000, expenses: 23000, net: 57000, count: 3 },
      { month: "2025-02", income: 80000, expenses: 24000, net: 56000, count: 3 },
    ];
    const categories: CategoryBreakdown[] = [
      { category: "Loan", expenses: 30000, income: 0, net: -30000, count: 2 },
      { category: "Food", expenses: 17000, income: 0, net: -17000, count: 2 },
    ];
    const insights = computeMoneyInsights(rows, monthly, categories, {});
    expect(insights.loanGroups).toHaveLength(1);
    expect(insights.avgMonthlyLoanPayments).toBe(15000);
    expect(insights.recommendations.length).toBeGreaterThan(0);
    expect(insights.savingsOpportunities[0]?.category).toBe("Food");
  });
});
