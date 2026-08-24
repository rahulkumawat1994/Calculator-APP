/**
 * Firestore data layer.
 *
 * Structure:
 *   config/slots          → { slots: GameSlot[] }
 *   config/settings       → { commissionPct: number }
 *   config/statementProfiles → { profiles, activeProfileId }
 *   sessions/{sessionId}  → SavedSession  (one doc per session)
 *   payments/{paymentId}  → PaymentRecord (one doc per payment)
 *   statementExtracts/{profileId}__{fingerprint}  → extracted statement rows (no PDF)
 *   config/loanBorrowers → family borrowers list
 *   loans/{borrowerId__loanId} → loan metadata + parsed schedule rows (no PDF)
 *
 * Sessions and payments each carry:
 *   date:    "DD/MM/YYYY"  — used for display and exact-match queries
 *   dateISO: "YYYY-MM-DD"  — used for range queries (monthly view)
 */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../config/firebase";
import type { StatementWdDpRow } from "../statement/extractStatementColumnsFromPdf";
import { fingerprintStatementExtract } from "../statement/statementExtractFingerprint";
import {
  decodeStatementRowsFromFirestore,
  encodeStatementRowsForFirestore,
  STATEMENT_ROWS_ENCODING_GZIP_CHUNKED,
} from "../statement/statementExtractStorage";
import { DEFAULT_STATEMENT_PROFILE_ID } from "../statement/statementProfiles";
import type { StatementProfile } from "../statement/statementProfiles";
import type { LoanBorrower } from "../loans/loanBorrowers";
import { DEFAULT_LOAN_BORROWER_ID } from "../loans/loanBorrowers";
import type { LoanColumnId } from "../loans/loanColumns";
import type { LoanScheduleRow } from "../loans/extractLoanScheduleFromPdf";
import {
  encodeLoanScheduleRowsForFirestore,
  LOAN_ROWS_ENCODING_GZIP_CHUNKED,
  LOAN_ROWS_PER_CHUNK,
  MAX_SCHEDULE_ROWS_DECODE,
} from "../loans/loanScheduleStorage";
import { toastApiError } from "../lib/toast/apiToast";
import { withFirestoreRetry } from "../lib/firestoreRetry";
import type {
  SavedSession,
  GameSlot,
  AppSettings,
  PaymentRecord,
  GameResult,
} from "../types";
import { DEFAULT_SETTINGS, toDateISO } from "../lib/calcUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Firestore document IDs cannot contain "/".
 * Replace slashes with "__SL__" so dates like "12/04/2026" in IDs are safe.
 * The actual data fields still store the original value.
 */
const toDocId = (id: string) => id.replace(/\//g, "__SL__");

/** Reverse {@link toDocId} — restores `/` in ids read from Firestore document paths. */
const fromDocId = (docId: string) => docId.replace(/__SL__/g, "/");

/**
 * Firestore rejects `undefined` at any depth. Optional fields must be omitted, not set to undefined.
 */
function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = stripUndefinedDeep(v);
  }
  return out;
}

function hydrateSavedSession(
  docSnap: { id: string; data: () => unknown },
): SavedSession {
  const data = docSnap.data() as SavedSession;
  const id =
    typeof data.id === "string" && data.id.length > 0 ? data.id : fromDocId(docSnap.id);
  return { ...data, id };
}

const configRef = (id: string) => doc(db, "config", id);

// ─── Slots ────────────────────────────────────────────────────────────────────

export async function loadSlotsDB(): Promise<GameSlot[]> {
  try {
    // Try new location first, then legacy location
    for (const ref of [configRef("slots"), doc(db, "data", "slots")]) {
      const snap = await withFirestoreRetry(() => getDoc(ref));
      if (snap.exists()) {
        const raw = snap.data().slots;
        return Array.isArray(raw) ? (raw as GameSlot[]) : [];
      }
    }
    return [];
  } catch (e) {
    toastApiError(e, "Could not load game slots from the database.", {
      toastId: "load-config-db",
    });
    return [];
  }
}

export async function saveSlotsDB(slots: GameSlot[]): Promise<void> {
  try {
    await setDoc(configRef("slots"), { slots });
  } catch (e) {
    console.error("saveSlotsDB failed:", e);
    throw e;
  }
}

/**
 * After renaming a game in settings, payment docs may still hold the old `slotName`.
 * Sessions only store `slotId` on messages, so they already follow the live slot list.
 * Returns how many payment documents were updated.
 */
