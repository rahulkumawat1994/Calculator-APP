import { describe, expect, it } from "vitest";
import type { MoneyTransaction } from "./moneyTypes";
import {
  defaultPeriodForRowCount,
  isDateInRange,
  listTransactionMonths,
  resolveMoneyPeriodRange,
  trimMonthlyForChart,
} from "./moneyDateFilter";

function txn(date: Date): MoneyTransaction {
  return {
    id: "1",
    account: "",
    date,
    dateRaw: "",
    num: "",
    transaction: "",
    memo: "",
    category: "",
    payment: 0,
    deposit: 0,
  };
}

describe("resolveMoneyPeriodRange", () => {
  const now = new Date(2026, 5, 8);

  it("returns this month bounds", () => {
    const { from, to } = resolveMoneyPeriodRange("this-month", null, now);
    expect(from?.getMonth()).toBe(5);
    expect(from?.getDate()).toBe(1);
    expect(to?.getMonth()).toBe(5);
    expect(to?.getDate()).toBe(30);
  });

  it("returns custom month bounds", () => {
    const { from, to } = resolveMoneyPeriodRange("custom-month", "2025-01", now);
    expect(from?.getFullYear()).toBe(2025);
    expect(from?.getMonth()).toBe(0);
    expect(to?.getDate()).toBe(31);
  });

  it("returns open range for all time", () => {
    const r = resolveMoneyPeriodRange("all", null, now);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });
});

describe("listTransactionMonths", () => {
  it("lists unique months newest first", () => {
    const rows = [
      txn(new Date(2025, 0, 5)),
      txn(new Date(2025, 1, 1)),
      txn(new Date(2025, 0, 20)),
    ];
    expect(listTransactionMonths(rows)).toEqual(["2025-02", "2025-01"]);
  });
});

describe("isDateInRange", () => {
  it("checks inclusive day bounds", () => {
    const d = new Date(2025, 5, 15);
    expect(isDateInRange(d, new Date(2025, 5, 1), new Date(2025, 5, 30))).toBe(true);
    expect(isDateInRange(d, new Date(2025, 6, 1), null)).toBe(false);
  });
});

describe("defaultPeriodForRowCount", () => {
  it("prefers shorter windows for large files", () => {
    expect(defaultPeriodForRowCount(2937)).toBe("last-3-months");
    expect(defaultPeriodForRowCount(50)).toBe("all");
  });
});

describe("trimMonthlyForChart", () => {
  it("keeps only the latest months", () => {
    const rows = [
      { month: "2024-01" },
      { month: "2024-06" },
      { month: "2025-01" },
      { month: "2025-06" },
      { month: "2025-12" },
    ];
    const trimmed = trimMonthlyForChart(rows, 3);
    expect(trimmed.map((r) => r.month)).toEqual(["2025-01", "2025-06", "2025-12"]);
  });
});
