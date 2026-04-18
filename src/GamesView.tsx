import { useState, useEffect, useRef } from "react";
import { toastApiError } from "./apiToast";
import {
  slotMinutes,
  formatSlotTime,
  getCurrentSlot,
  mergeSessionLedgerResult,
  sessionLedgerForSlotKey,
  upsertPayment,
} from "./calcUtils";
import type {
  SavedSession,
  GameSlot,
  AppSettings,
  PaymentRecord,
} from "./types";
import { useLoadingSignal } from "./TopProgressBar";

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

// ─── Component ────────────────────────────────────────────────────────────────

type ViewMode = "daily" | "monthly";

// State for inline editing: payment amount AND commission %
interface EditState {
  id: string;
  value: string; // amountPaid
  pct: string; // commissionPct
  showPct: boolean; // whether the % editor is expanded
}

function SkeletonSlotCards() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-[20px] border-2 border-[#e4edf8] p-5 shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
              <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
            </div>
          </div>
        </div>
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
}: Props) {
  const { inc, dec } = useLoadingSignal();
  const today = todayStr();
  const nowDate = new Date();

  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [openSlots, setOpenSlots] = useState<Set<string>>(new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [monthYear, setMonthYear] = useState({
    year: nowDate.getFullYear(),
    month: nowDate.getMonth() + 1,
  });

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

  // On mount, auto-jump to the most recent date with data
  useEffect(() => {
    loadSessionDatesForMonth(
      nowDate.getFullYear(),
      nowDate.getMonth() + 1
    ).then((dates) => {
      if (dates.length === 0) return;
      const sorted = [...dates].sort((a, b) => {
        const [ad, am, ay] = a.split("/").map(Number);
        const [bd, bm, by] = b.split("/").map(Number);
        return (
          new Date(by, bm - 1, bd).getTime() -
          new Date(ay, am - 1, ad).getTime()
        );
      });
      setSelectedDate(sorted[0]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    ])
      .then(([s, p]) => {
        if (seq !== daySeqRef.current) return;
        setDaySessions(s);
        setDayPayments(p);
        putDayDataCache(selectedDate, [...s], [...p]);
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
  const isFuture = compareDates(selectedDate, today) > 0;
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
    setEditState({
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
    if (!editState || editState.id !== paymentId) return;
    const raw = editState.value.trim();
    const amount = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && isNaN(amount as number)) return;
    const pct = parseFloat(editState.pct);
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
    setEditState(null);
  };

  const toggleSlot = (id: string) =>
    setOpenSlots((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // ── Month navigation ───────────────────────────────────────────────────────

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
          {/* Date navigator */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white border-2 border-[#dde8f8] text-[#1d6fb8] font-bold shadow-sm active:bg-[#e8f0fc] text-3xl"
            >
              ‹
            </button>
            <div className="text-center">
              <div className="text-[22px] font-extrabold text-[#1a1a1a]">
                {displayDate(selectedDate)}
              </div>
              <div className="text-[13px] text-gray-400">{selectedDate}</div>
            </div>
            <button
              onClick={() => {
                if (!isFuture) setSelectedDate((d) => shiftDate(d, 1));
              }}
              disabled={isFuture}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl border-2 font-bold shadow-sm text-3xl ${
                !isFuture
                  ? "bg-white border-[#dde8f8] text-[#1d6fb8] active:bg-[#e8f0fc]"
                  : "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
              }`}
            >
              ›
            </button>
          </div>

          {daySessions.length === 0 && dayLoading ? (
            /* Skeleton on first load only — no stale data to show yet */
            <SkeletonSlotCards />
          ) : (
            <>
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

                  return (
                    <div
                      key={slot.id}
                      className="bg-white rounded-[20px] shadow-sm border-2 border-[#e4edf8] overflow-hidden"
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
                          {users.length === 0 ? (
                            <div className="px-5 py-8 text-center">
                              <div className="text-[32px] mb-2">📭</div>
                              <div className="text-[16px] font-semibold text-gray-400">
                                No one sent numbers for this game yet.
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="divide-y-2 divide-[#f0f4f8]">
                                {users.map((user) => {
                                  const effectivePct =
                                    user.commissionPct ??
                                    settings.commissionPct;
                                  const pending =
                                    user.betTotal - (user.amountPaid ?? 0);
                                  const isEditing =
                                    editState?.id === user.paymentId;
                                  const notRecorded = user.amountPaid === null;
                                  const fullyPaid =
                                    !notRecorded && pending === 0;
                                  const hasDebt = !notRecorded && pending > 0;
                                  const overpaid = !notRecorded && pending < 0;

                                  return (
                                    <div
                                      key={user.contact}
                                      className="px-5 py-4"
                                    >
                                      <div className="text-[17px] font-extrabold text-[#1a1a1a] mb-1">
                                        👤 {user.contact}
                                      </div>
                                      <div className="text-[15px] text-gray-500 mb-3">
                                        Game total:{" "}
                                        <span className="font-bold text-[#1a1a1a]">
                                          ₹{user.betTotal}
                                        </span>
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
                                            value={editState!.value}
                                            onChange={(e) =>
                                              setEditState((s) =>
                                                s
                                                  ? {
                                                      ...s,
                                                      value: e.target.value,
                                                    }
                                                  : s
                                              )
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter")
                                                saveEdit(
                                                  user.paymentId,
                                                  user.contact,
                                                  slot.id,
                                                  slot.name
                                                );
                                              if (e.key === "Escape")
                                                setEditState(null);
                                            }}
                                            autoFocus
                                            placeholder={String(user.betTotal)}
                                            className="w-full text-[26px] font-extrabold text-center border-2 border-[#1d6fb8] rounded-[12px] px-4 py-3 outline-none mb-3 bg-white"
                                          />

                                          {/* Commission % editor */}
                                          <button
                                            onClick={() =>
                                              setEditState((s) =>
                                                s
                                                  ? {
                                                      ...s,
                                                      showPct: !s.showPct,
                                                    }
                                                  : s
                                              )
                                            }
                                            className="text-[12px] text-gray-400 underline mb-2 block"
                                          >
                                            {editState!.showPct
                                              ? "▲ Hide"
                                              : "▼ Change"}{" "}
                                            commission % (currently{" "}
                                            {editState!.pct}%)
                                          </button>
                                          {editState!.showPct && (
                                            <div className="flex items-center gap-2 mb-3">
                                              <input
                                                type="number"
                                                inputMode="decimal"
                                                min="0"
                                                max="100"
                                                step="0.5"
                                                value={editState!.pct}
                                                onChange={(e) =>
                                                  setEditState((s) =>
                                                    s
                                                      ? {
                                                          ...s,
                                                          pct: e.target.value,
                                                        }
                                                      : s
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
                                                saveEdit(
                                                  user.paymentId,
                                                  user.contact,
                                                  slot.id,
                                                  slot.name
                                                )
                                              }
                                              className="flex-1 py-3 bg-green-600 text-white text-[16px] font-bold rounded-[12px] active:opacity-80"
                                            >
                                              ✓ Save
                                            </button>
                                            <button
                                              onClick={() => setEditState(null)}
                                              className="px-5 py-3 bg-gray-100 text-gray-500 text-[16px] font-semibold rounded-[12px] active:opacity-80"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : notRecorded ? (
                                        <button
                                          onClick={() =>
                                            startEdit(
                                              user.paymentId,
                                              null,
                                              user.commissionPct
                                            )
                                          }
                                          className="w-full py-4 bg-[#1d6fb8] text-white text-[16px] font-bold rounded-[14px] flex items-center justify-center gap-2 active:opacity-80 shadow-sm"
                                        >
                                          👆 Tap to enter amount received
                                        </button>
                                      ) : fullyPaid ? (
                                        <div className="flex items-center justify-between bg-green-50 border-2 border-green-200 rounded-[14px] px-4 py-3">
                                          <div>
                                            <div className="text-[13px] text-gray-500">
                                              You received:
                                            </div>
                                            <div className="text-[20px] font-extrabold text-green-700">
                                              ₹{user.amountPaid}
                                            </div>
                                            <div className="text-[11px] text-gray-400 mt-0.5">
                                              Commission: {effectivePct}%
                                            </div>
                                          </div>
                                          <div className="flex flex-col items-end gap-1.5">
                                            <span className="text-[13px] font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                                              ✅ Fully Paid
                                            </span>
                                            <button
                                              onClick={() =>
                                                startEdit(
                                                  user.paymentId,
                                                  user.amountPaid,
                                                  user.commissionPct
                                                )
                                              }
                                              className="text-[12px] text-gray-400 underline"
                                            >
                                              Edit
                                            </button>
                                          </div>
                                        </div>
                                      ) : hasDebt ? (
                                        <div className="rounded-[14px] border-2 border-orange-200 overflow-hidden">
                                          <div className="flex items-center justify-between bg-orange-50 px-4 py-3">
                                            <div>
                                              <div className="text-[13px] text-gray-500">
                                                You received:
                                              </div>
                                              <div className="text-[20px] font-extrabold text-[#1d6fb8]">
                                                ₹{user.amountPaid}
                                              </div>
                                              <div className="text-[11px] text-gray-400 mt-0.5">
                                                Commission: {effectivePct}%
                                              </div>
                                            </div>
                                            <button
                                              onClick={() =>
                                                startEdit(
                                                  user.paymentId,
                                                  user.amountPaid,
                                                  user.commissionPct
                                                )
                                              }
                                              className="text-[13px] text-gray-400 underline"
                                            >
                                              Edit
                                            </button>
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
                                            <div className="text-[20px] font-extrabold text-blue-700">
                                              ₹{user.amountPaid}
                                            </div>
                                            <div className="text-[11px] text-gray-400 mt-0.5">
                                              Commission: {effectivePct}%
                                            </div>
                                          </div>
                                          <div className="flex flex-col items-end gap-1.5">
                                            <span className="text-[13px] font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">
                                              Extra: ₹{Math.abs(pending)}
                                            </span>
                                            <button
                                              onClick={() =>
                                                startEdit(
                                                  user.paymentId,
                                                  user.amountPaid,
                                                  user.commissionPct
                                                )
                                              }
                                              className="text-[12px] text-gray-400 underline"
                                            >
                                              Edit
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>

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
                    </div>
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
                <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] px-5 py-12 text-center shadow-sm">
                  <div className="text-[40px] mb-3">📭</div>
                  <div className="text-[17px] font-bold text-gray-400">
                    No payments recorded
                  </div>
                  <div className="text-[14px] text-gray-400 mt-1">
                    for {MONTH_NAMES[monthYear.month - 1]} {monthYear.year}
                  </div>
                </div>
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
    </div>
  );
}
