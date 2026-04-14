/**
 * Firestore data layer.
 *
 * Structure:
 *   config/slots          → { slots: GameSlot[] }
 *   config/settings       → { commissionPct: number }
 *   sessions/{sessionId}  → SavedSession  (one doc per session)
 *   payments/{paymentId}  → PaymentRecord (one doc per payment)
 *
 * Sessions and payments each carry:
 *   date:    "DD/MM/YYYY"  — used for display and exact-match queries
 *   dateISO: "YYYY-MM-DD"  — used for range queries (monthly view)
 */

import {
  collection, doc,
  getDoc, setDoc, deleteDoc, getDocs,
  query, where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";
import { DEFAULT_GAME_SLOTS, DEFAULT_SETTINGS } from "./calcUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "DD/MM/YYYY" → "YYYY-MM-DD" */
export function toDateISO(date: string): string {
  const [d, m, y] = date.split("/");
  return `${y}-${(m ?? "01").padStart(2, "0")}-${(d ?? "01").padStart(2, "0")}`;
}

/**
 * Firestore document IDs cannot contain "/".
 * Replace slashes with "__SL__" so dates like "12/04/2026" in IDs are safe.
 * The actual data fields still store the original value.
 */
const toDocId = (id: string) => id.replace(/\//g, "__SL__");

const configRef = (id: string) => doc(db, "config", id);

// ─── Slots ────────────────────────────────────────────────────────────────────

export async function loadSlotsDB(): Promise<GameSlot[]> {
  try {
    // Try new location first, then legacy location
    for (const ref of [configRef("slots"), doc(db, "data", "slots")]) {
      const snap = await getDoc(ref);
      if (snap.exists()) return snap.data().slots as GameSlot[];
    }
    return DEFAULT_GAME_SLOTS;
  } catch { return DEFAULT_GAME_SLOTS; }
}

export async function saveSlotsDB(slots: GameSlot[]): Promise<void> {
  await setDoc(configRef("slots"), { slots });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettingsDB(): Promise<AppSettings> {
  try {
    for (const ref of [configRef("settings"), doc(db, "data", "settings")]) {
      const snap = await getDoc(ref);
      if (snap.exists()) return snap.data() as AppSettings;
    }
    return DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

export async function saveSettingsDB(settings: AppSettings): Promise<void> {
  await setDoc(configRef("settings"), settings);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function saveSessionDoc(session: SavedSession): Promise<void> {
  const dateISO = toDateISO(session.date);
  const docId   = toDocId(session.id);
  console.log("[DB] saveSessionDoc →", docId, "date:", session.date);
  await setDoc(doc(db, "sessions", docId), { ...session, dateISO });
}

export async function deleteSessionDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, "sessions", toDocId(id)));
}

export async function loadSessionsByDate(date: string): Promise<SavedSession[]> {
  try {
    const snap = await getDocs(query(collection(db, "sessions"), where("date", "==", date)));
    return snap.docs.map(d => d.data() as SavedSession);
  } catch (e) { console.error("loadSessionsByDate failed:", e); return []; }
}

export async function loadSessionsByMonth(year: number, month: number): Promise<SavedSession[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await getDocs(query(
      collection(db, "sessions"),
      where("dateISO", ">=", `${year}-${pad(month)}-01`),
      where("dateISO", "<=", `${year}-${pad(month)}-31`),
    ));
    return snap.docs.map(d => d.data() as SavedSession);
  } catch { return []; }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function savePaymentDoc(payment: PaymentRecord): Promise<void> {
  const dateISO = toDateISO(payment.date);
  const docId   = toDocId(payment.id);
  console.log("[DB] savePaymentDoc →", docId, "date:", payment.date);
  await setDoc(doc(db, "payments", docId), { ...payment, dateISO });
}

export async function deletePaymentDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, "payments", toDocId(id)));
}

/** Delete all payments for a contact on a specific date. */
export async function deletePaymentsByContactDate(contact: string, date: string): Promise<void> {
  try {
    // Query by date only (avoids composite index requirement), then filter by contact in memory
    const snap = await getDocs(query(collection(db, "payments"), where("date", "==", date)));
    const toDelete = snap.docs.filter(d => d.data().contact === contact);
    await Promise.all(toDelete.map(d => deleteDoc(d.ref)));
  } catch { /* non-fatal */ }
}

export async function loadPaymentsByDate(date: string): Promise<PaymentRecord[]> {
  try {
    const snap = await getDocs(query(collection(db, "payments"), where("date", "==", date)));
    return snap.docs.map(d => d.data() as PaymentRecord);
  } catch (e) { console.error("loadPaymentsByDate failed:", e); return []; }
}

/** Returns all distinct dates (DD/MM/YYYY) that have sessions in the given month. */
export async function loadSessionDatesForMonth(year: number, month: number): Promise<string[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await getDocs(query(
      collection(db, "sessions"),
      where("dateISO", ">=", `${year}-${pad(month)}-01`),
      where("dateISO", "<=", `${year}-${pad(month)}-31`),
    ));
    return [...new Set(snap.docs.map(d => d.data().date as string))];
  } catch { return []; }
}

export async function loadPaymentsByMonth(year: number, month: number): Promise<PaymentRecord[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await getDocs(query(
      collection(db, "payments"),
      where("dateISO", ">=", `${year}-${pad(month)}-01`),
      where("dateISO", "<=", `${year}-${pad(month)}-31`),
    ));
    return snap.docs.map(d => d.data() as PaymentRecord);
  } catch { return []; }
}

// ─── One-time migration from old bulk-doc structure ───────────────────────────

export async function migrateOldFirestoreData(): Promise<void> {
  try {
    const [oldSessions, oldPayments] = await Promise.all([
      getDoc(doc(db, "data", "sessions")),
      getDoc(doc(db, "data", "payments")),
    ]);
    const jobs: Promise<void>[] = [];
    if (oldSessions.exists()) {
      const sessions = (oldSessions.data().sessions ?? []) as SavedSession[];
      jobs.push(...sessions.map(s => saveSessionDoc({ ...s, dateISO: toDateISO(s.date) })));
    }
    if (oldPayments.exists()) {
      const payments = (oldPayments.data().payments ?? []) as PaymentRecord[];
      jobs.push(...payments.map(p => savePaymentDoc({ ...p, dateISO: toDateISO(p.date) })));
    }
    await Promise.all(jobs);
  } catch (e) {
    console.warn("Firestore migration error:", e);
  }
}
