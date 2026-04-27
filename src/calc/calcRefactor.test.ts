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
