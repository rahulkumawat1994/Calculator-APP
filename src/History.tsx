import { useState, useEffect } from "react";
import type { SavedSession, CalculationResult, GameSlot, PaymentRecord } from "./types";
import EditableBreakdown from "./EditableBreakdown";

interface Props {
  slots:                        GameSlot[];
  loadSessionsByDate:           (date: string) => Promise<SavedSession[]>;
  loadPaymentsByDate:           (date: string) => Promise<PaymentRecord[]>;
  loadSessionDatesForMonth:     (year: number, month: number) => Promise<string[]>;
  saveSessionDoc:               (session: SavedSession) => Promise<void>;
  deleteSessionDoc:             (id: string) => Promise<void>;
  deletePaymentsByContactDate:  (contact: string, date: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}`;
}
function makeDateStr(year: number, month: number, day: number): string {
  return `${String(day).padStart(2,"0")}/${String(month).padStart(2,"0")}/${year}`;
}
function parseDate(str: string): Date {
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}
function buildCalendarCells(year: number, month: number): (number | null)[] {
  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const cells: (number | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function mergeResults(session: SavedSession): CalculationResult {
  if (session.overrideResult) return session.overrideResult;
  return {
    results: session.messages.flatMap(m => (m.overrideResult ?? m.result).results),
    total:   session.messages.reduce((s, m) => s + (m.overrideResult ?? m.result).total, 0),
  };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_LABELS = ["Mo","Tu","We","Th","Fr","Sa","Su"];

function slotPersons(sessions: SavedSession[], slotId: string) {
  const out = [];
  for (const s of sessions) {
    const msgs = s.messages.filter(m => m.slotId === slotId);
    if (!msgs.length) continue;
    out.push({
      sessionId: s.id, contact: s.contact,
      total: msgs.reduce((sum, m) => sum + (m.overrideResult ?? m.result).total, 0),
      result: {
        results: msgs.flatMap(m => (m.overrideResult ?? m.result).results),
        total:   msgs.reduce((sum, m) => sum + (m.overrideResult ?? m.result).total, 0),
      },
    });
  }
  return out.sort((a, b) => a.contact.localeCompare(b.contact));
}

function unslottedPersons(sessions: SavedSession[]) {
  const out = [];
  for (const s of sessions) {
    const msgs = s.messages.filter(m => !m.slotId);
    if (!msgs.length) continue;
    out.push({
      sessionId: s.id, contact: s.contact,
      total: msgs.reduce((sum, m) => sum + (m.overrideResult ?? m.result).total, 0),
      result: {
        results: msgs.flatMap(m => (m.overrideResult ?? m.result).results),
        total:   msgs.reduce((sum, m) => sum + (m.overrideResult ?? m.result).total, 0),
      },
    });
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function History({
  slots,
  loadSessionsByDate, loadPaymentsByDate, loadSessionDatesForMonth,
  saveSessionDoc, deleteSessionDoc, deletePaymentsByContactDate,
}: Props) {
  const today = todayStr();
  const now   = new Date();

  const [cal,           setCal]           = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selectedDate,  setSelectedDate]  = useState(today);
  const [openSlotIds,   setOpenSlotIds]   = useState<Set<string>>(new Set());
  const [openPersonIds, setOpenPersonIds] = useState<Set<string>>(new Set());
  const [confirmClear,  setConfirmClear]  = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Lazily loaded data for the selected day
  const [daySessions,  setDaySessions]  = useState<SavedSession[]>([]);
  const [dayPayments,  setDayPayments]  = useState<PaymentRecord[]>([]);
  const [dayLoading,   setDayLoading]   = useState(false);

  // Dates that have entries in the current calendar month (for calendar dots)
  const [activeDates,  setActiveDates]  = useState<Set<string>>(new Set());

  // Load all active dates for the calendar month whenever the month changes.
  // On the very first load, also auto-jump to the most recent date with data.
  const [initialJumpDone, setInitialJumpDone] = useState(false);
  useEffect(() => {
    loadSessionDatesForMonth(cal.year, cal.month).then(dates => {
      setActiveDates(prev => {
        const next = new Set(prev);
        dates.forEach(d => next.add(d));
        return next;
      });
      if (!initialJumpDone && dates.length > 0) {
        // Jump to the most recent date that has data
        const sorted = [...dates].sort((a, b) => {
          const [ad, am, ay] = a.split("/").map(Number);
          const [bd, bm, by] = b.split("/").map(Number);
          return new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime();
        });
        setSelectedDate(sorted[0]);
        setInitialJumpDone(true);
      }
    });
  }, [cal.year, cal.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sessions+payments whenever selectedDate changes
  useEffect(() => {
    setDayLoading(true);
    Promise.all([loadSessionsByDate(selectedDate), loadPaymentsByDate(selectedDate)])
      .then(([sessions, payments]) => {
        setDaySessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
        setDayPayments(payments);
        // Keep activeDates in sync after loading
        setActiveDates(prev => {
          const next = new Set(prev);
          if (sessions.length > 0) next.add(selectedDate);
          return next;
        });
      })
      .finally(() => setDayLoading(false));
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const shiftMonth = (delta: number) => {
    setCal(prev => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m > 12) { m = 1;  y++; }
      if (m < 1)  { m = 12; y--; }
      return { year: y, month: m };
    });
  };

  const dayTotal      = daySessions.reduce((s, sess) => s + mergeResults(sess).total, 0);
  const selDateDisplay = parseDate(selectedDate).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const toggleSlot   = (id: string) =>
    setOpenSlotIds(p   => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePerson = (id: string) =>
    setOpenPersonIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteSession = async (id: string) => {
    const session = daySessions.find(s => s.id === id);
    await deleteSessionDoc(id);
    if (session) await deletePaymentsByContactDate(session.contact, session.date);
    const remaining = daySessions.filter(s => s.id !== id);
    setDaySessions(remaining);
    setDayPayments(prev => prev.filter(p => !(session && p.contact === session.contact)));
    if (remaining.length === 0) {
      setActiveDates(prev => { const n = new Set(prev); n.delete(selectedDate); return n; });
    }
  };

  const handleResultChange = async (id: string, result: CalculationResult) => {
    const updated = daySessions.map(s => s.id === id ? { ...s, overrideResult: result } : s);
    setDaySessions(updated);
    const target = updated.find(s => s.id === id);
    if (target) await saveSessionDoc(target);
  };

  const handleClearAll = async () => {
    await Promise.all(daySessions.map(s =>
      Promise.all([
        deleteSessionDoc(s.id),
        deletePaymentsByContactDate(s.contact, s.date),
      ])
    ));
    setDaySessions([]);
    setDayPayments([]);
    setActiveDates(prev => { const n = new Set(prev); n.delete(selectedDate); return n; });
    setConfirmClear(false);
  };

  const cells = buildCalendarCells(cal.year, cal.month);

  return (
    <div className="w-full mb-8">

      {/* ── Calendar card ── */}
      <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] shadow-sm overflow-hidden mb-4">

        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#f0f4f8] bg-[#f8faff]">
          <button onClick={() => shiftMonth(-1)} className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors">‹</button>
          <div className="text-[16px] font-extrabold text-[#1a1a1a]">{MONTH_NAMES[cal.month - 1]} {cal.year}</div>
          <button onClick={() => shiftMonth(1)}  className="w-10 h-10 flex items-center justify-center rounded-xl text-[#1d6fb8] font-bold text-2xl active:bg-[#e8f0fc] transition-colors">›</button>
        </div>

        <div className="grid grid-cols-7 px-3 pt-2.5">
          {DAY_LABELS.map(d => (
            <div key={d} className="text-center text-[11px] font-bold text-gray-400 pb-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const dateStr    = makeDateStr(cal.year, cal.month, day);
            const isToday    = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasData    = activeDates.has(dateStr);
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
                  <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white/70" : "bg-[#1d6fb8]"}`} />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 px-4 pb-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1d6fb8] inline-block" /> Has entries</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 rounded-[6px] bg-[#dceeff] ring-2 ring-[#1d6fb8]" /> Today</span>
        </div>
      </div>

      {/* ── Selected date header ── */}
      <div className="flex items-start justify-between mb-3 px-1">
        <div>
          <div className="text-[16px] font-extrabold text-[#1a1a1a]">{selDateDisplay}</div>
          {dayLoading ? (
            <div className="text-[13px] text-gray-400 mt-0.5">Loading…</div>
          ) : daySessions.length > 0 ? (
            <div className="text-[13px] text-gray-500 mt-0.5">
              {daySessions.length} {daySessions.length === 1 ? "person" : "people"} · Day total:{" "}
              <span className="font-extrabold text-[#1d6fb8]">₹{dayTotal}</span>
            </div>
          ) : (
            <div className="text-[13px] text-gray-400 mt-0.5">No entries</div>
          )}
        </div>
        {daySessions.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="text-[12px] text-red-400 hover:text-red-600 font-semibold border border-red-200 rounded-lg px-2.5 py-1 transition-colors shrink-0 ml-2"
          >Clear All</button>
        )}
      </div>

      {/* Confirm clear all */}
      {confirmClear && (
        <div className="bg-red-50 border-2 border-red-200 rounded-[16px] px-4 py-4 mb-3">
          <div className="text-[15px] font-bold text-red-700 mb-3">Delete ALL entries for this day?</div>
          <div className="flex gap-2">
            <button onClick={handleClearAll} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-[12px] text-[14px]">Yes, Delete All</button>
            <button onClick={() => setConfirmClear(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-semibold rounded-[12px] text-[14px]">Cancel</button>
          </div>
        </div>
      )}

      {/* Confirm delete single contact */}
      {confirmDeleteId && (
        <div className="bg-red-50 border-2 border-red-200 rounded-[16px] px-4 py-4 mb-3">
          <div className="text-[15px] font-bold text-red-700 mb-1">Delete this entry?</div>
          <div className="text-[13px] text-red-500 mb-3">This will also remove their payment record for this day.</div>
          <div className="flex gap-2">
            <button onClick={() => { deleteSession(confirmDeleteId); setConfirmDeleteId(null); }} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-[12px] text-[14px]">Yes, Delete</button>
            <button onClick={() => setConfirmDeleteId(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-semibold rounded-[12px] text-[14px]">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Day view ── */}
      {dayLoading ? (
        <div className="bg-white rounded-[18px] border-2 border-[#e4edf8] px-5 py-10 text-center shadow-sm">
          <div className="text-[14px] text-gray-400 font-semibold">Loading entries…</div>
        </div>
      ) : daySessions.length === 0 ? (
        <div className="bg-white rounded-[18px] border-2 border-[#e4edf8] px-5 py-10 text-center shadow-sm">
          <div className="text-[36px] mb-2">📭</div>
          <div className="text-[16px] font-semibold text-gray-400">No entries for this day</div>
          <div className="text-[13px] text-gray-300 mt-1">Tap a date on the calendar</div>
        </div>
      ) : (
        <div className="space-y-3">

          {/* One section per enabled slot */}
          {slots
            .filter(s => s.enabled)
            .sort((a, b) => {
              const [ah, am] = a.time.split(":").map(Number);
              const [bh, bm] = b.time.split(":").map(Number);
              return ah * 60 + am - (bh * 60 + bm);
            })
            .map(slot => {
              const persons      = slotPersons(daySessions, slot.id);
              if (!persons.length) return null;
              const slotTotal    = persons.reduce((s, p) => s + p.total, 0);
              const isOpen       = openSlotIds.has(slot.id);
              const slotPayments = dayPayments.filter(p => p.slotId === slot.id);
              const slotReceived = slotPayments.reduce((s, p) => s + (p.amountPaid ?? 0), 0);
              const slotPending  = Math.max(0, slotTotal - slotReceived);

              return (
                <div key={slot.id} className="bg-white rounded-[20px] border-2 border-[#e4edf8] overflow-hidden shadow-sm">
                  <button onClick={() => toggleSlot(slot.id)} className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#f5f9ff] active:bg-[#eef4ff] transition-colors text-left">
                    <span className="text-[28px] leading-none shrink-0">{slot.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-extrabold text-[#1a1a1a]">{slot.name} Game</div>
                      <div className="text-[13px] text-gray-400 mt-0.5">
                        {persons.length} {persons.length === 1 ? "person" : "people"} · Total <span className="font-bold text-[#1d6fb8]">₹{slotTotal}</span>
                      </div>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[12px] font-semibold text-green-600">✅ Received ₹{slotReceived}</span>
                        {slotPending > 0
                          ? <span className="text-[12px] font-semibold text-orange-500">⏳ Pending ₹{slotPending}</span>
                          : slotReceived > 0
                          ? <span className="text-[12px] font-semibold text-green-500">🎉 Fully Paid</span>
                          : null
                        }
                      </div>
                    </div>
                    <span className="text-[#1d6fb8] font-bold text-[16px] shrink-0">{isOpen ? "▲" : "▼"}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t-2 border-[#eef2f8] divide-y-2 divide-[#f5f7fb]">
                      {persons.map(person => {
                        const personKey    = `${slot.id}:${person.sessionId}`;
                        const isPersonOpen = openPersonIds.has(personKey);
                        return (
                          <div key={person.sessionId}>
                            <button onClick={() => togglePerson(personKey)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f8faff] active:bg-[#eef4ff] transition-colors text-left bg-[#f8faff]">
                              <span className="text-[18px] shrink-0">👤</span>
                              <span className="flex-1 text-[15px] font-bold text-[#1a1a1a] truncate min-w-0">{person.contact}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[17px] font-extrabold text-[#1d6fb8]">₹{person.total}</span>
                                <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(person.sessionId); }} className="text-gray-300 hover:text-red-400 transition-colors p-1" title="Delete">🗑</button>
                                <span className="text-[#1d6fb8] font-bold text-[12px]">{isPersonOpen ? "▲" : "▼"}</span>
                              </div>
                            </button>
                            {isPersonOpen && (
                              <div className="px-4 py-3 bg-white border-t border-[#f0f4f8]">
                                <EditableBreakdown compact result={person.result} onChange={r => handleResultChange(person.sessionId, r)} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[#eef4ff]">
                        <span className="text-[13px] font-bold text-[#1d6fb8]">{slot.emoji} {slot.name} Total</span>
                        <span className="text-[16px] font-extrabold text-[#1d6fb8]">₹{slotTotal}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {/* Unassigned entries */}
          {(() => {
            const unslotted        = unslottedPersons(daySessions);
            if (!unslotted.length) return null;
            const isOpen           = openSlotIds.has("__unslotted__");
            const total            = unslotted.reduce((s, p) => s + p.total, 0);
            const unslottedPayments = dayPayments.filter(p => !p.slotId);
            const unslottedReceived = unslottedPayments.reduce((s, p) => s + (p.amountPaid ?? 0), 0);
            const unslottedPending  = Math.max(0, total - unslottedReceived);
            return (
              <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] overflow-hidden shadow-sm">
                <button onClick={() => toggleSlot("__unslotted__")} className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#f5f9ff] text-left">
                  <span className="text-[28px]">📋</span>
                  <div className="flex-1">
                    <div className="text-[17px] font-extrabold text-[#1a1a1a]">Other Entries</div>
                    <div className="text-[13px] text-gray-400 mt-0.5">
                      {unslotted.length} {unslotted.length === 1 ? "person" : "people"} · Total <span className="font-bold text-[#1d6fb8]">₹{total}</span>
                    </div>
                    <div className="flex gap-3 mt-1">
                      <span className="text-[12px] font-semibold text-green-600">✅ Received ₹{unslottedReceived}</span>
                      {unslottedPending > 0
                        ? <span className="text-[12px] font-semibold text-orange-500">⏳ Pending ₹{unslottedPending}</span>
                        : unslottedReceived > 0
                        ? <span className="text-[12px] font-semibold text-green-500">🎉 Fully Paid</span>
                        : null
                      }
                    </div>
                  </div>
                  <span className="text-[#1d6fb8] font-bold text-[16px]">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="border-t-2 border-[#eef2f8] divide-y-2 divide-[#f5f7fb]">
                    {unslotted.map(person => {
                      const personKey    = `__unslotted__:${person.sessionId}`;
                      const isPersonOpen = openPersonIds.has(personKey);
                      return (
                        <div key={person.sessionId}>
                          <button onClick={() => togglePerson(personKey)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f8faff] bg-[#f8faff] text-left">
                            <span className="text-[18px]">👤</span>
                            <span className="flex-1 text-[15px] font-bold text-[#1a1a1a] truncate">{person.contact}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[17px] font-extrabold text-[#1d6fb8]">₹{person.total}</span>
                              <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(person.sessionId); }} className="text-gray-300 hover:text-red-400 p-1">🗑</button>
                              <span className="text-[#1d6fb8] font-bold text-[12px]">{isPersonOpen ? "▲" : "▼"}</span>
                            </div>
                          </button>
                          {isPersonOpen && (
                            <div className="px-4 py-3 bg-white border-t border-[#f0f4f8]">
                              <EditableBreakdown compact result={person.result} onChange={r => handleResultChange(person.sessionId, r)} />
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
            <span className="text-[15px] font-bold text-white/70">Day Total</span>
            <span className="text-[24px] font-extrabold text-white">₹{dayTotal}</span>
          </div>
        </div>
      )}
    </div>
  );
}
