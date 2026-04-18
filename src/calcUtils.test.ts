import { describe, expect, it } from "vitest";
import type { SavedSession } from "./types";
import {
  calculateTotal,
  processLine,
  splitWhatsAppInputByContact,
  computePatternAccuracy,
  sessionLedgerForSlotKey,
  mergeSessionLedgerResult,
} from "./calcUtils";

describe("calculateTotal regression scenarios", () => {
  const rows = [
    { id: "dup-normal", input: "58.58x10", expectedTotal: 20 },
    { id: "solid-ab", input: "44444 *20 AB", expectedTotal: 40 },
    { id: "solid-a", input: "4444 *20 A", expectedTotal: 20 },
    { id: "solid-ax", input: "Ax33333*50", expectedTotal: 50 },
    {
      id: "solid-axb-harf-wa",
      input: "SG harf AxB 00000x50",
      expectedTotal: 100,
    },
    {
      id: "solid-a-b-dash-harf",
      input: "SG harf A-B 00000x50",
      expectedTotal: 100,
    },
    { id: "multix-b", input: "B.1111x9999x50", expectedTotal: 100 },
    { id: "multix-noprefix", input: "1111x2222x10", expectedTotal: 20 },
    { id: "label-harf", input: "Harf.B.1111x9999x50", expectedTotal: 100 },
    { id: "label-harf-typo-seps", input: "Harf.B..2222.x7777x50", expectedTotal: 100 },
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
    // WhatsApp-style "into" rate with common typos (intu / ijto)
    { id: "into-typo-intu", input: "75-57intu10", expectedTotal: 20 },
    { id: "into-typo-ijto", input: "48-84-16-61ijto10", expectedTotal: 40 },
    // Fuzzy "into" (Levenshtein ≤2): ilto / olto / iltu and similar phone typos → xrate; 3 pairs ×10 = 30
    { id: "into-typo-ilto", input: "11-13-31ilto10", expectedTotal: 30 },
    { id: "into-typo-olto", input: "11-13-31olto10", expectedTotal: 30 },
    { id: "into-typo-iltu", input: "11-13-31iltu10", expectedTotal: 30 },
    { id: "into-typo-spaced", input: "11-13-31ilto 10", expectedTotal: 30 },
  ] as const;

  it.each(rows)("$id -> total $expectedTotal", (row) => {
    const result = calculateTotal(row.input);
    expect(result.total).toBe(row.expectedTotal);
    expect(result.failedLines ?? []).toEqual([]);
  });

  it("WhatsApp sample: into / intu / ijto lines all parse (markers Sg/Fd/Gb may fail)", () => {
    const raw = `[16/04, 3:27 pm] GC MALHOTRA PLAYER: 15-51into10
13-31-32-23-05-50into5
75-57intu10
08-80into10
16-61into10
19-91into5
Sg
[16/04, 3:27 pm] GC MALHOTRA PLAYER: 66into10
99-44into5
Sg
[16/04, 4:47 pm] GC MALHOTRA PLAYER: 48-84-16-61ijto10
Fd
[16/04, 6:24 pm] GC MALHOTRA PLAYER: 48-84-16-61ijto10
Gb
[16/04, 8:33 pm] GC MALHOTRA PLAYER: 11-13-31into10
66-99into5
Gb`;
    const r = calculateTotal(raw);
    expect(r.total).toBe(260);
    expect(r.failedLines?.sort()).toEqual(["Fd", "Gb", "Gb", "Sg", "Sg"]);
  });

  it("solid run with trailing bbb note remains B-only (not AB double)", () => {
    const raw = `[17/04, 3:44 pm] RESHMA SHINGH: 222bbb=50 it is "b" only
[17/04, 3:44 pm] RESHMA SHINGH: 999bbb=50 it is "b" only`;
    const r = calculateTotal(raw);
    expect(r.total).toBe(100);
    expect(r.failedLines ?? []).toEqual([]);
  });

  it("DS paste: tail row ending with . + next dot-pair row merge under previous ×rate; no-dot row merges to next line ×rate", () => {
    const text = `DS.65.59…33.x15 49.53.35.96.95.47.69.97.39.52.28.82.02.
56.18.72.92.94.x10
74.44.55.19.91.81.50.67.20.37.73.83
24.79.03.30.70.x5`;
    const r = calculateTotal(text);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(400);
    expect(r.results).toHaveLength(3);
    expect(r.results[0]).toMatchObject({ count: 3, rate: 15, lineTotal: 45 });
    expect(r.results[1]).toMatchObject({ count: 18, rate: 15, lineTotal: 270 });
    expect(r.results[2]).toMatchObject({ count: 17, rate: 5, lineTotal: 85 });
  });

  it("WhatsApp: GB lines + Harf.AxB. same-digit run keeps AB multiplier", () => {
    const raw = `[17/04, 9:06 pm] Ramesh Ji P: GB. 70.x30
86.68.90.18.20.72.92.65.9420.06..47.66.x10
07.08.44.56.74.78.13.55.28.82.02.x5
[17/04, 9:06 pm] Ramesh Ji P: Harf.AxB. 6666x50`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(315);
    const harfSeg = r.results.find(x => x.line.includes("6666"));
    expect(harfSeg).toMatchObject({ isDouble: true, count: 2, rate: 50, lineTotal: 100 });
  });
});

