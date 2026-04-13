/**
 * All Firestore read/write helpers.
 *
 * Data layout (single-document per collection for simplicity):
 *   data/sessions  → { sessions: SavedSession[] }
 *   data/payments  → { payments: PaymentRecord[] }
 *   data/slots     → { slots: GameSlot[] }
 *   data/settings  → { commissionPct: number }
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";
import { DEFAULT_GAME_SLOTS, DEFAULT_SETTINGS } from "./calcUtils";

const ref = (id: string) => doc(db, "data", id);

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function loadSessionsDB(): Promise<SavedSession[]> {
  try {
    const snap = await getDoc(ref("sessions"));
    return (snap.exists() ? snap.data().sessions : []) as SavedSession[];
  } catch {
    return [];
  }
}

export async function saveSessionsDB(sessions: SavedSession[]): Promise<void> {
  await setDoc(ref("sessions"), { sessions });
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function loadPaymentsDB(): Promise<PaymentRecord[]> {
  try {
    const snap = await getDoc(ref("payments"));
    return (snap.exists() ? snap.data().payments : []) as PaymentRecord[];
  } catch {
    return [];
  }
}

export async function savePaymentsDB(payments: PaymentRecord[]): Promise<void> {
  await setDoc(ref("payments"), { payments });
}

// ─── Game Slots ───────────────────────────────────────────────────────────────

export async function loadSlotsDB(): Promise<GameSlot[]> {
  try {
    const snap = await getDoc(ref("slots"));
    return (snap.exists() ? snap.data().slots : DEFAULT_GAME_SLOTS) as GameSlot[];
  } catch {
    return DEFAULT_GAME_SLOTS;
  }
}

export async function saveSlotsDB(slots: GameSlot[]): Promise<void> {
  await setDoc(ref("slots"), { slots });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettingsDB(): Promise<AppSettings> {
  try {
    const snap = await getDoc(ref("settings"));
    return (snap.exists() ? snap.data() : DEFAULT_SETTINGS) as AppSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettingsDB(settings: AppSettings): Promise<void> {
  await setDoc(ref("settings"), settings);
}
