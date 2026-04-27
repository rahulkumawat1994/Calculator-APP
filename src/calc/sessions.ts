import type {
  CalculationResult,
  ParsedMessage,
  SavedMessage,
  SavedSession,
  Segment,
} from "../types";

// ─── Session management ────────────────────────────────────────────────────────

/** "DD/MM/YYYY" → "YYYY-MM-DD" */
export function toDateISO(date: string): string {
  const [d, m, y] = date.split("/");
  return `${y}-${(m ?? "01").padStart(2, "0")}-${(d ?? "01").padStart(2, "0")}`;
}

export function mergeIntoSessions(
  existing: SavedSession[],
  messages: ParsedMessage[]
): SavedSession[] {
  const updated = existing.map(s => ({ ...s, messages: [...s.messages] }));

  for (const msg of messages) {
    const msgId = msg.id ?? `${msg.contact}|${msg.date}|${msg.timestamp}`;
    const savedMsg: SavedMessage = {
      id: msgId,
      timestamp: msg.timestamp,
      text: msg.text,
      result: msg.result,
      ...(msg.slotId ? { slotId: msg.slotId } : {}),
    };
    const session = updated.find(s => s.contact === msg.contact && s.date === msg.date);
    if (session) {
      if (!session.messages.find(m => m.id === msgId)) session.messages.push(savedMsg);
    } else {
      updated.push({
        id: `${msg.contact}|${msg.date}`,
        contact: msg.contact,
        date: msg.date,
        dateISO: toDateISO(msg.date),
        messages: [savedMsg],
        createdAt: Date.now(),
      });
    }
  }
  return updated;
}

/** Firestore / History "Other entries" bucket — same key as History `openSlotIds` for unslotted. */
export const SESSION_SLOT_KEY_UNSLOTTED = "__unslotted__" as const;

function slotKeyForSavedMessage(m: SavedMessage): string {
  return m.slotId ?? SESSION_SLOT_KEY_UNSLOTTED;
}

export function mergeSavedMessages(msgs: SavedMessage[]): CalculationResult {
  return {
    results: msgs.flatMap(m => (m.overrideResult ?? m.result).results),
    total:   msgs.reduce((s, m) => s + (m.overrideResult ?? m.result).total, 0),
  };
}

function sessionSingleSlotKey(session: SavedSession): string | null {
  const keys = new Set(session.messages.map(slotKeyForSavedMessage));
  if (keys.size !== 1) return null;
  return session.messages.length ? slotKeyForSavedMessage(session.messages[0]) : null;
}

/** One slot (or unslotted bucket) totals for a saved session — used by History & GamesView. */
export function sessionLedgerForSlotKey(
  session: SavedSession,
  slotKey: string,
): CalculationResult | null {
  const msgs =
    slotKey === SESSION_SLOT_KEY_UNSLOTTED
      ? session.messages.filter(m => !m.slotId)
      : session.messages.filter(m => m.slotId === slotKey);
  if (!msgs.length) return null;
  const merged = mergeSavedMessages(msgs);
  const only = sessionSingleSlotKey(session);
  return (
    session.slotOverrides?.[slotKey]
    ?? (session.overrideResult && only === slotKey ? session.overrideResult : undefined)
    ?? merged
  );
}

/** Whole-session day totals (all slots + overrides) for History day row & GamesView aggregates. */
export function mergeSessionLedgerResult(session: SavedSession): CalculationResult {
  const so = session.slotOverrides;
  if (so && Object.keys(so).length > 0) {
    const orderedKeys: string[] = [];
    const seen = new Set<string>();
    for (const m of session.messages) {
      const k = slotKeyForSavedMessage(m);
      if (!seen.has(k)) {
        seen.add(k);
        orderedKeys.push(k);
      }
    }
    for (const k of Object.keys(so)) {
      if (!seen.has(k)) {
        seen.add(k);
        orderedKeys.push(k);
      }
    }
    const results: Segment[] = [];
    let total = 0;
    for (const k of orderedKeys) {
      const slotOv = so[k];
      if (slotOv) {
        results.push(...slotOv.results);
        total += slotOv.total;
        continue;
      }
      const msgs = session.messages.filter(m => slotKeyForSavedMessage(m) === k);
      const merged = mergeSavedMessages(msgs);
      results.push(...merged.results);
      total += merged.total;
    }
    return { results, total };
  }
  if (session.overrideResult) return session.overrideResult;
  return mergeSavedMessages(session.messages);
}

const STORAGE_KEY = 'calc_sessions_v1';

export function loadSessions(): SavedSession[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedSession[]; }
  catch { return []; }
}

export function saveSessions(sessions: SavedSession[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { /* quota exceeded – ignore */ }
}
