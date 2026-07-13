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
  {
    id: "sg",
    name: "Shri Ganesh SG",
    time: "16:25",
    emoji: "2",
    enabled: true,
  },
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
    {
      id: "label-harf-typo-seps",
      input: "Harf.B..2222.x7777x50",
      expectedTotal: 100,
    },
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
    {
      id: "space-dash-rate",
      input: "20 37 28 39 - 28\n22 17 22 33 - 5",
      expectedTotal: 132,
    },
    { id: "typo-separators", input: "12;34|56,10", expectedTotal: 30 },
    { id: "typo-fullwidth", input: "２０　３７x10", expectedTotal: 20 },
    {
      id: "typo-wp",
      input: "56 74 50 w.p\n13 31 15 palatel\n22 33 10 w p",
      expectedTotal: 250,
    },
    // WhatsApp-style "into" rate with common typos (intu / ijto)
    { id: "into-typo-intu", input: "75-57intu10", expectedTotal: 20 },
    { id: "into-typo-ijto", input: "48-84-16-61ijto10", expectedTotal: 40 },
    // Fuzzy "into" (Levenshtein ≤2): ilto / olto / iltu and similar phone typos → xrate; 3 pairs ×10 = 30
    { id: "into-typo-ilto", input: "11-13-31ilto10", expectedTotal: 30 },
    { id: "into-typo-olto", input: "11-13-31olto10", expectedTotal: 30 },
    { id: "into-typo-iltu", input: "11-13-31iltu10", expectedTotal: 30 },
    { id: "into-typo-spaced", input: "11-13-31ilto 10", expectedTotal: 30 },
    {
      id: "dot-list-with-palt-into",
      input: "37.48.50.41.36.27.with palt 5intu",
      expectedTotal: 30,
    },
    // WhatsApp: "=" before A/B lane letter on same-digit run (rate digits must not sit directly after "=" for SEP_RATE_RE)
    { id: "solid-equals-a", input: "111=A100", expectedTotal: 100 },
    { id: "solid-equals-b", input: "999=B100", expectedTotal: 100 },
    // Two-digit jodi + "." + single-digit stake (same as 40x5)
    { id: "jodi-dot-single-rate", input: "40.5", expectedTotal: 5 },
    // Dash as rate separator (WA shorthand): same stakes as slash whitelist + trailing single digit
    {
      id: "jodi-dash-rate-multiline",
      input: "27-5\n17-5\n52-5\n53-5",
      expectedTotal: 20,
    },
    // WhatsApp plus-chain rate (// or / at end): count entries × rate.
    { id: "arith-double-slash", input: "75+57//5", expectedTotal: 10 },
    {
      id: "arith-slash-chain",
      input: "01+02+03+04+05+06+07+08+09+10/5",
      expectedTotal: 50,
    },
    {
      id: "arith-long-palyr",
      input:
        "06+96+69+05+95+93+09+76+16+50+71+13+31+15+51+97+04+40+26+62+55+91+19+39//5",
      expectedTotal: 120,
    },
    {
      id: "arith-long-palyr-with-reference-chain",
      input:
        "06+96+69+05+95+93+09+76+16+50+71+13+31+15+51+97+04+40+26+62+55+91+19+39//5\n01+02+03+04+05+06+07+08+09+10//5",
      expectedTotal: 170,
    },
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
      "83",
      "45",
      "94",
      "34",
      "13",
      "02",
      "20",
      "38",
      "27",
      "19",
      "91",
      "03",
      "30",
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

  it("bare numbers in one message: jodis are tokens 1…n−1, last token is rate", () => {
    const cases = [
      { input: "65\n20", total: 20, segs: 1 },
      { input: "Desawr\n65\n20", total: 20, segs: 1 },
      { input: "Desawr\n65 70\n20", total: 40, segs: 2 },
      { input: "Desawr\n65\n20\n20", total: 40, segs: 2 },
      { input: "Desawr\n65 20 20", total: 40, segs: 2 },
    ] as const;
    for (const c of cases) {
      const r = calculateTotal(c.input);
      expect(r.failedLines ?? [], c.input).toEqual([]);
      expect(r.total, c.input).toBe(c.total);
      expect(r.results, c.input).toHaveLength(c.segs);
    }
  });

  it("WhatsApp: bare number message then into lines in next message", () => {
    const raw = `[29/05, 12:06 am] skgonline1979:  
65
20
[29/05, 12:06 am] skgonline1979: 49-94into15
48-84into10
59-95into5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs![0]!.result.total).toBe(20);
    expect(msgs![1]!.result.total).toBe(60);
    expect(msgs!.flatMap((m) => m.result.failedLines ?? [])).toEqual([]);
  });

  it("skgonline1979: dash jodi row then Into5 on next line (97-79-02-20-03-30)", () => {
    const raw = `[04/06, 3:21 pm] skgonline1979: 07-70-59-95into5
32-23into30
37-73-into10
87-78-82-28into5
97-79-02-20-03-30
Into5`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(150);
    expect(r.results).toHaveLength(5);
    expect(r.results[4]).toMatchObject({
      line: "97-79-02-20-03-30",
      rate: 5,
      count: 6,
      lineTotal: 30,
    });
  });

  it("GC MALHOTRA: hyphen line break before Into rate — merge rows (no orphan x5)", () => {
    const raw = `[03/05, 3:17 pm] GC MALHOTRA PLAYER: 75-57into10
25-52-02-20-
Into5
18-81-08-80into5
05-50into10
Sg
Db
[03/05, 3:18 pm] GC MALHOTRA PLAYER: 07-70into5
03-30into5
17-71-18-81into10
34-43-24-42-into5
32-23into10
Sh`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(180);
  });

  it("inyo typo + incomplete dash row merged with next into line", () => {
    const text = `77-59-95-inyo10
05-50-
77-59-95-into5`;
    const r = calculateTotal(text);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      line: "77-59-95",
      rate: 10,
      count: 3,
      lineTotal: 30,
    });
    expect(r.results[1]).toMatchObject({
      rate: 5,
      count: 5,
      lineTotal: 25,
    });
    expect(r.total).toBe(55);
  });

  it("GC MALHOTRA: hyphen before into on same line + inyo typo + colon in jodi row", () => {
    const raw = `[05/05, 2:00 pm] GC MALHOTRA PLAYER: 05-50-into15
32-23into5
01-10-28-82-18-81into5
17-71-49-08-80-94inyo5
Db
[05/05, 3:16 pm] GC MALHOTRA PLAYER: 05-50-into10
32-:23-34-43-17-71into5
Sg`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(150);
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
    const harfSeg = r.results.find((x) => x.line.includes("6666"));
    expect(harfSeg).toMatchObject({
      isDouble: true,
      count: 2,
      rate: 50,
      lineTotal: 100,
    });
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

  it("NN=RR rows + trailing 77.30 दिसावर keeps single-jodi stake when rate matches", () => {
    const r = calculateTotal(`27=40
72=40
49=30
94=30
77.30  दिसावर`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(5);
    expect(r.results[4]).toMatchObject({
      line: "77",
      rate: 30,
      count: 1,
      lineTotal: 30,
    });
    expect(r.total).toBe(170);
  });

  it("skgonline1979: NN=RR block + DS comma jodi and 77.30 continuation (WhatsApp)", () => {
    const raw = `[02/06, 12:23 am] skgonline1979: 27=40
72=40
49=30
94=30
77.30  दिसावर
[02/06, 12:23 am] skgonline1979: DS 19,62×55
77.30`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).not.toBeNull();
    expect(msgs!.flatMap((m) => m.result.failedLines ?? [])).toEqual([]);
    expect(msgs![0]!.result.total).toBe(170);
    expect(msgs![1]!.result.total).toBe(220);
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

  it("WhatsApp Palyr paste parses plus-chain rate messages as count times rate", () => {
    const raw = `[07/05, 8:13 pm] RAM KUMAR Palyr: 06+96+69+05+95+93+09+76+16+50+71+13+31+15+51+97+04+40+26+62+55+91+19+39//5
[07/05, 8:13 pm] RAM KUMAR Palyr: 01+02+03+04+05+06+07+08+09+10//5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).not.toBeNull();
    expect(msgs).toHaveLength(2);
    expect(msgs!.map((m) => m.result.total)).toEqual([120, 50]);
    expect(msgs!.flatMap((m) => m.result.results)).toHaveLength(2);
    expect(msgs!.flatMap((m) => m.result.failedLines ?? [])).toEqual([]);
    expect(msgs!.reduce((s, m) => s + m.result.total, 0)).toBe(170);
  });

  it("equals jodi chain with into rate (19=91=28into 5)", () => {
    const r = calculateTotal("19=91=28into 5");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(15);
    expect(r.results[0]).toMatchObject({
      line: "19 91 28",
      rate: 5,
      count: 3,
      lineTotal: 15,
    });
  });

  it("skgonline1979: Sg/FB/dot rows + Desawr 02..52 with 10.intu (03–04 Jun)", () => {
    const raw = `[03/06, 4:03 pm] skgonline1979: Sg.60.06.40.94.61..02.41.59.95x10
[03/06, 5:31 pm] skgonline1979: FB.55.50.05.44..16.78.30..62.12.88x10
[03/06, 9:00 pm] skgonline1979:
44..04..20.09.71.79.39.41x10
[04/06, 12:21 am] skgonline1979: Desawr 
02..52
10.intu`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(4);
    expect(msgs!.map((m) => m.result.total)).toEqual([90, 100, 80, 20]);
    expect(msgs![0]!.result.results[0]).toMatchObject({
      count: 9,
      rate: 10,
      lineTotal: 90,
    });
    expect(msgs![1]!.result.results[0]).toMatchObject({
      count: 10,
      rate: 10,
      lineTotal: 100,
    });
    expect(msgs![2]!.result.results[0]).toMatchObject({
      count: 8,
      rate: 10,
      lineTotal: 80,
    });
    expect(msgs!.flatMap((m) => m.result.failedLines ?? [])).toEqual([]);
  });

  it("GB: value row + 30..10..10 uniform-tail rate row → 5 jodis at 10", () => {
    const raw = `[01/06, 7:38 pm] skgonline1979: GB 
79..78..28
30..10..10`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({
      line: "79 78 28 30 10",
      rate: 10,
      count: 5,
      lineTotal: 50,
    });
    expect(r.total).toBe(50);
  });

  it("FB double-dot value/rate rows stay uniform-rate zip (54..14..08 + 10..10..10)", () => {
    const r = calculateTotal(`FB 
54..14..08
10..10..10`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(30);
    expect(r.results).toHaveLength(3);
    expect(r.results.map((x) => x.lineTotal)).toEqual([10, 10, 10]);
  });

  it("FB double-dot jodi..rate lines (46..45 and 20..20)", () => {
    const raw = `[28/05, 5:29 pm] skgonline1979: FB 
46..45
20..20`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.result.failedLines ?? []).toEqual([]);
    expect(msgs![0]!.result.total).toBe(65);
    expect(msgs![0]!.result.results).toHaveLength(2);
    expect(msgs![0]!.result.results[0]).toMatchObject({
      line: "46",
      rate: 45,
      lineTotal: 45,
    });
    expect(msgs![0]!.result.results[1]).toMatchObject({
      line: "20",
      rate: 20,
      lineTotal: 20,
    });
  });

  it("comma list: many commas separate multiple rates in one line", () => {
    const r = calculateTotal("95,79,98,01,,,,,,20,,,,,59,97,89,10,,,,,10");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(120);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      line: "95,79,98,01",
      rate: 20,
      count: 4,
      lineTotal: 80,
    });
    expect(r.results[1]).toMatchObject({
      line: "59,97,89,10",
      rate: 10,
      count: 4,
      lineTotal: 40,
    });
  });

  it("paren typo: (35( at end of line parses as rate 35", () => {
    const raw = `[29/05, 12:11 am] Jai Shree Shyam 🙏🏻: 98 94(150)wp
77 27 72 (35(`;
    const r = calculateTotal(raw.replace(/\[[^\]]*\]\s*[^:\n]+:\s*/g, ""));
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(705);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      line: "98 94",
      rate: 150,
      isWP: true,
      lineTotal: 600,
    });
    expect(r.results[1]).toMatchObject({
      line: "77 27 72",
      rate: 35,
      count: 3,
      lineTotal: 105,
    });
  });

  it("WhatsApp bold/markup: 04*54* merges with 09--59(75(wp typo paren", () => {
    const raw = `[28/05, 9:12 pm] Jai Shree Shyam 🙏🏻: 04*54*
09--59(75(wp
08--58--03--53*(35)wp`;
    const r = calculateTotal(raw.replace(/\[[^\]]*\]\s*[^:\n]+:\s*/g, ""));
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(880);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      line: "04 54 09--59",
      rate: 75,
      isWP: true,
      count: 8,
      lineTotal: 600,
    });
    expect(r.results[1]).toMatchObject({
      rate: 35,
      lineTotal: 280,
      isWP: true,
    });
  });

  it("WhatsApp bold/markup: *12..14*17...19*(50)wp → 8 WP entries at 50", () => {
    const r = calculateTotal("*12..14*17...19*(50)wp");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(400);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({
      line: "12..14 17...19",
      rate: 50,
      isWP: true,
      count: 8,
      lineTotal: 400,
    });
  });

  it("WhatsApp bold/markup: 78*73* is two jodis (not 78×73) and merges with (75)wp row", () => {
    const raw = `78*73*
23--28--(75)wp`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(600);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({
      line: "78 73 23--28",
      rate: 75,
      isWP: true,
      count: 8,
      lineTotal: 600,
    });
  });

  it("WhatsApp bold/markup: 59*_54* merges with *09 04(50) and does not fail first row", () => {
    const raw = `[14/05, 5:47 pm] Jai Shree Shyam 🙏🏻: 59*_54*
*09 04(50)
--05--57--52--02--07*(50)wp`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(700);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      line: "59 54 09 04",
      rate: 50,
      count: 4,
      lineTotal: 200,
    });
    expect(r.results[1]).toMatchObject({
      rate: 50,
      lineTotal: 500,
      isWP: true,
    });
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
    expect(r.results[0]).toMatchObject({
      line: "27",
      rate: 120,
      lineTotal: 120,
    });
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
  it("treats glued HarfAxBx. prefix as Harf.AxB. (AB 2× on same-digit run)", () => {
    const out = processLine("HarfAxBx.55555x50");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      line: "55555",
      rate: 50,
      count: 2,
      isDouble: true,
      lane: "AB",
      lineTotal: 100,
    });
    expect(calculateTotal("HarfAxBx.55555x50").total).toBe(100);
  });

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
    expect(out[0]).toMatchObject({
      line: "B.1111",
      rate: 50,
      count: 1,
      lineTotal: 50,
    });
    expect(out[1]).toMatchObject({
      line: "B.9999",
      rate: 50,
      count: 1,
      lineTotal: 50,
    });
  });

  it("parses Harf. ,B.. typo before multi-x same-digit chain (77777x9999x50)", () => {
    const out = processLine("Harf. ,B.. 77777x9999x50");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      line: "B.77777",
      rate: 50,
      count: 1,
      lane: "B",
      lineTotal: 50,
    });
    expect(out[1]).toMatchObject({
      line: "B.9999",
      rate: 50,
      count: 1,
      lane: "B",
      lineTotal: 50,
    });
    const raw = `[16/05, 2:11 pm] Ramesh Ji P: DB. 54.46.45.55.47.35.03.30.53..97.79.73.53..02.20.24.x10
Harf. ,B.. 77777x9999x50
[16/05, 2:21 pm] Ramesh Ji P: DB. 17.x20
71x10`;
    const r = calculateTotal(raw);
    expect(r.failedLines ?? []).toEqual([]);
    const harfSegs = r.results.filter(
      (s) => s.line.includes("77777") || s.line.includes("9999")
    );
    expect(harfSegs).toHaveLength(2);
    expect(harfSegs.reduce((s, x) => s + x.lineTotal, 0)).toBe(100);
  });

  it("parses multi-x chain with extra separators around x", () => {
    const out = processLine("Harf.B..2222.x7777x50");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      line: "B.2222",
      rate: 50,
      count: 1,
      lineTotal: 50,
    });
    expect(out[1]).toMatchObject({
      line: "B.7777",
      rate: 50,
      count: 1,
      lineTotal: 50,
    });
  });

  it("supports trailing dash-rate style", () => {
    const out = calculateTotal("20 37 28 39 - 28\n22 17 22 33 - 5");
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({
      count: 4,
      rate: 28,
      lineTotal: 112,
    });
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
    expect(out.results[0]).toMatchObject({
      count: 16,
      rate: 30,
      lineTotal: 480,
    });
  });

  it("splits comma jodi runs at पलट के साथ so each group keeps its own rate", () => {
    const text =
      "75,74,78,79,76,,,,15 पलट के साथ,,70,71,72,73,,,,10 पलट के साथ";
    const out = calculateTotal(text);
    expect(out.failedLines ?? []).toEqual([]);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({
      line: "75,74,78,79,76",
      rate: 15,
      isWP: true,
      lineTotal: 150,
    });
    expect(out.results[1]).toMatchObject({
      line: "70,71,72,73",
      rate: 10,
      isWP: true,
      lineTotal: 80,
    });
    expect(out.total).toBe(230);
  });

  it("single comma row with पलट के साथ still parses as one bet", () => {
    const text = "21,71,76,39,97,31,,,,20 पलट के साथ";
    const out = calculateTotal(text);
    expect(out.failedLines ?? []).toEqual([]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      rate: 20,
      isWP: true,
      lineTotal: 240,
    });
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
        usa: {
          results: [
            {
              line: "99",
              rate: 1,
              isWP: false,
              isDouble: false,
              count: 1,
              lineTotal: 42,
            },
          ],
          total: 42,
        },
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
        usa: {
          results: [
            {
              line: "1",
              rate: 1,
              isWP: false,
              isDouble: false,
              count: 1,
              lineTotal: 7,
            },
          ],
          total: 7,
        },
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
    expect(chunks.map((c) => c.slotId)).toEqual(["gl", "fb", "gl"]);
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
    expect(ledgerDateStringForSlot(marketTestSlots[5], earlyMorning)).toBe(
      "21/04/2026"
    );
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
    const r = calculateTotal("10 20 x5\n99abc88def77 not a valid bet line 42");
    expect(r.failedLines?.length).toBeGreaterThan(0);
    const a = computePatternAccuracy(r);
    expect(a.scorePercent).toBeLessThan(100);
    expect(a.reasons.some((x) => x.includes("not matched"))).toBe(true);
  });

  it("deducts for WA slot fallbacks", () => {
    const r = calculateTotal("11 22 x10");
    const a = computePatternAccuracy(r, { waSlotFallbackCount: 2 });
    expect(a.scorePercent).toBe(99.7);
    expect(a.reasons.some((x) => x.includes("fallback"))).toBe(true);
  });
});

