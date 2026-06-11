import { describe, expect, it } from "vitest";
import {
  computeCategoryBreakdown,
  computeMoneySummary,
  computeMonthlyBreakdown,
  computeAccountBreakdown,
  countTransferTransactions,
  filterMoneyTransactions,
  isTransferTransaction,
} from "./moneyAnalytics";
import type { MoneyTransaction } from "./moneyTypes";

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

describe("computeMoneySummary", () => {
  it("sums income, expenses, and net", () => {
    const rows = [
      txn({ id: "1", payment: 100, deposit: 0 }),
      txn({ id: "2", payment: 50, deposit: 0 }),
      txn({ id: "3", payment: 0, deposit: 500 }),
    ];
    const s = computeMoneySummary(rows);
    expect(s.totalExpenses).toBe(150);
    expect(s.totalIncome).toBe(500);
    expect(s.net).toBe(350);
    expect(s.expenseCount).toBe(2);
    expect(s.incomeCount).toBe(1);
  });
});

describe("computeCategoryBreakdown", () => {
  it("groups by category", () => {
    const rows = [
      txn({ id: "1", category: "Food", payment: 200 }),
      txn({ id: "2", category: "Food", payment: 100 }),
      txn({ id: "3", category: "Salary", deposit: 1000 }),
    ];
    const cats = computeCategoryBreakdown(rows);
    const food = cats.find((c) => c.category === "Food");
    expect(food?.expenses).toBe(300);
    expect(food?.count).toBe(2);
  });
});

describe("computeMonthlyBreakdown", () => {
  it("groups by month", () => {
    const rows = [
      txn({ id: "1", date: new Date(2025, 0, 15), payment: 100 }),
      txn({ id: "2", date: new Date(2025, 0, 20), deposit: 500 }),
      txn({ id: "3", date: new Date(2025, 1, 1), payment: 50 }),
    ];
    const months = computeMonthlyBreakdown(rows);
    expect(months).toHaveLength(2);
    expect(months[0].month).toBe("2025-01");
    expect(months[0].expenses).toBe(100);
    expect(months[0].income).toBe(500);
  });
});

describe("filterMoneyTransactions", () => {
  it("filters by type and search", () => {
    const rows = [
      txn({ id: "1", transaction: "Grocery store", payment: 50 }),
      txn({ id: "2", transaction: "Salary", deposit: 1000 }),
    ];
    const expenses = filterMoneyTransactions(rows, { type: "expense" });
    expect(expenses).toHaveLength(1);
    const search = filterMoneyTransactions(rows, { search: "salary" });
    expect(search).toHaveLength(1);
  });

  it("hides transfers when hideTransfers is true", () => {
    const rows = [
      txn({ id: "1", category: "Transfer", payment: 500 }),
      txn({ id: "2", category: "Food", payment: 50 }),
      txn({ id: "3", category: "[Savings]", deposit: 500 }),
    ];
    expect(countTransferTransactions(rows)).toBe(2);
    const hidden = filterMoneyTransactions(rows, { hideTransfers: true });
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.category).toBe("Food");
  });
});

describe("isTransferTransaction", () => {
  it("detects transfer category and bracket account names", () => {
    expect(isTransferTransaction(txn({ id: "1", category: "Transfer" }))).toBe(true);
    expect(isTransferTransaction(txn({ id: "2", category: "[Checking Account]" }))).toBe(true);
    expect(isTransferTransaction(txn({ id: "3", transaction: "Transfer to savings" }))).toBe(true);
    expect(isTransferTransaction(txn({ id: "4", category: "Food" }))).toBe(false);
  });
});

describe("credit card accounts", () => {
  const creditCards = new Set(["Visa Credit Card"]);

  it("excludes credit card deposits from income totals", () => {
    const rows = [
      txn({ id: "1", account: "Checking", deposit: 5000 }),
      txn({ id: "2", account: "Visa Credit Card", payment: 200, category: "Food" }),
      txn({ id: "3", account: "Visa Credit Card", deposit: 200 }),
    ];
    const s = computeMoneySummary(rows, { creditCardAccounts: creditCards });
    expect(s.totalIncome).toBe(5000);
    expect(s.totalExpenses).toBe(200);
    expect(s.net).toBe(4800);
  });

  it("tracks card bill payments separately in account breakdown", () => {
    const rows = [
      txn({ id: "1", account: "Visa Credit Card", payment: 150 }),
      txn({ id: "2", account: "Visa Credit Card", deposit: 150 }),
    ];
    const accounts = computeAccountBreakdown(rows, { creditCardAccounts: creditCards });
    expect(accounts[0]?.isCreditCard).toBe(true);
    expect(accounts[0]?.expenses).toBe(150);
    expect(accounts[0]?.income).toBe(0);
    expect(accounts[0]?.cardPayments).toBe(150);
  });
});
