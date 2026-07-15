/**
 * Timestamp-accurate electricity meter analytics.
 * Every rate/average uses actual elapsed hours between readings — never calendar-day division.
 */

import type {
  ElectricityBillingPeriod,
  ElectricityConfig,
  ElectricityReading,
  ElectricitySlabRate,
} from "../data/firestoreDb";
import { DEFAULT_SLAB_RATES } from "../data/firestoreDb";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Interval {
  fromTime: number;
  toTime: number;
  fromReading: number;
  toReading: number;
  units: number;
  hours: number;
  /** Flat-rate cost for this interval (null if no rate). */
  cost: number | null;
}

export interface DayUsage {
  dateISO: string;
  units: number;
  hours: number;
  cost: number | null;
}

export interface HourOfDayUsage {
  hour: number; // 0–23
  units: number;
  hours: number;
}

export interface MonthUsage {
  key: string; // YYYY-MM
  label: string;
  units: number;
  hours: number;
  cost: number | null;
  avgPerDay: number; // timestamp-based: units / (hours/24)
}

export interface SlabLineItem {
  label: string;
  units: number;
  rate: number;
  cost: number;
}

export interface SlabBreakdown {
  total: number;
  lines: SlabLineItem[];
  /** Index of the highest slab that received units (0-based). */
  currentSlabIndex: number;
  /** Units still needed to leave the current slab (Infinity if last open slab). */
  unitsToNextSlab: number | null;
  /** Rate of the current slab. */
  currentSlabRate: number | null;
}

export interface BillEstimate {
  energyCharge: number;
  fixedCharges: number;
  fuelSurcharge: number;
  tax: number;
  total: number;
  costPerUnit: number | null;
  slab: SlabBreakdown | null;
  /** Human-readable formula for transparency. */
  formula: string;
}

export interface MetricDetail {
  value: number | string | null;
  unit?: string;
  formula: string;
  details: string;
}

export interface TrendPoint {
  label: string;
  units: number;
  cost: number;
}

export interface UsageTrends {
  dailyPct: number | null;
  weeklyPct: number | null;
  monthlyPct: number | null;
  dailySeries: TrendPoint[];
  weeklySeries: TrendPoint[];
  monthlySeries: TrendPoint[];
  rolling7: TrendPoint[];
  rolling30: TrendPoint[];
  runningConsumption: TrendPoint[];
  runningCost: TrendPoint[];
}

export interface MeterAnalytics {
  intervals: Interval[];
  rows: Array<ElectricityReading & { units: number | null; cost: number | null }>;

  currentReading: number | null;
  previousReading: number | null;
  totalUnits: number;
  elapsedHours: number;
  elapsedDays: number; // fractional days = hours/24
  elapsedLabel: string;

  avgPerHour: number | null;
  avgPerDay: number | null; // total / (hours/24)

  todayUnits: number | null;
  yesterdayUnits: number | null;
  last7AvgPerDay: number | null;
  last30AvgPerDay: number | null;
  peakDay: DayUsage | null;
  lowestDay: DayUsage | null;
  avgDailyUsage: number | null; // mean of calendar-day attributed usage (only days with data)
  medianDailyUsage: number | null;

  avgHourlyUsage: number | null;
  highestHourly: HourOfDayUsage | null;
  lowestHourly: HourOfDayUsage | null;
  peakHour: number | null;
  idleHour: number | null;
  hourlyHeat: HourOfDayUsage[];

  currentMonthUnits: number;
  previousMonthUnits: number | null;
  projectedMonthEndUnits: number | null;
  monthlyAverage: number | null;
  monthlyComparisonPct: number | null;
  months: MonthUsage[];

  days: DayUsage[];
  nightUnits: number;
  nightPct: number | null;

  estimatedBill: BillEstimate | null;
  projectedMonthEndBill: BillEstimate | null;
  periodProjectedBill: BillEstimate | null;
  /** Last recorded bill end date (YYYY-MM-DD), if any billing period exists. */
  lastBillDate: string | null;
  /** Whole days since lastBillDate (exclusive of bill day itself if bill was earlier). */
  daysSinceLastBill: number | null;
  /** Assumed billing cycle length in days (from history, else fallback). */
  avgCycleDays: number;
  /** Estimated days remaining until next bill in the assumed cycle. */
  daysLeftInCycle: number | null;