describe("user typo normalization — real WhatsApp paste fixes", () => {
  it("28.82.80.08==.10 — stray dot after == rate marker", () => {
    const r = calculateTotal("28.82.80.08==.10");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(40);
    expect(r.results[0]).toMatchObject({ count: 4, rate: 10, lineTotal: 40 });
  });

  it("55.27.87..95..x.10 — stray dot after x rate marker", () => {
    const r = calculateTotal("55.27.87..95..x.10");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(40);
  });

  it("DS.30.x.180 — DS label + dot around x", () => {
    const r = calculateTotal("DS.30.x.180");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(180);
  });

  it("55x.30 — dot after x before rate", () => {
    const r = calculateTotal("55x.30");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(30);
  });

  it("83.29.entu20 — entu typo preceded by dot separator", () => {
    const r = calculateTotal("83.29.entu20");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(40);
    expect(r.results[0]).toMatchObject({ count: 2, rate: 20, lineTotal: 40 });
  });

  it("Dl.50 .75.into5 — DL label, dot before into", () => {
    const r = calculateTotal("Dl.50 .75.into5");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(10);
  });

  it("total suffix stripped before parsing — entu10total140", () => {
    const r = calculateTotal("21.18.74.58.48.84entu10total140");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(60);
    expect(r.results[0]).toMatchObject({ count: 6, rate: 10, lineTotal: 60 });
  });

  it("total suffix stripped — entu20total120", () => {
    const r = calculateTotal("59.29.92.95.34.43entu20total120");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(120);
    expect(r.results[0]).toMatchObject({ count: 6, rate: 20, lineTotal: 120 });
  });

  it("multi-line entu with total suffix on second line", () => {
    const text = "12.81.47.85entu20\n21.18.74.58.48.84entu10total140";
    const r = calculateTotal(text);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(140);
  });
});

