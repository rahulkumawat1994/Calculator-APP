import type { MoneyTransaction } from "./moneyTypes";
import { formatMonthKey } from "./moneyFormat";

export type MoneyPeriodPreset =
  | "this-month"
  | "last-3-months"
  | "last-6-months"
  | "this-year"
  | "last-12-months"
  | "all"
  | "custom-month";

const PERIOD_KEY = "money-view-period-v1";
const CUSTOM_MONTH_KEY = "money-view-custom-month-v1";

export function loadMoneyPeriodPreset(): MoneyPeriodPreset {
  try {
    const raw = localStorage.getItem(PERIOD_KEY);
    if (
      raw === "this-month" ||
      raw === "last-3-months" ||
      raw === "last-6-months" ||
      raw === "this-year" ||
      raw === "last-12-months" ||
      raw === "all" ||
      raw === "custom-month"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "last-3-months";
}

export function saveMoneyPeriodPreset(preset: MoneyPeriodPreset): void {
  try {
    localStorage.setItem(PERIOD_KEY, preset);
  } catch {
    /* ignore */
  }
}

export function loadMoneyCustomMonth(): string | null {
  try {
    return localStorage.getItem(CUSTOM_MONTH_KEY);
  } catch {
    return null;
  }
}

export function saveMoneyCustomMonth(month: string | null): void {
  try {
    if (month) localStorage.setItem(CUSTOM_MONTH_KEY, month);
    else localStorage.removeItem(CUSTOM_MONTH_KEY);
  } catch {
    /* ignore */
  }
}

export function defaultPeriodForRowCount(rowCount: number): MoneyPeriodPreset {
  if (rowCount >= 500) return "last-3-months";
  if (rowCount >= 150) return "last-6-months";
  return "all";
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function listTransactionMonths(rows: MoneyTransaction[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.date) set.add(monthKeyFromDate(r.date));
  }
  return [...set].sort().reverse();
}

export function resolveMoneyPeriodRange(
  preset: MoneyPeriodPreset,
  customMonth: string | null,
  now = new Date(),
): { from: Date | null; to: Date | null } {
  if (preset === "all") return { from: null, to: null };

  if (preset === "custom-month" && customMonth) {
    const [y, m] = customMonth.split("-").map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      const from = new Date(y, m - 1, 1);
      return { from, to: endOfMonth(from) };
    }
  }

  const to = endOfMonth(now);

  switch (preset) {
    case "this-month":
      return { from: startOfMonth(now), to };
    case "last-3-months":
      return { from: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to };
    case "last-6-months":
      return { from: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to };
    case "this-year":
      return { from: new Date(now.getFullYear(), 0, 1), to };
    case "last-12-months":
      return { from: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to };
    default:
      return { from: null, to: null };
  }
}

export function periodPresetLabel(preset: MoneyPeriodPreset, customMonth: string | null): string {
  switch (preset) {
    case "this-month":
      return "This month";
    case "last-3-months":
      return "Last 3 months";
    case "last-6-months":
      return "Last 6 months";
    case "this-year":
      return "This year";
    case "last-12-months":
      return "Last 12 months";
    case "all":
      return "All time";
    case "custom-month":
      return customMonth ? formatMonthKey(customMonth) : "Pick month";
    default:
      return "Period";
  }
}

export function dateOnlyMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isDateInRange(d: Date, from: Date | null, to: Date | null): boolean {
  const t = dateOnlyMs(d);
  if (from && t < dateOnlyMs(from)) return false;
  if (to && t > dateOnlyMs(to)) return false;
  return true;
}

/** Keep the most recent N months for charts when history is long. */
export function trimMonthlyForChart<T extends { month: string }>(rows: T[], max = 12): T[] {
  if (rows.length <= max) return rows;
  return rows.slice(-max);
}