describe("parser structure checks", () => {
  it("treats AxB on same-digit run as AB (2×)", () => {
    const out = processLine("SG harf AxB 00000x50");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rate: 50,
      count: 2,
      isDouble: true,
      lineTotal: 100,
    });
  });

  it("treats A-B on same-digit run as AB (2×)", () => {
    const out = processLine("SG harf A-B 00000x50");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rate: 50,
      count: 2,
      isDouble: true,
      lineTotal: 100,
    });
  });

  it("treats A.B and A/B on same-digit run as AB (2×)", () => {
    expect(processLine("SG harf A.B 11111x10")[0]?.lineTotal).toBe(20);
    expect(processLine("harf A / B 22222x5")[0]?.lineTotal).toBe(10);
  });

  it("parses multi-x same-digit chain into two segments", () => {
    const out = processLine("Harf.B.1111x9999x50");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ line: "B.1111", rate: 50, count: 1, lineTotal: 50 });
    expect(out[1]).toMatchObject({ line: "B.9999", rate: 50, count: 1, lineTotal: 50 });
  });

  it("parses multi-x chain with extra separators around x", () => {
    const out = processLine("Harf.B..2222.x7777x50");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ line: "B.2222", rate: 50, count: 1, lineTotal: 50 });
    expect(out[1]).toMatchObject({ line: "B.7777", rate: 50, count: 1, lineTotal: 50 });
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

describe("session ledger (History / GamesView)", () => {
  it("sessionLedgerForSlotKey uses slotOverrides instead of raw message totals", () => {
    const baseResult = calculateTotal("10 20 30 40 50 60 x10");
    const session: SavedSession = {
      id: "c|01/01/2026",
      contact: "c",
      date: "01/01/2026",
      dateISO: "2026-01-01",
      createdAt: 1,
      messages: [
        {
          id: "m1",
          timestamp: "t",
          text: "x",
          slotId: "usa",
          result: baseResult,
        },
      ],
      slotOverrides: {
        usa: { results: [{ line: "99", rate: 1, isWP: false, isDouble: false, count: 1, lineTotal: 42 }], total: 42 },
      },
    };
    expect(sessionLedgerForSlotKey(session, "usa")?.total).toBe(42);
  });

  it("mergeSessionLedgerResult uses slotOverrides without double-counting messages", () => {
    const baseResult = calculateTotal("10 20 x10");
    const session: SavedSession = {
      id: "c|01/01/2026",
      contact: "c",
      date: "01/01/2026",
      dateISO: "2026-01-01",
      createdAt: 1,
      messages: [
        {
          id: "m1",
          timestamp: "t",
          text: "x",
          slotId: "usa",
          result: baseResult,
        },
        {
          id: "m2",
          timestamp: "t2",
          text: "y",
          slotId: "india",
          result: calculateTotal("11 22 x5"),
        },
      ],
      slotOverrides: {
        usa: { results: [{ line: "1", rate: 1, isWP: false, isDouble: false, count: 1, lineTotal: 7 }], total: 7 },
      },
    };
    const indiaTotal = calculateTotal("11 22 x5").total;
    const merged = mergeSessionLedgerResult(session);
    expect(merged.total).toBe(7 + indiaTotal);
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
