import { useState, useEffect, useRef } from "react";
import { toastApiError } from "./apiToast";
import type {
  SavedSession,
  CalculationResult,
  GameSlot,
  PaymentRecord,
} from "./types";
import EditableBreakdown from "./EditableBreakdown";
import {
  mergeSessionLedgerResult,
  sessionLedgerForSlotKey,
  SESSION_SLOT_KEY_UNSLOTTED,
} from "./calcUtils";
import { useLoadingSignal } from "./TopProgressBar";
import { DangerActionDialog } from "./ui";

interface Props {
  slots: GameSlot[];
  loadSessionsByDate: (date: string) => Promise<SavedSession[]>;
  loadPaymentsByDate: (date: string) => Promise<PaymentRecord[]>;
  loadSessionDatesForMonth: (year: number, month: number) => Promise<string[]>;
  saveSessionDoc: (session: SavedSession) => Promise<void>;
  deleteSessionDoc: (id: string) => Promise<void>;
  deletePaymentsByContactDate: (contact: string, date: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  const n = new Date();
  return `${String(n.getDate()).padStart(2, "0")}/${String(
    n.getMonth() + 1
  ).padStart(2, "0")}/${n.getFullYear()}`;
}
function makeDateStr(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(
    2,
    "0"
  )}/${year}`;
}
function parseDate(str: string): Date {
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
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

interface PersonEntry {
  sessionId: string;
  contact: string;
  total: number;
  result: CalculationResult;
}

function slotPersons(sessions: SavedSession[], slotId: string): PersonEntry[] {
  const out: PersonEntry[] = [];
  for (const s of sessions) {
    const ledger = sessionLedgerForSlotKey(s, slotId);
    if (!ledger) continue;
    out.push({
      sessionId: s.id,
      contact: s.contact,
      total: ledger.total,
      result: ledger,
    });
  }
  return out.sort((a, b) => a.contact.localeCompare(b.contact));
}

function unslottedPersons(sessions: SavedSession[]): PersonEntry[] {
  const out: PersonEntry[] = [];
  for (const s of sessions) {
    const ledger = sessionLedgerForSlotKey(s, SESSION_SLOT_KEY_UNSLOTTED);
    if (!ledger) continue;
    out.push({
      sessionId: s.id,
      contact: s.contact,
      total: ledger.total,
      result: ledger,
    });
  }
  return out;
}

function pruneResultsByIndices(
  result: CalculationResult,
  remove: Set<number>
): CalculationResult {
  const results = result.results.filter((_, i) => !remove.has(i));
  return {
    results,
    total: results.reduce((s, r) => s + r.lineTotal, 0),
    ...(result.failedLines && result.failedLines.length > 0
      ? { failedLines: result.failedLines }
      : {}),
  };
}

// ─── Skeleton placeholder (first-load, no stale data available) ───────────────

function SkeletonDayView() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="bg-white rounded-[20px] border-2 border-[#e4edf8] p-4 shadow-sm"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
              <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded-lg w-2/3" />
            <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function History({
  slots,
  loadSessionsByDate,
  loadPaymentsByDate,
  loadSessionDatesForMonth,
  saveSessionDoc,
  deleteSessionDoc,
  deletePaymentsByContactDate,
}: Props) {
  const { inc, dec } = useLoadingSignal();
  const today = todayStr();
  const now = new Date();

  const [cal, setCal] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [openSlotIds, setOpenSlotIds] = useState<Set<string>>(new Set());
  const [openPersonIds, setOpenPersonIds] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Per-person (slot:sessionId) selected breakdown row indices for bulk delete */
  const [breakdownRowSelection, setBreakdownRowSelection] = useState<
    Map<string, Set<number>>
  >(() => new Map());
  const [confirmMultiRowDelete, setConfirmMultiRowDelete] = useState<{
    personKey: string;
    sessionId: string;
    slotKey: string;
    contact: string;
    indices: number[];
  } | null>(null);

  // Lazily loaded data for the selected day
  const [daySessions, setDaySessions] = useState<SavedSession[]>([]);
  const [dayPayments, setDayPayments] = useState<PaymentRecord[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  // Dates that have entries in the current calendar month (for calendar dots)
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());

  // Monotonic counter to discard stale async results when selectedDate changes quickly
  const loadSeqRef = useRef(0);

  // Last-known data per date: instant paint when revisiting a day, then always refetched (SWR)
  const dayCacheRef = useRef(
    new Map<string, { sessions: SavedSession[]; payments: PaymentRecord[] }>()
  );
  const putDayCache = (
    date: string,
    sessions: SavedSession[],
    payments: PaymentRecord[]
  ) => {
    dayCacheRef.current.set(date, { sessions, payments });
  };

  // Load all active dates for the calendar month whenever the month changes.
  // On the very first load, also auto-jump to the most recent date with data.
  const [initialJumpDone, setInitialJumpDone] = useState(false);
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
      .catch((err) => {
        toastApiError(err, "Could not load calendar highlights.");
      });
  }, [cal.year, cal.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sessions+payments when selectedDate changes: paint from cache if any, always refetch
  useEffect(() => {
    const cached = dayCacheRef.current.get(selectedDate);
    if (cached) {
      setDaySessions(
        [...cached.sessions].sort((a, b) => b.createdAt - a.createdAt)
      );
      setDayPayments([...cached.payments]);
    }

    const seq = ++loadSeqRef.current;
    inc();
    setDayLoading(true);
    Promise.all([
      loadSessionsByDate(selectedDate),
      loadPaymentsByDate(selectedDate),
    ])
      .then(([sessions, payments]) => {
        if (seq !== loadSeqRef.current) return; // stale – a newer request is in flight
        const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
        setDaySessions(sorted);
        setDayPayments(payments);
        putDayCache(selectedDate, sorted, payments);
        setActiveDates((prev) => {
          const next = new Set(prev);
          if (sessions.length > 0) next.add(selectedDate);
          return next;
        });
      })
      .catch((err) => {
        if (seq !== loadSeqRef.current) return;
        toastApiError(err, "Could not refresh data for this day.");
        if (cached) {
          setDaySessions(
            [...cached.sessions].sort((a, b) => b.createdAt - a.createdAt)
          );
          setDayPayments([...cached.payments]);
        } else {
          setDaySessions([]);
        }
      })
      .finally(() => {
        dec(); // always pair this request's inc — stale requests must not skip dec
        if (seq === loadSeqRef.current) setDayLoading(false);
      });
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBreakdownRowSelection(new Map());
    setConfirmMultiRowDelete(null);
  }, [selectedDate]);

  const shiftMonth = (delta: number) => {
    setCal((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
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

  const dayTotal = daySessions.reduce(
    (s, sess) => s + mergeSessionLedgerResult(sess).total,
    0
  );
  const deleteConfirmContact = confirmDeleteId
    ? daySessions.find((s) => s.id === confirmDeleteId)?.contact
    : undefined;
  const selDateDisplay = parseDate(selectedDate).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const toggleSlot = (id: string) =>
    setOpenSlotIds((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const togglePerson = (id: string) =>
    setOpenPersonIds((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const deleteSession = async (id: string) => {
    const session = daySessions.find((s) => s.id === id);
    try {
      await deleteSessionDoc(id);
      if (session)
        await deletePaymentsByContactDate(session.contact, session.date);
    } catch (err) {
      console.error("deleteSession failed:", err);
      toastApiError(
        err,
        "Delete failed. Please check your internet connection and try again."
      );
      return;
    }
    const remaining = daySessions.filter((s) => s.id !== id);
    const nextPayments = dayPayments.filter(
      (p) => !(session && p.contact === session.contact)
    );
    setDaySessions(remaining);
    setDayPayments(nextPayments);
    putDayCache(selectedDate, remaining, nextPayments);
    if (remaining.length === 0) {
      setActiveDates((prev) => {
        const n = new Set(prev);
        n.delete(selectedDate);
        return n;
      });
    }
    setBreakdownRowSelection((prev) => {
      const next = new Map(prev);
      const suffix = `:${id}`;
      for (const k of [...next.keys()]) {
        if (k.endsWith(suffix)) next.delete(k);
      }
      return next;
    });
    setConfirmDeleteId(null);
  };

  const handleResultChange = async (
    id: string,
    slotKey: string,
    result: CalculationResult
  ) => {
    const updated = daySessions.map((s) => {
      if (s.id !== id) return s;
      const { overrideResult: _legacy, ...rest } = s;
      return {
        ...rest,
        slotOverrides: { ...rest.slotOverrides, [slotKey]: result },
      };
    });
    setDaySessions(updated);
    putDayCache(
      selectedDate,
      updated,
      dayCacheRef.current.get(selectedDate)?.payments ?? dayPayments
    );
    const target = updated.find((s) => s.id === id);
    if (target) {
      try {
        await saveSessionDoc(target);
      } catch (err) {
        console.error("handleResultChange save failed:", err);
        toastApiError(err, "Could not save your change to the database.");
      }
    }
  };

  const handleClearAll = async () => {
    try {
      await Promise.all(
        daySessions.map((s) =>
          Promise.all([
            deleteSessionDoc(s.id),
            deletePaymentsByContactDate(s.contact, s.date),
          ])
        )
      );
    } catch (err) {
      console.error("handleClearAll failed:", err);
      toastApiError(
        err,
        "Clear all failed. Please check your internet connection and try again."
      );
      setConfirmClear(false);
      return;
    }
    setDaySessions([]);
    setDayPayments([]);
    putDayCache(selectedDate, [], []);
    setActiveDates((prev) => {
      const n = new Set(prev);
      n.delete(selectedDate);
      return n;
    });
    setConfirmClear(false);
    setBreakdownRowSelection(new Map());
  };

  const filteredBreakdownSelection = (
    personKey: string,
    rowCount: number
  ): Set<number> => {
    const raw = breakdownRowSelection.get(personKey);
    if (!raw?.size) return new Set();
    return new Set([...raw].filter((i) => i >= 0 && i < rowCount));
  };

  const toggleBreakdownRow = (personKey: string, rowIndex: number) => {
    setBreakdownRowSelection((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(personKey) ?? []);
      if (cur.has(rowIndex)) cur.delete(rowIndex);
      else cur.add(rowIndex);
      if (cur.size === 0) next.delete(personKey);
      else next.set(personKey, cur);
      return next;
    });
  };

  const clearBreakdownSelection = (personKey: string) => {
    setBreakdownRowSelection((prev) => {
      if (!prev.has(personKey)) return prev;
      const next = new Map(prev);
      next.delete(personKey);
      return next;
    });
  };

  const onBreakdownChange =
    (personKey: string, sessionId: string, slotKey: string) =>
    (r: CalculationResult) => {
      clearBreakdownSelection(personKey);
      void handleResultChange(sessionId, slotKey, r);
    };

  const applyMultiRowDelete = async () => {
    if (!confirmMultiRowDelete) return;
    const { sessionId, slotKey, indices, personKey } = confirmMultiRowDelete;
    const session = daySessions.find((s) => s.id === sessionId);
    setConfirmMultiRowDelete(null);
    if (!session) {
      clearBreakdownSelection(personKey);
      return;
    }
    const ledger = sessionLedgerForSlotKey(session, slotKey);
    if (!ledger) {
      clearBreakdownSelection(personKey);
      return;
    }
    const newResult = pruneResultsByIndices(ledger, new Set(indices));
    clearBreakdownSelection(personKey);
    await handleResultChange(sessionId, slotKey, newResult);
  };

  const cells = buildCalendarCells(cal.year, cal.month);

  return (
    <div className="w-full mb-8">
      {/* ── Calendar card ── */}
      <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] shadow-sm overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#f0f4f8] bg-[#f8faff]">
          <button
            onClick={() => shiftMonth(-1)}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors"
          >
            ‹
          </button>
          <div className="text-[16px] font-extrabold text-[#1a1a1a]">
            {MONTH_NAMES[cal.month - 1]} {cal.year}
          </div>
          <button
            onClick={() => shiftMonth(1)}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 px-3 pt-2.5">
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center text-[11px] font-bold text-gray-400 pb-1"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
          {cells.map((day, i) => {
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
            <span className="w-2 h-2 rounded-full bg-[#1d6fb8] inline-block" />{" "}
            Has entries
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 rounded-[6px] bg-[#dceeff] ring-2 ring-[#1d6fb8]" />{" "}
            Today
          </span>
        </div>
      </div>

      {/* ── Selected date header ── */}
      <div className="flex items-start justify-between mb-3 px-1">
        <div>
          <div className="text-[16px] font-extrabold text-[#1a1a1a]">
            {selDateDisplay}
          </div>
          {daySessions.length > 0 ? (
            <div className="text-[13px] text-gray-500 mt-0.5">
              {daySessions.length}{" "}
              {daySessions.length === 1 ? "person" : "people"} · Day total:{" "}
              <span className="font-extrabold text-[#1d6fb8]">₹{dayTotal}</span>
            </div>
          ) : !dayLoading ? (
            <div className="text-[13px] text-gray-400 mt-0.5">No entries</div>
          ) : null}
        </div>
        {daySessions.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="text-[12px] text-red-400 hover:text-red-600 font-semibold border border-red-200 rounded-lg px-2.5 py-1 transition-colors shrink-0 ml-2"
          >
            Clear All
          </button>
        )}
      </div>

      {/* ── Day view ── */}
      {daySessions.length === 0 ? (
        dayLoading ? (
          /* First-load skeleton — no stale data to show yet */
          <SkeletonDayView />
        ) : (
          <div className="bg-white rounded-[18px] border-2 border-[#e4edf8] px-5 py-10 text-center shadow-sm">
            <div className="text-[36px] mb-2">📭</div>
            <div className="text-[16px] font-semibold text-gray-400">
              No entries for this day
            </div>
            <div className="text-[13px] text-gray-300 mt-1">
              Tap a date on the calendar
            </div>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {/* One section per enabled slot */}
          {slots
            .filter((s) => s.enabled)
            .sort((a, b) => {
              const [ah, am] = a.time.split(":").map(Number);
              const [bh, bm] = b.time.split(":").map(Number);
              return ah * 60 + am - (bh * 60 + bm);
            })
            .map((slot) => {
              const persons = slotPersons(daySessions, slot.id);
              if (!persons.length) return null;
              const slotTotal = persons.reduce((s, p) => s + p.total, 0);
              const isOpen = openSlotIds.has(slot.id);
              const slotPayments = dayPayments.filter(
                (p) => p.slotId === slot.id
              );
              const slotReceived = slotPayments.reduce(
                (s, p) => s + (p.amountPaid ?? 0),
                0
              );
              const slotPending = Math.max(0, slotTotal - slotReceived);

              return (
                <div
                  key={slot.id}
                  className="bg-white rounded-[20px] border-2 border-[#e4edf8] overflow-hidden shadow-sm"
                >
                  <button
                    onClick={() => toggleSlot(slot.id)}
                    className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#f5f9ff] active:bg-[#eef4ff] transition-colors text-left"
                  >
                    <span className="text-[28px] leading-none shrink-0">
                      {slot.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-extrabold text-[#1a1a1a]">
                        {slot.name} Game
                      </div>
                      <div className="text-[13px] text-gray-400 mt-0.5">
                        {persons.length}{" "}
                        {persons.length === 1 ? "person" : "people"} · Total{" "}
                        <span className="font-bold text-[#1d6fb8]">
                          ₹{slotTotal}
                        </span>
                      </div>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[12px] font-semibold text-green-600">
                          ✅ Received ₹{slotReceived}
                        </span>
                        {slotPending > 0 ? (
                          <span className="text-[12px] font-semibold text-orange-500">
                            ⏳ Pending ₹{slotPending}
                          </span>
                        ) : slotReceived > 0 ? (
                          <span className="text-[12px] font-semibold text-green-500">
                            🎉 Fully Paid
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="text-[#1d6fb8] font-bold text-[16px] shrink-0">
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t-2 border-[#eef2f8] divide-y-2 divide-[#f5f7fb]">
                      {persons.map((person) => {
                        const personKey = `${slot.id}:${person.sessionId}`;
                        const isPersonOpen = openPersonIds.has(personKey);
                        const rowSel = filteredBreakdownSelection(
                          personKey,
                          person.result.results.length
                        );
                        const bulkCount = rowSel.size;
                        return (
                          <div key={person.sessionId}>
                            <div className="flex w-full items-stretch gap-0.5 bg-[#f8faff]">
                              <button
                                type="button"
                                onClick={() => togglePerson(personKey)}
                                className="flex flex-1 min-w-0 items-center gap-3 px-3 py-3 sm:px-4 hover:bg-[#eef4ff] active:bg-[#e8f0fc] transition-colors text-left"
                              >
                                <span className="text-[18px] shrink-0">👤</span>
                                <span className="flex-1 text-[15px] font-bold text-[#1a1a1a] truncate min-w-0">
                                  {person.contact}
                                </span>
                                <span className="text-[17px] font-extrabold text-[#1d6fb8] shrink-0">
                                  ₹{person.total}
                                </span>
                                <span className="text-[#1d6fb8] font-bold text-[12px] shrink-0 pr-1">
                                  {isPersonOpen ? "▲" : "▼"}
                                </span>
                              </button>
                              {bulkCount > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmMultiRowDelete({
                                      personKey,
                                      sessionId: person.sessionId,
                                      slotKey: slot.id,
                                      contact: person.contact,
                                      indices: [...rowSel].sort(
                                        (a, b) => a - b
                                      ),
                                    });
                                  }}
                                  className="self-center shrink-0 my-2 mr-1 px-2.5 py-1.5 rounded-[10px] text-[11px] sm:text-[12px] font-bold bg-red-600 text-white shadow-sm hover:bg-red-700 active:opacity-90"
                                >
                                  Delete {bulkCount} line
                                  {bulkCount === 1 ? "" : "s"}
                                </button>
                              )}
                              <button
                                type="button"
                                title="Delete entire entry"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(person.sessionId);
                                }}
                                className="shrink-0 w-10 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors"
                              >
                                🗑
                              </button>
                            </div>
                            {isPersonOpen && (
                              <div className="px-4 py-3 bg-white border-t border-[#f0f4f8]">
                                <EditableBreakdown
                                  compact
                                  confirmRowDelete
                                  result={person.result}
                                  rowSelection={{
                                    selectedIndices: rowSel,
                                    onToggleRowSelect: (idx) => {
                                      toggleBreakdownRow(personKey, idx);
                                    },
                                  }}
                                  onChange={onBreakdownChange(
                                    personKey,
                                    person.sessionId,
                                    slot.id
                                  )}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[#eef4ff]">
                        <span className="text-[13px] font-bold text-[#1d6fb8]">
                          {slot.emoji} {slot.name} Total
                        </span>
                        <span className="text-[16px] font-extrabold text-[#1d6fb8]">
                          ₹{slotTotal}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {/* Unassigned entries */}
          {(() => {
            const unslotted = unslottedPersons(daySessions);
            if (!unslotted.length) return null;
            const isOpen = openSlotIds.has("__unslotted__");
            const total = unslotted.reduce((s, p) => s + p.total, 0);
            const unslottedPayments = dayPayments.filter((p) => !p.slotId);
            const unslottedReceived = unslottedPayments.reduce(
              (s, p) => s + (p.amountPaid ?? 0),
              0
            );
            const unslottedPending = Math.max(0, total - unslottedReceived);
            return (
              <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] overflow-hidden shadow-sm">
                <button
                  onClick={() => toggleSlot("__unslotted__")}
                  className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#f5f9ff] text-left"
                >
                  <span className="text-[28px]">📋</span>
                  <div className="flex-1">
                    <div className="text-[17px] font-extrabold text-[#1a1a1a]">
                      Other Entries
                    </div>
                    <div className="text-[13px] text-gray-400 mt-0.5">
                      {unslotted.length}{" "}
                      {unslotted.length === 1 ? "person" : "people"} · Total{" "}
                      <span className="font-bold text-[#1d6fb8]">₹{total}</span>
                    </div>
                    <div className="flex gap-3 mt-1">
                      <span className="text-[12px] font-semibold text-green-600">
                        ✅ Received ₹{unslottedReceived}
                      </span>
                      {unslottedPending > 0 ? (
                        <span className="text-[12px] font-semibold text-orange-500">
                          ⏳ Pending ₹{unslottedPending}
                        </span>
                      ) : unslottedReceived > 0 ? (
                        <span className="text-[12px] font-semibold text-green-500">
                          🎉 Fully Paid
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-[#1d6fb8] font-bold text-[16px]">
                    {isOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t-2 border-[#eef2f8] divide-y-2 divide-[#f5f7fb]">
                    {unslotted.map((person) => {
                      const personKey = `__unslotted__:${person.sessionId}`;
                      const isPersonOpen = openPersonIds.has(personKey);
                      const rowSel = filteredBreakdownSelection(
                        personKey,
                        person.result.results.length
                      );
                      const bulkCount = rowSel.size;
                      return (
                        <div key={person.sessionId}>
                          <div className="flex w-full items-stretch gap-0.5 bg-[#f8faff]">
                            <button
                              type="button"
                              onClick={() => togglePerson(personKey)}
                              className="flex flex-1 min-w-0 items-center gap-3 px-3 py-3 sm:px-4 hover:bg-[#eef4ff] active:bg-[#e8f0fc] transition-colors text-left"
                            >
                              <span className="text-[18px] shrink-0">👤</span>
                              <span className="flex-1 text-[15px] font-bold text-[#1a1a1a] truncate min-w-0">
                                {person.contact}
                              </span>
                              <span className="text-[17px] font-extrabold text-[#1d6fb8] shrink-0">
                                ₹{person.total}
                              </span>
                              <span className="text-[#1d6fb8] font-bold text-[12px] shrink-0 pr-1">
                                {isPersonOpen ? "▲" : "▼"}
                              </span>
                            </button>
                            {bulkCount > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmMultiRowDelete({
                                    personKey,
                                    sessionId: person.sessionId,
                                    slotKey: SESSION_SLOT_KEY_UNSLOTTED,
                                    contact: person.contact,
                                    indices: [...rowSel].sort((a, b) => a - b),
                                  });
                                }}
                                className="self-center shrink-0 my-2 mr-1 px-2.5 py-1.5 rounded-[10px] text-[11px] sm:text-[12px] font-bold bg-red-600 text-white shadow-sm hover:bg-red-700 active:opacity-90"
                              >
                                Delete {bulkCount} line
                                {bulkCount === 1 ? "" : "s"}
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete entire entry"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(person.sessionId);
                              }}
                              className="shrink-0 w-10 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors"
                            >
                              🗑
                            </button>
                          </div>
                          {isPersonOpen && (
                            <div className="px-4 py-3 bg-white border-t border-[#f0f4f8]">
                              <EditableBreakdown
                                compact
                                confirmRowDelete
                                result={person.result}
                                rowSelection={{
                                  selectedIndices: rowSel,
                                  onToggleRowSelect: (idx) => {
                                    toggleBreakdownRow(personKey, idx);
                                  },
                                }}
                                onChange={onBreakdownChange(
                                  personKey,
                                  person.sessionId,
                                  SESSION_SLOT_KEY_UNSLOTTED
                                )}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="bg-[#1a3a5c] rounded-[16px] px-5 py-3.5 flex items-center justify-between shadow-sm">
            <span className="text-[15px] font-bold text-white/70">
              Day Total
            </span>
            <span className="text-[24px] font-extrabold text-white">
              ₹{dayTotal}
            </span>
          </div>
        </div>
      )}

      <DangerActionDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void handleClearAll()}
        titleId="history-clear-all-title"
        title="Delete ALL entries for this day?"
        message={null}
        confirmLabel="Yes, Delete All"
      />

      <DangerActionDialog
        open={confirmDeleteId != null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) void deleteSession(confirmDeleteId);
        }}
        titleId="history-delete-entry-title"
        title="Delete this entry?"
        message={
          <>
            <p className="text-[13px] text-red-600 leading-snug">
              This will also remove their payment record for this day.
            </p>
            {deleteConfirmContact ? (
              <p
                className="text-[14px] font-semibold text-[#1a1a1a] mt-2 truncate"
                title={deleteConfirmContact}
              >
                {deleteConfirmContact}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Yes, Delete"
      />

      <DangerActionDialog
        open={confirmMultiRowDelete != null}
        onClose={() => setConfirmMultiRowDelete(null)}
        onConfirm={() => void applyMultiRowDelete()}
        titleId="history-multi-row-title"
        title={
          confirmMultiRowDelete
            ? `Delete ${confirmMultiRowDelete.indices.length} selected line${
                confirmMultiRowDelete.indices.length === 1 ? "" : "s"
              }?`
            : ""
        }
        message={
          confirmMultiRowDelete ? (
            <p className="text-[13px] text-gray-600 leading-snug">
              This updates the saved breakdown for{" "}
              <span className="font-semibold text-[#1a1a1a]">
                {confirmMultiRowDelete.contact}
              </span>{" "}
              in History (only the highlighted rows are removed).
            </p>
          ) : null
        }
        confirmLabel="Yes, Delete"
      />
    </div>
  );
}
