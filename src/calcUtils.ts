import type { Segment, CalculationResult, SavedMessage, SavedSession } from './types';

// ─── Number helpers ────────────────────────────────────────────────────────────

function reverseNumber(num: number): number {
  return parseInt(String(num).padStart(2, '0').split('').reverse().join(''), 10);
}

function normalizePair(num: number): string {
  const r = reverseNumber(num);
  return [num, r].sort().join('-');
}

function countSegment(allNumbers: number[], isWP: boolean): number {
  if (!isWP) return new Set(allNumbers).size;
  const seen = new Set<string>();
  let count = 0;
  for (const n of allNumbers) {
    const key = normalizePair(n);
    if (!seen.has(key)) {
      seen.add(key);
      count += n === reverseNumber(n) ? 1 : 2;
    }
  }
  return count;
}

// Splits digit blocks into 2-digit pairs: "8307" → [83, 07]
function extractPairedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const block of text.match(/\d+/g) ?? []) {
    if (block.length === 1) continue;
    if (block.length === 2) { out.push(Number(block)); }
    else { for (let i = 0; i + 1 < block.length; i += 2) out.push(Number(block.slice(i, i + 2))); }
  }
  return out;
}

// ─── Line parser ───────────────────────────────────────────────────────────────

export function processLine(line: string): Segment[] {
  // ── Normalize paren typos before parsing ──────────────────────────────────
  // Handles the common variations a human might type:
  //   (rate/suffix   (rate\suffix   (rate|suffix   (rate.suffix
  //   (rate suffix)  (ratesuffix)   ( rate )       (rate        ← missing close
  const trimmed = line
    .trim()
    // (rate / \ | . suffix)  or  (rate / \ | . suffix  (any non-alpha separator)
    .replace(/\(\s*(\d+)\s*[\/\\|.]\s*([a-zA-Z]*)\s*\)?/g, '($1)$2')
    // (rate suffix)  or  (rate suffix  (space between rate and suffix)
    .replace(/\(\s*(\d+)\s+([a-zA-Z]+)\s*\)?/g, '($1)$2')
    // (ratesuffix)  or  (ratesuffix  (no separator at all)
    .replace(/\(\s*(\d+)([a-zA-Z]+)\s*\)?/g, '($1)$2')
    // ( rate )  (spaces inside parens, no suffix)
    .replace(/\(\s*(\d+)\s*\)/g, '($1)')
    // (rate  (only opening paren, nothing after digits — add closing)
    .replace(/\(\s*(\d+)\s*$/g, '($1)');
  if (!trimmed) return [];
  const results: Segment[] = [];
  let match: RegExpExecArray | null;

  // Paren format: numbers(rate)[suffix]
  const parenPattern = /([^()]*)\((\d+)\)\s*([a-zA-Z]*)/gi;
  while ((match = parenPattern.exec(trimmed)) !== null) {
    const nums = (match[1].match(/(?<!\d)\d{2}(?!\d)/g) ?? []).map(Number);
    if (!nums.length) continue;
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix), isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const display = match[1].replace(/^[\s*\-_.,:|]+|[\s*\-_.,:|]+$/g, '').trim();
      results.push({ line: display || match[1].trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
    }
  }
  if (results.length) return results;

  // X format: [prefix][numbers]x[rate][suffix]
  const xPattern = /([^x]*)x(\d+)\s*([a-zA-Z]*)/gi;
  while ((match = xPattern.exec(trimmed)) !== null) {
    const nums = extractPairedNumbers(match[1]);
    if (!nums.length) continue;
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix), isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const display = match[1].replace(/^\D+/, '').replace(/\D+$/, '').trim();
      results.push({ line: display || match[1].trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
    }
  }
  if (results.length) return results;

  // Equals format: numbers=+[rate][suffix]
  const eqPattern = /([^=]*)=+(\d+)\s*([a-zA-Z]*)/gi;
  while ((match = eqPattern.exec(trimmed)) !== null) {
    const nums = extractPairedNumbers(match[1]);
    if (!nums.length) continue;
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix), isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const display = match[1].replace(/^\D+/, '').replace(/\D+$/, '').trim();
      results.push({ line: display || match[1].trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
    }
  }
  if (results.length) return results;

  // Plain comma format: last number = rate, any trailing text = WP indicator
  if (/,/.test(trimmed)) {
    const all = [...trimmed.matchAll(/\d+/g)];
    if (all.length >= 2) {
      const last = all[all.length - 1];
      const after = trimmed.slice((last.index ?? 0) + last[0].length);
      const isDouble = /[ab]/i.test(after);
      const isWP = /\S/.test(after) && !/^[ab\s]+$/i.test(after.trim());
      const rate = Number(last[0]);
      const nums = extractPairedNumbers(trimmed.slice(0, last.index));
      if (nums.length > 0) {
        const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
        if (count > 0) {
          const display = trimmed.slice(0, last.index).replace(/[,\s.]+$/, '').trim();
          results.push({ line: display, rate, isWP, isDouble, count, lineTotal: count * rate });
        }
      }
    }
  }
  return results;
}

// ─── Text preprocessor & total calculator ─────────────────────────────────────

export function preprocessText(text: string): string {
  return text.replace(/\[[^\]]*\]\s*[^:]+:\s*/g, '\n').trim();
}