describe("↳ not counted annotations + market-suffix lines (WhatsApp paste)", () => {
  const block = `06===500 फरीदाबाद
↳ not counted
59.95=100 फरीदाबाद
↳ not counted
72.27.11.66=30 फरीदाबाद
↳ not counted
88=========500 फरीदाबाद
↳ not counted
फरीदाबाद
↳ not counted
40.04=30 श्री गणेश
↳ not counted
88=====100 श्री गणेश
↳ not counted
85.58===100 श्री गणेश
↳ not counted`;

  it("↳ not counted lines do not produce errors", () => {
    const r = calculateTotal(block);
    expect(r.failedLines ?? []).toEqual([]);
  });

  it("standalone Hindi market label alone (फरीदाबाद) is silently skipped", () => {
    const r = calculateTotal("फरीदाबाद");
    expect(r.failedLines ?? []).toEqual([]);
  });

  it("standalone श्री गणेश label alone is silently skipped", () => {
    const r = calculateTotal("श्री गणेश");
    expect(r.failedLines ?? []).toEqual([]);
  });
});

describe("no-digit label/annotation lines — silently skipped (no errors)", () => {
  const noDigitLines = [
    "Sri Ganesh...",
    "Delhi Bazzar",
    "⚠ Could not read this line",
    "Not added to total",
    "Fix",
    "Gali&ds",
    "Galli .....",
    "Gali &ds",
  ];
  for (const line of noDigitLines) {
    it(`skips: ${JSON.stringify(line)}`, () => {
      const r = calculateTotal(line);
      expect(r.failedLines ?? []).toEqual([]);
    });
  }

  it("full paste block with label/annotation noise produces no errors", () => {
    const text = `ds
↳ not counted
Gali
↳ not counted
Sri Ganesh...
↳ not counted
Delhi Bazzar
⚠ Could not read this line
Not added to total
Fix
Gali&ds
↳ not counted
Galli .....
⚠ Could not read this line
Not added to total
Gali &ds
↳ not counted`;
    const r = calculateTotal(text);
    expect(r.failedLines ?? []).toEqual([]);
  });
});