  efficiencyScore: number | null;
  insights: string[];
  trends: UsageTrends;

  metrics: Record<string, MetricDetail>;
}

export interface AnalyticsOptions {
  nowMs?: number;
  fixedCharges?: number;
  billingPeriods?: ElectricityBillingPeriod[];
  avgPeriodDaysFallback?: number;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function msToDateISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatElapsed(hours: number): string {
  if (!(hours > 0)) return "0h";
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.round((hours - Math.floor(hours)) * 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (d === 0 && m > 0 && h < 12) parts.push(`${m}m`);
  return parts.join(" ") || `${hours.toFixed(1)}h`;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_SHORT[Number(m) - 1]} ${y}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : +((s[mid - 1]! + s[mid]!) / 2).toFixed(3);
}

function pctChange(curr: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return +(((curr - prev) / prev) * 100).toFixed(1);
}

// ─── Slab / bill ──────────────────────────────────────────────────────────────

/**
 * Non-progressive (telescopic) slab billing:
 * total units determine which slab applies, then ALL units are charged at that slab's rate.
 * Example: 600 units → entire 600 × "above 500" rate (not 50×r1 + 100×r2 + …).
 */
export function calcSlabCost(
  totalUnits: number,
  slabs: ElectricitySlabRate[] = DEFAULT_SLAB_RATES,
): SlabBreakdown {
  const units = Math.max(0, totalUnits);
  if (!slabs.length) {
    return { total: 0, lines: [], currentSlabIndex: 0, unitsToNextSlab: null, currentSlabRate: null };
  }

  // Find the slab whose upper bound is ≥ total units (last open slab catches the rest).
  let currentSlabIndex = slabs.length - 1;
  for (let i = 0; i < slabs.length; i++) {
    const ceiling = slabs[i]!.upTo >= 999999 ? Infinity : slabs[i]!.upTo;
    if (units <= ceiling) {
      currentSlabIndex = i;
      break;
    }
  }

  const slab = slabs[currentSlabIndex]!;
  const prevLimit = currentSlabIndex === 0 ? 0 : slabs[currentSlabIndex - 1]!.upTo;
  const ceiling = slab.upTo >= 999999 ? Infinity : slab.upTo;
  const fromUnit = prevLimit + 1;
  const label =
    ceiling === Infinity
      ? `${fromUnit}+ units (all units @ this rate)`
      : `≤${slab.upTo} units (all units @ this rate)`;

  const cost = +(units * slab.rate).toFixed(2);
  const lines: SlabLineItem[] =
    units > 0
      ? [{ label, units: +units.toFixed(3), rate: slab.rate, cost }]
      : [];

  // How many more units until the next higher (all-units) rate kicks in.
  const unitsToNextSlab =
    ceiling === Infinity ? null : +(Math.max(0, ceiling - units).toFixed(3));

  return {
    total: cost,
    lines,
    currentSlabIndex,
    unitsToNextSlab,
    currentSlabRate: slab.rate,
  };
}

export function estimateBill(
  units: number,
  config: ElectricityConfig,
  fixedCharges: number,
): BillEstimate {
  const slabs = config.slabRates?.length ? config.slabRates : DEFAULT_SLAB_RATES;
  const taxPct = config.taxPercent ?? 0;
  const fuelPerUnit = config.fuelSurchargePerUnit ?? 0;

  let energyCharge = 0;
  let slab: SlabBreakdown | null = null;
  let formula: string;

  if (config.useSlabRates) {
    slab = calcSlabCost(units, slabs);
    energyCharge = slab.total;
    formula = `All units × applicable slab rate + fuel + fixed + tax%`;
  } else {
    const rate = config.pricePerUnit;
    energyCharge = +(units * rate).toFixed(2);
    formula = `units × ₹${rate}/unit + fuel + fixed + tax%`;
  }

  const fuelSurcharge = +(units * fuelPerUnit).toFixed(2);
  const subtotal = energyCharge + fixedCharges + fuelSurcharge;
  const tax = +(subtotal * (taxPct / 100)).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  const costPerUnit = units > 0 ? +(total / units).toFixed(4) : null;

  return {
    energyCharge,
    fixedCharges,
    fuelSurcharge,
    tax,
    total,
    costPerUnit,
    slab,
    formula: `${formula} → ₹${total.toFixed(2)}`,
  };
}

// ─── Core interval + attribution ──────────────────────────────────────────────

export function buildIntervals(readings: ElectricityReading[]): Interval[] {
  const sorted = [...readings].sort((a, b) => a.readingTime - b.readingTime);
  const out: Interval[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const hours = (cur.readingTime - prev.readingTime) / HOUR_MS;
    if (!(hours > 0)) continue;
    const units = +(cur.reading - prev.reading).toFixed(6);
    const rate = cur.pricePerUnit > 0 ? cur.pricePerUnit : 0;
    const cost = rate > 0 ? +(units * rate).toFixed(2) : null;
    out.push({
      fromTime: prev.readingTime,
      toTime: cur.readingTime,
      fromReading: prev.reading,
      toReading: cur.reading,
      units,
      hours,
      cost,
    });
  }
  return out;
}

export function buildRows(
  readings: ElectricityReading[],
): Array<ElectricityReading & { units: number | null; cost: number | null }> {
  const sorted = [...readings].sort((a, b) => a.readingTime - b.readingTime);
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    const units = prev != null ? +(r.reading - prev.reading).toFixed(3) : null;
    const cost =
      units != null && r.pricePerUnit > 0 ? +(units * r.pricePerUnit).toFixed(2) : null;
    return { ...r, units, cost };
  });
}

