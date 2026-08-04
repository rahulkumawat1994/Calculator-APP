import { describe, expect, it } from "vitest";
import { computeAuditAnalytics } from "./auditAnalytics";

describe("computeAuditAnalytics", () => {
  it("aggregates totals, modes, failures, and daily buckets", () => {
    const rows = [
      {
        id: "1",
        createdAt: new Date(2026, 7, 4, 10, 0).getTime(),
        mode: "manual" as const,
        total: 100,
        failedCount: 0,
        selectedSlotName: "Gali",
      },
      {
        id: "2",
        createdAt: new Date(2026, 7, 4, 14, 0).getTime(),
        mode: "wa" as const,
        total: 200,
        failedCount: 2,
        waSlotsSummary: "Disawar",
      },
      {
        id: "3",
        createdAt: new Date(2026, 7, 5, 9, 0).getTime(),
        mode: "manual" as const,
        total: 50,
        failedCount: 0,
        selectedSlotName: "Gali",
      },
    ];
    const differs = new Map([
      ["1", { differs: false }],
      ["2", { differs: true }],
      ["3", { differs: false }],
    ]);

    const a = computeAuditAnalytics(rows, differs);

    expect(a.rowCount).toBe(3);
    expect(a.totalAmount).toBe(350);
    expect(a.avgAmount).toBe(117);
    expect(a.profit5Pct).toBe(18);
    expect(a.avgProfit).toBe(6);
    expect(a.manualCount).toBe(2);
    expect(a.waCount).toBe(1);
    expect(a.failedRowCount).toBe(1);
    expect(a.totalFailedLines).toBe(2);
    expect(a.differsCount).toBe(1);
    expect(a.daily).toHaveLength(2);
    expect(a.monthly).toHaveLength(1);
    expect(a.monthly[0]).toMatchObject({
      month: "2026-08",
      count: 3,
      total: 350,
      profit: 18,
    });
    expect(a.daily[0]).toMatchObject({
      date: "2026-08-04",
      count: 2,
      total: 300,
      profit: 15,
    });
    expect(a.topSlots[0]).toMatchObject({
      name: "Disawar",
      count: 1,
      total: 200,
      profit: 10,
    });
    expect(a.topSlots[1]).toMatchObject({
      name: "Gali",
      count: 2,
      total: 150,
      profit: 8,
    });
  });

  it("returns zeros for empty input", () => {
    const a = computeAuditAnalytics([]);
    expect(a.rowCount).toBe(0);
    expect(a.totalAmount).toBe(0);
    expect(a.daily).toEqual([]);
    expect(a.monthly).toEqual([]);
    expect(a.topSlots).toEqual([]);
  });
});
