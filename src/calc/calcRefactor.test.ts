/**
 * Regression: after splitting `calcUtils` into `src/calc/*`, the barrel must match
 * direct module imports and preserve totals / helpers (no behavior drift).
 */
import { describe, expect, it } from "vitest";
import type { GameSlot, SavedSession } from "../types";
import * as fromBarrel from "../lib/calcUtils";
import { processLine as processLineDirect } from "./betParser";
import {
  calculateTotal as totalDirect,
  computePatternAccuracy as accuracyDirect,
} from "./pasteAndTotal";
import {
  mergeSessionLedgerResult as mergeLedgerDirect,
  toDateISO as toDateISODirect,
} from "./sessions";
import {
  normalizeTypoTolerantInput as normDirect,
  preprocessText as preprocessDirect,
} from "./textNormalize";
import { parseWhatsAppMessages as parseWaDirect } from "./whatsapp";
import {
  DEFAULT_SETTINGS as defaultSettingsDirect,
  upsertPaymentStubs,
} from "./settingsPayments";
import { slotMinutes as slotMinutesDirect } from "./slotsTime";
import { pickSlotByMarketHints as pickDirect } from "./market";

const slot: GameSlot = { id: "t", name: "Test", time: "10:00", emoji: "x", enabled: true };

function assertSameTotal(a: { total: number; failedLines?: string[] }, b: typeof a, label: string) {
  expect(b.total, label).toBe(a.total);
  expect(b.failedLines ?? [], label).toEqual(a.failedLines ?? []);
}

describe("refactor: barrel re-exports exist", () => {
  it("exposes core entrypoints used by the app", () => {
    expect(fromBarrel.calculateTotal).toBeTypeOf("function");
    expect(fromBarrel.processLine).toBeTypeOf("function");
    expect(fromBarrel.preprocessText).toBeTypeOf("function");
    expect(fromBarrel.normalizeTypoTolerantInput).toBeTypeOf("function");
    expect(fromBarrel.parseWhatsAppMessages).toBeTypeOf("function");
    expect(fromBarrel.splitWhatsAppInputByContact).toBeTypeOf("function");
    expect(fromBarrel.computePatternAccuracy).toBeTypeOf("function");
    expect(fromBarrel.mergeIntoSessions).toBeTypeOf("function");
    expect(fromBarrel.toDateISO).toBeTypeOf("function");
    expect(fromBarrel.loadSessions).toBeTypeOf("function");
    expect(fromBarrel.mergeSessionLedgerResult).toBeTypeOf("function");
    expect(fromBarrel.loadSettings).toBeTypeOf("function");
    expect(fromBarrel.DEFAULT_SETTINGS).toMatchObject({ commissionPct: 5 });
    expect(fromBarrel.loadGameSlots).toBeTypeOf("function");
    expect(fromBarrel.slotMinutes).toBeTypeOf("function");
    expect(fromBarrel.stripLeadingMarketPrefix).toBeTypeOf("function");
  });
});

describe("refactor: barrel vs direct module — identical results", () => {
  const totalCases = [
    { label: "x-rate pairs", text: "58.58x10" },
    { label: "comma + slash stake", text: "43/10\nc5/5" },
    { label: "multiline comma + rate", text: "FB 12,34,56,78,\n12,11,10,9x5\n" },
  ] as const;

  it.each(totalCases)("calculateTotal: $label", ({ text }) => {
    const a = fromBarrel.calculateTotal(text);
    const b = totalDirect(text);
    assertSameTotal(b, a, "calculateTotal parity");
  });

  it("processLine matches for separator and paren", () => {
    const lines = ["32-22x5", "444(10)A", "12,34,56,10"];
    for (const line of lines) {
      expect(fromBarrel.processLine(line)).toEqual(processLineDirect(line));
    }
  });

  it("slash-separated jodis with ==rate ignore meaningless FB suffix", () => {
    const text = [
      "16/61==25FB",
      "64/46==25",
      "36/63/86/68==15FB",
      "36/63/64//==50FB",
    ].join("\n");
    const { total } = fromBarrel.calculateTotal(text);
    expect(total).toBe(50 + 50 + 60 + 150);
  });

  it("slash jodi chains with ===rate ignore GL suffix", () => {
    const text = [
      "14/15/46===100",
      "41/51/64==50GL",
      "16/61/36/63/86/68/==25GL",
    ].join("\n");
    const { total } = fromBarrel.calculateTotal(text);
    expect(total).toBe(300 + 150 + 150);
  });

  it("comma into lines with market code suffix are not WP", () => {
    const text = [
      "37,38,into,15,srg",
      "09,75,70,71,74,73,into,10srg",
      "95,35,59,53,into,10srg",
    ].join("\n");
    const { result } = fromBarrel.calculateTotalWithSources(text);
    expect(result.total).toBe(30 + 60 + 40);
    expect(result.results.every((s) => !s.isWP)).toBe(true);
  });

  it("text helpers match", () => {
    const raw = "[1/1, 2:00 pm] A: 43/10\n";
    expect(fromBarrel.preprocessText(raw)).toBe(preprocessDirect(raw));
    const messy = "２０x１０";
    expect(fromBarrel.normalizeTypoTolerantInput(messy)).toBe(normDirect(messy));
  });

  it("toDateISO", () => {
    const d = "15/04/2026";
    expect(fromBarrel.toDateISO(d)).toBe(toDateISODirect(d));
  });

  it("computePatternAccuracy", () => {
    const r = fromBarrel.calculateTotal("completely unparseable gibberish xyz");
    const a = fromBarrel.computePatternAccuracy(r);
    const b = accuracyDirect(r);
    expect(b.scorePercent).toBe(a.scorePercent);
    expect(b.reasons.length).toBe(a.reasons.length);
  });

  it("mergeSessionLedgerResult (single slot, no override)", () => {
    const session: SavedSession = {
      id: "c|d",
      contact: "c",
      date: "1/1/2026",
      dateISO: "2026-01-01",
      createdAt: 0,
      messages: [
        {
          id: "1",
          timestamp: "t",
          text: "10x5",
          result: fromBarrel.calculateTotal("10x5"),
        },
      ],
    };
    expect(fromBarrel.mergeSessionLedgerResult(session)).toEqual(mergeLedgerDirect(session));
  });

  it("parseWhatsAppMessages: same as direct import (non-null)", () => {
    const raw = `[27/04, 5:00 pm] C: 10x5
`;
    const a = fromBarrel.parseWhatsAppMessages(raw);
    const b = parseWaDirect(raw);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a![0]!.result.total).toBe(b![0]!.result.total);
    expect(a![0]!.result.results).toEqual(b![0]!.result.results);
  });

  it("settings & payments: defaults and stub", () => {
    expect(fromBarrel.DEFAULT_SETTINGS).toEqual(defaultSettingsDirect);
    const a = fromBarrel.upsertPaymentStubs([], ["x"], slot, "1/1/2026", 3);
    const b = upsertPaymentStubs([], ["x"], slot, "1/1/2026", 3);
    expect(b).toEqual(a);
  });

  it("slots + market helpers", () => {
    const slots: GameSlot[] = [slot, { id: "x", name: "Other", time: "12:00", emoji: "y", enabled: true }];
    const hints = fromBarrel.pickSlotByMarketHints(slots, ["delhi", "bazaar", "db"]);
    expect(hints).toEqual(pickDirect(slots, ["delhi", "bazaar", "db"]));
    expect(fromBarrel.slotMinutes("10:00")).toBe(slotMinutesDirect("10:00"));
  });
});

