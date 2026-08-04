import { localGameDayKeyFromTimestamp } from "./auditDateFilter";

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const PROFIT_RATE = 0.05;

export type AuditMonthlyPoint = {
  month: string;
  label: string;
  count: number;
  total: number;
  profit: number;
};

export type AuditDailyPoint = {
  date: string;
  label: string;
  count: number;
  total: number;
  profit: number;
};

export type AuditSlotPoint = {
  name: string;
  count: number;
  total: number;
  profit: number;
};

export type AuditAnalytics = {
  rowCount: number;
  totalAmount: number;
  avgAmount: number;
  profit5Pct: number;
  avgProfit: number;
  manualCount: number;
  waCount: number;
  failedRowCount: number;
  totalFailedLines: number;
  differsCount: number;
  daily: AuditDailyPoint[];
  monthly: AuditMonthlyPoint[];
  topSlots: AuditSlotPoint[];
};

type AuditRowLike = {
  id: string;
  createdAt: number;
  mode: "manual" | "wa";
  total: number;
  failedCount?: number;
  selectedSlotName?: string;
  waSlotsSummary?: string;
};

function formatDayLabel(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const m = parts[1];
  const d = parts[2];
  if (!m || !d) return dateKey;
  return `${d} ${MONTH_SHORT[m - 1] ?? ""}`;
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return `${MONTH_SHORT[m - 1] ?? ""} ${y}`;
}

function monthKeyFromDayKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

function slotLabelForRow(row: AuditRowLike): string {
  const wa = row.waSlotsSummary?.trim();
  if (wa) return wa;
  const slot = row.selectedSlotName?.trim();
  if (slot) return slot;
  return row.mode === "wa" ? "WhatsApp" : "Manual";
}

/** Aggregate audit rows for the admin analytics panel (respects current filters). */
export function computeAuditAnalytics(
  rows: AuditRowLike[],
  differsById?: Map<string, { differs?: boolean }>,
): AuditAnalytics {
  let totalAmount = 0;
  let manualCount = 0;
  let waCount = 0;
  let failedRowCount = 0;
  let totalFailedLines = 0;
  let differsCount = 0;

  const byDay = new Map<string, { count: number; total: number }>();
  const byMonth = new Map<string, { count: number; total: number }>();
  const bySlot = new Map<string, { count: number; total: number }>();

  for (const row of rows) {
    const amount = Number.isFinite(row.total) ? row.total : 0;
    totalAmount += amount;

    if (row.mode === "wa") waCount += 1;
    else manualCount += 1;

    const failed = row.failedCount ?? 0;
    if (failed > 0) {
      failedRowCount += 1;
      totalFailedLines += failed;
    }

    if (differsById?.get(row.id)?.differs) differsCount += 1;

    const dayKey = localGameDayKeyFromTimestamp(row.createdAt);
    if (dayKey) {
      const day = byDay.get(dayKey) ?? { count: 0, total: 0 };
      day.count += 1;
      day.total += amount;
      byDay.set(dayKey, day);

      const monthKey = monthKeyFromDayKey(dayKey);
      const month = byMonth.get(monthKey) ?? { count: 0, total: 0 };
      month.count += 1;
      month.total += amount;
      byMonth.set(monthKey, month);
    }

    const slotName = slotLabelForRow(row);
    const slot = bySlot.get(slotName) ?? { count: 0, total: 0 };
    slot.count += 1;
    slot.total += amount;
    bySlot.set(slotName, slot);
  }

  const rowCount = rows.length;
  const profit5Pct = Math.round(totalAmount * PROFIT_RATE);
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, total }]) => ({
      date,
      label: formatDayLabel(date),
      count,
      total,
      profit: Math.round(total * PROFIT_RATE),
    }));

  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { count, total }]) => ({
      month,
      label: formatMonthLabel(month),
      count,
      total,
      profit: Math.round(total * PROFIT_RATE),
    }));

  const topSlots = [...bySlot.entries()]
    .map(([name, { count, total }]) => ({
      name,
      count,
      total,
      profit: Math.round(total * PROFIT_RATE),
    }))
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, 5);

  return {
    rowCount,
    totalAmount,
    avgAmount: rowCount > 0 ? Math.round(totalAmount / rowCount) : 0,
    profit5Pct,
    avgProfit: rowCount > 0 ? Math.round(profit5Pct / rowCount) : 0,
    manualCount,
    waCount,
    failedRowCount,
    totalFailedLines,
    differsCount,
    daily,
    monthly,
    topSlots,
  };
}