/** Prorate each interval across local calendar days by elapsed hours. */
export function allocateToDays(intervals: Interval[]): DayUsage[] {
  const map = new Map<string, DayUsage>();

  for (const iv of intervals) {
    if (!(iv.hours > 0)) continue;
    let t = iv.fromTime;
    const end = iv.toTime;
    while (t < end) {
      const dayStart = startOfLocalDay(t);
      const dayEnd = dayStart + DAY_MS;
      const segEnd = Math.min(end, dayEnd);
      const segHours = (segEnd - t) / HOUR_MS;
      if (segHours > 0) {
        const share = segHours / iv.hours;
        const units = iv.units * share;
        const cost = iv.cost != null ? iv.cost * share : null;
        const iso = msToDateISO(t);
        const prev = map.get(iso) ?? { dateISO: iso, units: 0, hours: 0, cost: null };
        prev.units += units;
        prev.hours += segHours;
        prev.cost = prev.cost == null && cost == null ? null : (prev.cost ?? 0) + (cost ?? 0);
        map.set(iso, prev);
      }
      t = segEnd;
    }
  }

  return [...map.values()]
    .map((d) => ({
      ...d,
      units: +d.units.toFixed(3),
      hours: +d.hours.toFixed(4),
      cost: d.cost != null ? +d.cost.toFixed(2) : null,
    }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** Aggregate usage by hour-of-day (0–23), prorated by hours. */
export function allocateByHourOfDay(intervals: Interval[]): HourOfDayUsage[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, units: 0, hours: 0 }));

  for (const iv of intervals) {
    if (!(iv.hours > 0)) continue;
    let t = iv.fromTime;
    const end = iv.toTime;
    while (t < end) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const segEnd = Math.min(end, nextHour);
      const segHours = (segEnd - t) / HOUR_MS;
      if (segHours > 0) {
        const hour = d.getHours();
        buckets[hour]!.units += iv.units * (segHours / iv.hours);
        buckets[hour]!.hours += segHours;
      }
      t = segEnd;
    }
  }

  return buckets.map((b) => ({
    hour: b.hour,
    units: +b.units.toFixed(3),
    hours: +b.hours.toFixed(4),
  }));
}

function avgDailyInWindow(intervals: Interval[], fromMs: number, toMs: number): number | null {
  let units = 0;
  let hours = 0;
  for (const iv of intervals) {
    const start = Math.max(iv.fromTime, fromMs);
    const end = Math.min(iv.toTime, toMs);
    if (end <= start) continue;
    const segH = (end - start) / HOUR_MS;
    units += iv.units * (segH / iv.hours);
    hours += segH;
  }
  if (!(hours > 0)) return null;
  return +(units / (hours / 24)).toFixed(3);
}