describe("leading comma/dot before game label (WhatsApp typo)", () => {
  it(",Harf.b.x4444x6666x50 — leading comma stripped, both numbers counted at rate 50", () => {
    const r = calculateTotal(",Harf.b.x4444x6666x50");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(100);
    expect(r.results).toHaveLength(2);
  });
});

describe("3-digit number + dash rate (100-30 style)", () => {
  it("100-30 alone gives 1×30=30 (no A/B marker → single bet)", () => {
    const r = calculateTotal("100-30");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(30);
  });

  it("100-30 on line 1 and 10-20 on line 2 do NOT merge — total is 30+20=50", () => {
    const r = calculateTotal("100-30\n10-20");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results).toHaveLength(2);
    expect(r.total).toBe(50);
  });
});

describe("postfix Rs/rs rate marker (`200rs`, `75rs`)", () => {
  it("22 200rs — jodi 22 at rate 200", () => {
    const r = calculateTotal("22 200rs");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(200);
    expect(r.results[0]).toMatchObject({ rate: 200, count: 1 });
  });

  it("27 72 77 75rs — three jodis at rate 75", () => {
    const r = calculateTotal("27 72 77  75rs");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(225);
    expect(r.results[0]).toMatchObject({ rate: 75, count: 3 });
  });

  it("multi-line rs paste: 200+225=425", () => {
    const r = calculateTotal("22 200rs\n27 72 77  75rs");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(425);
    expect(r.results).toHaveLength(2);
  });
});

