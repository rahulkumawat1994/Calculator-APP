export interface Segment {
  line: string;
  rate: number;
  isWP: boolean;
  isDouble: boolean;
  count: number;
  lineTotal: number;
}

export interface CalculationResult {
  results: Segment[];
  total: number;
  failedLines?: string[];
}

export interface SavedMessage {
  id: string;
  timestamp: string;
  text: string;
  result: CalculationResult;
  overrideResult?: CalculationResult;
  slotId?: string;
}

export interface SavedSession {
  id: string;
  contact: string;
  date: string;      // "DD/MM/YYYY" — used for display & equality
  dateISO: string;   // "YYYY-MM-DD" — used for Firestore range queries
  messages: SavedMessage[];
  createdAt: number;
  /** Whole-session override (legacy); prefer slotOverrides for History edits */
  overrideResult?: CalculationResult;
  /** Per-slot merged breakdown overrides (History edits when a contact has slot-tagged messages) */
  slotOverrides?: Record<string, CalculationResult>;
}

export interface GameSlot {
  id: string;
  name: string;
  time: string; // "10:00" 24-hour format
  emoji: string;
  enabled: boolean;
}

export interface AppSettings {
  commissionPct: number;
}

export interface PaymentRecord {
  id: string; // `${contact}|${slotId}|${date}`
  slotId: string;
  slotName: string;
  date: string;      // "DD/MM/YYYY"
  dateISO: string;   // "YYYY-MM-DD"
  contact: string;
  amountPaid: number | null;
  commissionPct?: number; // snapshot at creation; falls back to global setting
  notes: string;
  createdAt: number;
  updatedAt: number;
}
