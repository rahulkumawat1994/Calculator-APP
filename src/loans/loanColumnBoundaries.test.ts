import { describe, expect, it } from "vitest";
import {
  boundaryLimits,
  equalColumnBoundaries,
  setBoundaryAt,
} from "./loanColumnBoundaries";

describe("setBoundaryAt", () => {
  it("moves only the targeted divider without collapsing neighbors", () => {
    const pdfW = 600;
    const bounds = equalColumnBoundaries(6, pdfW);
    const mid = bounds[3]!;
    const moved = setBoundaryAt(bounds, 3, mid + 30, pdfW);
    expect(moved[3]).toBeGreaterThan(bounds[3]!);
    expect(moved[2]).toBe(bounds[2]);
    expect(moved[4]).toBe(bounds[4]);
    expect(moved[0]).toBe(bounds[0]);
  });

  it("does not collapse when value is out of range", () => {
    const pdfW = 600;
    const bounds = equalColumnBoundaries(4, pdfW);
    const { max } = boundaryLimits(bounds, 2, pdfW);
    const moved = setBoundaryAt(bounds, 2, max + 500, pdfW);
    expect(moved[2]).toBeLessThanOrEqual(max);
    expect(moved[2]).toBeGreaterThan(bounds[1]!);
  });

  it("clamps to max instead of collapsing other dividers", () => {
    const pdfW = 100;
    const bounds = [0, 40, 70, 100];
    const moved = setBoundaryAt(bounds, 1, 90, pdfW);
    expect(moved[0]).toBe(0);
    expect(moved[2]).toBe(70);
    expect(moved[3]).toBe(100);
    expect(moved[1]).toBeLessThan(70);
  });
});