export async function syncPaymentSlotNamesToMatchSlots(slots: GameSlot[]): Promise<number> {
  const nameById = new Map(slots.map(s => [s.id, s.name]));
  const uniqIds = [...new Set(slots.map(s => s.id))];
  let touched = 0;
  const CHUNK = 400;

  for (const slotId of uniqIds) {
    const desiredName = nameById.get(slotId);
    if (desiredName == null) continue;

    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "payments"), where("slotId", "==", slotId)))
    );
    const toUpdate = snap.docs.filter(
      d => (d.data().slotName as string | undefined) !== desiredName,
    );

    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      const now = Date.now();
      for (const d of slice) {
        batch.update(d.ref, { slotName: desiredName, updatedAt: now });
      }
      if (slice.length > 0) await batch.commit();
      touched += slice.length;
    }
  }

  return touched;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettingsDB(): Promise<AppSettings> {
  try {
    for (const ref of [configRef("settings"), doc(db, "data", "settings")]) {
      const snap = await withFirestoreRetry(() => getDoc(ref));
      if (snap.exists()) return snap.data() as AppSettings;
    }
    return DEFAULT_SETTINGS;
  } catch (e) {
    toastApiError(e, "Could not load settings from the database.", {
      toastId: "load-config-db",
    });
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettingsDB(settings: AppSettings): Promise<void> {
  try {
    await setDoc(configRef("settings"), settings);
  } catch (e) {
    console.error("saveSettingsDB failed:", e);
    throw e;
  }
}

// ─── Statement profiles (cloud sync) ─────────────────────────────────────────

export type StatementProfilesCloudState = {
  profiles: StatementProfile[];
  activeProfileId: string;
};

function parseStatementProfilesFromFirestore(data: DocumentData): StatementProfile[] {
  const raw = data.profiles;
  if (!Array.isArray(raw)) return [];
  const out: StatementProfile[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.name === "string" && o.id.length > 0) {
      out.push({ id: o.id, name: o.name.trim() || o.id });
    }
  }
  if (!out.some((p) => p.id === DEFAULT_STATEMENT_PROFILE_ID)) {
    out.unshift({ id: DEFAULT_STATEMENT_PROFILE_ID, name: "Me" });
  }
  return out;
}

/** Loads profile tabs from Firestore (`config/statementProfiles`). */
export async function loadStatementProfilesDB(): Promise<StatementProfilesCloudState | null> {
  try {
    const snap = await withFirestoreRetry(() => getDoc(configRef("statementProfiles")));
    if (!snap.exists()) return null;
    const profiles = parseStatementProfilesFromFirestore(snap.data());
    if (profiles.length === 0) return null;
    const data = snap.data();
    const activeRaw = data.activeProfileId;
    const activeProfileId =
      typeof activeRaw === "string" && activeRaw.trim().length > 0
        ? activeRaw.trim()
        : DEFAULT_STATEMENT_PROFILE_ID;
    return { profiles, activeProfileId };
  } catch (e) {
    console.error("loadStatementProfilesDB failed:", e);
    return null;
  }
}

export async function saveStatementProfilesDB(state: StatementProfilesCloudState): Promise<void> {
  try {
    await setDoc(configRef("statementProfiles"), {
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      updatedAtMs: Date.now(),
    });
  } catch (e) {
    console.error("saveStatementProfilesDB failed:", e);
    throw e;
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function saveSessionDoc(session: SavedSession): Promise<void> {
  const dateISO = toDateISO(session.date);
  const docId = toDocId(session.id);
  try {
    const payload = stripUndefinedDeep({ ...session, dateISO }) as DocumentData;
    await setDoc(doc(db, "sessions", docId), payload);
  } catch (e) {
    console.error("saveSessionDoc failed:", docId, e);
    throw e;
  }
}

export async function deleteSessionDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, "sessions", toDocId(id)));
}

export async function loadSessionsByDate(
  date: string
): Promise<SavedSession[]> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "sessions"), where("date", "==", date)))
    );
    return snap.docs.map((d) => hydrateSavedSession(d));
  } catch (e) {
    console.error("loadSessionsByDate failed:", e);
    toastApiError(e, "Could not load sessions for this day.", {
      toastId: "load-day-ledger",
    });
    return [];
  }
}

export async function loadSessionsByMonth(
  year: number,
  month: number
): Promise<SavedSession[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "sessions"),
          where("dateISO", ">=", `${year}-${pad(month)}-01`),
          where("dateISO", "<=", `${year}-${pad(month)}-31`)
        )
      )
    );
    return snap.docs.map((d) => hydrateSavedSession(d));
  } catch (e) {
    toastApiError(e, "Could not load sessions for this month.", {
      toastId: "load-month-ledger",
    });
    return [];
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function savePaymentDoc(payment: PaymentRecord): Promise<void> {
  const dateISO = toDateISO(payment.date);
  const docId = toDocId(payment.id);
  try {
    const payload = stripUndefinedDeep({ ...payment, dateISO }) as DocumentData;
    await setDoc(doc(db, "payments", docId), payload);
  } catch (e) {
    console.error("savePaymentDoc failed:", docId, e);
    throw e;
  }
}

export async function deletePaymentDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, "payments", toDocId(id)));
}

/** Delete all payments for a contact on a specific date. */
export async function deletePaymentsByContactDate(
  contact: string,
  date: string
): Promise<void> {
  try {
    // Query by date only (avoids composite index requirement), then filter by contact in memory
    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "payments"), where("date", "==", date)))
    );
    const toDelete = snap.docs.filter((d) => d.data().contact === contact);
    await Promise.all(toDelete.map((d) => deleteDoc(d.ref)));
  } catch {
    /* Caller surfaces errors (e.g. History delete) */
  }
}

// ─── Statement extracts (PDF table rows only; never PDF bytes) ─────────────

export type SaveStatementExtractResult =
  | { status: "uploaded" }
  | { status: "duplicate" }
  | { status: "error"; message: string };

/**
 * Same write pattern as {@link saveSessionDoc}: `getDoc` then `setDoc` on `db` (no transaction).
 * Stores parsed rows + metadata only.
 */