function allocateToMonths(intervals: Interval[]): MonthUsage[] {
  const map = new Map<string, { units: number; hours: number; cost: number | null }>();
  for (const iv of intervals) {
    if (!(iv.hours > 0)) continue;
    let t = iv.fromTime;
    const end = iv.toTime;
    while (t < end) {
      const d = new Date(t);
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const segEnd = Math.min(end, nextMonth);
      const segH = (segEnd - t) / HOUR_MS;
      if (segH > 0) {
        const key = monthKey(t);
        const share = segH / iv.hours;
        const prev = map.get(key) ?? { units: 0, hours: 0, cost: null };
        prev.units += iv.units * share;
        prev.hours += segH;
        prev.cost =
          prev.cost == null && iv.cost == null ? null : (prev.cost ?? 0) + (iv.cost ?? 0) * share;
        map.set(key, prev);
      }
      t = segEnd;
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, v]) => ({
      key,
      label: monthLabel(key),
      units: +v.units.toFixed(3),
      hours: +v.hours.toFixed(4),
      cost: v.cost != null ? +v.cost.toFixed(2) : null,
      avgPerDay: v.hours > 0 ? +(v.units / (v.hours / 24)).toFixed(3) : 0,
    }));
}

function weekKey(ms: number): string {
  const d = new Date(ms);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d.getTime() - jan1.getTime()) / DAY_MS + jan1.getDay() + 1) / 7);
  return `W${wk} '${String(d.getFullYear()).slice(2)}`;
}

function buildTrendSeries(days: DayUsage[]): UsageTrends {
  const dailySeries: TrendPoint[] = days.map((d) => {
    const [, m, day] = d.dateISO.split("-");
    return {
      label: `${Number(day)} ${MONTH_SHORT[Number(m) - 1]}`,
      units: d.units,
      cost: d.cost ?? 0,
    };
  });

  const weekMap = new Map<string, { units: number; cost: number }>();
  for (const d of days) {
    const ms = new Date(d.dateISO + "T12:00:00").getTime();
    const key = weekKey(ms);
    const prev = weekMap.get(key) ?? { units: 0, cost: 0 };
    weekMap.set(key, { units: prev.units + d.units, cost: prev.cost + (d.cost ?? 0) });
  }
  const weeklySeries = [...weekMap.entries()].map(([label, v]) => ({
    label,
    units: +v.units.toFixed(3),
    cost: +v.cost.toFixed(2),
  }));

  const monthMap = new Map<string, { units: number; cost: number }>();
  for (const d of days) {
    const [y, m] = d.dateISO.split("-");
    const key = `${MONTH_SHORT[Number(m) - 1]} '${y!.slice(2)}`;
    const prev = monthMap.get(key) ?? { units: 0, cost: 0 };
    monthMap.set(key, { units: prev.units + d.units, cost: prev.cost + (d.cost ?? 0) });
  }
  const monthlySeries = [...monthMap.entries()].map(([label, v]) => ({
    label,
    units: +v.units.toFixed(3),
    cost: +v.cost.toFixed(2),
  }));

  const rolling7: TrendPoint[] = [];
  const rolling30: TrendPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    const slice7 = days.slice(Math.max(0, i - 6), i + 1);
    const slice30 = days.slice(Math.max(0, i - 29), i + 1);
    const avg7 = slice7.reduce((s, d) => s + d.units, 0) / slice7.length;
    const avg30 = slice30.reduce((s, d) => s + d.units, 0) / slice30.length;
    rolling7.push({ label: dailySeries[i]!.label, units: +avg7.toFixed(3), cost: 0 });
    rolling30.push({ label: dailySeries[i]!.label, units: +avg30.toFixed(3), cost: 0 });
  }

  let runU = 0;
  let runC = 0;
  const runningConsumption: TrendPoint[] = [];
  const runningCost: TrendPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    runU += days[i]!.units;
    runC += days[i]!.cost ?? 0;
    runningConsumption.push({ label: dailySeries[i]!.label, units: +runU.toFixed(3), cost: 0 });
    runningCost.push({ label: dailySeries[i]!.label, units: 0, cost: +runC.toFixed(2) });
  }

  const last = days[days.length - 1]?.units ?? 0;
  const prev = days[days.length - 2]?.units ?? 0;
  const dailyPct = days.length >= 2 ? pctChange(last, prev) : null;

  const last7 = days.slice(-7).reduce((s, d) => s + d.units, 0);
  const prev7 = days.slice(-14, -7).reduce((s, d) => s + d.units, 0);
  const weeklyPct = days.length >= 14 ? pctChange(last7, prev7) : null;

  const lastM = monthlySeries[monthlySeries.length - 1]?.units ?? 0;
  const prevM = monthlySeries[monthlySeries.length - 2]?.units ?? 0;
  const monthlyPct = monthlySeries.length >= 2 ? pctChange(lastM, prevM) : null;

  return {
    dailyPct,
    weeklyPct,
    monthlyPct,
    dailySeries,
    weeklySeries,
    monthlySeries,
    rolling7,
    rolling30,
    runningConsumption,
    runningCost,
  };
}

