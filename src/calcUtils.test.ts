import { describe, expect, it } from "vitest";
import {
  calculateTotal,
  processLine,
  splitWhatsAppInputByContact,
  computePatternAccuracy,
} from "./calcUtils";

describe("calculateTotal regression scenarios", () => {
  const rows = [
    { id: "dup-normal", input: "58.58x10", expectedTotal: 20 },
    { id: "solid-ab", input: "44444 *20 AB", expectedTotal: 40 },
    { id: "solid-a", input: "4444 *20 A", expectedTotal: 20 },
    { id: "solid-ax", input: "Ax33333*50", expectedTotal: 50 },
    { id: "multix-b", input: "B.1111x9999x50", expectedTotal: 100 },
    { id: "multix-noprefix", input: "1111x2222x10", expectedTotal: 20 },
    { id: "label-harf", input: "Harf.B.1111x9999x50", expectedTotal: 100 },
    { id: "label-db", input: "DB. 29.09.11x10", expectedTotal: 30 },
    {
      id: "multiline-sep",
      input:
        "DB. 29.09.11..19..25.52.91.03.30.84x10\n50.23.39.17.01.16.22.18.81.71.14x5\n.\nHarf.B.1111x9999x50",
      expectedTotal: 255,
    },
    { id: "paren-solid", input: "44444(20)AB", expectedTotal: 40 },
    { id: "comma-rate", input: "12,34,56,10", expectedTotal: 30 },
    { id: "space-dash-rate", input: "20 37 28 39 - 28\n22 17 22 33 - 5", expectedTotal: 132 },
    { id: "typo-separators", input: "12;34|56,10", expectedTotal: 30 },
    { id: "typo-fullwidth", input: "２０　３７x10", expectedTotal: 20 },
    { id: "typo-wp", input: "56 74 50 w.p\n13 31 15 palatel\n22 33 10 w p", expectedTotal: 250 },
  ] as const;

  it.each(rows)("$id -> total $expectedTotal", (row) => {
    const result = calculateTotal(row.input);
    expect(result.total).toBe(row.expectedTotal);
    expect(result.failedLines ?? []).toEqual([]);
  });
});

describe("parser structure checks", () => {
  it("parses multi-x same-digit chain into two segments", () => {
    const out = processLine("Harf.B.1111x9999x50");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ line: "B.1111", rate: 50, count: 1, lineTotal: 50 });
    expect(out[1]).toMatchObject({ line: "B.9999", rate: 50, count: 1, lineTotal: 50 });
  });

  it("supports trailing dash-rate style", () => {
    const out = calculateTotal("20 37 28 39 - 28\n22 17 22 33 - 5");
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({ count: 4, rate: 28, lineTotal: 112 });
    expect(out.results[1]).toMatchObject({ count: 4, rate: 5, lineTotal: 20 });
    expect(out.total).toBe(132);
  });

  it("tolerates separator typos between digit groups", () => {
    const out = calculateTotal("12;34|56,10");
    expect(out.total).toBe(30);
    expect(out.results[0]).toMatchObject({ count: 3, rate: 10, lineTotal: 30 });
  });
});

describe("splitWhatsAppInputByContact", () => {
  it("returns null for plain text", () => {
    expect(splitWhatsAppInputByContact("12 34 56 x10")).toBeNull();
  });

  it("returns null when only one contact appears", () => {
    const one = `[6:16 pm, 12/4/2026] Alice:
10 20 x5
[6:17 pm, 12/4/2026] Alice:
30 x10`;
    expect(splitWhatsAppInputByContact(one)).toBeNull();
  });

  it("splits two contacts into two snippets with headers preserved", () => {
    const raw = `[6:16 pm, 12/4/2026] Alice:
10 20 x5

[6:17 pm, 12/4/2026] Bob:
30 x10`;
    const out = splitWhatsAppInputByContact(raw);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    expect(out![0].contact).toBe("Alice");
    expect(out![0].text).toContain("Alice:");
    expect(out![0].text).toContain("10 20 x5");
    expect(out![1].contact).toBe("Bob");
    expect(out![1].text).toContain("Bob:");
    expect(out![1].text).toContain("30 x10");
  });
});

describe("computePatternAccuracy", () => {
  it("is 100 with no failed lines and no WA fallbacks", () => {
    const r = calculateTotal("10 20 x5");
    const a = computePatternAccuracy(r);
    expect(a.scorePercent).toBe(100);
    expect(a.reasons).toHaveLength(0);
  });

  it("drops below 100 when failed lines exist", () => {
    const r = calculateTotal("10 20 x5\nthis is not a valid bet line at all");
    expect(r.failedLines?.length).toBeGreaterThan(0);
    const a = computePatternAccuracy(r);
    expect(a.scorePercent).toBeLessThan(100);
    expect(a.reasons.some(x => x.includes("not matched"))).toBe(true);
  });

  it("deducts for WA slot fallbacks", () => {
    const r = calculateTotal("11 22 x10");
    const a = computePatternAccuracy(r, { waSlotFallbackCount: 2 });
    expect(a.scorePercent).toBe(99.7);
    expect(a.reasons.some(x => x.includes("fallback"))).toBe(true);
  });
});
