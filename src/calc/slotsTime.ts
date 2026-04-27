import type { GameSlot } from "../types";

// ─── Game slots ────────────────────────────────────────────────────────────────

/** Example games only — not loaded automatically; users add games in Settings. */
export const DEFAULT_GAME_SLOTS: GameSlot[] = [
  { id: 'usa',     name: 'USA',     emoji: '🇺🇸', time: '10:00', enabled: true },
  { id: 'india',   name: 'India',   emoji: '🇮🇳', time: '14:00', enabled: true },
  { id: 'japan',   name: 'Japan',   emoji: '🇯🇵', time: '18:00', enabled: true },
  { id: 'italy',   name: 'Italy',   emoji: '🇮🇹', time: '22:00', enabled: true },
  { id: 'vietnam', name: 'Vietnam', emoji: '🇻🇳', time: '02:00', enabled: true },
];

/**
 * When no games exist yet, Calculator uses this only for in-memory UI / audit metadata.
 * Never persist this id to sessions or payments.
 */
export const NO_CONFIGURED_SLOTS_PLACEHOLDER_ID = "__no_slots_configured__";

const NO_CONFIGURED_SLOTS_PLACEHOLDER: GameSlot = {
  id:   NO_CONFIGURED_SLOTS_PLACEHOLDER_ID,
  name: "Add games in Settings",
  emoji: "⚙️",
  time: "12:00",
  enabled: true,
};

/** Returns minutes since midnight for a "HH:MM" string. */
export function slotMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Formats "14:00" → "2:00 PM". */
export function formatSlotTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Returns the currently active game slot — the next slot whose result hasn't
 * been announced yet (i.e. whose time hasn't passed).
 */
export function getCurrentSlot(slots: GameSlot[]): GameSlot {
  const enabled = slots.filter(s => s.enabled);
  if (!enabled.length) {
    if (slots.length > 0) return slots[0];
    return NO_CONFIGURED_SLOTS_PLACEHOLDER;
  }
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const sorted = [...enabled].sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
  const next = sorted.find(s => slotMinutes(s.time) > cur);
  return (next ?? sorted[0]);
}

/** localStorage key for game slots (migrate / reconcile with Firestore). */
export const GAME_SLOTS_LS_KEY = "calc_slots_v1";

export function loadGameSlots(): GameSlot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_SLOTS_LS_KEY) ?? "null");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
export function saveGameSlots(slots: GameSlot[]): void {
  try {
    localStorage.setItem(GAME_SLOTS_LS_KEY, JSON.stringify(slots));
  } catch {
    /* quota exceeded – ignore */
  }
}

/** True if the user has any saved games (non-empty list). */
export function slotsDifferFromDefault(slots: GameSlot[]): boolean {
  return slots.length > 0;
}
