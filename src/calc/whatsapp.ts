import type { ParsedMessage } from "../types";
import { calculateTotal } from "./pasteAndTotal";

// ─── WhatsApp message parser ───────────────────────────────────────────────────

function formatLedgerDate(day: number, month: number, year: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function daysFromReference(
  day: number,
  month: number,
  year: number,
  reference: Date,
): number {
  const candidate = new Date(year, month - 1, day);
  const ref = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
  );
  return Math.abs(candidate.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Resolve short `a/b` headers that can be DD/MM or MM/DD (e.g. `8/4`).
 * Picks the interpretation closest to `reference` (usually today).
 */
function parseAmbiguousShortDate(
  a: string,
  b: string,
  year: number,
  reference: Date,
): string {
  const n1 = parseInt(a, 10);
  const n2 = parseInt(b, 10);
  const candidates: Array<{ day: number; month: number }> = [];

  if (n1 >= 1 && n1 <= 31 && n2 >= 1 && n2 <= 12) {
    candidates.push({ day: n1, month: n2 });
  }
  if (n1 >= 1 && n1 <= 12 && n2 >= 1 && n2 <= 31) {
    const mmdd = { day: n2, month: n1 };
    if (!candidates.some((c) => c.day === mmdd.day && c.month === mmdd.month)) {
      candidates.push(mmdd);
    }
  }

  if (candidates.length === 0) return "";
  if (candidates.length === 1) {
    const c = candidates[0]!;
    return formatLedgerDate(c.day, c.month, year);
  }

  let best = candidates[0]!;
  let bestDistance = daysFromReference(best.day, best.month, year, reference);
  for (const candidate of candidates.slice(1)) {
    const distance = daysFromReference(
      candidate.day,
      candidate.month,
      year,
      reference,
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return formatLedgerDate(best.day, best.month, year);
}

function parseTwoPartDate(
  first: string,
  second: string,
  year: number,
  reference: Date,
): string {
  const n1 = parseInt(first, 10);
  const n2 = parseInt(second, 10);
  if (n1 > 12 && n2 >= 1 && n2 <= 12) {
    return formatLedgerDate(n1, n2, year);
  }
  if (n2 > 12 && n1 >= 1 && n1 <= 12) {
    return formatLedgerDate(n2, n1, year);
  }
  return parseAmbiguousShortDate(first, second, year, reference);
}

type ParsedHeaderDate = {
  date: string;
  /** True when the bracket starts with a date before the time — trust WhatsApp's date. */
  dateFirst: boolean;
};

function parseHeaderDate(
  content: string,
  reference: Date = new Date(),
): ParsedHeaderDate {
  const year = reference.getFullYear();

  const dateFirstFull = content.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*,/);
  if (dateFirstFull) {
    const y = parseInt(dateFirstFull[3]!, 10);
    return {
      date: parseTwoPartDate(dateFirstFull[1]!, dateFirstFull[2]!, y, reference),
      dateFirst: true,
    };
  }

  const dateFirstShort = content.match(/^(\d{1,2})\/(\d{1,2})\s*,/);
  if (dateFirstShort) {
    return {
      date: parseTwoPartDate(
        dateFirstShort[1]!,
        dateFirstShort[2]!,
        year,
        reference,
      ),
      dateFirst: true,
    };
  }

  const fullDateM = content.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (fullDateM) {
    const y = parseInt(fullDateM[3]!, 10);
    return {
      date: formatLedgerDate(
        parseInt(fullDateM[1]!, 10),
        parseInt(fullDateM[2]!, 10),
        y,
      ),
      dateFirst: false,
    };
  }

  return { date: "", dateFirst: false };
}

/**
 * If a WhatsApp message timestamp is before 06:00 AM, the message belongs to the
 * **previous** calendar date (the overnight portion of the same game day).
 * Only used for time-first headers — date-first headers already carry WhatsApp's date.
 */
function adjustWADateForOvernight(date: string, timestamp: string): string {
  if (!date) return date;
  const timeM = timestamp.match(/(\d{1,2}):(\d{2})(?:\s*([ap]m))?/i);
  if (!timeM) return date;
  let hours = parseInt(timeM[1]!, 10);
  const meridiem = timeM[3]?.toLowerCase();
  if (meridiem === "am" && hours === 12) hours = 0;
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (hours >= 6) return date;
  const parts = date.split("/");
  if (parts.length !== 3) return date;
  const dt = new Date(
    parseInt(parts[2]!, 10),
    parseInt(parts[1]!, 10) - 1,
    parseInt(parts[0]!, 10),
  );
  dt.setDate(dt.getDate() - 1);
  return formatLedgerDate(dt.getDate(), dt.getMonth() + 1, dt.getFullYear());
}

export type WaHeaderMessage = {
  contact: string;
  date: string;
  timestamp: string;
  text: string;
};

export function looksLikeWhatsApp(input: string): boolean {
  return /\[[^\]]*\]\s*[^:\n\uFF1A]+[\uFF1A:]/.test(input);
}

/** Header scan only — no `calculateTotal` (cheap for slot detection / labels while typing). */
export function parseWhatsAppHeaders(input: string): WaHeaderMessage[] | null {
  if (!looksLikeWhatsApp(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n\uFF1A]+)\s*[\uFF1A:]\s*/g;
  const headers: Array<{
    index: number;
    end: number;
    contact: string;
    date: string;
    timestamp: string;
  }> = [];

  const reference = new Date();
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    const content = match[1];
    const contact = match[2].trim();
    const { date, dateFirst } = parseHeaderDate(content, reference);
    const timeM = content.match(/(\d{1,2}:\d{2}(?:\s*[ap]m)?)/i);
    const timestamp = timeM?.[1] ?? content;
    const resolvedDate = dateFirst
      ? date
      : adjustWADateForOvernight(date, timestamp);
    headers.push({
      index: match.index,
      end: match.index + match[0].length,
      contact,
      date: resolvedDate,
      timestamp,
    });
  }

  if (!headers.length) return null;

  const messages: WaHeaderMessage[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const textEnd = i + 1 < headers.length ? headers[i + 1].index : input.length;
    const text = input.slice(h.end, textEnd).trim();
    if (!text) continue;
    messages.push({
      contact: h.contact,
      date: h.date,
      timestamp: h.timestamp,
      text,
    });
  }

  return messages.length ? messages : null;
}

export function parseWhatsAppMessages(input: string): ParsedMessage[] | null {
  const headers = parseWhatsAppHeaders(input);
  if (!headers) return null;

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const result = calculateTotal(h.text);
    if (result.results.length === 0 && (result.failedLines?.length ?? 0) === 0)
      continue;
    messages.push({
      id: `${h.contact}|${h.date}|${h.timestamp}|${i}`,
      contact: h.contact,
      date: h.date,
      timestamp: h.timestamp,
      text: h.text,
      result,
    });
  }

  return messages.length ? messages : null;
}

