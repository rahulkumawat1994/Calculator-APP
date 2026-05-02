import { useState, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import {
  formatSlotTime,
  getCurrentSlot,
  mergeSessionLedgerResult,
  sessionLedgerForSlotKey,
  slotMinutes,
  upsertPayment,
  toastApiError,
  toDateISO,
} from "@/lib";
import type {
  SavedSession,
  GameSlot,
  AppSettings,
  PaymentRecord,
  GameResult,
  Segment,
  CalculationResult,
} from "@/types";
import ConfirmDialog from "./ConfirmDialog";
import EditableBreakdown from "./EditableBreakdown";
import { useLoadingSignal } from "./TopProgressBar";
import { Card, DangerActionDialog, Modal } from "./ui";

interface Props {
  slots: GameSlot[];
  settings: AppSettings;
  loadSessionsByDate: (date: string) => Promise<SavedSession[]>;
  loadSessionsByMonth: (year: number, month: number) => Promise<SavedSession[]>;
  loadSessionDatesForMonth: (year: number, month: number) => Promise<string[]>;
  loadPaymentsByDate: (date: string) => Promise<PaymentRecord[]>;
  loadPaymentsByMonth: (
    year: number,
    month: number
  ) => Promise<PaymentRecord[]>;
  savePaymentDoc: (payment: PaymentRecord) => Promise<void>;
  loadGameResultsByDate: (date: string) => Promise<GameResult[]>;
  saveGameResult: (result: GameResult) => Promise<void>;
  saveSessionDoc: (session: SavedSession) => Promise<void>;
  deleteSessionDoc: (id: string) => Promise<void>;
  deletePaymentsByContactDate: (contact: string, date: string) => Promise<void>;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  const n = new Date();
  return `${String(n.getDate()).padStart(2, "0")}/${String(
    n.getMonth() + 1
  ).padStart(2, "0")}/${n.getFullYear()}`;
}
function parseDate(str: string): Date {
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}
function shiftDate(str: string, delta: number): string {
  const d = parseDate(str);
  d.setDate(d.getDate() + delta);
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
}
function displayDate(str: string): string {
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  if (str === today) return "Today";
  if (str === yesterday) return "Yesterday";
  return parseDate(str).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function compareDates(a: string, b: string): number {
  return parseDate(a).getTime() - parseDate(b).getTime();
}

// ─── Winner detection ──────────────────────────────────────────────────────────

/** Extract all number strings from a segment's display line. */
function extractLineNumbers(line: string): string[] {
  return line.match(/\d+/g) ?? [];
}

/** Reverse a 2-digit number string: "42" → "24". Works for any length. */
function reverseNumStr(n: string): string {
  return n.split("").reverse().join("");
}

/** Returns the winning segments for a user, with info about how they won. */
function getWinningSegments(
  segments: Segment[],
  winningNum: string
): Array<{ seg: Segment; matchedNumber: string; isUlta: boolean }> {
  if (!winningNum) return [];
  const rev = reverseNumStr(winningNum);
  const results: Array<{ seg: Segment; matchedNumber: string; isUlta: boolean }> = [];
  for (const seg of segments) {
    const nums = extractLineNumbers(seg.line);
    for (const n of nums) {
      if (n === winningNum) {
        results.push({ seg, matchedNumber: n, isUlta: false });
        break;
      }
      if (seg.isWP && n === rev) {
        results.push({ seg, matchedNumber: n, isUlta: true });
        break;
      }
    }
  }
  return results;
}

// ─── Slot status ───────────────────────────────────────────────────────────────

type SlotStatus = "active" | "upcoming" | "closed";

function getSlotStatus(
  slot: GameSlot,
  activeSlotId: string,
  isToday: boolean
): SlotStatus {
  if (!isToday) return "closed";
  if (slot.id === activeSlotId) return "active";
  const now = new Date();
  return slotMinutes(slot.time) <= now.getHours() * 60 + now.getMinutes()
    ? "closed"
    : "upcoming";
}

const STATUS_STYLE: Record<SlotStatus, { badge: string; label: string }> = {
  active: {
    badge: "bg-green-100 text-green-700 border border-green-300",
    label: "🟢 Open Now",
  },
  upcoming: {
    badge: "bg-blue-100 text-blue-700 border border-blue-200",
    label: "🔵 Coming Later",
  },
  closed: {
    badge: "bg-gray-100 text-gray-500 border border-gray-200",
    label: "✅ Done",
  },
};

// ─── Data helpers ──────────────────────────────────────────────────────────────

interface UserRow {
  contact: string;
  betTotal: number;
  amountPaid: number | null;
  commissionPct: number | undefined;
  paymentId: string;
  segments: Segment[];
  sessionId: string;
  slotLedger: CalculationResult;
}

function buildSlotUsers(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  slotId: string,
  date: string
): UserRow[] {
  const rows: UserRow[] = [];
  for (const session of sessions) {
    if (session.date !== date) continue;
    const ledger = sessionLedgerForSlotKey(session, slotId);
    if (!ledger) continue;
    const betTotal = ledger.total;
    const pid = `${session.contact}|${slotId}|${date}`;
    const pr = payments.find((p) => p.id === pid);
    rows.push({
      contact: session.contact,
      betTotal,
      amountPaid: pr?.amountPaid ?? null,
      commissionPct: pr?.commissionPct,
      paymentId: pid,
      segments: ledger.results,
      sessionId: session.id,
      slotLedger: ledger,
    });
  }
  return rows.sort((a, b) => a.contact.localeCompare(b.contact));
}

interface DaySummary {
  date: string;
  totalBets: number;
  received: number;
  earned: number;
  pending: number;
}

function buildMonthData(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  commissionPct: number,
  year: number,
  month: number
) {
  const allDates = new Set<string>();
  for (const s of sessions) {
    const p = s.date.split("/");
    if (p.length >= 3 && parseInt(p[1]) === month && parseInt(p[2]) === year)
      allDates.add(s.date);
  }
  for (const p of payments) {
    const parts = p.date.split("/");
    if (
      parts.length >= 3 &&
      parseInt(parts[1]) === month &&
      parseInt(parts[2]) === year
    )
      allDates.add(p.date);
  }

  const days: DaySummary[] = [];
  for (const date of allDates) {
    const totalBets = sessions
      .filter((s) => s.date === date)
      .reduce((sum, s) => sum + mergeSessionLedgerResult(s).total, 0);
    const dayPayments = payments.filter(
      (p) => p.date === date && p.amountPaid !== null
    );
    const received = dayPayments.reduce(
      (sum, p) => sum + (p.amountPaid ?? 0),
      0
    );
    if (totalBets === 0 && received === 0) continue;
    // Per-payment commission: use each payment's own commissionPct or fall back to global
    const earned = dayPayments.reduce((sum, p) => {
      const pct = p.commissionPct ?? commissionPct;
      return sum + Math.round((p.amountPaid ?? 0) * pct) / 100;
    }, 0);
    const pending = Math.max(0, totalBets - received);
    days.push({
      date,
      totalBets,
      received,
      earned: Math.round(earned * 100) / 100,
      pending,
    });
  }

  days.sort((a, b) => compareDates(b.date, a.date));
  const totalBets = days.reduce((s, d) => s + d.totalBets, 0);
  const totalReceived = days.reduce((s, d) => s + d.received, 0);
  const totalEarned =
    Math.round(days.reduce((s, d) => s + d.earned, 0) * 100) / 100;
  const totalPending = days.reduce((s, d) => s + d.pending, 0);
  return { days, totalBets, totalReceived, totalEarned, totalPending };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function makeDateStr(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function buildCalendarCells(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const cells: (number | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ─── Component ────────────────────────────────────────────────────────────────

type ViewMode = "daily" | "monthly";

// State for inline editing: payment amount AND commission %
interface EditState {
  id: string;
  value: string; // amountPaid
  pct: string; // commissionPct
  showPct: boolean; // whether the % editor is expanded
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void;
}

function SkeletonSlotCards() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <Card key={i} padding="md">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
              <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function GamesView({
  slots,
  settings,
  loadSessionsByDate,
  loadSessionsByMonth,
  loadSessionDatesForMonth,
  loadPaymentsByDate,
  loadPaymentsByMonth,
  savePaymentDoc,
  loadGameResultsByDate,
  saveGameResult,
  saveSessionDoc,
  deleteSessionDoc,
  deletePaymentsByContactDate,
}: Props) {
  const { inc, dec } = useLoadingSignal();
  const today = todayStr();
  const nowDate = new Date();

  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  /** Calendar month shown in the daily calendar widget */
  const [cal, setCal] = useState({ year: nowDate.getFullYear(), month: nowDate.getMonth() + 1 });
  /** Dates (DD/MM/YYYY) that have session data — used for calendar dots */
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [initialJumpDone, setInitialJumpDone] = useState(false);
  const [openSlots, setOpenSlots] = useState<Set<string>>(new Set());
  /** Payment editing state — lives inside the user detail modal */
  const [modalPayEdit, setModalPayEdit] = useState<EditState | null>(null);
  /** Slot id currently running “mark all paid” Firestore writes */
  const [bulkSavingSlotId, setBulkSavingSlotId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [monthYear, setMonthYear] = useState({
    year: nowDate.getFullYear(),
    month: nowDate.getMonth() + 1,
  });

  /** slotId → saved winning number (from Firestore) */
  const [gameResults, setGameResults] = useState<Map<string, string>>(new Map());
  /** slotId → draft input (not yet saved) */
  const [winDraft, setWinDraft] = useState<Map<string, string>>(new Map());
  /** slotId → currently saving */
  const [winSaving, setWinSaving] = useState<Set<string>>(new Set());

  /** Currently open user detail bottom-sheet modal */
  const [userModal, setUserModal] = useState<{ slot: GameSlot; user: UserRow } | null>(null);
  /** Which slot's winning-number modal is open (slotId) */
  const [winNumModal, setWinNumModal] = useState<string | null>(null);
  /** Bet row selection inside the user modal */
  const [modalBetRowSel, setModalBetRowSel] = useState<Set<number>>(new Set());
  /** Whether the bets accordion is open inside the user modal */
  const [modalBetsOpen, setModalBetsOpen] = useState(false);
  /** Confirm delete for the session open in the user modal */
  const [modalConfirmDelete, setModalConfirmDelete] = useState(false);
  /** Confirm multi-row bet-line delete inside the user modal */
  const [modalConfirmRowDelete, setModalConfirmRowDelete] = useState<{
    sessionId: string;
    slotKey: string;
    indices: number[];
  } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  /** Session id to delete directly from the row (without opening the modal) */
  const [directDeleteSessionId, setDirectDeleteSessionId] = useState<string | null>(null);

  // Lazily loaded data
  const [daySessions, setDaySessions] = useState<SavedSession[]>([]);
  const [dayPayments, setDayPayments] = useState<PaymentRecord[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const [monthSessions, setMonthSessions] = useState<SavedSession[]>([]);
  const [monthPayments, setMonthPayments] = useState<PaymentRecord[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);

  // Sequence refs to discard stale results when date/month changes quickly
  const daySeqRef = useRef(0);
  const monthSeqRef = useRef(0);

  // SWR: show last-loaded sessions+payments immediately, then always refetch in background
  const dayDataCacheRef = useRef(
    new Map<string, { sessions: SavedSession[]; payments: PaymentRecord[] }>()
  );
  const putDayDataCache = (
    date: string,
    sessions: SavedSession[],
    payments: PaymentRecord[]
  ) => {
    dayDataCacheRef.current.set(date, { sessions, payments });
  };
  const monthDataCacheRef = useRef(
    new Map<string, { sessions: SavedSession[]; payments: PaymentRecord[] }>()
  );
  const monthCacheKey = (y: number, m: number) => `${y}-${m}`;
  const putMonthDataCache = (
    y: number,
    mo: number,
    sessions: SavedSession[],
    payments: PaymentRecord[]
  ) => {
    monthDataCacheRef.current.set(monthCacheKey(y, mo), { sessions, payments });
  };

  // Load active dates for the calendar month and auto-jump to most recent date with data
  useEffect(() => {
    loadSessionDatesForMonth(cal.year, cal.month)
      .then((dates) => {
        setActiveDates((prev) => {
          const next = new Set(prev);
          dates.forEach((d) => next.add(d));
          return next;
        });
        if (!initialJumpDone && dates.length > 0) {
          const sorted = [...dates].sort((a, b) => {
            const [ad, am, ay] = a.split("/").map(Number);
            const [bd, bm, by] = b.split("/").map(Number);
            return (
              new Date(by, bm - 1, bd).getTime() -
              new Date(ay, am - 1, ad).getTime()
            );
          });
          setSelectedDate(sorted[0]);
          setInitialJumpDone(true);
        }
      })
      .catch(() => {/* non-fatal */});
  }, [cal.year, cal.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load daily data — paint from cache if any, always refetch; top bar during fetch
  useEffect(() => {
    if (viewMode !== "daily") return;
    const cached = dayDataCacheRef.current.get(selectedDate);
    if (cached) {
      setDaySessions([...cached.sessions]);
      setDayPayments([...cached.payments]);
    }

    const seq = ++daySeqRef.current;
    inc();
    setDayLoading(true);
    Promise.all([
      loadSessionsByDate(selectedDate),
      loadPaymentsByDate(selectedDate),
      loadGameResultsByDate(selectedDate),
    ])
      .then(([s, p, gr]) => {
        if (seq !== daySeqRef.current) return;
        setDaySessions(s);
        setDayPayments(p);
        putDayDataCache(selectedDate, [...s], [...p]);
        setActiveDates((prev) => {
          const next = new Set(prev);
          if (s.length > 0) next.add(selectedDate);
          return next;
        });
        const map = new Map<string, string>();
        for (const r of gr) {
          if (r.winningNumber) map.set(r.slotId, r.winningNumber);
        }
        setGameResults(map);
      })
      .catch((err) => {
        if (seq !== daySeqRef.current) return;
        toastApiError(err, "Could not refresh payments for this day.");
        if (cached) {
          setDaySessions([...cached.sessions]);
          setDayPayments([...cached.payments]);
        }
      })
      .finally(() => {
        dec();
        if (seq === daySeqRef.current) setDayLoading(false);
      });
  }, [selectedDate, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load monthly data — paint from cache if any, always refetch
  useEffect(() => {
    if (viewMode !== "monthly") return;
    const mKey = monthCacheKey(monthYear.year, monthYear.month);
    const cached = monthDataCacheRef.current.get(mKey);
    if (cached) {
      setMonthSessions([...cached.sessions]);
      setMonthPayments([...cached.payments]);
    }

    const seq = ++monthSeqRef.current;
    inc();
    setMonthLoading(true);
    Promise.all([
      loadSessionsByMonth(monthYear.year, monthYear.month),
      loadPaymentsByMonth(monthYear.year, monthYear.month),
    ])
      .then(([s, p]) => {
        if (seq !== monthSeqRef.current) return;
        setMonthSessions(s);
        setMonthPayments(p);
        putMonthDataCache(monthYear.year, monthYear.month, [...s], [...p]);
      })
      .catch((err) => {
        if (seq !== monthSeqRef.current) return;
        toastApiError(err, "Could not refresh monthly payments.");
        if (cached) {
          setMonthSessions([...cached.sessions]);
          setMonthPayments([...cached.payments]);
        }
      })
      .finally(() => {
        dec();
        if (seq === monthSeqRef.current) setMonthLoading(false);
      });
  }, [monthYear, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabledSlots = slots
    .filter((s) => s.enabled)
    .sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
  const isToday = selectedDate === today;
  const activeSlotId = getCurrentSlot(slots).id;

  // ── Daily helpers ──────────────────────────────────────────────────────────

  const slotUsers = (slotId: string) =>
    buildSlotUsers(daySessions, dayPayments, slotId, selectedDate);
  const slotSummary = (slotId: string) => {
    const users = slotUsers(slotId);
    const totalBets = users.reduce((s, u) => s + u.betTotal, 0);
    const received = users.reduce((s, u) => s + (u.amountPaid ?? 0), 0);
    // Per-payment commission
    const myEarning = users.reduce((s, u) => {
      const pct = u.commissionPct ?? settings.commissionPct;
      return s + Math.round((u.amountPaid ?? 0) * pct) / 100;
    }, 0);
    const pending = totalBets - received;
    return {
      totalBets,
      received,
      pending,
      myEarning: Math.round(myEarning * 100) / 100,
      count: users.length,
    };
  };
  const daySummary = () => {
    const all = enabledSlots.map((s) => slotSummary(s.id));
    return {
      totalBets: all.reduce((s, x) => s + x.totalBets, 0),
      received: all.reduce((s, x) => s + x.received, 0),
      pending: all.reduce((s, x) => s + x.pending, 0),
      myEarning:
        Math.round(all.reduce((s, x) => s + x.myEarning, 0) * 100) / 100,
    };
  };

  // ── Payment editing ────────────────────────────────────────────────────────

  const startEdit = (
    paymentId: string,
    current: number | null,
    currentPct?: number
  ) =>
    setModalPayEdit({
      id: paymentId,
      value: current !== null ? String(current) : "",
      pct: String(currentPct ?? settings.commissionPct),
      showPct: false,
    });

  const saveEdit = async (
    paymentId: string,
    contact: string,
    slotId: string,
    slotName: string
  ) => {
    if (!modalPayEdit || modalPayEdit.id !== paymentId) return;
    const raw = modalPayEdit.value.trim();
    const amount = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && isNaN(amount as number)) return;
    const pct = parseFloat(modalPayEdit.pct);
    const commissionPct = isNaN(pct) ? settings.commissionPct : pct;

    const updatedPayments = upsertPayment(dayPayments, {
      id: paymentId,
      contact,
      slotId,
      slotName,
      date: selectedDate,
      amountPaid: amount,
      commissionPct,
    });
    const saved = updatedPayments.find((p) => p.id === paymentId);
    if (saved) {
      try {
        await savePaymentDoc(saved);
        setDayPayments(updatedPayments);
        putDayDataCache(selectedDate, daySessions, updatedPayments);
      } catch (err) {
        console.error("saveEdit failed:", err);
        toastApiError(
          err,
          "Save failed. Please check your internet connection and try again."
        );
        return;
      }
    }
    setModalPayEdit(null);
  };

  /** One-tap: set a single user's received amount equal to this game's total. */
  const markUserFullyPaid = async (
    paymentId: string,
    contact: string,
    slot: GameSlot,
    betTotal: number,
    currentPct?: number
  ) => {
    setModalPayEdit(null);
    const commissionPct = currentPct ?? settings.commissionPct;
    const updatedPayments = upsertPayment(dayPayments, {
      id: paymentId,
      contact,
      slotId: slot.id,
      slotName: slot.name,
      date: selectedDate,
      amountPaid: betTotal,
      commissionPct,
    });
    const saved = updatedPayments.find((p) => p.id === paymentId);
    if (!saved) return;
    try {
      await savePaymentDoc(saved);
      setDayPayments(updatedPayments);
      putDayDataCache(selectedDate, daySessions, updatedPayments);
      toast.success(`Marked fully paid for ${contact}.`);
    } catch (err) {
      toastApiError(
        err,
        "Save failed. Please check your internet connection and try again."
      );
    }
  };

  /** Clear received amount for a single user in one game row. */
  const clearUserReceivedAmount = async (
    paymentId: string,
    contact: string,
    slot: GameSlot,
    currentPct?: number
  ) => {
    setModalPayEdit(null);
    const commissionPct = currentPct ?? settings.commissionPct;
    const updatedPayments = upsertPayment(dayPayments, {
      id: paymentId,
      contact,
      slotId: slot.id,
      slotName: slot.name,
      date: selectedDate,
      amountPaid: null,
      commissionPct,
    });
    const saved = updatedPayments.find((p) => p.id === paymentId);
    if (!saved) return;
    try {
      await savePaymentDoc(saved);
      setDayPayments(updatedPayments);
      putDayDataCache(selectedDate, daySessions, updatedPayments);
      toast.success(`Removed received amount for ${contact}.`);
    } catch (err) {
      toastApiError(
        err,
        "Save failed. Please check your internet connection and try again."
      );
    }
  };

  /** Set amount paid = game total for every player in this slot (selected day). */
  const markAllFullyPaidForSlot = async (slot: GameSlot) => {
    const users = buildSlotUsers(daySessions, dayPayments, slot.id, selectedDate);
    const targets = users.filter((u) => u.amountPaid !== u.betTotal);
    if (targets.length === 0) return;
    setModalPayEdit(null);
    setBulkSavingSlotId(slot.id);
    inc();
    try {
      let updated = [...dayPayments];
      for (const u of targets) {
        const commissionPct = u.commissionPct ?? settings.commissionPct;
        updated = upsertPayment(updated, {
          id: u.paymentId,
          contact: u.contact,
          slotId: slot.id,
          slotName: slot.name,
          date: selectedDate,
          amountPaid: u.betTotal,
          commissionPct,
        });
      }
      const saves = targets.map((u) => updated.find((p) => p.id === u.paymentId)!);
      await Promise.all(saves.map((p) => savePaymentDoc(p)));
      setDayPayments(updated);
      putDayDataCache(selectedDate, daySessions, updated);
      toast.success(
        `Saved ${targets.length} payment${targets.length === 1 ? "" : "s"} — ${slot.name} fully settled for this day.`
      );
    } catch (err) {
      toastApiError(err, "Could not save all payments. Try again.");
    } finally {
      dec();
      setBulkSavingSlotId(null);
    }
  };

  /** Reset recorded paid amounts to blank for every player in this slot/day. */
  const resetPaymentsForSlot = async (slot: GameSlot) => {
    const users = buildSlotUsers(daySessions, dayPayments, slot.id, selectedDate);
    const targets = users.filter((u) => u.amountPaid !== null);
    if (targets.length === 0) return;
    setModalPayEdit(null);
    setBulkSavingSlotId(slot.id);
    inc();
    try {
      let updated = [...dayPayments];
      for (const u of targets) {
        const commissionPct = u.commissionPct ?? settings.commissionPct;
        updated = upsertPayment(updated, {
          id: u.paymentId,
          contact: u.contact,
          slotId: slot.id,
          slotName: slot.name,
          date: selectedDate,
          amountPaid: null,
          commissionPct,
        });
      }
      const saves = targets.map((u) => updated.find((p) => p.id === u.paymentId)!);
      await Promise.all(saves.map((p) => savePaymentDoc(p)));
      setDayPayments(updated);
      putDayDataCache(selectedDate, daySessions, updated);
      toast.success(
        `Reset ${targets.length} payment${targets.length === 1 ? "" : "s"} — ${slot.name} cleared for this day.`
      );
    } catch (err) {
      toastApiError(err, "Could not reset payments. Try again.");
    } finally {
      dec();
      setBulkSavingSlotId(null);
    }
  };

  // ── Winning number ─────────────────────────────────────────────────────────

  const handleSaveWinNumber = async (slot: GameSlot) => {
    const draft = (winDraft.get(slot.id) ?? "").trim();
    if (!draft) return;
    setWinSaving((s) => new Set(s).add(slot.id));
    const id = `${slot.id}|${selectedDate}`;
    const result: GameResult = {
      id,
      slotId: slot.id,
      slotName: slot.name,
      date: selectedDate,
      dateISO: toDateISO(selectedDate),
      winningNumber: draft,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await saveGameResult(result);
      setGameResults((prev) => new Map(prev).set(slot.id, draft));
      setWinDraft((prev) => {
        const n = new Map(prev);
        n.delete(slot.id);
        return n;
      });
      toast.success(`Winning number ${draft} saved for ${slot.name}.`);
    } catch (err) {
      toastApiError(err, "Could not save winning number. Try again.");
    } finally {
      setWinSaving((s) => {
        const n = new Set(s);
        n.delete(slot.id);
        return n;
      });
    }
  };

  const handleClearWinNumber = async (slot: GameSlot) => {
    const id = `${slot.id}|${selectedDate}`;
    const result: GameResult = {
      id,
      slotId: slot.id,
      slotName: slot.name,
      date: selectedDate,
      dateISO: toDateISO(selectedDate),
      winningNumber: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await saveGameResult(result);
      setGameResults((prev) => {
        const n = new Map(prev);
        n.delete(slot.id);
        return n;
      });
      setWinDraft((prev) => {
        const n = new Map(prev);
        n.delete(slot.id);
        return n;
      });
    } catch (err) {
      toastApiError(err, "Could not clear winning number. Try again.");
    }
  };

  // ── Bet breakdown / session management ─────────────────────────────────────

  const closeUserModal = () => {
    setUserModal(null);
    setModalPayEdit(null);
    setModalBetRowSel(new Set());
    setModalBetsOpen(false);
    setModalConfirmDelete(false);
    setModalConfirmRowDelete(null);
  };

  const handleResultChange = async (sessionId: string, slotKey: string, result: CalculationResult) => {
    const updated = daySessions.map((s) => {
      if (s.id !== sessionId) return s;
      const { overrideResult: _legacy, ...rest } = s;
      return { ...rest, slotOverrides: { ...rest.slotOverrides, [slotKey]: result } };
    });
    setDaySessions(updated);
    putDayDataCache(selectedDate, updated, dayPayments);
    const target = updated.find((s) => s.id === sessionId);
    if (target) {
      try {
        await saveSessionDoc(target);
      } catch (err) {
        toastApiError(err, "Could not save your change to the database.");
      }
    }
  };

  const pruneResultsByIndices = (result: CalculationResult, remove: Set<number>): CalculationResult => {
    const results = result.results.filter((_, i) => !remove.has(i));
    return {
      results,
      total: results.reduce((s, r) => s + r.lineTotal, 0),
      ...(result.failedLines?.length ? { failedLines: result.failedLines } : {}),
    };
  };

  const applyMultiRowDelete = async () => {
    if (!modalConfirmRowDelete) return;
    const { sessionId, slotKey, indices } = modalConfirmRowDelete;
    const session = daySessions.find((s) => s.id === sessionId);
    setModalConfirmRowDelete(null);
    if (!session) { setModalBetRowSel(new Set()); return; }
    const ledger = sessionLedgerForSlotKey(session, slotKey);
    if (!ledger) { setModalBetRowSel(new Set()); return; }
    const newResult = pruneResultsByIndices(ledger, new Set(indices));
    setModalBetRowSel(new Set());
    await handleResultChange(sessionId, slotKey, newResult);
  };

  const deleteSession = async (id: string) => {
    const session = daySessions.find((s) => s.id === id);
    try {
      await deleteSessionDoc(id);
      if (session) await deletePaymentsByContactDate(session.contact, session.date);
    } catch (err) {
      toastApiError(err, "Delete failed. Please check your internet connection and try again.");
      return;
    }
    const remaining = daySessions.filter((s) => s.id !== id);
    const nextPayments = dayPayments.filter((p) => !(session && p.contact === session.contact));
    setDaySessions(remaining);
    setDayPayments(nextPayments);
    putDayDataCache(selectedDate, remaining, nextPayments);
    closeUserModal();
    toast.success("Entry deleted.");
  };

  const handleClearAllDay = async () => {
    try {
      await Promise.all(
        daySessions.map((s) =>
          Promise.all([deleteSessionDoc(s.id), deletePaymentsByContactDate(s.contact, s.date)])
        )
      );
    } catch (err) {
      toastApiError(err, "Clear all failed. Please check your internet connection and try again.");
      setConfirmClearAll(false);
      return;
    }
    setDaySessions([]);
    setDayPayments([]);
    putDayDataCache(selectedDate, [], []);
    setConfirmClearAll(false);
    toast.success("All entries cleared.");
  };

  const toggleSlot = (id: string) =>
    setOpenSlots((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // ── Month navigation ───────────────────────────────────────────────────────

  const shiftCal = (delta: number) => {
    setCal((prev) => {
      let m = prev.month + delta, y = prev.year;
      if (m > 12) { m = 1; y++; }
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    });
  };

  const shiftMonth = (delta: number) => {
    setMonthYear((prev) => {
      let m = prev.month + delta,
        y = prev.year;
      if (m > 12) {
        m = 1;
        y++;
      }
      if (m < 1) {
        m = 12;
        y--;
      }
      return { year: y, month: m };
    });
  };

  const canGoNextMonth =
    monthYear.year < nowDate.getFullYear() ||
    (monthYear.year === nowDate.getFullYear() &&
      monthYear.month < nowDate.getMonth() + 1);

  const {
    totalBets,
    received: dayReceived,
    pending: dayPending,
    myEarning: dayEarning,
  } = daySummary();
  const {
    days: monthDays,
    totalBets: monthBets,
    totalReceived: monthReceived,
    totalEarned: monthEarned,
    totalPending: monthPending,
  } = buildMonthData(
    monthSessions,
    monthPayments,
    settings.commissionPct,
    monthYear.year,
    monthYear.month
  );

  return (
    <div className="w-full max-w-[640px] mx-auto">
      {/* View toggle */}
      <div className="flex bg-white rounded-[16px] border-2 border-[#e4edf8] p-1 mb-5 shadow-sm">
        {(["daily", "monthly"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`flex-1 py-3 text-[16px] font-bold rounded-[12px] transition-colors ${
              viewMode === mode
                ? "bg-[#1d6fb8] text-white shadow-sm"
                : "text-gray-400"
            }`}
          >
            {mode === "daily" ? "📅 Daily View" : "📊 Monthly View"}
          </button>
        ))}
      </div>

      {/* ══════════ DAILY VIEW ══════════ */}
      {viewMode === "daily" && (
        <>
          {/* Calendar card */}
          <Card className="mb-4" overflow="hidden" padding="none">
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#f0f4f8] bg-[#f8faff]">
              <button
                onClick={() => shiftCal(-1)}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors"
              >
                ‹
              </button>
              <div className="text-[16px] font-extrabold text-[#1a1a1a]">
                {MONTH_NAMES[cal.month - 1]} {cal.year}
              </div>
              <button
                onClick={() => shiftCal(1)}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 px-3 pt-2.5">
              {DAY_LABELS.map((d) => (
                <div key={d} className="text-center text-[11px] font-bold text-gray-400 pb-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
              {buildCalendarCells(cal.year, cal.month).map((day, i) => {
                if (!day) return <div key={i} />;
                const dateStr = makeDateStr(cal.year, cal.month, day);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const hasData = activeDates.has(dateStr);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`relative flex flex-col items-center justify-center mx-auto w-9 h-9 rounded-[10px] text-[14px] font-bold transition-colors ${
                      isSelected
                        ? "bg-[#1d6fb8] text-white shadow-sm"
                        : isToday
                        ? "bg-[#dceeff] text-[#1d6fb8] ring-2 ring-[#1d6fb8]"
                        : "hover:bg-[#f0f6ff] text-[#1a1a1a] active:bg-[#e4eeff]"
                    }`}
                  >
                    {day}
                    {hasData && (
                      <span
                        className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${
                          isSelected ? "bg-white/70" : "bg-[#1d6fb8]"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-4 px-4 pb-3 text-[11px] text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#1d6fb8] inline-block" /> Has entries
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-4 rounded-[6px] bg-[#dceeff] ring-2 ring-[#1d6fb8]" /> Today
              </span>
            </div>
          </Card>

          {daySessions.length === 0 && dayLoading ? (
            /* Skeleton on first load only — no stale data to show yet */
            <SkeletonSlotCards />
          ) : (
            <>
              {/* Clear All button — only when there are entries */}
              {daySessions.length > 0 && (
                <div className="flex justify-end mb-3">
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-[12px] text-red-500 hover:text-red-700 font-semibold border border-red-200 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    🗑 Clear All Entries
                  </button>
                </div>
              )}
              {/* Earnings card */}
              {dayEarning > 0 && (
                <div className="bg-[#1a3a5c] rounded-[20px] px-5 py-5 mb-4 shadow-[0_6px_28px_rgba(26,58,92,0.30)] flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-bold text-white/60 uppercase tracking-widest mb-1">
                      💰 My Earnings — {displayDate(selectedDate)}
                    </div>
                    <div className="text-[48px] font-extrabold text-white leading-none">
                      ₹{dayEarning}
                    </div>
                    <div className="text-[14px] text-white/60 mt-1">
                      Commission of ₹{dayReceived} received
                    </div>
                  </div>
                  <div className="text-[52px] leading-none opacity-20">💵</div>
                </div>
              )}

              {/* Day summary */}
              {(totalBets > 0 || dayReceived > 0) && (
                <div className="bg-[#1d6fb8] rounded-[20px] px-5 py-4 mb-4 shadow-[0_4px_20px_rgba(29,111,184,0.25)]">
                  <div className="text-[12px] font-bold text-white/60 uppercase tracking-widest mb-3 text-center">
                    Day Summary
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Total Game", value: totalBets },
                      { label: "I Received", value: dayReceived },
                      {
                        label: "Pending",
                        value: Math.max(0, dayPending),
                        warn: dayPending > 0,
                      },
                    ].map(({ label, value, warn }) => (
                      <div
                        key={label}
                        className={`rounded-[14px] px-2 py-3 text-center ${
                          warn
                            ? "bg-orange-400/25 ring-1 ring-orange-200/40"
                            : "bg-white/15"
                        }`}
                      >
                        <div className="text-[11px] text-white/70 font-semibold mb-1 leading-tight">
                          {label}
                        </div>
                        <div
                          className={`text-[20px] font-extrabold leading-none ${
                            warn ? "text-amber-100" : "text-white"
                          }`}
                        >
                          ₹{value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slot cards */}
              <div className="space-y-4">
                {enabledSlots.map((slot) => {
                  const status = getSlotStatus(slot, activeSlotId, isToday);
                  const users = slotUsers(slot.id);
                  const summary = slotSummary(slot.id);
                  const isOpen = openSlots.has(slot.id);
                  const { badge, label: statusLabel } = STATUS_STYLE[status];
                  const savedWinNum = gameResults.get(slot.id) ?? "";
                  const winnerCount = savedWinNum
                    ? users.filter(
                        (u) => getWinningSegments(u.segments, savedWinNum).length > 0
                      ).length
                    : 0;

                  return (
                    <Card
                      key={slot.id}
                      overflow="hidden"
                      padding="none"
                    >
                      <button
                        onClick={() => toggleSlot(slot.id)}
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#f5f9ff] active:bg-[#eef4ff] transition-colors text-left"
                      >
                        <span className="text-[32px] leading-none shrink-0">
                          {slot.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[19px] font-extrabold text-[#1a1a1a] leading-tight">
                            {slot.name} Game
                          </div>
                          <div className="text-[13px] text-gray-500 mt-0.5">
                            Result at {formatSlotTime(slot.time)}
                          </div>
                          {summary.count > 0 ? (
                            <div className="text-[13px] text-gray-400 mt-1 space-y-0.5">
                              <div>
                                {summary.count}{" "}
                                {summary.count === 1 ? "person" : "people"} ·
                                Received{" "}
                                <span className="font-bold text-[#1d6fb8]">
                                  ₹{summary.received}
                                </span>{" "}
                                of ₹{summary.totalBets}
                              </div>
                              {summary.pending === 0 &&
                                summary.totalBets > 0 && (
                                  <div className="text-[12px] font-semibold text-green-600">
                                    No pending
                                  </div>
                                )}
                              {summary.pending < 0 && (
                                <div className="text-[12px] font-semibold text-blue-700">
                                  Overpaid ₹{Math.abs(summary.pending)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-[13px] text-gray-300 mt-0.5">
                              No entries yet
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {isToday && (
                            <span
                              className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${badge}`}
                            >
                              {statusLabel}
                            </span>
                          )}
                          {summary.count > 0 && summary.pending > 0 && (
                            <span className="text-[12px] font-bold text-orange-800 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full tabular-nums">
                              Pending ₹{summary.pending}
                            </span>
                          )}
                          {summary.myEarning > 0 && (
                            <span className="text-[12px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                              +₹{summary.myEarning}
                            </span>
                          )}
                          <span className="text-[#1d6fb8] text-[18px] font-bold mt-1">
                            {isOpen ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t-2 border-[#eef2f8]">
                          {/* Compact winning number row */}
                          <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f4f8]">
                            <span className="text-[13px] font-bold text-gray-500">🏆 Result</span>
                            {savedWinNum ? (
                              <button
                                onClick={() => setWinNumModal(slot.id)}
                                className="flex items-center gap-2"
                              >
                                <span className="text-[22px] font-extrabold text-amber-700 leading-none">
                                  {savedWinNum}
                                </span>
                                {winnerCount > 0 ? (
                                  <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                                    🎉 {winnerCount}W
                                  </span>
                                ) : users.length > 0 ? (
                                  <span className="text-[11px] text-gray-400">No winners</span>
                                ) : null}
                                <span className="text-[11px] text-[#1d6fb8] underline ml-1">Edit</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => setWinNumModal(slot.id)}
                                className="text-[13px] font-bold text-[#1d6fb8]"
                              >
                                + Add result
                              </button>
                            )}
                          </div>

                          {users.length === 0 ? (
                            <div className="px-5 py-8 text-center">
                              <div className="text-[32px] mb-2">📭</div>
                              <div className="text-[16px] font-semibold text-gray-400">
                                No one sent numbers for this game yet.
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Bulk action buttons */}
                              {(summary.pending !== 0 ||
                                users.some((u) => u.amountPaid !== null)) && (
                                <div className="px-4 pt-3 pb-1">
                                  <div
                                    className={`grid gap-2 ${
                                      summary.pending !== 0 &&
                                      users.some((u) => u.amountPaid !== null)
                                        ? "grid-cols-2"
                                        : "grid-cols-1"
                                    }`}
                                  >
                                    {summary.pending !== 0 && (
                                      <button
                                        type="button"
                                        disabled={
                                          bulkSavingSlotId === slot.id || dayLoading
                                        }
                                        onClick={() =>
                                          setConfirmState({
                                            title: `Mark all fully paid — ${slot.name}`,
                                            message:
                                              `Date: ${selectedDate}\n\n` +
                                              `"Received" will be set to each person's game total.`,
                                            confirmLabel: "Yes, Mark Fully Paid",
                                            run: () => {
                                              void markAllFullyPaidForSlot(slot);
                                            },
                                          })
                                        }
                                        className="w-full py-2.5 rounded-[12px] text-[13px] font-bold border-2 border-green-600 text-green-800 bg-green-50 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {bulkSavingSlotId === slot.id
                                          ? "Saving…"
                                          : "✓ Mark all full paid"}
                                      </button>
                                    )}
                                    {users.some((u) => u.amountPaid !== null) && (
                                      <button
                                        type="button"
                                        disabled={
                                          bulkSavingSlotId === slot.id || dayLoading
                                        }
                                        onClick={() =>
                                          setConfirmState({
                                            title: `Reset payments — ${slot.name}`,
                                            message:
                                              `Date: ${selectedDate}\n\n` +
                                              `All recorded received amounts for this game will be cleared back to blank.`,
                                            confirmLabel: "Yes, Reset",
                                            danger: true,
                                            run: () => {
                                              void resetPaymentsForSlot(slot);
                                            },
                                          })
                                        }
                                        className="w-full py-2.5 rounded-[12px] text-[13px] font-bold border-2 border-rose-300 text-rose-800 bg-rose-50 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {bulkSavingSlotId === slot.id
                                          ? "Saving…"
                                          : "↺ Clear all received"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Compact user list */}
                              <div className="divide-y divide-[#f5f7fb]">
                                {users.map((user) => {
                                  const isWinner = savedWinNum
                                    ? getWinningSegments(user.segments, savedWinNum).length > 0
                                    : false;
                                  const pending =
                                    user.betTotal - (user.amountPaid ?? 0);
                                  const notRecorded = user.amountPaid === null;
                                  const fullyPaid = !notRecorded && pending === 0;
                                  const hasDebt = !notRecorded && pending > 0;
                                  const overpaid = !notRecorded && pending < 0;
                                  return (
                                    <div
                                      key={user.contact}
                                      className="group relative flex items-center hover:bg-[#f5f9ff] active:bg-[#eef4ff] transition-colors"
                                    >
                                      {/* Main tap area — opens detail modal */}
                                      <button
                                        onClick={() => {
                                          setModalPayEdit(null);
                                          setModalBetRowSel(new Set());
                                          setModalBetsOpen(false);
                                          setUserModal({ slot, user });
                                        }}
                                        className="flex-1 flex items-center gap-3 px-4 py-3.5 text-left min-w-0 pr-10"
                                      >
                                        <div
                                          className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-extrabold shrink-0 ${
                                            isWinner
                                              ? "bg-amber-100 text-amber-700"
                                              : "bg-[#e8f0fc] text-[#1d6fb8]"
                                          }`}
                                        >
                                          {user.contact[0]?.toUpperCase() ?? "?"}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[15px] font-extrabold text-[#1a1a1a] truncate leading-tight">
                                            {isWinner && "🏆 "}
                                            {user.contact}
                                          </div>
                                          <div className="text-[12px] text-gray-400 mt-0.5">
                                            {user.slotLedger.results.length} bet
                                            {user.slotLedger.results.length !== 1
                                              ? "s"
                                              : ""}{" "}
                                            · ₹{user.betTotal}
                                          </div>
                                        </div>
                                        <span
                                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                                            notRecorded
                                              ? "bg-gray-100 text-gray-500"
                                              : fullyPaid
                                              ? "bg-green-100 text-green-700"
                                              : hasDebt
                                              ? "bg-orange-100 text-orange-700"
                                              : overpaid
                                              ? "bg-blue-100 text-blue-700"
                                              : ""
                                          }`}
                                        >
                                          {notRecorded
                                            ? "Not recorded"
                                            : fullyPaid
                                            ? "Paid ✓"
                                            : hasDebt
                                            ? `Owes ₹${pending}`
                                            : `Extra ₹${Math.abs(pending)}`}
                                        </span>
                                        <span className="text-gray-300 text-[18px] shrink-0 group-hover:opacity-0 transition-opacity">
                                          ›
                                        </span>
                                      </button>
                                      {/* Delete icon — visible on hover */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDirectDeleteSessionId(user.sessionId);
                                        }}
                                        className="absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-100 text-gray-300 hover:text-red-500 text-[16px]"
                                        title="Delete entry"
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Slot totals footer */}
                              <div className="border-t-2 border-[#eef2f8] bg-[#f8faff] px-5 py-4 space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[14px] font-semibold text-gray-500">
                                    Game Total
                                  </span>
                                  <span className="text-[17px] font-extrabold text-gray-700">
                                    ₹{summary.totalBets}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[14px] font-semibold text-gray-500">
                                    I Received
                                  </span>
                                  <span className="text-[17px] font-extrabold text-[#1d6fb8]">
                                    ₹{summary.received}
                                  </span>
                                </div>
                                {summary.pending > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-[14px] font-semibold text-orange-600">
                                      Still Pending
                                    </span>
                                    <span className="text-[17px] font-extrabold text-orange-600">
                                      ₹{summary.pending}
                                    </span>
                                  </div>
                                )}
                                {summary.pending < 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-[14px] font-semibold text-blue-700">
                                      Overpaid
                                    </span>
                                    <span className="text-[17px] font-extrabold text-blue-700">
                                      ₹{Math.abs(summary.pending)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {summary.received > 0 && (
                                <div className="bg-green-50 border-t-2 border-green-100 px-5 py-3.5 flex items-center justify-between">
                                  <div>
                                    <div className="text-[14px] font-extrabold text-green-700">
                                      💰 My Earnings
                                    </div>
                                    <div className="text-[12px] text-green-600">
                                      Commission of ₹{summary.received} received
                                    </div>
                                  </div>
                                  <span className="text-[22px] font-extrabold text-green-700">
                                    ₹{summary.myEarning}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>

              {enabledSlots.length === 0 && (
                <div className="text-center text-gray-400 mt-16">
                  <div className="text-[40px] mb-3">⚙️</div>
                  <div className="text-[16px] font-semibold">
                    No games set up yet.
                  </div>
                  <div className="text-[14px] mt-1">
                    Go to Settings to add games.
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════ MONTHLY VIEW ══════════ */}
      {viewMode === "monthly" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => shiftMonth(-1)}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white border-2 border-[#dde8f8] text-[#1d6fb8] font-bold shadow-sm active:bg-[#e8f0fc] text-3xl"
            >
              ‹
            </button>
            <div className="text-center">
              <div className="text-[22px] font-extrabold text-[#1a1a1a]">
                {MONTH_NAMES[monthYear.month - 1]}
              </div>
              <div className="text-[14px] text-gray-400">{monthYear.year}</div>
            </div>
            <button
              onClick={() => {
                if (canGoNextMonth) shiftMonth(1);
              }}
              disabled={!canGoNextMonth}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl border-2 font-bold shadow-sm text-3xl ${
                canGoNextMonth
                  ? "bg-white border-[#dde8f8] text-[#1d6fb8] active:bg-[#e8f0fc]"
                  : "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
              }`}
            >
              ›
            </button>
          </div>

          {monthSessions.length === 0 && monthLoading ? (
            <SkeletonSlotCards />
          ) : (
            <>
              <div
                className={`rounded-[22px] px-6 py-6 mb-5 font-sans border ${
                  monthEarned > 0
                    ? "bg-linear-to-br from-[#1b4a77] via-[#1d6fb8] to-[#245487] border-[#2f6ea6] shadow-[0_8px_28px_rgba(29,111,184,0.35)]"
                    : "bg-linear-to-br from-[#f7fbff] via-[#eef6ff] to-[#e8f2ff] border-[#d5e6fa] shadow-[0_6px_18px_rgba(128,162,200,0.22)]"
                }`}
              >
                <div
                  className={`text-[12px] font-semibold uppercase tracking-[0.18em] mb-1 ${
                    monthEarned > 0 ? "text-white/80" : "text-[#4f6b88]"
                  }`}
                >
                  💰 My Earnings — {MONTH_NAMES[monthYear.month - 1]}{" "}
                  {monthYear.year}
                </div>
                <div
                  className={`text-[52px] font-black leading-none mb-1 ${
                    monthEarned > 0 ? "text-white" : "text-[#1e3c5f]"
                  }`}
                >
                  ₹{monthEarned}
                </div>
                {monthReceived > 0 && (
                  <div
                    className={`text-[14px] ${
                      monthEarned > 0 ? "text-white/80" : "text-[#4f6b88]"
                    }`}
                  >
                    Commission of ₹{monthReceived} total received
                  </div>
                )}

                {monthBets > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                    {[
                      { label: "Total Game", value: `₹${monthBets}` },
                      { label: "Received", value: `₹${monthReceived}` },
                      { label: "My Earning", value: `₹${monthEarned}` },
                      {
                        label: "Pending",
                        value: `₹${monthPending}`,
                        warn: monthPending > 0,
                      },
                    ].map(({ label, value, warn }) => (
                      <div
                        key={label}
                        className={`rounded-[14px] px-2 py-3 text-center ${
                          warn && !monthEarned
                            ? "bg-orange-100/90 border border-orange-200 sm:bg-white/80 sm:border-[#d9e7f8]"
                            : monthEarned > 0
                            ? warn
                              ? "bg-orange-400/25 ring-1 ring-orange-200/50"
                              : "bg-white/15"
                            : "bg-white/80 border border-[#d9e7f8]"
                        }`}
                      >
                        <div
                          className={`text-[10px] font-semibold mb-1 uppercase tracking-wide ${
                            monthEarned > 0 ? "text-white/75" : "text-[#4f6b88]"
                          }`}
                        >
                          {label}
                        </div>
                        <div
                          className={`text-[16px] sm:text-[18px] font-black leading-none ${
                            monthEarned > 0
                              ? warn
                                ? "text-amber-100"
                                : "text-white"
                              : warn
                              ? "text-orange-700"
                              : "text-[#1e3c5f]"
                          }`}
                        >
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {monthDays.length > 0 && (
                  <div
                    className={`text-[12px] mt-3 font-semibold ${
                      monthEarned > 0 ? "text-white/70" : "text-[#6b7f96]"
                    }`}
                  >
                    {monthDays.length} {monthDays.length === 1 ? "day" : "days"}{" "}
                    with activity
                  </div>
                )}
              </div>

              {monthDays.length === 0 ? (
                <Card
                  padding="none"
                  className="px-5 py-12 text-center"
                >
                  <div className="text-[40px] mb-3">📭</div>
                  <div className="text-[17px] font-bold text-gray-400">
                    No payments recorded
                  </div>
                  <div className="text-[14px] text-gray-400 mt-1">
                    for {MONTH_NAMES[monthYear.month - 1]} {monthYear.year}
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {monthDays.map((day) => (
                    <button
                      key={day.date}
                      onClick={() => {
                        setSelectedDate(day.date);
                        setViewMode("daily");
                      }}
                      className="w-full bg-white rounded-[18px] border-2 border-[#e4edf8] px-4 py-4 shadow-sm hover:border-[#c5d8f0] active:bg-[#f0f6ff] transition-colors text-left"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-[18px] font-extrabold text-[#1a1a1a]">
                            {parseDate(day.date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                          <span className="text-[13px] text-gray-400 ml-2">
                            {parseDate(day.date).toLocaleDateString("en-IN", {
                              weekday: "long",
                            })}
                          </span>
                        </div>
                        <span className="text-[#1d6fb8] text-[13px] font-bold">
                          View ›
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-gray-50 rounded-[12px] px-2 py-2.5 text-center border border-gray-100">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            Total Game
                          </div>
                          <div className="text-[16px] sm:text-[17px] font-extrabold text-[#1a1a1a] leading-none">
                            ₹{day.totalBets}
                          </div>
                        </div>
                        <div className="bg-[#f0f6ff] rounded-[12px] px-2 py-2.5 text-center">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            Received
                          </div>
                          <div className="text-[16px] sm:text-[17px] font-extrabold text-[#1d6fb8] leading-none">
                            ₹{day.received}
                          </div>
                        </div>
                        <div className="bg-green-50 rounded-[12px] px-2 py-2.5 text-center">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            My Earning
                          </div>
                          <div className="text-[16px] sm:text-[17px] font-extrabold text-green-700 leading-none">
                            ₹{day.earned}
                          </div>
                        </div>
                        <div
                          className={`rounded-[12px] px-2 py-2.5 text-center ${
                            day.pending > 0 ? "bg-orange-50" : "bg-gray-50"
                          }`}
                        >
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            Pending
                          </div>
                          <div
                            className={`text-[16px] sm:text-[17px] font-extrabold leading-none ${
                              day.pending > 0
                                ? "text-orange-600"
                                : "text-gray-400"
                            }`}
                          >
                            ₹{day.pending}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        danger={confirmState?.danger ?? false}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          const cfg = confirmState;
          if (!cfg) return;
          setConfirmState(null);
          cfg.run();
        }}
      />

      {/* ── Row hover — direct delete dialog ────────────────────────────── */}
      <DangerActionDialog
        open={directDeleteSessionId !== null}
        onClose={() => setDirectDeleteSessionId(null)}
        onConfirm={() => {
          if (directDeleteSessionId) void deleteSession(directDeleteSessionId);
          setDirectDeleteSessionId(null);
        }}
        titleId="gv-direct-delete-title"
        title="Delete this entry?"
        message={
          <p className="text-[13px] text-red-600 leading-snug">
            This will also remove their payment record for this day.
          </p>
        }
        confirmLabel="Yes, Delete"
      />

      {/* ── Clear All Danger Dialog ───────────────────────────────────────── */}
      <DangerActionDialog
        open={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        onConfirm={() => void handleClearAllDay()}
        titleId="gv-clear-all-title"
        title="Delete ALL entries for this day?"
        message={null}
        confirmLabel="Yes, Delete All"
      />

      {/* ── User Detail Bottom Sheet ─────────────────────────────────────────── */}
      <Modal
        open={userModal !== null}
        onBackdropClick={closeUserModal}
        overlayClassName="p-0 items-end sm:items-center sm:p-4"
      >
        {userModal &&
          (() => {
            const liveUser =
              slotUsers(userModal.slot.id).find(
                (u) => u.contact === userModal.user.contact
              ) ?? userModal.user;
            const { slot } = userModal;
            const pending = liveUser.betTotal - (liveUser.amountPaid ?? 0);
            const notRecorded = liveUser.amountPaid === null;
            const fullyPaid = !notRecorded && pending === 0;
            const hasDebt = !notRecorded && pending > 0;
            const overpaid = !notRecorded && pending < 0;
            const effectivePct = liveUser.commissionPct ?? settings.commissionPct;
            const isEditing = modalPayEdit?.id === liveUser.paymentId;
            const savedWinNum = gameResults.get(slot.id) ?? "";
            const winningMatches = savedWinNum
              ? getWinningSegments(liveUser.segments, savedWinNum)
              : [];
            const isWinner = winningMatches.length > 0;
            const filteredSel = new Set(
              [...modalBetRowSel].filter(
                (i) => i >= 0 && i < liveUser.slotLedger.results.length
              )
            );
            return (
              <div
                className="w-full max-w-[520px] bg-white rounded-t-[24px] sm:rounded-[24px] max-h-[92vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle bar for mobile */}
                <div className="flex justify-center pt-3 pb-1 sm:hidden">
                  <div className="w-10 h-1 rounded-full bg-gray-200" />
                </div>

                {/* Header */}
                <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-100">
                  <div>
                    <div className="text-[20px] font-extrabold text-[#1a1a1a] leading-tight">
                      {isWinner && "🏆 "}
                      {liveUser.contact}
                    </div>
                    <div className="text-[13px] text-gray-400 mt-0.5">
                      {slot.emoji} {slot.name} · {selectedDate}
                    </div>
                  </div>
                  <button
                    onClick={closeUserModal}
                    className="mt-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-[18px] transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Winner banner */}
                {isWinner && (
                  <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-[16px] p-3">
                    <div className="text-[13px] font-extrabold text-amber-800 mb-2">
                      🎉 Winner! Winning bets:
                    </div>
                    <div className="space-y-1">
                      {winningMatches.map(({ seg, matchedNumber, isUlta }, wi) => (
                        <div key={wi} className="text-[12px] text-amber-900">
                          <span className="font-bold">{seg.line}</span>
                          {" @ ₹"}
                          {seg.rate}
                          {isUlta && (
                            <span className="ml-1 text-amber-700 font-semibold">
                              (ulta {matchedNumber})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bets accordion */}
                <div className="px-5 pt-3 pb-2">
                  <button
                    onClick={() => setModalBetsOpen((v) => !v)}
                    className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded-[14px] px-4 py-3 text-left hover:bg-[#f0f6ff] active:bg-[#e8f0fc] transition-colors"
                  >
                    <span className="text-[14px] font-extrabold text-gray-700">
                      Bets ·{" "}
                      {liveUser.slotLedger.results.length} line
                      {liveUser.slotLedger.results.length !== 1 ? "s" : ""} · ₹
                      {liveUser.betTotal}
                    </span>
                    <span className="text-[12px] font-bold text-[#1d6fb8]">
                      {modalBetsOpen ? "▲ Hide" : "▼ Show"}
                    </span>
                  </button>

                  {modalBetsOpen && (
                    <div className="mt-2">
                      {filteredSel.size > 0 && (
                        <div className="flex justify-end mb-2">
                          <button
                            onClick={() =>
                              setModalConfirmRowDelete({
                                sessionId: liveUser.sessionId,
                                slotKey: slot.id,
                                indices: [...filteredSel].sort((a, b) => a - b),
                              })
                            }
                            className="text-[12px] font-bold text-white bg-red-500 px-2.5 py-1 rounded-[8px]"
                          >
                            Delete {filteredSel.size}
                          </button>
                        </div>
                      )}
                      <div className="bg-gray-50 border border-gray-100 rounded-[14px] px-3 py-3">
                        <EditableBreakdown
                          compact
                          confirmRowDelete
                          result={liveUser.slotLedger}
                          rowSelection={{
                            selectedIndices: filteredSel,
                            onToggleRowSelect: (idx) =>
                              setModalBetRowSel((prev) => {
                                const n = new Set(prev);
                                n.has(idx) ? n.delete(idx) : n.add(idx);
                                return n;
                              }),
                          }}
                          onChange={(r) => {
                            setModalBetRowSel(new Set());
                            void handleResultChange(liveUser.sessionId, slot.id, r);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100 mx-5 my-2" />

                {/* Payment section */}
                <div className="px-5 pt-3 pb-4">
                  <div className="text-[14px] font-extrabold text-gray-700 mb-3">
                    Payment
                  </div>
                  {isEditing ? (
                    <div className="bg-[#f0f6ff] border-2 border-[#1d6fb8] rounded-[14px] p-4">
                      <div className="text-[14px] font-semibold text-gray-600 mb-2">
                        How much did you receive? (₹)
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={modalPayEdit!.value}
                        onChange={(e) =>
                          setModalPayEdit((s) =>
                            s ? { ...s, value: e.target.value } : s
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            void saveEdit(
                              liveUser.paymentId,
                              liveUser.contact,
                              slot.id,
                              slot.name
                            );
                          if (e.key === "Escape") setModalPayEdit(null);
                        }}
                        autoFocus
                        placeholder={String(liveUser.betTotal)}
                        className="w-full text-[26px] font-extrabold text-center border-2 border-[#1d6fb8] rounded-[12px] px-4 py-3 outline-none mb-3 bg-white"
                      />
                      <button
                        onClick={() =>
                          setModalPayEdit((s) =>
                            s ? { ...s, showPct: !s.showPct } : s
                          )
                        }
                        className="text-[12px] text-gray-400 underline mb-2 block"
                      >
                        {modalPayEdit!.showPct ? "▲ Hide" : "▼ Change"} commission
                        % (currently {modalPayEdit!.pct}%)
                      </button>
                      {modalPayEdit!.showPct && (
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="0.5"
                            value={modalPayEdit!.pct}
                            onChange={(e) =>
                              setModalPayEdit((s) =>
                                s ? { ...s, pct: e.target.value } : s
                              )
                            }
                            className="w-24 text-center text-[18px] font-bold border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[10px] px-2 py-2 outline-none"
                          />
                          <span className="text-[16px] font-bold text-gray-500">
                            %
                          </span>
                          <span className="text-[12px] text-gray-400">
                            for this payment only
                          </span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            void saveEdit(
                              liveUser.paymentId,
                              liveUser.contact,
                              slot.id,
                              slot.name
                            )
                          }
                          className="flex-1 py-2.5 bg-green-600 text-white text-[14px] font-bold rounded-[10px] active:opacity-80"
                        >
                          ✓ Save
                        </button>
                        <button
                          onClick={() => setModalPayEdit(null)}
                          className="px-4 py-2.5 bg-gray-100 text-gray-500 text-[14px] font-semibold rounded-[10px] active:opacity-80"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : notRecorded ? (
                    <div className="rounded-[14px] border-2 border-[#dfe8f8] bg-[#f8fbff] p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() =>
                            startEdit(
                              liveUser.paymentId,
                              null,
                              liveUser.commissionPct
                            )
                          }
                          className="py-2.5 bg-[#1d6fb8] text-white text-[13px] font-bold rounded-[10px] flex items-center justify-center gap-2 active:opacity-80 shadow-sm"
                        >
                          Enter amount
                        </button>
                        <button
                          onClick={() =>
                            void markUserFullyPaid(
                              liveUser.paymentId,
                              liveUser.contact,
                              slot,
                              liveUser.betTotal,
                              liveUser.commissionPct
                            )
                          }
                          className="py-2.5 bg-indigo-600 text-white text-[13px] font-bold rounded-[10px] flex items-center justify-center gap-2 active:opacity-80 shadow-sm"
                        >
                          Paid fully
                        </button>
                      </div>
                    </div>
                  ) : fullyPaid ? (
                    <div className="flex items-center justify-between bg-green-50 border-2 border-green-200 rounded-[14px] px-4 py-3">
                      <div>
                        <div className="text-[13px] text-gray-500">
                          You received:
                        </div>
                        <div className="text-[22px] font-extrabold text-green-700">
                          ₹{liveUser.amountPaid}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          Commission: {effectivePct}%
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-[13px] font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                          ✅ Fully Paid
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              startEdit(
                                liveUser.paymentId,
                                liveUser.amountPaid,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[12px] text-gray-400 underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              void clearUserReceivedAmount(
                                liveUser.paymentId,
                                liveUser.contact,
                                slot,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[12px] text-rose-600 underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : hasDebt ? (
                    <div className="rounded-[14px] border-2 border-orange-200 overflow-hidden">
                      <div className="flex items-center justify-between bg-orange-50 px-4 py-3">
                        <div>
                          <div className="text-[13px] text-gray-500">
                            You received:
                          </div>
                          <div className="text-[22px] font-extrabold text-[#1d6fb8]">
                            ₹{liveUser.amountPaid}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            Commission: {effectivePct}%
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            onClick={() =>
                              startEdit(
                                liveUser.paymentId,
                                liveUser.amountPaid,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[13px] text-gray-400 underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              void clearUserReceivedAmount(
                                liveUser.paymentId,
                                liveUser.contact,
                                slot,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[12px] text-rose-600 underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="bg-orange-100 px-4 py-2.5 text-center">
                        <span className="text-[15px] font-extrabold text-orange-700">
                          ⚠️ Still Owes: ₹{pending}
                        </span>
                      </div>
                    </div>
                  ) : overpaid ? (
                    <div className="flex items-center justify-between bg-blue-50 border-2 border-blue-200 rounded-[14px] px-4 py-3">
                      <div>
                        <div className="text-[13px] text-gray-500">
                          You received:
                        </div>
                        <div className="text-[22px] font-extrabold text-blue-700">
                          ₹{liveUser.amountPaid}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          Commission: {effectivePct}%
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-[13px] font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">
                          Extra: ₹{Math.abs(pending)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              startEdit(
                                liveUser.paymentId,
                                liveUser.amountPaid,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[12px] text-gray-400 underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              void clearUserReceivedAmount(
                                liveUser.paymentId,
                                liveUser.contact,
                                slot,
                                liveUser.commissionPct
                              )
                            }
                            className="text-[12px] text-rose-600 underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="h-px bg-gray-100 mx-5" />

                {/* Delete entry */}
                <div className="px-5 py-4 pb-6">
                  <button
                    onClick={() => setModalConfirmDelete(true)}
                    className="w-full py-3 text-[14px] font-bold text-red-600 border-2 border-red-100 rounded-[14px] hover:bg-red-50 active:bg-red-100 transition-colors"
                  >
                    🗑 Delete this entry
                  </button>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* ── Winning Number Modal ─────────────────────────────────────────────── */}
      {(() => {
        const wSlot = winNumModal
          ? enabledSlots.find((s) => s.id === winNumModal)
          : null;
        const savedNum = winNumModal ? gameResults.get(winNumModal) ?? "" : "";
        const draft = winNumModal ? winDraft.get(winNumModal) ?? "" : "";
        const isSaving = winNumModal ? winSaving.has(winNumModal) : false;
        return (
          <Modal
            open={winNumModal !== null}
            onBackdropClick={() => setWinNumModal(null)}
          >
            {wSlot && (
              <div
                className="w-full max-w-[320px] bg-white rounded-[24px] p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[18px] font-extrabold text-[#1a1a1a]">
                    {wSlot.emoji} {wSlot.name} — Result
                  </div>
                  <button
                    onClick={() => setWinNumModal(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 text-[16px]"
                  >
                    ✕
                  </button>
                </div>
                {savedNum ? (
                  <>
                    <div className="text-center mb-5">
                      <div className="text-[14px] text-gray-500 mb-1">
                        Winning number
                      </div>
                      <div className="text-[56px] font-extrabold text-amber-700 leading-none">
                        {savedNum}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setWinDraft((p) => new Map(p).set(winNumModal!, savedNum));
                          setGameResults((p) => {
                            const n = new Map(p);
                            n.delete(winNumModal!);
                            return n;
                          });
                        }}
                        className="py-2.5 text-[13px] font-bold border-2 border-amber-400 text-amber-800 rounded-[12px] active:opacity-80"
                      >
                        Change
                      </button>
                      <button
                        onClick={async () => {
                          await handleClearWinNumber(wSlot);
                          setWinNumModal(null);
                        }}
                        className="py-2.5 text-[13px] font-bold border-2 border-rose-300 text-rose-700 rounded-[12px] active:opacity-80"
                      >
                        Clear
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[14px] text-gray-500 mb-4">
                      Enter the 2-digit winning number for this game
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="42"
                        value={draft}
                        onChange={(e) =>
                          setWinDraft((p) =>
                            new Map(p).set(
                              winNumModal!,
                              e.target.value.replace(/\D/g, "")
                            )
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && draft.length > 0) {
                            void handleSaveWinNumber(wSlot).then(() =>
                              setWinNumModal(null)
                            );
                          }
                        }}
                        autoFocus
                        className="w-20 text-center text-[28px] font-extrabold border-2 border-amber-300 focus:border-amber-500 rounded-[12px] px-2 py-2.5 outline-none bg-white"
                      />
                      <button
                        disabled={draft.length === 0 || isSaving}
                        onClick={() =>
                          void handleSaveWinNumber(wSlot).then(() =>
                            setWinNumModal(null)
                          )
                        }
                        className="flex-1 py-2.5 bg-amber-500 disabled:opacity-50 text-white text-[14px] font-bold rounded-[12px] active:opacity-80"
                      >
                        {isSaving ? "Saving…" : "✓ Save"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ── Modal — confirm delete session ───────────────────────────────────── */}
      <DangerActionDialog
        open={modalConfirmDelete}
        onClose={() => setModalConfirmDelete(false)}
        onConfirm={() => {
          if (userModal) void deleteSession(userModal.user.sessionId);
          setModalConfirmDelete(false);
        }}
        titleId="gv-delete-entry-title"
        title="Delete this entry?"
        message={
          <p className="text-[13px] text-red-600 leading-snug">
            This will also remove their payment record for this day.
          </p>
        }
        confirmLabel="Yes, Delete"
      />

      {/* ── Modal — confirm delete selected bet lines ─────────────────────── */}
      <DangerActionDialog
        open={modalConfirmRowDelete !== null}
        onClose={() => setModalConfirmRowDelete(null)}
        onConfirm={() => void applyMultiRowDelete()}
        titleId="gv-multi-row-title"
        title={
          modalConfirmRowDelete
            ? `Delete ${modalConfirmRowDelete.indices.length} selected line${modalConfirmRowDelete.indices.length === 1 ? "" : "s"}?`
            : ""
        }
        message={
          modalConfirmRowDelete ? (
            <p className="text-[13px] text-gray-600 leading-snug">
              Removes the highlighted bet rows for{" "}
              <span className="font-semibold text-[#1a1a1a]">
                {userModal?.user.contact ?? ""}
              </span>
              .
            </p>
          ) : null
        }
        confirmLabel="Yes, Delete"
      />
    </div>
  );
}