describe("Jul-7 batch — four previously failing patterns", () => {
  it("trailing = with rate on next line: 13 jodis × 30 = 390", () => {
    const r = calculateTotal("66.77.22.33.88.90\n09.26.62.65.56.40.04=\n30");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(390);
  });

  it("trailing = with rate on next line (7 jodis): 09.26... =\\n30 = 210", () => {
    const r = calculateTotal("09.26.62.65.56.40.04=\n30");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(210);
  });

  it("comma WP rate: 10,65,90,03,25,94,99\\n(35/wp — 7 jodis WP at 35", () => {
    const r = calculateTotal("10,65,90,03,25,94,99\n(35/wp");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.results[0]).toMatchObject({ rate: 35, isWP: true });
    expect(r.total).toBe(455);
  });

  it("int typo for into: 65-56int10 = 2 × 10 = 20", () => {
    const r = calculateTotal("65-56int10");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(20);
  });

  it("Harf.ab.x5555x50 — lowercase ab lane, x-prefixed number = 100", () => {
    const r = calculateTotal("Harf.ab.x5555x50");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(100);
  });

  it("Harf.AB.x5555x50 — uppercase AB lane = 100", () => {
    const r = calculateTotal("Harf.AB.x5555x50");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(100);
  });
});

describe("double-paren rate: ((35)) treated same as (35)", () => {
  it("99 66((35)) — 2 jodis at rate 35 = 70", () => {
    const r = calculateTotal("99 66((35))");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(70);
    expect(r.results[0]).toMatchObject({ rate: 35, count: 2 });
  });
});
