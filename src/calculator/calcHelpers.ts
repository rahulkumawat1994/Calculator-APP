import {
  looksLikeWhatsApp,
  parseWhatsAppHeaders,
  splitPlainTextByMarketSlots,
  slotMinutes,
  type WaHeaderMessage,
} from "@/lib";
import type { CalculationResult, GameSlot, ParsedMessage } from "@/types";

export const RESULT_VIEW_MODE_KEY = "calc-result-view-mode";
export type ResultViewMode = "summary" | "check";

export const lineCountFormatter = new Intl.NumberFormat("en-IN");

export type CalcBlock = {
  id: string;
  label: string;
  text: string;
  labelLocked?: boolean;
};

export type TaggedMessages = ParsedMessage & { slotId: string };

export type PerUserCalc = {
  blockId: string;
  label: string;
  text: string;
  result: CalculationResult;
  pendingTagged: TaggedMessages[] | null;
  isWAMode: boolean;
  waSlotFallbackCount?: number;
};

export function newBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
}

export function getStoredResultViewMode(): ResultViewMode {
  try {
    const v = localStorage.getItem(RESULT_VIEW_MODE_KEY);
    if (v === "check" || v === "notebook") return "check";
    return "summary";
  } catch {
    return "summary";
  }
}

export function normPasteText(s: string): string {
  return s.trim().replace(/\r\n/g, "\n");
}

export function uniqueContactLabel(
  messages: Array<{ contact: string }>,
  fallbackIndex1: number,
): string {
  const uniq = [
    ...new Set(
      messages
        .map((m) => m.contact.replace(/\s+/g, " ").trim())
        .filter((c) => c.length > 0),
    ),
  ];
  if (uniq.length === 0) return `User ${fallbackIndex1}`;
  if (uniq.length === 1) return uniq[0];
  if (uniq.length <= 3) return uniq.join(", ");
  return `${uniq.slice(0, 2).join(", ")} +${uniq.length - 2} more`;
}

export function summarizeWaSlots(
  tagged: Array<{ slotId: string }>,
  allSlots: GameSlot[],
): string {
  const nameById = new Map(allSlots.map((s) => [s.id, s.name]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of tagged) {
    const label = nameById.get(m.slotId) ?? m.slotId;
    if (!seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order.join(", ");
}

export function collectAllWaHeaders(blocks: CalcBlock[]): WaHeaderMessage[] {
  const out: WaHeaderMessage[] = [];
  for (const b of blocks) {
    const m = parseWhatsAppHeaders(b.text);
    if (m?.length) out.push(...m);
  }
  return out;
}

export function collectPlainMarketSlotIds(
  blocks: CalcBlock[],
  slots: GameSlot[],
  fallback: GameSlot,
): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    const t = normPasteText(b.text);
    if (!t) continue;
    if (looksLikeWhatsApp(b.text)) continue;
    const parts = splitPlainTextByMarketSlots(t, slots, fallback);
    const labeled = parts.filter(
      (p) => p.text.trim().length > 0 && p.touchedByMarketLabel,
    );
    if (labeled.length === 0) continue;
    for (const p of parts) {
      if (p.text.trim().length > 0) ids.push(p.slotId);
    }
  }
  return ids;
}

export function detectSlotFromTimestamp(
  timeStr: string,
  slots: GameSlot[],
): GameSlot | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3]?.toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  const msgMinutes = h * 60 + m;
  const enabled = slots.filter((s) => s.enabled);
  const sorted = [...enabled].sort(
    (a, b) => slotMinutes(a.time) - slotMinutes(b.time),
  );
  return (
    sorted.find((s) => slotMinutes(s.time) > msgMinutes) ?? sorted[0] ?? null
  );
}
