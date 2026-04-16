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
  getDoc, setDoc, deleteDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, limit, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { toastApiError } from "./apiToast";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";
import { DEFAULT_GAME_SLOTS, DEFAULT_SETTINGS, toDateISO } from "./calcUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  } catch (e) {
    toastApiError(e, "Could not load game slots from the database.", { toastId: "load-config-db" });
    return DEFAULT_GAME_SLOTS;
  }
}

export async function saveSlotsDB(slots: GameSlot[]): Promise<void> {
  try {
    await setDoc(configRef("slots"), { slots });
  } catch (e) { console.error("saveSlotsDB failed:", e); throw e; }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettingsDB(): Promise<AppSettings> {
  try {
    for (const ref of [configRef("settings"), doc(db, "data", "settings")]) {
      const snap = await getDoc(ref);
      if (snap.exists()) return snap.data() as AppSettings;
    }
    return DEFAULT_SETTINGS;
  } catch (e) {
    toastApiError(e, "Could not load settings from the database.", { toastId: "load-config-db" });
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettingsDB(settings: AppSettings): Promise<void> {
  try {
    await setDoc(configRef("settings"), settings);
  } catch (e) { console.error("saveSettingsDB failed:", e); throw e; }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function saveSessionDoc(session: SavedSession): Promise<void> {
  const dateISO = toDateISO(session.date);
  const docId   = toDocId(session.id);
  try {
    await setDoc(doc(db, "sessions", docId), { ...session, dateISO });
  } catch (e) { console.error("saveSessionDoc failed:", docId, e); throw e; }
}

export async function deleteSessionDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, "sessions", toDocId(id)));
}

export async function loadSessionsByDate(date: string): Promise<SavedSession[]> {
  try {
    const snap = await getDocs(query(collection(db, "sessions"), where("date", "==", date)));
    return snap.docs.map(d => d.data() as SavedSession);
  } catch (e) {
    console.error("loadSessionsByDate failed:", e);
    toastApiError(e, "Could not load sessions for this day.", { toastId: "load-day-ledger" });
    return [];
  }
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
  } catch (e) {
    toastApiError(e, "Could not load sessions for this month.", { toastId: "load-month-ledger" });
    return [];
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function savePaymentDoc(payment: PaymentRecord): Promise<void> {
  const dateISO = toDateISO(payment.date);
  const docId   = toDocId(payment.id);
  try {
    await setDoc(doc(db, "payments", docId), { ...payment, dateISO });
  } catch (e) { console.error("savePaymentDoc failed:", docId, e); throw e; }
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
  } catch {
    /* Caller surfaces errors (e.g. History delete) */
  }
}

export async function loadPaymentsByDate(date: string): Promise<PaymentRecord[]> {
  try {
    const snap = await getDocs(query(collection(db, "payments"), where("date", "==", date)));
    return snap.docs.map(d => d.data() as PaymentRecord);
  } catch (e) {
    console.error("loadPaymentsByDate failed:", e);
    toastApiError(e, "Could not load payments for this day.", { toastId: "load-day-ledger" });
    return [];
  }
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
  } catch (e) {
    toastApiError(e, "Could not load calendar dates.", { toastId: "load-calendar-dates" });
    return [];
  }
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
  } catch (e) {
    toastApiError(e, "Could not load payments for this month.", { toastId: "load-month-ledger" });
    return [];
  }
}

// ─── Private calculation audit logs ───────────────────────────────────────────

export interface CalculationAuditPayload {
  input: string;
  mode: "manual" | "wa";
  total: number;
  resultCount: number;
  failedCount: number;
  selectedSlotId?: string;
  selectedSlotName?: string;
  /** WhatsApp: unique game names actually assigned per message time (not only the UI fallback). */
  waSlotsSummary?: string;
  waMessageCount?: number;
}

export interface CalculationAuditLog extends CalculationAuditPayload {
  id: string;
  createdAt: number;
}

export interface ReportIssuePayload {
  input: string;
  expected?: string;
  note?: string;
}

export interface ReportIssueLog extends ReportIssuePayload {
  id: string;
  createdAt: number;
  /** When true, the issue is treated as resolved (admin-only field). */
  fixed?: boolean;
}

/**
 * Internal analytics log for calculate clicks.
 * Uses a dedicated collection so it never touches app business data.
 */
export async function logCalculationAudit(payload: CalculationAuditPayload): Promise<void> {
  try {
    await addDoc(collection(db, "calc_audit_logs"), {
      ...payload,
      // Guard against very large paste payloads.
      input: payload.input.slice(0, 12000),
      createdAt: Date.now(),
    });
  } catch (e) {
    console.warn("logCalculationAudit failed:", e);
    toastApiError(e, "Could not save calculation audit log.", { toastId: "calc-audit-log" });
  }
}

export async function loadCalculationAuditLogs(maxRows = 300): Promise<CalculationAuditLog[]> {
  try {
    const snap = await getDocs(query(
      collection(db, "calc_audit_logs"),
      orderBy("createdAt", "desc"),
      limit(maxRows),
    ));
    return snap.docs.map(d => {
      const data = d.data() as Omit<CalculationAuditLog, "id">;
      return { id: d.id, ...data };
    });
  } catch (e) {
    console.warn("loadCalculationAuditLogs failed:", e);
    toastApiError(e, "Could not load audit logs.");
    return [];
  }
}