function nightShare(hourly: HourOfDayUsage[]): { nightUnits: number; nightPct: number | null } {
  // Night = 10 PM – 6 AM
  const nightHours = new Set([22, 23, 0, 1, 2, 3, 4, 5]);
  let night = 0;
  let total = 0;
  for (const h of hourly) {
    total += h.units;
    if (nightHours.has(h.hour)) night += h.units;
  }
  return {
    nightUnits: +night.toFixed(3),
    nightPct: total > 0 ? +((night / total) * 100).toFixed(1) : null,
  };
}

function buildInsights(a: {
  avgPerDay: number | null;
  todayUnits: number | null;
  yesterdayUnits: number | null;
  nightPct: number | null;
  projectedMonthEndUnits: number | null;
  monthlyComparisonPct: number | null;
  trends: UsageTrends;
  peakDay: DayUsage | null;
  lowestDay: DayUsage | null;
  currentMonthUnits: number;
}): string[] {
  const out: string[] = [];
  if (a.trends.dailyPct != null) {
    const dir = a.trends.dailyPct >= 0 ? "increased" : "decreased";
    out.push(`Day-over-day usage ${dir} by ${Math.abs(a.trends.dailyPct)}%.`);
  }
  if (a.todayUnits != null && a.yesterdayUnits != null) {
    const diff = +(a.todayUnits - a.yesterdayUnits).toFixed(2);
    if (diff < 0) out.push(`Today has consumed ${Math.abs(diff).toFixed(2)} kWh less than yesterday so far.`);
    else if (diff > 0) out.push(`Today has already used ${diff.toFixed(2)} kWh more than yesterday.`);
    else out.push(`Today's usage so far matches yesterday.`);
  }
  if (a.nightPct != null) out.push(`Night usage (10 PM–6 AM) is ${a.nightPct}% of total.`);
  if (a.projectedMonthEndUnits != null) {
    out.push(`Current monthly projection is ${a.projectedMonthEndUnits.toFixed(0)} kWh.`);
  }
  if (a.monthlyComparisonPct != null) {
    if (a.monthlyComparisonPct > 0) {
      out.push(`Consumption is ${a.monthlyComparisonPct}% higher than last month (so far).`);
    } else if (a.monthlyComparisonPct < 0) {
      out.push(`Consumption is ${Math.abs(a.monthlyComparisonPct)}% lower than last month (so far).`);
    }
  }
  if (a.peakDay && a.lowestDay && a.peakDay.dateISO !== a.lowestDay.dateISO) {
    out.push(
      `Peak day ${a.peakDay.dateISO} used ${a.peakDay.units.toFixed(1)} kWh; lowest was ${a.lowestDay.units.toFixed(1)} kWh on ${a.lowestDay.dateISO}.`,
    );
  }
  if (a.avgPerDay != null && a.currentMonthUnits > 0) {
    out.push(`Timestamp-based average is ${a.avgPerDay.toFixed(2)} kWh/day.`);
  }
  return out;
}

