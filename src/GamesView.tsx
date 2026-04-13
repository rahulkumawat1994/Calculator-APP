import { useState, useCallback } from "react";
import {
  slotMinutes,
  formatSlotTime,
  getCurrentSlot,
  upsertPayment,
} from "./calcUtils";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";

interface Props {
  sessions:       SavedSession[];
  slots:          GameSlot[];
  payments:       PaymentRecord[];
  settings:       AppSettings;
  onSavePayments: (p: PaymentRecord[]) => void;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}`;
}
function parseDate(str: string): Date {
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}
function shiftDate(str: string, delta: number): string {
  const d = parseDate(str);
  d.setDate(d.getDate() + delta);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function displayDate(str: string): string {
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  if (str === today) return "Today";
  if (str === yesterday) return "Yesterday";
  return parseDate(str).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function compareDates(a: string, b: string): number {
  return parseDate(a).getTime() - parseDate(b).getTime();
}

// ─── Slot status ───────────────────────────────────────────────────────────────

type SlotStatus = "active" | "upcoming" | "closed";

function getSlotStatus(slot: GameSlot, activeSlotId: string, isToday: boolean): SlotStatus {
  if (!isToday) return "closed";
  if (slot.id === activeSlotId) return "active";
  const now = new Date();
  return slotMinutes(slot.time) <= now.getHours() * 60 + now.getMinutes() ? "closed" : "upcoming";
}

const STATUS_STYLE: Record<SlotStatus, { badge: string; label: string }> = {
  active:   { badge: "bg-green-100 text-green-700 border border-green-300", label: "🟢 Open Now" },
  upcoming: { badge: "bg-blue-100 text-blue-700 border border-blue-200",   label: "🔵 Coming Later" },
  closed:   { badge: "bg-gray-100 text-gray-500 border border-gray-200",   label: "✅ Done" },
};

// ─── Data helpers ──────────────────────────────────────────────────────────────

interface UserRow {
  contact:    string;
  betTotal:   number;
  amountPaid: number | null;
  paymentId:  string;
}

function getSlotUsers(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  slotId: string,
  date: string,
): UserRow[] {
  const rows: UserRow[] = [];
  for (const session of sessions) {
    if (session.date !== date) continue;
    const msgs = session.messages.filter(m => m.slotId === slotId);
    if (!msgs.length) continue;
    const betTotal = msgs.reduce((s, m) => s + (m.overrideResult ?? m.result).total, 0);
    const pid = `${session.contact}|${slotId}|${date}`;
    const pr  = payments.find(p => p.id === pid);
    rows.push({ contact: session.contact, betTotal, amountPaid: pr?.amountPaid ?? null, paymentId: pid });
  }
  return rows.sort((a, b) => a.contact.localeCompare(b.contact));
}

// Monthly breakdown: per-day totals from sessions + payment records
interface DaySummary {
  date:      string;
  totalBets: number;
  received:  number;
  earned:    number;
  pending:   number;
}
function getMonthData(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  commissionPct: number,
  year: number,
  month: number, // 1-indexed
): { days: DaySummary[]; totalBets: number; totalReceived: number; totalEarned: number; totalPending: number } {
  // Collect every date in this month that has sessions or payments
  const allDates = new Set<string>();
  for (const s of sessions) {
    const p = s.date.split("/");
    if (p.length >= 3 && parseInt(p[1]) === month && parseInt(p[2]) === year) allDates.add(s.date);
  }
  for (const p of payments) {
    const parts = p.date.split("/");
    if (parts.length >= 3 && parseInt(parts[1]) === month && parseInt(parts[2]) === year) allDates.add(p.date);
  }

  const days: DaySummary[] = [];
  for (const date of allDates) {
    const totalBets = sessions
      .filter(s => s.date === date)
      .reduce((sum, s) => sum + s.messages.reduce((ms, m) => ms + (m.overrideResult ?? m.result).total, 0), 0);
    const received = payments
      .filter(p => p.date === date && p.amountPaid !== null)
      .reduce((sum, p) => sum + (p.amountPaid ?? 0), 0);
    if (totalBets === 0 && received === 0) continue;
    const earned  = Math.round(received * commissionPct) / 100;
    const pending = Math.max(0, totalBets - received);
    days.push({ date, totalBets, received, earned, pending });
  }

  days.sort((a, b) => compareDates(b.date, a.date));
  const totalBets     = days.reduce((s, d) => s + d.totalBets, 0);
  const totalReceived = days.reduce((s, d) => s + d.received, 0);
  const totalEarned   = Math.round(totalReceived * commissionPct) / 100;
  const totalPending  = days.reduce((s, d) => s + d.pending, 0);
  return { days, totalBets, totalReceived, totalEarned, totalPending };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Component ────────────────────────────────────────────────────────────────

type ViewMode = "daily" | "monthly";

export default function GamesView({ sessions, slots, payments, settings, onSavePayments }: Props) {
  const today = todayStr();
  const nowDate = new Date();

  const [viewMode,     setViewMode]     = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [openSlots,    setOpenSlots]    = useState<Set<string>>(new Set());
  const [editState,    setEditState]    = useState<{ id: string; value: string } | null>(null);
  const [monthYear,    setMonthYear]    = useState({ year: nowDate.getFullYear(), month: nowDate.getMonth() + 1 });

  const enabledSlots = slots
    .filter(s => s.enabled)
    .sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));

  const isToday      = selectedDate === today;
  const isFuture     = compareDates(selectedDate, today) > 0;
  const activeSlotId = getCurrentSlot(slots).id;

  // ── Daily slot data ─────────────────────────────────────────────────────────

  const slotUsers = useCallback(
    (slotId: string) => getSlotUsers(sessions, payments, slotId, selectedDate),
    [sessions, payments, selectedDate],
  );

  const slotSummary = (slotId: string) => {
    const users     = slotUsers(slotId);
    const totalBets = users.reduce((s, u) => s + u.betTotal, 0);
    const received  = users.reduce((s, u) => s + (u.amountPaid ?? 0), 0);
    const myEarning = Math.round(received * settings.commissionPct) / 100;
    return { totalBets, received, myEarning, count: users.length };
  };

  const daySummary = () => {
    const all = enabledSlots.map(s => slotSummary(s.id));
    return {
      totalBets:  all.reduce((s, x) => s + x.totalBets, 0),
      received:   all.reduce((s, x) => s + x.received, 0),
      myEarning:  all.reduce((s, x) => s + x.myEarning, 0),
    };
  };

  // ── Payment editing ─────────────────────────────────────────────────────────

  const startEdit = (paymentId: string, current: number | null) =>
    setEditState({ id: paymentId, value: current !== null ? String(current) : "" });

  const saveEdit = (paymentId: string, contact: string, slotId: string, slotName: string) => {
    if (!editState || editState.id !== paymentId) return;
    const raw    = editState.value.trim();
    const amount = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && isNaN(amount!)) return;
    onSavePayments(upsertPayment(payments, { id: paymentId, contact, slotId, slotName, date: selectedDate, amountPaid: amount }));
    setEditState(null);
  };

  const toggleSlot = (id: string) =>
    setOpenSlots(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Month navigation ────────────────────────────────────────────────────────

  const shiftMonth = (delta: number) => {
    setMonthYear(prev => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m > 12) { m = 1;  y++; }
      if (m < 1)  { m = 12; y--; }
      return { year: y, month: m };
    });
  };

  const canGoNextMonth =
    monthYear.year < nowDate.getFullYear() ||
    (monthYear.year === nowDate.getFullYear() && monthYear.month < nowDate.getMonth() + 1);

  // ── Render ──────────────────────────────────────────────────────────────────

  const { totalBets, received: dayReceived, myEarning: dayEarning } = daySummary();
  const { days: monthDays, totalBets: monthBets, totalReceived: monthReceived, totalEarned: monthEarned, totalPending: monthPending } =
    getMonthData(sessions, payments, settings.commissionPct, monthYear.year, monthYear.month);

  return (
    <div className="w-full max-w-[640px] mx-auto">

      {/* ── View toggle ── */}
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
            {mode === "daily"   ? "📅 Daily View"   : "📊 Monthly View"}
          </button>
        ))}
      </div>

      {/* ══════════════════ DAILY VIEW ══════════════════ */}
      {viewMode === "daily" && (
        <>
          {/* Date navigator */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedDate(d => shiftDate(d, -1))}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white border-2 border-[#dde8f8] text-[#1d6fb8] font-bold shadow-sm active:bg-[#e8f0fc] text-3xl"
            >‹</button>
            <div className="text-center">
              <div className="text-[22px] font-extrabold text-[#1a1a1a]">{displayDate(selectedDate)}</div>
              <div className="text-[13px] text-gray-400">{selectedDate}</div>
            </div>
            <button
              onClick={() => { if (!isFuture) setSelectedDate(d => shiftDate(d, 1)); }}
              disabled={isFuture}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl border-2 font-bold shadow-sm text-3xl ${
                !isFuture
                  ? "bg-white border-[#dde8f8] text-[#1d6fb8] active:bg-[#e8f0fc]"
                  : "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
              }`}
            >›</button>
          </div>

          {/* Prominent Earnings Card */}
          {dayEarning > 0 && (
            <div className="bg-[#1a3a5c] rounded-[20px] px-5 py-5 mb-4 shadow-[0_6px_28px_rgba(26,58,92,0.30)] flex items-center justify-between">
              <div>
                <div className="text-[13px] font-bold text-white/60 uppercase tracking-widest mb-1">
                  💰 My Earnings — {displayDate(selectedDate)}
                </div>
                <div className="text-[48px] font-extrabold text-white leading-none">₹{dayEarning}</div>
                <div className="text-[14px] text-white/60 mt-1">
                  {settings.commissionPct}% of ₹{dayReceived} received
                </div>
              </div>
              <div className="text-[52px] leading-none opacity-20">💵</div>
            </div>
          )}

          {/* Day summary (game total + received) */}
          {(totalBets > 0 || dayReceived > 0) && (
            <div className="bg-[#1d6fb8] rounded-[20px] px-5 py-4 mb-4 shadow-[0_4px_20px_rgba(29,111,184,0.25)]">
              <div className="text-[12px] font-bold text-white/60 uppercase tracking-widest mb-3 text-center">
                Day Summary
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Total Game",  value: totalBets    },
                  { label: "I Received",  value: dayReceived  },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/15 rounded-[14px] px-3 py-3 text-center">
                    <div className="text-[12px] text-white/70 font-semibold mb-1">{label}</div>
                    <div className="text-[24px] font-extrabold text-white leading-none">₹{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slot cards */}
          <div className="space-y-4">
            {enabledSlots.map(slot => {
              const status  = getSlotStatus(slot, activeSlotId, isToday);
              const users   = slotUsers(slot.id);
              const summary = slotSummary(slot.id);
              const isOpen  = openSlots.has(slot.id);
              const { badge, label: statusLabel } = STATUS_STYLE[status];

              return (
                <div key={slot.id} className="bg-white rounded-[20px] shadow-sm border-2 border-[#e4edf8] overflow-hidden">
                  {/* Slot header */}
                  <button
                    onClick={() => toggleSlot(slot.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#f5f9ff] active:bg-[#eef4ff] transition-colors text-left"
                  >
                    <span className="text-[32px] leading-none shrink-0">{slot.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[19px] font-extrabold text-[#1a1a1a] leading-tight">{slot.name} Game</div>
                      <div className="text-[13px] text-gray-500 mt-0.5">Result at {formatSlotTime(slot.time)}</div>
                      {summary.count > 0 ? (
                        <div className="text-[13px] text-gray-400 mt-1">
                          {summary.count} {summary.count === 1 ? "person" : "people"} ·{" "}
                          Received <span className="font-bold text-[#1d6fb8]">₹{summary.received}</span> of ₹{summary.totalBets}
                        </div>
                      ) : (
                        <div className="text-[13px] text-gray-300 mt-0.5">No entries yet</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {isToday && (
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${badge}`}>{statusLabel}</span>
                      )}
                      {summary.myEarning > 0 && (
                        <span className="text-[12px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                          +₹{summary.myEarning}
                        </span>
                      )}
                      <span className="text-[#1d6fb8] text-[18px] font-bold mt-1">{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded user cards */}
                  {isOpen && (
                    <div className="border-t-2 border-[#eef2f8]">
                      {users.length === 0 ? (
                        <div className="px-5 py-8 text-center">
                          <div className="text-[32px] mb-2">📭</div>
                          <div className="text-[16px] font-semibold text-gray-400">No one sent numbers for this game yet.</div>
                        </div>
                      ) : (
                        <>
                          <div className="divide-y-2 divide-[#f0f4f8]">
                            {users.map(user => {
                              const pending     = user.betTotal - (user.amountPaid ?? 0);
                              const isEditing   = editState?.id === user.paymentId;
                              const notRecorded = user.amountPaid === null;
                              const fullyPaid   = !notRecorded && pending === 0;
                              const hasDebt     = !notRecorded && pending > 0;
                              const overpaid    = !notRecorded && pending < 0;

                              return (
                                <div key={user.contact} className="px-5 py-4">
                                  <div className="text-[17px] font-extrabold text-[#1a1a1a] mb-1">👤 {user.contact}</div>
                                  <div className="text-[15px] text-gray-500 mb-3">
                                    Game total: <span className="font-bold text-[#1a1a1a]">₹{user.betTotal}</span>
                                  </div>

                                  {isEditing ? (
                                    <div className="bg-[#f0f6ff] border-2 border-[#1d6fb8] rounded-[14px] p-4">
                                      <div className="text-[14px] font-semibold text-gray-600 mb-2">How much did you receive? (₹)</div>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min="0"
                                        value={editState!.value}
                                        onChange={e => setEditState({ id: user.paymentId, value: e.target.value })}
                                        onKeyDown={e => {
                                          if (e.key === "Enter")  saveEdit(user.paymentId, user.contact, slot.id, slot.name);
                                          if (e.key === "Escape") setEditState(null);
                                        }}
                                        autoFocus
                                        placeholder={String(user.betTotal)}
                                        className="w-full text-[26px] font-extrabold text-center border-2 border-[#1d6fb8] rounded-[12px] px-4 py-3 outline-none mb-3 bg-white"
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => saveEdit(user.paymentId, user.contact, slot.id, slot.name)}
                                          className="flex-1 py-3 bg-green-600 text-white text-[16px] font-bold rounded-[12px] active:opacity-80"
                                        >✓ Save</button>
                                        <button
                                          onClick={() => setEditState(null)}
                                          className="px-5 py-3 bg-gray-100 text-gray-500 text-[16px] font-semibold rounded-[12px] active:opacity-80"
                                        >Cancel</button>
                                      </div>
                                    </div>
                                  ) : notRecorded ? (
                                    <button
                                      onClick={() => startEdit(user.paymentId, null)}
                                      className="w-full py-4 bg-[#1d6fb8] text-white text-[16px] font-bold rounded-[14px] flex items-center justify-center gap-2 active:opacity-80 shadow-sm"
                                    >👆 Tap to enter amount received</button>
                                  ) : fullyPaid ? (
                                    <div className="flex items-center justify-between bg-green-50 border-2 border-green-200 rounded-[14px] px-4 py-3">
                                      <div>
                                        <div className="text-[13px] text-gray-500">You received:</div>
                                        <div className="text-[20px] font-extrabold text-green-700">₹{user.amountPaid}</div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1.5">
                                        <span className="text-[13px] font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">✅ Fully Paid</span>
                                        <button onClick={() => startEdit(user.paymentId, user.amountPaid)} className="text-[12px] text-gray-400 underline">Edit</button>
                                      </div>
                                    </div>
                                  ) : hasDebt ? (
                                    <div className="rounded-[14px] border-2 border-orange-200 overflow-hidden">
                                      <div className="flex items-center justify-between bg-orange-50 px-4 py-3">
                                        <div>
                                          <div className="text-[13px] text-gray-500">You received:</div>
                                          <div className="text-[20px] font-extrabold text-[#1d6fb8]">₹{user.amountPaid}</div>
                                        </div>
                                        <button onClick={() => startEdit(user.paymentId, user.amountPaid)} className="text-[13px] text-gray-400 underline">Edit</button>
                                      </div>
                                      <div className="bg-orange-100 px-4 py-2.5 text-center">
                                        <span className="text-[15px] font-extrabold text-orange-700">⚠️ Still Owes: ₹{pending}</span>
                                      </div>
                                    </div>
                                  ) : overpaid ? (
                                    <div className="flex items-center justify-between bg-blue-50 border-2 border-blue-200 rounded-[14px] px-4 py-3">
                                      <div>
                                        <div className="text-[13px] text-gray-500">You received:</div>
                                        <div className="text-[20px] font-extrabold text-blue-700">₹{user.amountPaid}</div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1.5">
                                        <span className="text-[13px] font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">Extra: ₹{Math.abs(pending)}</span>
                                        <button onClick={() => startEdit(user.paymentId, user.amountPaid)} className="text-[12px] text-gray-400 underline">Edit</button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          {/* Slot footer */}
                          <div className="border-t-2 border-[#eef2f8] bg-[#f8faff] px-5 py-4 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-[14px] font-semibold text-gray-500">Game Total</span>
                              <span className="text-[17px] font-extrabold text-gray-700">₹{summary.totalBets}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[14px] font-semibold text-gray-500">I Received</span>
                              <span className="text-[17px] font-extrabold text-[#1d6fb8]">₹{summary.received}</span>
                            </div>
                            {summary.totalBets - summary.received > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-[14px] font-semibold text-orange-600">Still Pending</span>
                                <span className="text-[17px] font-extrabold text-orange-600">₹{summary.totalBets - summary.received}</span>
                              </div>
                            )}
                          </div>
                          {summary.received > 0 && (
                            <div className="bg-green-50 border-t-2 border-green-100 px-5 py-3.5 flex items-center justify-between">
                              <div>
                                <div className="text-[14px] font-extrabold text-green-700">💰 My Earnings</div>
                                <div className="text-[12px] text-green-600">{settings.commissionPct}% of ₹{summary.received}</div>
                              </div>
                              <span className="text-[22px] font-extrabold text-green-700">₹{summary.myEarning}</span>
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
              <div className="text-[16px] font-semibold">No games set up yet.</div>
              <div className="text-[14px] mt-1">Go to Settings to add games.</div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════ MONTHLY VIEW ══════════════════ */}
      {viewMode === "monthly" && (
        <>
          {/* Month navigator */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => shiftMonth(-1)}
              className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white border-2 border-[#dde8f8] text-[#1d6fb8] font-bold shadow-sm active:bg-[#e8f0fc] text-3xl"
            >‹</button>
            <div className="text-center">
              <div className="text-[22px] font-extrabold text-[#1a1a1a]">
                {MONTH_NAMES[monthYear.month - 1]}
              </div>
              <div className="text-[14px] text-gray-400">{monthYear.year}</div>
            </div>
            <button
              onClick={() => { if (canGoNextMonth) shiftMonth(1); }}
              disabled={!canGoNextMonth}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl border-2 font-bold shadow-sm text-3xl ${
                canGoNextMonth
                  ? "bg-white border-[#dde8f8] text-[#1d6fb8] active:bg-[#e8f0fc]"
                  : "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
              }`}
            >›</button>
          </div>

          {/* Big monthly earnings card */}
          <div className={`rounded-[22px] px-6 py-6 mb-5 ${
            monthEarned > 0
              ? "bg-[#1a3a5c] shadow-[0_6px_28px_rgba(26,58,92,0.35)]"
              : "bg-gray-200 shadow"
          }`}>
            <div className={`text-[13px] font-bold uppercase tracking-widest mb-1 ${monthEarned > 0 ? "text-white/60" : "text-gray-500"}`}>
              💰 My Earnings — {MONTH_NAMES[monthYear.month - 1]} {monthYear.year}
            </div>
            <div className={`text-[56px] font-extrabold leading-none mb-1 ${monthEarned > 0 ? "text-white" : "text-gray-500"}`}>
              ₹{monthEarned}
            </div>
            {monthReceived > 0 && (
              <div className="text-[15px] text-white/60">
                {settings.commissionPct}% of ₹{monthReceived} total received
              </div>
            )}

            {/* Sub-stats */}
            {monthBets > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                  { label: "Days",      value: String(monthDays.length) },
                  { label: "Received",  value: `₹${monthReceived}` },
                  { label: "Pending",   value: `₹${monthPending}` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/15 rounded-[14px] px-2 py-3 text-center">
                    <div className="text-[10px] text-white/70 font-semibold mb-1">{label}</div>
                    <div className="text-[18px] font-extrabold text-white leading-none">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-day breakdown */}
          {monthDays.length === 0 ? (
            <div className="bg-white rounded-[20px] border-2 border-[#e4edf8] px-5 py-12 text-center shadow-sm">
              <div className="text-[40px] mb-3">📭</div>
              <div className="text-[17px] font-bold text-gray-400">No payments recorded</div>
              <div className="text-[14px] text-gray-400 mt-1">
                for {MONTH_NAMES[monthYear.month - 1]} {monthYear.year}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {monthDays.map(day => (
                <button
                  key={day.date}
                  onClick={() => { setSelectedDate(day.date); setViewMode("daily"); }}
                  className="w-full bg-white rounded-[18px] border-2 border-[#e4edf8] px-4 py-4 shadow-sm hover:border-[#c5d8f0] active:bg-[#f0f6ff] transition-colors text-left"
                >
                  {/* Date row */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-[18px] font-extrabold text-[#1a1a1a]">
                        {parseDate(day.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                      <span className="text-[13px] text-gray-400 ml-2">
                        {parseDate(day.date).toLocaleDateString("en-IN", { weekday: "long" })}
                      </span>
                    </div>
                    <span className="text-[#1d6fb8] text-[13px] font-bold">View ›</span>
                  </div>

                  {/* 3 stat boxes */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-[#f0f6ff] rounded-[12px] px-2 py-2.5 text-center">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Received</div>
                      <div className="text-[17px] font-extrabold text-[#1d6fb8] leading-none">₹{day.received}</div>
                    </div>
                    <div className="bg-green-50 rounded-[12px] px-2 py-2.5 text-center">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">My Earning</div>
                      <div className="text-[17px] font-extrabold text-green-700 leading-none">₹{day.earned}</div>
                    </div>
                    <div className={`rounded-[12px] px-2 py-2.5 text-center ${day.pending > 0 ? "bg-orange-50" : "bg-gray-50"}`}>
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Pending</div>
                      <div className={`text-[17px] font-extrabold leading-none ${day.pending > 0 ? "text-orange-600" : "text-gray-400"}`}>
                        ₹{day.pending}
                      </div>
                    </div>
                  </div>
                </button>
              ))}

              {/* Month grand total card */}
              <div className="bg-[#1a3a5c] rounded-[18px] px-4 py-4 shadow-[0_4px_16px_rgba(26,58,92,0.25)]">
                <div className="text-[12px] font-bold text-white/60 uppercase tracking-widest mb-3">
                  Month Total — {MONTH_NAMES[monthYear.month - 1]} {monthYear.year}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Received",   value: monthReceived, color: "text-white"        },
                    { label: "My Earning", value: monthEarned,   color: "text-green-300"    },
                    { label: "Pending",    value: monthPending,  color: "text-orange-300"   },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/10 rounded-[12px] px-2 py-3 text-center">
                      <div className="text-[10px] text-white/60 font-semibold uppercase tracking-wide mb-1">{label}</div>
                      <div className={`text-[18px] font-extrabold leading-none ${color}`}>₹{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
