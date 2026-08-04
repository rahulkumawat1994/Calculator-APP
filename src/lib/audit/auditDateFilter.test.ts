import { describe, expect, it } from "vitest";
import {
  filterRowsByInputSearch,
  filterRowsByAuditMode,
  filterRowsByGameMonth,
  localGameDayKeyFromTimestamp,
} from "./auditDateFilter";

describe("filterRowsByInputSearch", () => {
  const rows = [
    { id: "1", input: "97-79ibto5\nGL 100×5" },
    { id: "2", input: "[12/4] Player: 05-50-into15" },
    { id: "3", input: undefined },
  ];

  it("returns all rows when query is empty", () => {
    expect(filterRowsByInputSearch(rows, "")).toEqual(rows);
    expect(filterRowsByInputSearch(rows, "   ")).toEqual(rows);
  });

  it("matches case-insensitive substrings in input", () => {
    expect(filterRowsByInputSearch(rows, "ibto5").map((r) => r.id)).toEqual([
      "1",
    ]);
    expect(filterRowsByInputSearch(rows, "INTO15").map((r) => r.id)).toEqual([
      "2",
    ]);
  });

  it("excludes rows with missing input when searching", () => {
    expect(filterRowsByInputSearch(rows, "player")).toEqual([rows[1]]);
  });
});

describe("filterRowsByAuditMode", () => {
  const rows = [
    { id: "1", mode: "manual" as const },
    { id: "2", mode: "wa" as const },
    { id: "3", mode: "manual" as const },
  ];

  it("returns all rows when no mode filter is set", () => {
    expect(filterRowsByAuditMode(rows, {})).toEqual(rows);
  });

  it("hides manual rows when hideManual is true", () => {
    expect(filterRowsByAuditMode(rows, { hideManual: true }).map((r) => r.id)).toEqual(
      ["2"],
    );
  });
});

describe("filterRowsByGameMonth", () => {
  const rows = [
    { id: "1", createdAt: new Date(2026, 7, 4, 10, 0).getTime() },
    { id: "2", createdAt: new Date(2026, 7, 15, 10, 0).getTime() },
    { id: "3", createdAt: new Date(2026, 8, 2, 10, 0).getTime() },
  ];

  it("returns all rows when month is empty", () => {
    expect(filterRowsByGameMonth(rows, "")).toEqual(rows);
  });

  it("filters by game-day month", () => {
    expect(filterRowsByGameMonth(rows, "2026-08").map((r) => r.id)).toEqual([
      "1",
      "2",
    ]);
    expect(filterRowsByGameMonth(rows, "2026-09").map((r) => r.id)).toEqual([
      "3",
    ]);
  });

  it("uses game-day cutoff before 6am", () => {
    const early = {
      id: "4",
      createdAt: new Date(2026, 8, 1, 3, 0).getTime(),
    };
    expect(localGameDayKeyFromTimestamp(early.createdAt)).toBe("2026-08-31");
    expect(filterRowsByGameMonth([early], "2026-08").map((r) => r.id)).toEqual([
      "4",
    ]);
  });
});