function efficiencyScore(avgPerDay: number | null, peakDay: DayUsage | null, lowestDay: DayUsage | null): number | null {
  if (avgPerDay == null || !peakDay || !lowestDay || peakDay.units <= 0) return null;
  // Higher when average is closer to lowest (efficient) vs peak (wasteful).
  const span = peakDay.units - lowestDay.units;
  if (span <= 0) return 85;
  const relative = (peakDay.units - avgPerDay) / span; // 1 = at lowest, 0 = at peak
  return Math.round(Math.max(0, Math.min(100, 40 + relative * 60)));
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function computeMeterAnalytics(
  readings: ElectricityReading[],
  config: ElectricityConfig,
  opts: AnalyticsOptions = {},
): MeterAnalytics {
  const nowMs = opts.nowMs ?? Date.now();
  const fixedCharges = opts.fixedCharges ?? 0;
  const billingPeriods = opts.billingPeriods ?? [];
  const avgPeriodDaysFallback = opts.avgPeriodDaysFallback ?? 30;

  const rows = buildRows(readings);
  const intervals = buildIntervals(readings);
  const sorted = [...readings].sort((a, b) => a.readingTime - b.readingTime);

  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2]! : null;

  const totalUnits =
    first && last ? +Math.max(0, last.reading - first.reading).toFixed(3) : 0;
  const elapsedHours =
    first && last && last.readingTime > first.readingTime
      ? (last.readingTime - first.readingTime) / HOUR_MS
      : 0;
  const elapsedDays = +(elapsedHours / 24).toFixed(4);
  const elapsedLabel = formatElapsed(elapsedHours);

  const avgPerHour = elapsedHours > 0 ? +(totalUnits / elapsedHours).toFixed(4) : null;
  const avgPerDay = elapsedHours > 0 ? +(totalUnits / (elapsedHours / 24)).toFixed(3) : null;

  const days = allocateToDays(intervals);
  const hourlyHeat = allocateByHourOfDay(intervals);
  const { nightUnits, nightPct } = nightShare(hourlyHeat);

  const todayISO = msToDateISO(nowMs);
  const yestDate = new Date(startOfLocalDay(nowMs) - DAY_MS);
  const yesterdayISO = msToDateISO(yestDate.getTime());

  const todayUnits = days.find((d) => d.dateISO === todayISO)?.units ?? null;
  const yesterdayUnits = days.find((d) => d.dateISO === yesterdayISO)?.units ?? null;

  const windowEnd = nowMs;
  const last7AvgPerDay = avgDailyInWindow(intervals, windowEnd - 7 * DAY_MS, windowEnd);
  const last30AvgPerDay = avgDailyInWindow(intervals, windowEnd - 30 * DAY_MS, windowEnd);

  const positiveDays = days.filter((d) => d.units >= 0);
  const peakDay =
    positiveDays.length > 0
      ? positiveDays.reduce((a, b) => (b.units > a.units ? b : a))
      : null;
  const lowestDay =
    positiveDays.length > 0
      ? positiveDays.reduce((a, b) => (b.units < a.units ? b : a))
      : null;

  const dayUnitValues = positiveDays.map((d) => d.units);
  const avgDailyUsage =
    dayUnitValues.length > 0
      ? +(dayUnitValues.reduce((s, n) => s + n, 0) / dayUnitValues.length).toFixed(3)
      : null;
  const medianDailyUsage = median(dayUnitValues);

  const activeHours = hourlyHeat.filter((h) => h.hours > 0);
  const avgHourlyUsage = avgPerHour;
  const highestHourly =
    activeHours.length > 0
      ? activeHours.reduce((a, b) => (b.units / Math.max(b.hours, 1e-9) > a.units / Math.max(a.hours, 1e-9) ? b : a))
      : null;
  const lowestHourly =
    activeHours.length > 0
      ? activeHours.reduce((a, b) => (b.units / Math.max(b.hours, 1e-9) < a.units / Math.max(a.hours, 1e-9) ? b : a))
      : null;
  const peakHour = highestHourly?.hour ?? null;
  const idleHour = lowestHourly?.hour ?? null;

  const months = allocateToMonths(intervals);
  const curMonthKey = monthKey(nowMs);
  const currentMonth = months.find((m) => m.key === curMonthKey);
  const currentMonthUnits = currentMonth?.units ?? 0;

  const prevMonthDate = new Date(nowMs);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevMonthKey = monthKey(prevMonthDate.getTime());
  const previousMonth = months.find((m) => m.key === prevMonthKey);
  const previousMonthUnits = previousMonth?.units ?? null;

  // Project month end using timestamp avg/day for remaining calendar hours in month
  const nextMonthStart = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth() + 1, 1).getTime();
  const monthRemainingH = Math.max(0, (nextMonthStart - nowMs) / HOUR_MS);
  const projectedMonthEndUnits =
    avgPerDay != null
      ? +(currentMonthUnits + avgPerDay * (monthRemainingH / 24)).toFixed(3)
      : null;

  const monthlyAverage =
    months.length > 0
      ? +(months.reduce((s, m) => s + m.units, 0) / months.length).toFixed(3)
      : null;

  // Compare current month pace (avg/day so far) vs previous month avg/day
  let monthlyComparisonPct: number | null = null;
  if (currentMonth && previousMonth && previousMonth.avgPerDay > 0 && currentMonth.avgPerDay > 0) {
    monthlyComparisonPct = pctChange(currentMonth.avgPerDay, previousMonth.avgPerDay);
  }

  const estimatedBill =
    totalUnits > 0 || config.useSlabRates || config.pricePerUnit > 0
      ? estimateBill(totalUnits, config, fixedCharges)
      : null;

  const projectedMonthEndBill =
    projectedMonthEndUnits != null ? estimateBill(projectedMonthEndUnits, config, fixedCharges) : null;

  // Billing-period projection
  const lastPeriod = [...billingPeriods].sort((a, b) => b.toDate.localeCompare(a.toDate))[0] ?? null;
  const lastBillDate = lastPeriod?.toDate ?? null;

  const avgCycleDays =
    billingPeriods.length >= 2
      ? Math.round(
          billingPeriods.reduce((s, p) => {
            const from = startOfLocalDay(new Date(p.fromDate + "T00:00:00").getTime());
            const to = startOfLocalDay(new Date(p.toDate + "T00:00:00").getTime());
            // Cycle length as exclusive day span (10 Jun → 10 Jul ≈ 30 days)
            return s + Math.max(1, Math.round((to - from) / DAY_MS));
          }, 0) / billingPeriods.length,
        )
      : avgPeriodDaysFallback;

  // Days since last bill date (Jul 10 → Jul 15 = 5)
  const daysSinceLastBill = lastBillDate
    ? Math.max(
        0,
        Math.round(
          (startOfLocalDay(nowMs) - startOfLocalDay(new Date(lastBillDate + "T00:00:00").getTime())) /
            DAY_MS,
        ),
      )
    : null;
  const daysLeftInCycle =
    daysSinceLastBill != null ? Math.max(0, avgCycleDays - daysSinceLastBill) : null;

  // Units after the bill day (start of day after last bill)
  const periodStartMs = lastBillDate
    ? startOfLocalDay(new Date(lastBillDate + "T00:00:00").getTime()) + DAY_MS
    : first
      ? first.readingTime
      : startOfLocalDay(nowMs);
  const periodUnits = intervals
    .filter((iv) => iv.toTime > periodStartMs)
    .reduce((s, iv) => {
      const start = Math.max(iv.fromTime, periodStartMs);
      const end = iv.toTime;
      if (end <= start) return s;
      return s + iv.units * ((end - start) / HOUR_MS / iv.hours);
    }, 0);
  const projectedPeriodUnits =
    avgPerDay != null && daysLeftInCycle != null
      ? +(periodUnits + avgPerDay * daysLeftInCycle).toFixed(3)
      : avgPerDay != null && !lastBillDate
        ? +(totalUnits + avgPerDay * avgCycleDays).toFixed(3) // no bill date yet: rough full-cycle guess
        : null;
  const periodProjectedBill =
    projectedPeriodUnits != null ? estimateBill(projectedPeriodUnits, config, fixedCharges) : null;

  const trends = buildTrendSeries(days);
  const score = efficiencyScore(avgPerDay, peakDay, lowestDay);

  const insights = buildInsights({
    avgPerDay,
    todayUnits,
    yesterdayUnits,
    nightPct,
    projectedMonthEndUnits,
    monthlyComparisonPct,
    trends,
    peakDay,
    lowestDay,
    currentMonthUnits,
  });

  const metrics: Record<string, MetricDetail> = {
    totalUnits: {
      value: totalUnits,
      unit: "KWH",
      formula: "Latest Reading − First Reading",
      details: first && last ? `${last.reading} − ${first.reading} = ${totalUnits}` : "Need ≥2 readings",
    },
    elapsedTime: {
      value: elapsedLabel,
      formula: "(Latest Time − First Time) in hours",
      details: `${elapsedHours.toFixed(2)} hours ≈ ${elapsedDays.toFixed(2)} days`,
    },
    avgPerHour: {
      value: avgPerHour,
      unit: "KWH/h",
      formula: "Total Consumption ÷ Elapsed Hours",
      details: elapsedHours > 0 ? `${totalUnits} ÷ ${elapsedHours.toFixed(2)}` : "n/a",
    },
    avgPerDay: {
      value: avgPerDay,
      unit: "KWH/day",
      formula: "Total Consumption ÷ (Elapsed Hours ÷ 24)",
      details: elapsedHours > 0 ? `${totalUnits} ÷ (${elapsedHours.toFixed(2)} / 24)` : "n/a",
    },
    today: {
      value: todayUnits,
      unit: "KWH",
      formula: "Prorated interval units overlapping today",
      details: "Usage attributed by hours within today's local midnight–midnight window",
    },
    peakDay: {
      value: peakDay?.units ?? null,
      unit: "KWH",
      formula: "Max(daily attributed units)",
      details: peakDay ? `${peakDay.dateISO}: ${peakDay.units} KWH` : "n/a",
    },
    estimatedBill: {
      value: estimatedBill?.total ?? null,
      unit: "₹",
      formula: estimatedBill?.formula ?? "n/a",
      details: estimatedBill
        ? `Energy ₹${estimatedBill.energyCharge} + Fixed ₹${estimatedBill.fixedCharges} + Fuel ₹${estimatedBill.fuelSurcharge} + Tax ₹${estimatedBill.tax}`
        : "n/a",
    },
    efficiencyScore: {
      value: score,
      formula: "40 + 60 × (peak − avg) / (peak − lowest)",
      details: "Higher when average stays closer to your best (lowest) day",
    },
    periodProjection: {
      value: periodProjectedBill?.total ?? null,
      unit: "₹",
      formula: lastBillDate
        ? "Units since last bill + avg/day × days left in billing cycle"
        : "Rough full-cycle estimate (add last bill date under Billing for accuracy)",
      details:
        projectedPeriodUnits != null && daysLeftInCycle != null
          ? `Last bill ${lastBillDate}: ${periodUnits.toFixed(1)} KWH so far + ${avgPerDay?.toFixed(2)} × ${daysLeftInCycle}d left (cycle ~${avgCycleDays}d) → ${projectedPeriodUnits} KWH`
          : projectedPeriodUnits != null
            ? `No bill date yet → ~${projectedPeriodUnits} KWH over ${avgCycleDays}d cycle`
            : "n/a",
    },
  };

  return {
    intervals,
    rows,
    currentReading: last?.reading ?? null,
    previousReading: prev?.reading ?? null,
    totalUnits,
    elapsedHours: +elapsedHours.toFixed(4),
    elapsedDays,
    elapsedLabel,
    avgPerHour,
    avgPerDay,
    todayUnits,
    yesterdayUnits,
    last7AvgPerDay,
    last30AvgPerDay,
    peakDay,
    lowestDay,
    avgDailyUsage,
    medianDailyUsage,
    avgHourlyUsage,
    highestHourly,
    lowestHourly,
    peakHour,
    idleHour,
    hourlyHeat,
    currentMonthUnits: +currentMonthUnits.toFixed(3),
    previousMonthUnits: previousMonthUnits != null ? +previousMonthUnits.toFixed(3) : null,
    projectedMonthEndUnits,
    monthlyAverage,
    monthlyComparisonPct,
    months,
    days,
    nightUnits,
    nightPct,
    estimatedBill,
    projectedMonthEndBill,
    periodProjectedBill,
    lastBillDate,
    daysSinceLastBill,
    avgCycleDays,
    daysLeftInCycle,
    efficiencyScore: score,
    insights,
    trends,
    metrics,
  };
}
