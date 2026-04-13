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
  failedLines?: string[]; // lines that produced 0 output (no rate found / no valid numbers)
}

export interface SavedMessage {
  id: string;
  timestamp: string;
  text: string;
  result: CalculationResult;
  overrideResult?: CalculationResult; // stores user-edited breakdown for this individual entry
}

export interface SavedSession {
  id: string;
  contact: string;
  date: string;
  messages: SavedMessage[];
  createdAt: number;
  overrideResult?: CalculationResult; // stores user-edited breakdown
}
