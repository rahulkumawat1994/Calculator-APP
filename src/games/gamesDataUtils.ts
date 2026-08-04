import {
  mergeSessionLedgerResult,
  sessionLedgerForSlotKey,
  slotMinutes,
} from "@/lib";
import type {
  CalculationResult,
  GameSlot,
  PaymentRecord,
  SavedSession,
  Segment,
} from "@/types";
import { compareDates } from "./dateUtils";

export type SlotStatus = "active" | "upcoming" | "closed";

export function getSlotStatus(
  slot: GameSlot,
  activeSlotId: string,
  isToday: boolean,
): SlotStatus {
  if (!isToday) return "closed";
  if (slot.id === activeSlotId) return "active";
  const now = new Date();
  return slotMinutes(slot.time) <= now.getHours() * 60 + now.getMinutes()
    ? "closed"
    : "upcoming";
}

export const STATUS_STYLE: Record<
  SlotStatus,
  { badge: string; label: string }
> = {
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

export interface UserRow {
  contact: string;
  betTotal: number;
  amountPaid: number | null;
  commissionPct: number | undefined;
  paymentId: string;
  segments: Segment[];
  sessionId: string;
  slotLedger: CalculationResult;
}

export function buildSlotUsers(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  slotId: string,
  date: string,
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

export interface DaySummary {
  date: string;
  totalBets: number;
  received: number;
  earned: number;
  pending: number;
}

export function buildMonthData(
  sessions: SavedSession[],
  payments: PaymentRecord[],
  commissionPct: number,
  year: number,
  month: number,
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
      (p) => p.date === date && p.amountPaid !== null,
    );
    const received = dayPayments.reduce(
      (sum, p) => sum + (p.amountPaid ?? 0),
      0,
    );
    if (totalBets === 0 && received === 0) continue;
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