export async function saveStatementExtractIfNew(params: {
  profileId: string;
  fileName: string;
  rows: StatementWdDpRow[];
}): Promise<SaveStatementExtractResult> {
  const { profileId, fileName, rows } = params;
  const trimmedProfileId = profileId.trim();
  if (trimmedProfileId.length === 0) {
    return { status: "error", message: "Missing profile." };
  }
  const trimmedName = fileName.trim();
  if (trimmedName.length === 0) {
    return { status: "error", message: "Missing file name." };
  }
  if (rows.length === 0) {
    return { status: "error", message: "No rows to upload." };
  }

  let fingerprint: string;
  try {
    fingerprint = await fingerprintStatementExtract(trimmedName, rows);
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not fingerprint data.",
    };
  }

  const ref = doc(db, "statementExtracts", `${trimmedProfileId}__${fingerprint}`);
  const encoded = encodeStatementRowsForFirestore(rows);
  const payload: DocumentData = {
    profileId: trimmedProfileId,
    fileName: trimmedName,
    rowCount: encoded.rowCount,
    contentFingerprint: fingerprint,
    rowsEncoding: encoded.encoding,
    uploadedAt: serverTimestamp(),
  };
  if (encoded.compressed) {
    payload.rowsCompressed = encoded.compressed;
  }
  if (encoded.chunks) {
    payload.rowChunkCount = encoded.chunks.length;
  }

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return { status: "duplicate" };
    }
    await setDoc(ref, payload);
    if (encoded.chunks) {
      await writeStatementExtractRowChunks(ref.id, encoded.chunks);
    }
    return { status: "uploaded" };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Upload failed.";
    const hint =
      /exceeds the maximum allowed size/i.test(raw)
        ? " The extract was too large for Firestore; try again after updating the app."
        : /failed to fetch|networkerror|load failed|fetch.*aborted/i.test(raw) &&
            !/CORS policy|Access-Control/i.test(raw)
          ? " Add this origin in Firebase Console → Project settings → Your apps → Authorized domains; serve the app over http(s), not file://."
          : "";
    return {
      status: "error",
      message: raw + hint,
    };
  }
}

async function writeStatementExtractRowChunks(extractId: string, chunks: string[]): Promise<void> {
  const chunkColl = collection(db, "statementExtracts", extractId, "rowChunks");
  const BATCH = 400;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    await withFirestoreRetry(async () => {
      const batch = writeBatch(db);
      for (let j = 0; j < slice.length; j++) {
        batch.set(doc(chunkColl, String(i + j)), { data: slice[j]! });
      }
      await batch.commit();
    });
  }
}

/** One saved extract document for list/detail UI. */
export type StatementExtractListItem = {
  id: string;
  profileId: string;
  fileName: string;
  rowCount: number;
  contentFingerprint: string;
  /** Milliseconds since epoch, or null if missing. */
  uploadedAtMs: number | null;
  rows: StatementWdDpRow[];
};

function firestoreTimestampToMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  if (value && typeof value === "object" && typeof (value as { seconds?: unknown }).seconds === "number") {
    return (value as { seconds: number }).seconds * 1000;
  }
  return null;
}

/**
 * Recent rows saved via {@link saveStatementExtractIfNew} (newest first).
 * Requires an index on `uploadedAt` if Firestore prompts you when first running this query.
 */
export async function loadRecentStatementExtracts(
  profileId: string,
  maxDocs = 40,
): Promise<StatementExtractListItem[]> {
  const trimmedProfileId = profileId.trim();
  const snap = await withFirestoreRetry(() =>
    getDocs(
      query(
        collection(db, "statementExtracts"),
        orderBy("uploadedAt", "desc"),
        limit(Math.max(maxDocs, 50)),
      ),
    ),
  );
  const mapped = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      let chunkPayloads: string[] | undefined;
      if (data.rowsEncoding === STATEMENT_ROWS_ENCODING_GZIP_CHUNKED) {
        const chunkSnap = await getDocs(collection(d.ref, "rowChunks"));
        chunkPayloads = [...chunkSnap.docs]
          .sort((a, b) => Number(a.id) - Number(b.id))
          .map((cd) => (typeof cd.data().data === "string" ? cd.data().data : ""));
      }
      const rows = decodeStatementRowsFromFirestore(
        typeof data.rowsEncoding === "string" ? data.rowsEncoding : undefined,
        typeof data.rowsCompressed === "string" ? data.rowsCompressed : undefined,
        chunkPayloads,
        Array.isArray(data.rows) ? (data.rows as unknown[]) : undefined,
      );
      const storedProfileId =
        typeof data.profileId === "string" && data.profileId.trim().length > 0
          ? data.profileId.trim()
          : DEFAULT_STATEMENT_PROFILE_ID;
      return {
        id: d.id,
        profileId: storedProfileId,
        fileName: typeof data.fileName === "string" ? data.fileName : "Unknown file",
        rowCount: typeof data.rowCount === "number" ? data.rowCount : rows.length,
        contentFingerprint:
          typeof data.contentFingerprint === "string" ? data.contentFingerprint : d.id,
        uploadedAtMs: firestoreTimestampToMs(data.uploadedAt),
        rows,
      };
    }),
  );
  return mapped
    .filter((item) => item.profileId === trimmedProfileId)
    .slice(0, maxDocs);
}

/** Permanently deletes one `statementExtracts` document (parsed rows only; never touches PDFs). */
export async function deleteStatementExtract(extractId: string): Promise<void> {
  const trimmed = extractId.trim();
  if (trimmed.length === 0) throw new Error("Missing extract id.");
  const extractRef = doc(db, "statementExtracts", trimmed);
  const chunkSnap = await withFirestoreRetry(() =>
    getDocs(collection(db, "statementExtracts", trimmed, "rowChunks")),
  );
  if (chunkSnap.empty) {
    await withFirestoreRetry(() => deleteDoc(extractRef));
    return;
  }
  const BATCH = 400;
  for (let i = 0; i < chunkSnap.docs.length; i += BATCH) {
    const batch = writeBatch(db);
    const slice = chunkSnap.docs.slice(i, i + BATCH);
    for (const d of slice) batch.delete(d.ref);
    if (i + BATCH >= chunkSnap.docs.length) {
      batch.delete(extractRef);
    }
    await batch.commit();
  }
}