function extractFirstRate(line: string): { rate: number; suffix: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/\((\d+)\)\s*([a-zA-Z]*)/i))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  if ((m = line.match(/[xX](\d+)\s*([a-zA-Z]*)/))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  if ((m = line.match(/=+(\d+)\s*([a-zA-Z]*)/))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  return null;
}

export function calculateTotal(text: string): CalculationResult {
  const cleaned = preprocessText(text);
  const rawLines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  const mergedLines: string[] = [];
  let pending = '';

  for (const line of rawLines) {
    const hasExplicitRate = /\(\d+\)/.test(line) || /x\d+/i.test(line) || /=\d+/.test(line);
    const hasCommaRate = /,/.test(line);
    if (!hasExplicitRate && !hasCommaRate) {
      pending = pending ? pending + ' ' + line : line;
    } else {
      if (pending) {
        const ri = extractFirstRate(line);
        mergedLines.push(ri ? `${pending}(${ri.rate})${ri.suffix}` : pending + ' ' + line);
        pending = '';
      }
      mergedLines.push(line);
    }
  }
  if (pending) mergedLines.push(pending);

  const results = mergedLines.flatMap(processLine);
  return { results, total: results.reduce((s, r) => s + r.lineTotal, 0) };
}

// ─── WhatsApp message parser ───────────────────────────────────────────────────

export interface ParsedMessage {
  id?: string;
  contact: string;
  date: string;
  timestamp: string;
  text: string;
  result: CalculationResult;
}

export function parseWhatsAppMessages(input: string): ParsedMessage[] | null {
  if (!/\[[^\]]*\]\s*[^:\n]+:/.test(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n]+):\s*/g;
  const headers: Array<{ index: number; end: number; contact: string; date: string; timestamp: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    const content = match[1];
    const contact = match[2].trim();
    const dateM = content.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const timeM = content.match(/(\d{1,2}:\d{2}(?:\s*[ap]m)?)/i);
    headers.push({
      index: match.index,
      end: match.index + match[0].length,
      contact,
      date: dateM?.[1] ?? '',
      timestamp: timeM?.[1] ?? content,
    });
  }

  if (!headers.length) return null;

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const textEnd = i + 1 < headers.length ? headers[i + 1].index : input.length;
    const text = input.slice(h.end, textEnd).trim();
    if (!text) continue;
    // Include index so messages at the same minute get unique IDs.
    // Pasting the same conversation twice will produce the same index → dedup still works.
    messages.push({
      id: `${h.contact}|${h.date}|${h.timestamp}|${i}`,
      contact: h.contact,
      date: h.date,
      timestamp: h.timestamp,
      text,
      result: calculateTotal(text),
    });
  }

  return messages.length ? messages : null;
}

// ─── Session management ────────────────────────────────────────────────────────

export function mergeIntoSessions(
  existing: SavedSession[],
  messages: ParsedMessage[]
): SavedSession[] {
  const updated = existing.map(s => ({ ...s, messages: [...s.messages] }));

  for (const msg of messages) {
    const msgId = msg.id ?? `${msg.contact}|${msg.date}|${msg.timestamp}`;
    const savedMsg: SavedMessage = {
      id: msgId,
      timestamp: msg.timestamp,
      text: msg.text,
      result: msg.result,
    };
    const session = updated.find(s => s.contact === msg.contact && s.date === msg.date);
    if (session) {
      if (!session.messages.find(m => m.id === msgId)) session.messages.push(savedMsg);
    } else {
      updated.push({
        id: `${msg.contact}|${msg.date}`,
        contact: msg.contact,
        date: msg.date,
        messages: [savedMsg],
        createdAt: Date.now(),
      });
    }
  }
  return updated;
}

const STORAGE_KEY = 'calc_sessions_v1';

export function loadSessions(): SavedSession[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedSession[]; }
  catch { return []; }
}

export function saveSessions(sessions: SavedSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