/** Normalize pasted input so visually identical pastes share one dedupe key. */
function calculationAuditInputDedupeKey(input: string | undefined): string {
  return (input ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * Deletes duplicate rows in `calc_audit_logs` (best effort, scanned newest first).
 * Rows with the **same input text** (after trim + CRLF→LF) are duplicates: **keep the newest**
 * `createdAt` and delete the rest. Empty inputs are skipped (never deduped together).
 */
export async function pruneDuplicateCalculationAuditLogs(maxScan = 2000): Promise<number> {
  try {
    const snap = await getDocs(query(
      collection(db, "calc_audit_logs"),
      orderBy("createdAt", "desc"),
      limit(maxScan),
    ));
    const rows: CalculationAuditLog[] = snap.docs.map(d => {
      const data = d.data() as Omit<CalculationAuditLog, "id">;
      return { id: d.id, ...data };
    });

    const toDelete = new Set<string>();

    const byInput = new Map<string, CalculationAuditLog[]>();
    for (const r of rows) {
      const key = calculationAuditInputDedupeKey(r.input);
      if (!key) continue;
      if (!byInput.has(key)) byInput.set(key, []);
      byInput.get(key)!.push(r);
    }
    for (const group of byInput.values()) {
      if (group.length < 2) continue;
      const keep = group.reduce((a, b) =>
        (a.createdAt ?? 0) >= (b.createdAt ?? 0) ? a : b,
      );
      for (const g of group) {
        if (g.id !== keep.id) toDelete.add(g.id);
      }
    }

    if (toDelete.size === 0) return 0;

    const ids = [...toDelete];
    const chunk = 450;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const batch = writeBatch(db);
      for (const id of slice) {
        batch.delete(doc(db, "calc_audit_logs", id));
      }
      await batch.commit();
      deleted += slice.length;
    }
    return deleted;
  } catch (e) {
    console.warn("pruneDuplicateCalculationAuditLogs failed:", e);
    toastApiError(e, "Could not delete duplicate audit inputs.");
    return 0;
  }
}

export async function deleteCalculationAuditLog(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "calc_audit_logs", id));
  } catch (e) {
    console.warn("deleteCalculationAuditLog failed:", e);
    throw e;
  }
}

/**
 * Clears audit logs in the dedicated collection.
 * Returns deleted count (best effort).
 */
export async function clearCalculationAuditLogs(maxRows = 2000): Promise<number> {
  try {
    const snap = await getDocs(query(
      collection(db, "calc_audit_logs"),
      orderBy("createdAt", "desc"),
      limit(maxRows),
    ));
    if (snap.empty) return 0;
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    return snap.docs.length;
  } catch (e) {
    console.warn("clearCalculationAuditLogs failed:", e);
    throw e;
  }
}

/** @returns new Firestore document id */
export async function logReportIssue(payload: ReportIssuePayload): Promise<string> {
  try {
    const ref = await addDoc(collection(db, "report_issue_logs"), {
      input: payload.input.slice(0, 12000),
      expected: (payload.expected ?? "").slice(0, 3000),
      note: (payload.note ?? "").slice(0, 3000),
      createdAt: Date.now(),
      fixed: false,
    });
    return ref.id;
  } catch (e) {
    console.warn("logReportIssue failed:", e);
    throw e;
  }
}

export async function loadReportIssueLogs(maxRows = 300): Promise<ReportIssueLog[]> {
  try {
    const snap = await getDocs(query(
      collection(db, "report_issue_logs"),
      orderBy("createdAt", "desc"),
      limit(maxRows),
    ));
    return snap.docs.map(d => {
      const data = d.data() as Omit<ReportIssueLog, "id">;
      return {
        id: d.id,
        ...data,
        fixed: data.fixed === true,
      };
    });
  } catch (e) {
    console.warn("loadReportIssueLogs failed:", e);
    toastApiError(e, "Could not load report issues.");
    return [];
  }
}

export async function updateReportIssueFixed(id: string, fixed: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, "report_issue_logs", id), { fixed });
  } catch (e) {
    console.warn("updateReportIssueFixed failed:", e);
    throw e;
  }
}

export async function deleteReportIssueLog(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "report_issue_logs", id));
  } catch (e) {
    console.warn("deleteReportIssueLog failed:", e);
    throw e;
  }
}

export async function clearReportIssueLogs(maxRows = 2000): Promise<number> {
  try {
    const snap = await getDocs(query(
      collection(db, "report_issue_logs"),
      orderBy("createdAt", "desc"),
      limit(maxRows),
    ));
    if (snap.empty) return 0;
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    return snap.docs.length;
  } catch (e) {
    console.warn("clearReportIssueLogs failed:", e);
    throw e;
  }
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
    toastApiError(e, "Firestore data migration had a problem.", { toastId: "migrate-firestore" });
  }
}