/** Deletes all cloud saves tagged with `profileId` (up to `maxDocs` recent items). */
export async function deleteStatementExtractsForProfile(
  profileId: string,
  maxDocs = 200,
): Promise<number> {
  const items = await loadRecentStatementExtracts(profileId, maxDocs);
  for (const item of items) {
    await deleteStatementExtract(item.id);
  }
  return items.length;
}

export async function loadPaymentsByDate(
  date: string
): Promise<PaymentRecord[]> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "payments"), where("date", "==", date)))
    );
    return snap.docs.map((d) => d.data() as PaymentRecord);
  } catch (e) {
    console.error("loadPaymentsByDate failed:", e);
    toastApiError(e, "Could not load payments for this day.", {
      toastId: "load-day-ledger",
    });
    return [];
  }
}

/** Returns all distinct dates (DD/MM/YYYY) that have sessions in the given month. */
export async function loadSessionDatesForMonth(
  year: number,
  month: number
): Promise<string[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "sessions"),
          where("dateISO", ">=", `${year}-${pad(month)}-01`),
          where("dateISO", "<=", `${year}-${pad(month)}-31`)
        )
      )
    );
    return [...new Set(snap.docs.map((d) => d.data().date as string))];
  } catch (e) {
    toastApiError(e, "Could not load calendar dates.", {
      toastId: "load-calendar-dates",
    });
    return [];
  }
}

export async function loadPaymentsByMonth(
  year: number,
  month: number
): Promise<PaymentRecord[]> {
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "payments"),
          where("dateISO", ">=", `${year}-${pad(month)}-01`),
          where("dateISO", "<=", `${year}-${pad(month)}-31`)
        )
      )
    );
    return snap.docs.map((d) => d.data() as PaymentRecord);
  } catch (e) {
    toastApiError(e, "Could not load payments for this month.", {
      toastId: "load-month-ledger",
    });
    return [];
  }
}

// ─── Game results (winning numbers) ──────────────────────────────────────────

export async function saveGameResult(result: GameResult): Promise<void> {
  const docId = toDocId(result.id);
  try {
    const payload = stripUndefinedDeep({ ...result }) as DocumentData;
    await setDoc(doc(db, "game_results", docId), payload);
  } catch (e) {
    console.error("saveGameResult failed:", docId, e);
    throw e;
  }
}

export async function loadGameResultsByDate(
  date: string
): Promise<GameResult[]> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "game_results"), where("date", "==", date)))
    );
    return snap.docs.map((d) => d.data() as GameResult);
  } catch (e) {
    console.error("loadGameResultsByDate failed:", e);
    toastApiError(e, "Could not load game results for this day.", {
      toastId: "load-game-results",
    });
    return [];
  }
}

// ─── Private calculation audit logs ───────────────────────────────────────────

export interface CalculationAuditPayload {
  input: string;
  mode: "manual" | "wa";
  total: number;
  resultCount: number;
  /** Unparsed line count from `failedLines` at calculate time. Omitted on very old logs. */
  failedCount?: number;
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
export async function logCalculationAudit(
  payload: CalculationAuditPayload
): Promise<void> {
  try {
    await addDoc(collection(db, "calc_audit_logs"), {
      ...payload,
      // Guard against very large paste payloads.
      input: payload.input.slice(0, 12000),
      createdAt: Date.now(),
    });
  } catch (e) {
    console.warn("logCalculationAudit failed:", e);
    toastApiError(e, "Could not save calculation audit log.", {
      toastId: "calc-audit-log",
    });
  }
}

export async function loadCalculationAuditLogs(
  maxRows = 300
): Promise<CalculationAuditLog[]> {
  const snap = await withFirestoreRetry(() =>
    getDocs(
      query(
        collection(db, "calc_audit_logs"),
        orderBy("createdAt", "desc"),
        limit(maxRows)
      )
    )
  );
  return snap.docs.map((d) => {
    const data = d.data() as Omit<CalculationAuditLog, "id">;
    return { id: d.id, ...data };
  });
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
export async function pruneDuplicateCalculationAuditLogs(
  maxScan = 2000
): Promise<number> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "calc_audit_logs"),
          orderBy("createdAt", "desc"),
          limit(maxScan)
        )
      )
    );
    const rows: CalculationAuditLog[] = snap.docs.map((d) => {
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
        (a.createdAt ?? 0) >= (b.createdAt ?? 0) ? a : b
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
 * Overwrite saved audit totals/counts (e.g. after verifying current parser output).
 */
export async function updateCalculationAuditSavedFields(
  id: string,
  fields: {
    total: number;
    resultCount: number;
    failedCount: number;
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, "calc_audit_logs", id), fields);
  } catch (e) {
    console.warn("updateCalculationAuditSavedFields failed:", e);
    throw e;
  }
}

/** Deletes many audit docs in batches (Firestore write batch limit). */
export async function deleteCalculationAuditLogsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const CHUNK = 450;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const id of slice) {
        batch.delete(doc(db, "calc_audit_logs", id));
      }
      await batch.commit();
    }
  } catch (e) {
    console.warn("deleteCalculationAuditLogsByIds failed:", e);
    throw e;
  }
}

