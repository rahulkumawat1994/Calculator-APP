import { describe, expect, it } from "vitest";
import type { ElectricityConfig, ElectricityReading } from "../data/firestoreDb";
import { DEFAULT_SLAB_RATES } from "../data/firestoreDb";
import {
  allocateToDays,
  buildIntervals,
  calcSlabCost,
  computeMeterAnalytics,
  estimateBill,
  formatElapsed,
} from "./electricityCalc";

function reading(
  partial: Partial<ElectricityReading> & Pick<ElectricityReading, "reading" | "readingTime">,
): ElectricityReading {
  const d = new Date(partial.readingTime);
  const dateISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    id: partial.id ?? `r_${partial.readingTime}`,
    dateISO: partial.dateISO ?? dateISO,
    meterId: partial.meterId ?? "main",
    reading: partial.reading,
    readingTime: partial.readingTime,
    enteredAt: partial.enteredAt ?? partial.readingTime,
    pricePerUnit: partial.pricePerUnit ?? 10,
    note: partial.note,
  };
}

const baseConfig: ElectricityConfig = {
  pricePerUnit: 10,
  useSlabRates: false,
  slabRates: DEFAULT_SLAB_RATES,
  fixedChargesMain: 50,
  fixedChargesBasement: 0,
  taxPercent: 0,
  fuelSurchargePerUnit: 0,
};

describe("timestamp accuracy — sample range", () => {
  // 10 Jul 2026 11:24 AM -> 37429
  // 14 Jul 2026 11:59 PM -> 37562
  const t0 = new Date(2026, 6, 10, 11, 24).getTime();
  const t1 = new Date(2026, 6, 14, 23, 59).getTime();
  const readings = [reading({ reading: 37429, readingTime: t0 }), reading({ reading: 37562, readingTime: t1 })];

  it("total = latest − first", () => {
    const a = computeMeterAnalytics(readings, baseConfig, { nowMs: t1, fixedCharges: 50 });
    expect(a.totalUnits).toBe(133);
    expect(a.currentReading).toBe(37562);
    expect(a.previousReading).toBe(37429);
  });

  it("elapsed uses actual hours, not calendar days", () => {
    const a = computeMeterAnalytics(readings, baseConfig, { nowMs: t1 });
    const expectedHours = (t1 - t0) / 3_600_000;
    expect(a.elapsedHours).toBeCloseTo(expectedHours, 4);
    // Calendar span is ~4.5 days; must NOT be integer 5 from inclusive calendar days
    expect(a.elapsedDays).toBeCloseTo(expectedHours / 24, 4);
    expect(a.avgPerDay).toBeCloseTo(133 / (expectedHours / 24), 3);
    expect(a.avgPerHour).toBeCloseTo(133 / expectedHours, 4);
  });

  it("formatElapsed shows days and hours", () => {
    expect(formatElapsed(24 + 5.5)).toMatch(/1d/);
  });
});

describe("cross-midnight proration", () => {
  it("splits interval across two calendar days by hours", () => {
    // 10 Jul 10:00 → 11 Jul 10:00, 24 kWh over exactly 24h → 12 each day? 
    // Actually 10:00 to next 10:00 = 14h on day1 (10→24) + 10h on day2 (0→10)
    const from = new Date(2026, 6, 10, 10, 0).getTime();
    const to = new Date(2026, 6, 11, 10, 0).getTime();
    const iv = buildIntervals([
      reading({ reading: 100, readingTime: from }),
      reading({ reading: 124, readingTime: to }),
    ]);
    const days = allocateToDays(iv);
    expect(days).toHaveLength(2);
    expect(days[0]!.units + days[1]!.units).toBeCloseTo(24, 3);
    // 14 hours on Jul 10, 10 hours on Jul 11
    expect(days[0]!.units).toBeCloseTo(14, 2);
    expect(days[1]!.units).toBeCloseTo(10, 2);
  });
});

describe("slab + bill", () => {
  it("charges ALL units at the applicable slab rate (non-progressive)", () => {
    const s200 = calcSlabCost(200, DEFAULT_SLAB_RATES);
    // 200 is in 151–300 → entire 200 × ₹6.00 = 1200 (NOT progressive bands)
    expect(s200.currentSlabRate).toBe(6);
    expect(s200.total).toBe(1200);
    expect(s200.unitsToNextSlab).toBe(100); // 100 more before ≤500 slab

    const s600 = calcSlabCost(600, DEFAULT_SLAB_RATES);
    // Over 500 → entire 600 × ₹8.50
    expect(s600.currentSlabRate).toBe(8.5);
    expect(s600.total).toBe(5100);
    expect(s600.unitsToNextSlab).toBeNull();
  });

  it("adds tax and fuel surcharge", () => {
    const bill = estimateBill(100, {
      ...baseConfig,
      useSlabRates: false,
      pricePerUnit: 10,
      taxPercent: 10,
      fuelSurchargePerUnit: 1,
    }, 50);
    // energy 1000 + fuel 100 + fixed 50 = 1150; tax 115 = 1265
    expect(bill.energyCharge).toBe(1000);
    expect(bill.fuelSurcharge).toBe(100);
    expect(bill.fixedCharges).toBe(50);
    expect(bill.tax).toBe(115);
    expect(bill.total).toBe(1265);
  });
});

describe("CSV-like multi reading analytics", () => {
  const readings = [
    reading({ reading: 37429, readingTime: new Date(2026, 6, 10, 11, 24).getTime() }),
    reading({ reading: 37444, readingTime: new Date(2026, 6, 10, 22, 20).getTime() }),
    reading({ reading: 37459, readingTime: new Date(2026, 6, 11, 10, 36).getTime() }),
    reading({ reading: 37527, readingTime: new Date(2026, 6, 13, 15, 41).getTime() }),
  ];

  it("peak day uses prorated daily totals not single gap", () => {
    const a = computeMeterAnalytics(readings, baseConfig, {
      nowMs: new Date(2026, 6, 13, 16, 0).getTime(),
      fixedCharges: 0,
    });
    expect(a.totalUnits).toBe(98);
    expect(a.peakDay).not.toBeNull();
    expect(a.peakDay!.units).toBeGreaterThan(17); // not just the single 17 kWh reading
    expect(a.insights.length).toBeGreaterThan(0);
    expect(a.metrics.avgPerDay.formula).toContain("Elapsed Hours");
  });
});
