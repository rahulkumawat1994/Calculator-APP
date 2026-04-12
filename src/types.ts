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
}

export interface SavedMessage {
  id: string;
  timestamp: string;
  text: string;
  result: CalculationResult;
}

export interface SavedSession {
  id: string;
  contact: string;
  date: string;
  messages: SavedMessage[];
  createdAt: number;
}