/**
 * Clears audit logs in the dedicated collection.
 * Returns deleted count (best effort).
 */
export async function clearCalculationAuditLogs(
  maxRows = 2000
): Promise<number> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "calc_audit_logs"),
          orderBy("createdAt", "desc"),
          limit(maxRows)
        )
      )
    );
    if (snap.empty) return 0;
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    return snap.docs.length;
  } catch (e) {
    console.warn("clearCalculationAuditLogs failed:", e);
    throw e;
  }
}

/** @returns new Firestore document id */
export async function logReportIssue(
  payload: ReportIssuePayload
): Promise<string> {
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

export async function loadReportIssueLogs(
  maxRows = 300
): Promise<ReportIssueLog[]> {
  const snap = await withFirestoreRetry(() =>
    getDocs(
      query(
        collection(db, "report_issue_logs"),
        orderBy("createdAt", "desc"),
        limit(maxRows)
      )
    )
  );
  return snap.docs.map((d) => {
    const data = d.data() as Omit<ReportIssueLog, "id">;
    return {
      id: d.id,
      ...data,
      fixed: data.fixed === true,
    };
  });
}

export async function updateReportIssueFixed(
  id: string,
  fixed: boolean
): Promise<void> {
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

/** Deletes many report-issue docs in batches (Firestore write batch limit). */
export async function deleteReportIssueLogsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const CHUNK = 450;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const id of slice) {
        batch.delete(doc(db, "report_issue_logs", id));
      }
      await batch.commit();
    }
  } catch (e) {
    console.warn("deleteReportIssueLogsByIds failed:", e);
    throw e;
  }
}

export async function clearReportIssueLogs(maxRows = 2000): Promise<number> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(
        query(
          collection(db, "report_issue_logs"),
          orderBy("createdAt", "desc"),
          limit(maxRows)
        )
      )
    );
    if (snap.empty) return 0;
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    return snap.docs.length;
  } catch (e) {
    console.warn("clearReportIssueLogs failed:", e);
    throw e;
  }
}

// ─── Electricity meter readings ───────────────────────────────────────────────

export type ElectricityMeterId = "main" | "basement";

export interface ElectricityReading {
  /** Unique document ID — generated once on first save, never changes */
  id: string;
  /** "YYYY-MM-DD" — derived from readingTime, kept for grouping/queries */
  dateISO: string;
  /** Which meter this reading belongs to */
  meterId: ElectricityMeterId;
  /** Cumulative KWH reading from the meter */
  reading: number;
  /** Unix ms — when the meter was physically read (user-supplied date + time) */
  readingTime: number;
  /** Unix ms — when the record was saved/updated in the app */
  enteredAt: number;
  /**
   * Rate (₹/unit) locked in at the time this reading was saved.
   * Changing the global price later will NOT affect this entry.
   * 0 means no price was set at that time.
   */
  pricePerUnit: number;
  /** Optional note */
  note?: string;
}

export interface ElectricitySlabRate {
  /** Upper limit for this slab (use Infinity / 999999 for the last slab) */
  upTo: number;
  /** ₹ per unit for consumption within this slab */
  rate: number;
}

export const DEFAULT_SLAB_RATES: ElectricitySlabRate[] = [
  { upTo: 50,     rate: 3.00 },
  { upTo: 150,    rate: 4.50 },
  { upTo: 300,    rate: 6.00 },
  { upTo: 500,    rate: 7.25 },
  { upTo: 999999, rate: 8.50 },
];

export interface ElectricityConfig {
  /** Flat rate — used only when useSlabRates is false */
  pricePerUnit: number;
  /**
   * When true, billing uses slabRates: total units select one slab, then
   * ALL units are charged at that slab's rate (non-progressive).
   */
  useSlabRates: boolean;
  slabRates: ElectricitySlabRate[];
  /** Fixed charges (meter rent, service charge) saved per meter for convenience */
  fixedChargesMain: number;
  fixedChargesBasement: number;
  /** Tax / duty percent applied on (energy + fixed + fuel) */
  taxPercent: number;
  /** Fuel / FPA surcharge in ₹ per unit */
  fuelSurchargePerUnit: number;
}

export interface ElectricityBillingPeriod {
  id: string;
  meterId: ElectricityMeterId;
  /** "YYYY-MM-DD" — first day of this bill period */
  fromDate: string;
  /** "YYYY-MM-DD" — last day of this bill period (date bill was generated/received) */
  toDate: string;
  /** Fixed charges on this specific bill (meter rent, service charge, taxes, etc.) */
  fixedCharges: number;
  /** Total amount on the bill you received (₹) — compare vs calculated */
  actualBillTotal?: number;
  /** Meter dial (KWH) when the bill arrived — app derives usage vs period start */
  billMeterReading?: number;
  /** @deprecated legacy — bill KWH entered directly; use billMeterReading */
  actualBillUnits?: number;
  note?: string;
  createdAt: number;
}

