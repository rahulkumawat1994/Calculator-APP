import type { GameSlot } from "../types";
import { slotMinutes } from "./slotsTime";

// ─── Indian market line prefixes → game slot (Payments / History tagging) ─────

/** Regex + hints to match a configured {@link GameSlot} by `id` / `name` (Hindi or English). */
const MARKET_SLOT_RULES: { re: RegExp; hints: string[] }[] = [
  // Delhi / DB
  { re: /^दिल्ली\s*बजार\b\.?/iu, hints: ["दिल्ली बजार", "दिल्ली", "delhi", "bazaar", "db"] },
  {
    re: /^DB\s*\/\s*दिल्ली(?:\s+बजार)?\.?/iu,
    hints: ["दिल्ली", "delhi", "bazaar", "db"],
  },
  { re: /^DB\b\.?/i, hints: ["दिल्ली", "delhi", "bazaar", "db"] },
  // Shri Ganesh / SG
  { re: /^श्री\s*गणेश\b\.?/iu, hints: ["श्री गणेश", "श्री", "गणेश", "ganesh", "shri", "sg"] },
  { re: /^SG\s*\/\s*श्री(?:\s*गणेश)?\b\.?/iu, hints: ["श्री", "गणेश", "ganesh", "shri", "sg"] },
  { re: /^SG\b\.?/i, hints: ["श्री", "गणेश", "ganesh", "shri", "sg"] },
  // Faridabad / FB / FD
  { re: /^फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FB\s*\/\s*फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FD\s*\/\s*फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FB\b\.?/i, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FD\b\.?/i, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  // Gali / GL
  { re: /^गली\b\.?/iu, hints: ["गली", "gali", "gl"] },
  { re: /^Gali\b\.?/i, hints: ["गली", "gali", "gl"] },
  { re: /^GL\s*\/\s*गली\b\.?/iu, hints: ["गली", "gali", "gl"] },
  { re: /^GL\b\.?/i, hints: ["गली", "gali", "gl"] },
  // Ghaziabad / GB
  { re: /^गाजियाबाद\b\.?/iu, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  { re: /^GB\s*\/\s*गाजियाबाद\b\.?/iu, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  { re: /^GB\b\.?/i, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  // Disawar / DS
  { re: /^दिसावर\b\.?/iu, hints: ["दिसावर", "disawar", "disawer", "ds"] },
  { re: /^Disawar\b\.?/i, hints: ["disawar", "disawer", "दिसावर", "ds"] },
  { re: /^Disawer\b\.?/i, hints: ["disawer", "disawar", "दिसावर", "ds"] },
  { re: /^DS\s*\/\s*दिसावर\b\.?/iu, hints: ["दिसावर", "disawar", "disawer", "ds"] },
  { re: /^DS\b\.?/i, hints: ["दिसावर", "disawar", "disawer", "ds"] },
];

function hintMatchesSlot(slot: GameSlot, rawHint: string): boolean {
  const hint = rawHint.normalize("NFKC").trim().toLowerCase();
  if (!hint) return false;
  const id = slot.id.normalize("NFKC").trim().toLowerCase();
  const name = slot.name.normalize("NFKC").trim().toLowerCase();
  if (hint.length <= 2) {
    return id === hint || id.endsWith(`_${hint}`) || name === hint;
  }
  return name.includes(hint) || id.includes(hint);
}

/** First enabled slot (by time order) that matches any hint. */
export function pickSlotByMarketHints(
  slots: GameSlot[],
  hints: string[],
): GameSlot | null {
  const enabled = slots.filter((s) => s.enabled);
  const sorted = [...enabled].sort(
    (a, b) => slotMinutes(a.time) - slotMinutes(b.time),
  );
  for (const slot of sorted) {
    if (hints.some((h) => hintMatchesSlot(slot, h))) return slot;
  }
  return null;
}

/**
 * Disawar / DS (late draw, often ~3am): History uses the **same** local calendar day
 * as when you save. All other markets default to the **previous** day (day games).
 */
const SAME_DAY_LEDGER_HINTS = [
  "दिसावर",
  "disawar",
  "disawer",
  "deasawer",
  "ds",
] as const;

export function slotUsesSameCalendarDayLedger(slot: GameSlot): boolean {
  return SAME_DAY_LEDGER_HINTS.some((h) => hintMatchesSlot(slot, h));
}

function formatLocalLedgerDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * `DD/MM/YYYY` for History / Games when saving **manual** (non‑WhatsApp) Calculator
 * rows on `operationDay` (local date bucket). Day markets → previous calendar day;
 * Disawar (name/id hints) → same day. WhatsApp saves use the date from the chat header.
 */
export function ledgerDateStringForSlot(
  slot: GameSlot,
  operationDay: Date = new Date(),
): string {
  const cal = new Date(
    operationDay.getFullYear(),
    operationDay.getMonth(),
    operationDay.getDate(),
  );
  if (slotUsesSameCalendarDayLedger(slot)) {
    return formatLocalLedgerDate(cal);
  }
  cal.setDate(cal.getDate() - 1);
  return formatLocalLedgerDate(cal);
}

/**
 * If the line starts with a known market tag (DB / GL / …), returns that slot.
 * Uses configured slot names/ids — set games in Settings to match local spellings.
 */
/** Strip leading market tag from a line when it maps to a slot; otherwise unchanged. */
export function stripLeadingMarketPrefix(
  line: string,
  slots: GameSlot[],
): { slot: GameSlot | null; rest: string } {
  const t = line.replace(/^\uFEFF/, "").trim();
  if (!t) return { slot: null, rest: line };
  for (const rule of MARKET_SLOT_RULES) {
    const m = rule.re.exec(t);
    if (!m) continue;
    const slot = pickSlotByMarketHints(slots, rule.hints);
    if (!slot) continue;
    const rest = t.slice(m[0].length).trim();
    return { slot, rest };
  }
  return { slot: null, rest: line };
}

export function detectSlotFromMarketLine(
  line: string,
  slots: GameSlot[],
): GameSlot | null {
  return stripLeadingMarketPrefix(line, slots).slot;
}

export interface MarketTextChunk {
  slotId: string;
  text: string;
  /** True if a market prefix line set or switched the slot for this chunk. */
  touchedByMarketLabel: boolean;
}

/**
 * Split plain (non‑WhatsApp) paste into chunks by leading market labels so each chunk
 * can be saved under the right game. Lines without a label stay under the previous slot
 * (or `fallbackSlot` until the first label).
 */
export function splitPlainTextByMarketSlots(
  text: string,
  slots: GameSlot[],
  fallbackSlot: GameSlot,
): MarketTextChunk[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [{ slotId: fallbackSlot.id, text: "", touchedByMarketLabel: false }];
  }

  const chunks: MarketTextChunk[] = [];
  let curSlotId = fallbackSlot.id;
  let curLines: string[] = [];
  let curTouched = false;

  const flush = () => {
    if (curLines.length === 0) return;
    chunks.push({
      slotId: curSlotId,
      text: curLines.join("\n"),
      touchedByMarketLabel: curTouched,
    });
    curLines = [];
    curTouched = false;
  };

  for (const line of lines) {
    const { slot, rest } = stripLeadingMarketPrefix(line, slots);
    if (slot) {
      flush();
      curSlotId = slot.id;
      curTouched = true;
      if (rest) curLines.push(rest);
    } else {
      curLines.push(line);
    }
  }
  flush();

  if (chunks.length === 0) {
    return [{ slotId: fallbackSlot.id, text: text.trim(), touchedByMarketLabel: false }];
  }
  return chunks;
}
