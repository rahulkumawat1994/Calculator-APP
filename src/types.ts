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
  date: string;
  messages: SavedMessage[];
  createdAt: number;
  overrideResult?: CalculationResult;
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
  date: string;
  contact: string;
  amountPaid: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}