/** Generate a unique ID for a new electricity reading. */
export function newElectricityReadingId(meterId: ElectricityMeterId): string {
  return `${meterId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const electricityConfigRef = () => doc(db, "config", "electricity");

const DEFAULT_ELEC_CONFIG: ElectricityConfig = {
  pricePerUnit: 0,
  useSlabRates: false,
  slabRates: DEFAULT_SLAB_RATES,
  fixedChargesMain: 0,
  fixedChargesBasement: 0,
  taxPercent: 0,
  fuelSurchargePerUnit: 0,
};

export async function loadElectricityConfig(): Promise<ElectricityConfig> {
  try {
    const snap = await withFirestoreRetry(() => getDoc(electricityConfigRef()));
    if (snap.exists()) return { ...DEFAULT_ELEC_CONFIG, ...(snap.data() as ElectricityConfig) };
    return DEFAULT_ELEC_CONFIG;
  } catch (e) {
    toastApiError(e, "Could not load electricity settings.", { toastId: "electricity-config" });
    return DEFAULT_ELEC_CONFIG;
  }
}

export async function loadElectricityBillingPeriods(meterId: ElectricityMeterId): Promise<ElectricityBillingPeriod[]> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(query(collection(db, "electricity_billing_periods"), where("meterId", "==", meterId)))
    );
    const docs = snap.docs.map((d) => d.data() as ElectricityBillingPeriod);
    return docs.sort((a, b) => b.fromDate.localeCompare(a.fromDate)); // newest first
  } catch (e) {
    toastApiError(e, "Could not load billing periods.", { toastId: "electricity-billing" });
    return [];
  }
}

export async function saveElectricityBillingPeriod(period: ElectricityBillingPeriod): Promise<void> {
  await setDoc(doc(db, "electricity_billing_periods", period.id), period);
}

export async function deleteElectricityBillingPeriod(id: string): Promise<void> {
  await deleteDoc(doc(db, "electricity_billing_periods", id));
}

export function newBillingPeriodId(meterId: ElectricityMeterId): string {
  return `bp_${meterId}_${Date.now()}`;
}

export async function saveElectricityConfig(config: ElectricityConfig): Promise<void> {
  await setDoc(electricityConfigRef(), config);
}

/** Migrate docs saved with the old schema (no id / no readingTime) so the UI works. */
function hydrateElectricityReading(
  docId: string,
  raw: Record<string, unknown>,
): ElectricityReading {
  // Old schema used `savedAt`; new schema uses `readingTime` + `enteredAt`
  const readingTime =
    typeof raw.readingTime === "number"
      ? raw.readingTime
      : typeof raw.savedAt === "number"
      ? raw.savedAt
      : Date.now();

  const dateISO =
    typeof raw.dateISO === "string" && raw.dateISO
      ? raw.dateISO
      : new Date(readingTime).toISOString().slice(0, 10);

  return {
    id:           typeof raw.id === "string" && raw.id ? raw.id : docId,
    dateISO,
    meterId:      (raw.meterId as ElectricityMeterId) ?? "main",
    reading:      typeof raw.reading === "number" ? raw.reading : 0,
    readingTime,
    enteredAt:    typeof raw.enteredAt === "number" ? raw.enteredAt : readingTime,
    pricePerUnit: typeof raw.pricePerUnit === "number" ? raw.pricePerUnit : 0,
    ...(typeof raw.note === "string" && raw.note ? { note: raw.note } : {}),
  };
}

export async function loadElectricityReadings(): Promise<ElectricityReading[]> {
  try {
    const snap = await withFirestoreRetry(() =>
      getDocs(collection(db, "electricity_readings"))
    );
    const docs = snap.docs.map((d) =>
      hydrateElectricityReading(d.id, d.data() as Record<string, unknown>)
    );
    // Sort client-side — avoids needing a Firestore composite index on readingTime
    return docs.sort((a, b) => a.readingTime - b.readingTime);
  } catch (e) {
    toastApiError(e, "Could not load electricity readings.", { toastId: "electricity-readings" });
    return [];
  }
}

export async function saveElectricityReading(reading: ElectricityReading): Promise<void> {
  await setDoc(doc(db, "electricity_readings", reading.id), reading);
}

export async function deleteElectricityReading(id: string): Promise<void> {
  await deleteDoc(doc(db, "electricity_readings", id));
}

// ─── Loan borrowers (family members) ─────────────────────────────────────────

export type LoanBorrowersCloudState = {
  borrowers: LoanBorrower[];
  activeBorrowerId: string;
};

function parseLoanBorrowersFromFirestore(data: DocumentData): LoanBorrower[] {
  const raw = data.borrowers;
  if (!Array.isArray(raw)) return [];
  const out: LoanBorrower[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.name === "string" && o.id.length > 0) {
      out.push({ id: o.id, name: o.name.trim() || o.id });
    }
  }
  if (!out.some((b) => b.id === DEFAULT_LOAN_BORROWER_ID)) {
    out.unshift({ id: DEFAULT_LOAN_BORROWER_ID, name: "Me" });
  }
  return out;
}

export async function loadLoanBorrowersDB(): Promise<LoanBorrowersCloudState | null> {
  try {
    const snap = await withFirestoreRetry(() => getDoc(configRef("loanBorrowers")));
    if (!snap.exists()) return null;
    const borrowers = parseLoanBorrowersFromFirestore(snap.data());
    if (borrowers.length === 0) return null;
    const data = snap.data();
    const activeRaw = data.activeBorrowerId;
    const activeBorrowerId =
      typeof activeRaw === "string" && activeRaw.trim().length > 0
        ? activeRaw.trim()
        : DEFAULT_LOAN_BORROWER_ID;
    return { borrowers, activeBorrowerId };
  } catch (e) {
    console.error("loadLoanBorrowersDB failed:", e);
    return null;
  }
}

export async function saveLoanBorrowersDB(state: LoanBorrowersCloudState): Promise<void> {
  try {
    await setDoc(configRef("loanBorrowers"), {
      borrowers: state.borrowers,
      activeBorrowerId: state.activeBorrowerId,
      updatedAtMs: Date.now(),
    });
  } catch (e) {
    console.error("saveLoanBorrowersDB failed:", e);
    throw e;
  }
}

// ─── Loans (repayment schedule metadata + parsed rows) ───────────────────────

export type LoanPartPaymentRecord = {
  date: string;
  amount: number;
};

export type LoanRecord = {
  id: string;
  borrowerId: string;
  name: string;
  lender: string;
  loanType: string;
  principal: number | null;
  interestRate: number | null;
  tenureMonths: number | null;
  emiAmount: number | null;
  columnOrder: LoanColumnId[];
  columnBoundaries: number[] | null;
  scheduleFileName: string | null;
  scheduleRowCount: number;
  scheduleFingerprint: string | null;
  partPayments?: LoanPartPaymentRecord[];
  createdAtMs: number;
  updatedAtMs: number;
  rows: LoanScheduleRow[];
};

function loanDocId(borrowerId: string, loanId: string): string {
  return `${borrowerId.trim()}__${toDocId(loanId.trim())}`;
}

function parseLoanColumnOrder(raw: unknown): LoanColumnId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set([
    "installmentNo",
    "dueDate",
    "installmentAmount",
    "interest",
    "principal",
    "balancePrincipal",
  ]);
  return raw.filter((x): x is LoanColumnId => typeof x === "string" && allowed.has(x));
}

function parseLoanPartPayments(raw: unknown): LoanPartPaymentRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LoanPartPaymentRecord[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date.trim() : "";
    const amount = typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null;
    if (date && amount != null && amount > 0) out.push({ date, amount });
  }
  return out.length > 0 ? out : undefined;
}

function parseLoanColumnBoundaries(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return out.length >= 3 ? out : null;
}

async function loadLoanScheduleChunks(
  loanDocIdStr: string,
  maxChunks?: number,
): Promise<string[]> {
  const chunkColl = collection(db, "loans", loanDocIdStr, "scheduleChunks");
  const snap = await withFirestoreTimeout(
    withFirestoreRetry(() => getDocs(chunkColl)),
  );
  const sorted = snap.docs.sort((a, b) => Number(a.id) - Number(b.id));
  const docs = maxChunks != null ? sorted.slice(0, maxChunks) : sorted;
  return docs.map((d) => {
    const data = d.data();
    return typeof data.data === "string" ? data.data : "";
  });
}

function hydrateLoanDoc(
  docSnap: import("firebase/firestore").QueryDocumentSnapshot,
): LoanRecord {
  const data = docSnap.data();
  const scheduleRowCount =
    typeof data.scheduleRowCount === "number" ? data.scheduleRowCount : 0;
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    id: typeof data.loanId === "string" ? fromDocId(data.loanId) : fromDocId(docSnap.id.split("__").slice(1).join("__") || docSnap.id),
    borrowerId: typeof data.borrowerId === "string" ? data.borrowerId : "",
    name: typeof data.name === "string" ? data.name : "",
    lender: typeof data.lender === "string" ? data.lender : "",
    loanType: typeof data.loanType === "string" ? data.loanType : "",
    principal: numOrNull(data.principal),
    interestRate: numOrNull(data.interestRate),
    tenureMonths: numOrNull(data.tenureMonths),
    emiAmount: numOrNull(data.emiAmount),
    columnOrder: parseLoanColumnOrder(data.columnOrder),
    columnBoundaries: parseLoanColumnBoundaries(data.columnBoundaries),
    scheduleFileName:
      typeof data.scheduleFileName === "string" ? data.scheduleFileName : null,
    scheduleRowCount,
    scheduleFingerprint:
      typeof data.scheduleFingerprint === "string" ? data.scheduleFingerprint : null,
    partPayments: parseLoanPartPayments(data.partPayments),
    createdAtMs: firestoreTimestampToMs(data.createdAtMs) ?? Date.now(),
    updatedAtMs: firestoreTimestampToMs(data.updatedAtMs) ?? Date.now(),
    rows: [],
  };
}

export type LoanSchedulePayload = {
  encoding?: string;
  compressed?: string;
  chunks?: string[];
  scheduleRowCount: number;
};

/** One Firestore read: loan metadata + compressed schedule bytes (no decode). */
export async function loadLoanDocForDetail(
  borrowerId: string,
  loanId: string,
): Promise<{ meta: LoanRecord; payload: LoanSchedulePayload } | null> {
  const trimmedBorrower = borrowerId.trim();
  const trimmedLoan = loanId.trim();
  if (!trimmedBorrower || !trimmedLoan) return null;
  try {
    const docId = loanDocId(trimmedBorrower, trimmedLoan);
    const snap = await withFirestoreTimeout(
      withFirestoreRetry(() => getDoc(doc(db, "loans", docId))),
    );
    if (!snap.exists()) return null;
    const meta = hydrateLoanDoc(snap as import("firebase/firestore").QueryDocumentSnapshot);
    const data = snap.data();
    const encoding = typeof data.scheduleEncoding === "string" ? data.scheduleEncoding : undefined;
    const compressed =
      typeof data.scheduleCompressed === "string" ? data.scheduleCompressed : undefined;
    const scheduleRowCount =
      typeof data.scheduleRowCount === "number" ? data.scheduleRowCount : 0;
    let chunks: string[] | undefined;
    if (encoding === LOAN_ROWS_ENCODING_GZIP_CHUNKED) {
      const maxChunks = Math.ceil(MAX_SCHEDULE_ROWS_DECODE / LOAN_ROWS_PER_CHUNK) + 1;
      chunks = await loadLoanScheduleChunks(docId, maxChunks);
    }
    return {
      meta,
      payload: { encoding, compressed, chunks, scheduleRowCount },
    };
  } catch (e) {
    console.error("loadLoanDocForDetail failed:", e);
    toastApiError(e, "Could not load loan.", { toastId: "load-loan-detail" });
    return null;
  }
}

async function writeLoanScheduleChunks(loanDocIdStr: string, chunks: string[]): Promise<void> {
  const chunkColl = collection(db, "loans", loanDocIdStr, "scheduleChunks");
  const BATCH = 400;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    await withFirestoreRetry(async () => {
      const batch = writeBatch(db);
      for (let j = 0; j < slice.length; j++) {
        batch.set(doc(chunkColl, String(i + j)), { data: slice[j]! });
      }
      await batch.commit();
    });
  }
}

function withFirestoreTimeout<T>(promise: Promise<T>, ms = 25000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firestore request timed out")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export async function loadLoansForBorrower(borrowerId: string): Promise<LoanRecord[]> {
  const trimmed = borrowerId.trim();
  if (!trimmed) return [];
  try {
    const snap = await withFirestoreTimeout(
      withFirestoreRetry(() =>
        getDocs(query(collection(db, "loans"), where("borrowerId", "==", trimmed))),
      ),
    );
    const loans = snap.docs.map((d) => hydrateLoanDoc(d));
    return loans.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  } catch (e) {
    console.error("loadLoansForBorrower failed:", e);
    toastApiError(e, "Could not load loans.", { toastId: "load-loans" });
    return [];
  }
}

export async function loadLoanRecordWithSchedule(
  borrowerId: string,
  loanId: string,
): Promise<LoanRecord | null> {
  const result = await loadLoanDocForDetail(borrowerId, loanId);
  if (!result) return null;
  const { decodeLoanScheduleSafe } = await import("../loans/decodeLoanScheduleOffThread");
  const rows = await decodeLoanScheduleSafe(
    result.payload.encoding,
    result.payload.compressed,
    result.payload.chunks,
    result.payload.scheduleRowCount,
  );
  return { ...result.meta, rows };
}

export async function saveLoanRecord(loan: Omit<LoanRecord, "createdAtMs" | "updatedAtMs"> & {
  createdAtMs?: number;
}): Promise<void> {
  const docId = loanDocId(loan.borrowerId, loan.id);
  const encoded = encodeLoanScheduleRowsForFirestore(loan.rows);
  const now = Date.now();
  const payload: DocumentData = stripUndefinedDeep({
    borrowerId: loan.borrowerId,
    loanId: loan.id,
    name: loan.name,
    lender: loan.lender,
    loanType: loan.loanType,
    principal: loan.principal,
    interestRate: loan.interestRate,
    tenureMonths: loan.tenureMonths,
    emiAmount: loan.emiAmount,
    columnOrder: loan.columnOrder,
    columnBoundaries: loan.columnBoundaries,
    scheduleFileName: loan.scheduleFileName,
    scheduleRowCount: encoded.rowCount,
    scheduleFingerprint: loan.scheduleFingerprint,
    partPayments: loan.partPayments,
    scheduleEncoding: encoded.encoding,
    scheduleCompressed: encoded.compressed,
    scheduleChunkCount: encoded.chunks?.length,
    createdAtMs: loan.createdAtMs ?? now,
    updatedAtMs: now,
  }) as DocumentData;
  await setDoc(doc(db, "loans", docId), payload);
  if (encoded.chunks) {
    await writeLoanScheduleChunks(docId, encoded.chunks);
  }
}

export async function deleteLoanRecord(borrowerId: string, loanId: string): Promise<void> {
  const docId = loanDocId(borrowerId, loanId);
  const chunkColl = collection(db, "loans", docId, "scheduleChunks");
  const chunks = await getDocs(chunkColl);
  if (!chunks.empty) {
    await withFirestoreRetry(async () => {
      const batch = writeBatch(db);
      chunks.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    });
  }
  await deleteDoc(doc(db, "loans", docId));
}

export async function deleteLoansForBorrower(borrowerId: string): Promise<void> {
  const loans = await loadLoansForBorrower(borrowerId);
  await Promise.all(loans.map((l) => deleteLoanRecord(borrowerId, l.id)));
}

// ─── One-time migration from old bulk-doc structure ───────────────────────────

export async function migrateOldFirestoreData(): Promise<void> {
  try {
    const [oldSessions, oldPayments] = await withFirestoreRetry(() =>
      Promise.all([
        getDoc(doc(db, "data", "sessions")),
        getDoc(doc(db, "data", "payments")),
      ])
    );
    const jobs: Promise<void>[] = [];
    if (oldSessions.exists()) {
      const sessions = (oldSessions.data().sessions ?? []) as SavedSession[];
      jobs.push(
        ...sessions.map((s) =>
          saveSessionDoc({ ...s, dateISO: toDateISO(s.date) })
        )
      );
    }
    if (oldPayments.exists()) {
      const payments = (oldPayments.data().payments ?? []) as PaymentRecord[];
      jobs.push(
        ...payments.map((p) =>
          savePaymentDoc({ ...p, dateISO: toDateISO(p.date) })
        )
      );
    }
    await Promise.all(jobs);
  } catch (e) {
    console.warn("Firestore migration error:", e);
    toastApiError(e, "Firestore data migration had a problem.", {
      toastId: "migrate-firestore",
    });
  }
}
