import { describe, expect, it } from "vitest";
import type { GameSlot, SavedSession } from "../types";
import {
  calculateTotal,
  formatSegmentLineForPairListDisplay,
  processLine,
  splitWhatsAppInputByContact,
  computePatternAccuracy,
  sessionLedgerForSlotKey,
  mergeSessionLedgerResult,
  stripLeadingMarketPrefix,
  splitPlainTextByMarketSlots,
  detectSlotFromMarketLine,
  ledgerDateStringForSlot,
} from "./calcUtils";
import { parseWhatsAppMessages } from "../calc/whatsapp";

const marketTestSlots: GameSlot[] = [
  { id: "db", name: "Delhi DB", time: "14:50", emoji: "1", enabled: true },
  { id: "sg", name: "Shri Ganesh SG", time: "16:25", emoji: "2", enabled: true },
  { id: "fb", name: "Faridabad", time: "17:50", emoji: "3", enabled: true },
  { id: "gl", name: "Gali GL", time: "23:17", emoji: "4", enabled: true },
  { id: "gb", name: "Ghaziabad GB", time: "21:15", emoji: "5", enabled: true },
  { id: "ds", name: "Disawar DS", time: "03:00", emoji: "6", enabled: true },
];

const fallbackGl = marketTestSlots.find((s) => s.id === "gl")!;

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
    // Dot jodi line: 9103 → two pairs 91+03 (same as 91.03). Tail is .30x5 → jodi 30, rate 5 (not x30).
    {
      id: "dot-9103-typo-and-30x5",
      input: "83.45.94.34.13..02.20.38.27.19.9103.30x5",
      expectedTotal: 65,
    },
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
    // WhatsApp: "=" before A/B lane letter on same-digit run (rate digits must not sit directly after "=" for SEP_RATE_RE)
    { id: "solid-equals-a", input: "111=A100", expectedTotal: 100 },
    { id: "solid-equals-b", input: "999=B100", expectedTotal: 100 },
    // Two-digit jodi + "." + single-digit stake (same as 40x5)
    { id: "jodi-dot-single-rate", input: "40.5", expectedTotal: 5 },
  ] as const;

  it.each(rows)("$id -> total $expectedTotal", (row) => {
    const result = calculateTotal(row.input);
    expect(result.total).toBe(row.expectedTotal);
    expect(result.failedLines ?? []).toEqual([]);
  });

  it("formatSegmentLineForPairListDisplay: 9103 shows 91, 03 in comma list (13 jodis, not 11 from regex)", () => {
    const r = calculateTotal("83.45.94.34.13..02.20.38.27.19.9103.30x5");
    const s = r.results[0]!;
    expect(s.count).toBe(13);
    const list = formatSegmentLineForPairListDisplay(s);
    const parts = list.split(", ");
    expect(parts).toHaveLength(13);
    expect(parts).toEqual([
      "83", "45", "94", "34", "13", "02", "20", "38", "27", "19", "91", "03", "30",
    ]);
  });

  it("formatSegmentLineForPairListDisplay: comma triple same-digit runs show 444, 777 (not 44, 77) with AB", () => {
    const r = calculateTotal("444,,,777,,,,,100ab");
    const s = r.results[0]!;
    expect(s.count).toBe(4);
    expect(s.isDouble).toBe(true);
    expect(formatSegmentLineForPairListDisplay(s)).toBe("444, 777");
  });

  it("formatSegmentLineForPairListDisplay: single triple with commas stripped shows 333 not 33 (AB)", () => {
    const r = calculateTotal("333,,,,,,100ab");
    const s = r.results[0]!;
    expect(formatSegmentLineForPairListDisplay(s)).toBe("333");
  });

  it("processLine sets lane A / B / AB for solid and comma suffixes", () => {
    expect(processLine("444(20)A")[0]?.lane).toBe("A");
    expect(processLine("444x20B")[0]?.lane).toBe("B");
    expect(processLine("333,,,100ab")[0]?.lane).toBe("AB");
    expect(processLine("B.1111x9999x50")[0]?.lane).toBe("B");
  });

  it("WhatsApp sample: into / intu / ijto lines all parse (Sg/Fd/Gb stamps skipped)", () => {
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
    expect(r.failedLines ?? []).toEqual([]);
  });

  it("Indian rs rate: Fb/Gb labels, space rsN and .rsN", () => {
    const raw = `[16/04, 5:31 pm] Mahinder Singh: Fb. 55 rs10
24.42.rs5
[16/04, 9:01 pm] Mahinder Singh: Gb. 20.02.46.64.rs5`;
    const r = calculateTotal(raw);
    expect(r.total).toBe(40);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(3);
  });

  it("comma list with rate on next line (…30,….. then ,20)", () => {
    const raw = `777,,,,,170ab
33,11,99,,,,,30
03,01,10,30,.....
,20
99,,,,,,90`;
    const r = calculateTotal(raw);
    expect(r.total).toBe(600);
    expect(r.failedLines ?? []).toEqual([]);
    const fourPair = r.results.find((x) => x.line === "03,01,10,30");
    expect(fourPair?.rate).toBe(20);
    expect(fourPair?.lineTotal).toBe(80);
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

  it("WhatsApp: comma list broken with trailing comma, rate ×N on next line (FB…)", () => {
    const raw = `[27/04, 5:12 pm] PAWAN JI PLAYER: FB 43,97,62,98,
33,79,26,89×70
`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(8 * 70);
    expect(r.results).toHaveLength(1);
  });

  it("WhatsApp: single '=' between jodis, multi '=' before stake (03=87=…=====5)", () => {
    const raw = `[02/05, 3:55 pm] K S: 03=87=04=55=43=22=====5
[02/05, 3:57 pm] K S: 42=28=05=35=96=92===5
[02/05, 3:57 pm] K S: 24=82====5
[02/05, 3:58 pm] K S: 10=42=28=====10`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    // 6×5 + 6×5 + 2×5 + 3×10
    expect(r.total).toBe(100);
  });

  it("dot jodi list + =rate + Hindi market suffix (no triple equals on line)", () => {
    const r = calculateTotal("10.01.15.51.60.06=10 गली दिसावर");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBeGreaterThan(0);
  });

  it("LAL CHAND 3-line block (dot rows + Hindi rate line) parses", () => {
    const raw = `20.02.70.07.25.52.75.57
40.04.45.54.90.09.95.59
10.01.15.51.60.06=10 गली दिसावर`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBeGreaterThan(0);
  });

  it("WhatsApp K S paste: per-message parse + fullwidth colon + spaced equals", () => {
    const raw = `[02/05, 3:55 pm] K S: 03=87=04=55=43=22=====5
[02/05, 3:57 pm] K S\uFF1A 42=28=05=35=96=92===5
[02/05, 3:57 pm] K S: 24 = 82 ====5
[02/05, 3:58 pm] K S: 10=42=28=====10`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).not.toBeNull();
    const sum = msgs!.reduce((s, m) => s + m.result.total, 0);
    expect(msgs!.flatMap((m) => m.result.failedLines ?? [])).toEqual([]);
    expect(sum).toBe(100);
  });

  it("slash pair/rate (NN/10) lines from WhatsApp — 43/10, 07/20 parse as NN×rate, not as junk", () => {
    const raw = `[27/04, 5:43 pm] JAGSIR: 43/10
34/5
07/20
50/10
`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(10 + 5 + 20 + 10);
  });

  it("slash denominator 120 — NN/120 becomes NN×120 (not NN + 120 merged with next row)", () => {
    const r = calculateTotal("27/120\n73/20");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({ line: "27", rate: 120, lineTotal: 120 });
    expect(r.results[1]).toMatchObject({ line: "73", rate: 20, lineTotal: 20 });
    expect(r.total).toBe(140);
  });

  it("merges first dot-clause ending in `.` with following line ×rate when no prior inherited rate", () => {
    const text = `DB. 58..26.66.65.
44..05.09.06.60.x10`;
    const r = calculateTotal(text);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(1);
    expect(r.total).toBe(90);
    expect(r.results[0]).toMatchObject({ rate: 10, count: 9, lineTotal: 90 });
  });

  it("regression: slash stake + multiline comma + x-rate (one segment each where applicable)", () => {
    const slash = calculateTotal("43/10");
    expect(slash.failedLines ?? []).toEqual([]);
    expect(slash.total).toBe(10);

    const pawan = `FB 43,97,62,98,
33,79,26,89×70
`;
    const c = calculateTotal(pawan);
    expect(c.failedLines ?? []).toEqual([]);
    expect(c.total).toBe(8 * 70);
    expect(c.results).toHaveLength(1);
  });

  it("full JAGSIR-style slash list (all NN/rate rows) — no failed lines, sum of rates", () => {
    const raw = `[27/04, 5:43 pm] JAGSIR SINGH PLAYER: 43/10
34/5
07/20
70/20
14/5
41/5
12/5
21/5
10/20
13/10
15/5
16/10
61/10
[27/04, 5:45 pm] JAGSIR SINGH PLAYER: 05/20
52/10
25/5
53/5
35/10
71/5
17/10
54/10
45/10
56/10
65/20
57/5
75/10.
58/10
85/30
[27/04, 5:46 pm] JAGSIR SINGH PLAYER: 72/10
27/20
74/10
47/10
76/10
67/10
78/10
87/40
[27/04, 5:47 pm] JAGSIR SINGH PLAYER: 50/10
`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(430);
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

  it("parses same-digit run + AB/A/B glued before rate (000B100 / 000A100 / 000AB100)", () => {
    expect(processLine("000B100")[0]).toMatchObject({
      line: "000",
      rate: 100,
      count: 1,
      isDouble: false,
      lineTotal: 100,
    });
    expect(processLine("000A100")[0]).toMatchObject({
      line: "000",
      rate: 100,
      count: 1,
      isDouble: false,
      lineTotal: 100,
    });
    expect(processLine("000AB100")[0]).toMatchObject({
      line: "000",
      rate: 100,
      count: 2,
      isDouble: true,
      lineTotal: 200,
    });
    const r = calculateTotal("000B100\n000A100");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(200);
  });

  it("accepts unicode multiply sign in rate marker (×) including single pair", () => {
    const text = `GL 08,09,73,54,57×10
GL 17,71,23,32×10
GL 83×10`;
    const out = calculateTotal(text);
    expect(out.failedLines ?? []).toEqual([]);
    expect(out.total).toBe(100);
  });

  it("merges comma list split across lines when first row has no trailing comma before ×rate row", () => {
    const text = `GL 40,95,18,17,70,10,00
04,59,81,71,07,01,44,19,91×30`;
    const out = calculateTotal(text);
    expect(out.failedLines ?? []).toEqual([]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ count: 16, rate: 30, lineTotal: 480 });
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

describe("market slot hints (plain paste)", () => {
  it("stripLeadingMarketPrefix removes DB / दिल्ली style tags", () => {
    const { slot, rest } = stripLeadingMarketPrefix(
      "DB/दिल्ली बजार 12 34 x10",
      marketTestSlots
    );
    expect(slot?.id).toBe("db");
    expect(rest).toBe("12 34 x10");
  });

  it("detectSlotFromMarketLine maps Sg / श्री गणेश line", () => {
    const s = detectSlotFromMarketLine("Sg 11 22 x5", marketTestSlots);
    expect(s?.id).toBe("sg");
  });

  it("splitPlainTextByMarketSlots assigns chunks by labels", () => {
    const raw = "10 20 x5\nFB\n30 40 x10\nGL\n50 x2";
    const chunks = splitPlainTextByMarketSlots(
      raw,
      marketTestSlots,
      fallbackGl
    );
    expect(chunks.map((c) => c.slotId)).toEqual([
      "gl",
      "fb",
      "gl",
    ]);
    expect(chunks[0].touchedByMarketLabel).toBe(false);
    expect(chunks[1].touchedByMarketLabel).toBe(true);
    expect(chunks[1].text).toContain("30");
    expect(chunks[2].touchedByMarketLabel).toBe(true);
  });
});

describe("ledgerDateStringForSlot (slot result-time determines same vs previous day)", () => {
  const op = new Date(2026, 3, 21); // 21 Apr 2026 local

  it("day/evening slots (result time ≥ 06:00) use the SAME calendar day", () => {
    // Gali 23:17, Faridabad 17:50, Delhi Bazaar 14:50 — all afternoon/evening
    expect(ledgerDateStringForSlot(marketTestSlots[3], op)).toBe("21/04/2026");
    expect(ledgerDateStringForSlot(marketTestSlots[2], op)).toBe("21/04/2026");
    expect(ledgerDateStringForSlot(marketTestSlots[0], op)).toBe("21/04/2026");
  });

  it("overnight slots (result time < 06:00) use the PREVIOUS calendar day", () => {
    // Disawar 03:00 — overnight draw, game started the previous afternoon
    expect(ledgerDateStringForSlot(marketTestSlots[5], op)).toBe("20/04/2026");
    // Same rule at 3:30 AM the next calendar day — still "yesterday's game"
    const earlyMorning = new Date(2026, 3, 22, 3, 30); // 22 Apr 2026 03:30 AM
    expect(ledgerDateStringForSlot(marketTestSlots[5], earlyMorning)).toBe("21/04/2026");
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