/**
 * When a paste looks like WhatsApp and contains **more than one distinct contact**
 * (each with at least one non-empty message body), returns one combined snippet per
 * contact so the UI can open separate text areas. Otherwise `null` (keep one area).
 */
export function splitWhatsAppInputByContact(
  input: string,
): { contact: string; text: string }[] | null {
  if (!looksLikeWhatsApp(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n\uFF1A]+)\s*[\uFF1A:]\s*/g;
  const headers: Array<{ index: number; end: number; contact: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    headers.push({
      index: match.index,
      end: match.index + match[0].length,
      contact: match[2].trim(),
    });
  }

  if (!headers.length) return null;

  const chunksByContact = new Map<string, string[]>();
  const order: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const textEnd = i + 1 < headers.length ? headers[i + 1].index : input.length;
    const body = input.slice(h.end, textEnd).trim();
    if (!body) continue;
    const block = input.slice(h.index, textEnd).trim();
    const key = h.contact;
    if (!chunksByContact.has(key)) {
      chunksByContact.set(key, []);
      order.push(key);
    }
    chunksByContact.get(key)!.push(block);
  }

  if (order.length <= 1) return null;

  return order.map((contact) => ({
    contact,
    text: chunksByContact.get(contact)!.join("\n\n"),
  }));
}