describe("equals-format jodi columns", () => {
  it("13=40 / 31= / … / 86=40==320 — shared rate per block", () => {
    const r = totalDirect(`13=40
31=
63=
36=
81=
18=
68=
86=40==320= गली`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(320);
    expect(r.results[0]?.count).toBe(8);
  });

  it("01=30 … 09=30==270", () => {
    const r = totalDirect(`01=30
02=
03=
04=
05=
06=
07=
08=
09=30==270`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(270);
  });

  it("80=30==1240=9-9-26 — single row, ignore user total and date tail", () => {
    const r = totalDirect("80=30==1240=9-9-26 गाजियाबाद और गली और दिसावर");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(30);
    expect(r.results[0]).toMatchObject({ line: "80", rate: 30, count: 1, lineTotal: 30 });
  });
});

describe("glued paren stakes", () => {
  it("75(20)95(15)05(10)555(20)=65 — chained + =total note", () => {
    const r = totalDirect("75(20)95(15)05(10)555(20)=65");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(65);
    expect(r.results).toHaveLength(4);
  });
});

describe("with palt / palat flags", () => {
  it("34 89 39(75) with palt counts as WP (palat)", () => {
    const r = totalDirect("34 89 39(75) with palt");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(450);
    expect(r.results[0]).toMatchObject({ count: 6, rate: 75, isWP: true });
  });
});

describe("paren rate typos (WhatsApp)", () => {
  it("NN)rate without opening paren (03)20)", () => {
    const r = totalDirect(`55(20)
59(30)
03)20`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(70);
  });

  it("leading plus repeats digit (++7(50)B → 77(50)B)", () => {
    const r = totalDirect(`++7(50)B
+++7(50)A`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(150);
  });

  it("+++(6)50)B — digit in parens + stray close paren", () => {
    const r = totalDirect(`+++(6)50)B
+++(6)50)A`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(100);
  });

  it("glued jodi+rate with trailing ) only (5910) → 59(10))", () => {
    const r = totalDirect(`23(20)
5910)
57(10)`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(40);
  });
});

describe("multi-row entu blocks", () => {
  it("pending dot row + entu10total40 on next line (85.58 block)", () => {
    const r = totalDirect(`85.58
38.83entu10total40`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(40);
  });

  it("dot rows + emtu on last line + Total170 note", () => {
    const r = totalDirect(`32.54.81entu20
23.45.18.49.51.28. 82entu10
15.94.38.83.58.85
46.64emtu5
Total170`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(170);
  });
});

describe("user totals and into typos (WhatsApp)", () => {
  it("ignores glued running totals (total320 / tot60)", () => {
    const r = totalDirect(`15.16.17.18.28.87
51.61.71.81.82.78
32.23.34.43
Entu20total320`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(320);
  });

  it("KALU RAM: multiline dot block + Entu20 on last line (rate split from jodis)", () => {
    const r = totalDirect(`15.16.17.18.28.87
51.61.71.81.82.78
32.23.34.43
Entu20`);
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(320);
  });

  it("ent / onto / int + glued 8215 dot typo", () => {
    expect(totalDirect("65.67.77.21.32ent20").total).toBe(100);
    expect(totalDirect("-25-52onto10").total).toBe(20);
    expect(totalDirect("65-56-59-95 int5").total).toBe(20);
    expect(totalDirect("51.81.8215.18.28entu10tot60").total).toBe(60);
  });

  it("merges broken paren rate across two lines", () => {
    const r = totalDirect("11(90\n10)10");
    expect(r.failedLines ?? []).toEqual([]);
    expect(r.total).toBe(100);
  });
});
