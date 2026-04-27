import type { AppSettings, GameSlot, PaymentRecord } from "../types";
import { toDateISO } from "./sessions";

const SETTINGS_KEY = "calc_settings_v1";
const PAYMENTS_KEY = "calc_payments_v1";

export const DEFAULT_SETTINGS: AppSettings = { commissionPct: 5 };

export function loadSettings(): AppSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
}
export function saveSettings(s: AppSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* quota exceeded – ignore */ }
}

export function loadPaymentRecords(): PaymentRecord[] {
  try { return JSON.parse(localStorage.getItem(PAYMENTS_KEY) ?? '[]') as PaymentRecord[]; }
  catch { return []; }
}
export function savePaymentRecords(records: PaymentRecord[]): void {
  try { localStorage.setItem(PAYMENTS_KEY, JSON.stringify(records)); } catch { /* quota exceeded – ignore */ }
}

/**
 * Creates a PaymentRecord stub for each contact that doesn't already have one
 * for this slot + date combination.
 */
export function upsertPaymentStubs(
  existing: PaymentRecord[],
  contacts: string[],
  slot: GameSlot,
  date: string,
  commissionPct?: number,
): PaymentRecord[] {
  const dateISO = toDateISO(date);
  const updated  = [...existing];
  for (const contact of contacts) {
    const id = `${contact}|${slot.id}|${date}`;
    if (!updated.find(r => r.id === id)) {
      updated.push({
        id, slotId: slot.id, slotName: slot.name,
        date, dateISO, contact,
        amountPaid: null,
        ...(commissionPct !== undefined ? { commissionPct } : {}),
        notes: '',
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
  }
  return updated;
}

/** Creates or updates a payment record's amountPaid / commissionPct. */
export function upsertPayment(
  records: PaymentRecord[],
  patch: Pick<PaymentRecord, 'id' | 'contact' | 'slotId' | 'slotName' | 'date'> & {
    amountPaid: number | null;
    commissionPct?: number;
    notes?: string;
  }
): PaymentRecord[] {
  const now     = Date.now();
  const dateISO = toDateISO(patch.date);
  const idx     = records.findIndex(r => r.id === patch.id);
  if (idx >= 0) {
    const updated = [...records];
    updated[idx] = {
      ...updated[idx],
      amountPaid:    patch.amountPaid,
      notes:         patch.notes ?? updated[idx].notes,
      ...(patch.commissionPct !== undefined ? { commissionPct: patch.commissionPct } : {}),
      updatedAt: now,
    };
    return updated;
  }
  return [...records, {
    id: patch.id, slotId: patch.slotId, slotName: patch.slotName,
    date: patch.date, dateISO, contact: patch.contact,
    amountPaid: patch.amountPaid,
    ...(patch.commissionPct !== undefined ? { commissionPct: patch.commissionPct } : {}),
    notes: patch.notes ?? '',
    createdAt: now, updatedAt: now,
  }];
}
