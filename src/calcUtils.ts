import type { Segment, CalculationResult, SavedMessage, SavedSession, GameSlot, AppSettings, PaymentRecord } from './types';

// ─── Number helpers ────────────────────────────────────────────────────────────

function reverseNumber(num: number): number {
  return parseInt(String(num).padStart(2, '0').split('').reverse().join(''), 10);
}

function normalizePair(num: number): string {
  const r = reverseNumber(num);
  return [num, r].sort().join('-');
}

/** Normal bets: every listed pair counts (58.58 → 2). WP/palat: unique pair families only. */
function countSegment(allNumbers: number[], isWP: boolean): number {
  if (!isWP) return allNumbers.length;
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

// ─── Flag detector ─────────────────────────────────────────────────────────────
// WP keywords: "wp", "w.p", "palat", Hindi "पलट" (reverse/pair).
// AB keywords: letter 'a'/'b', OR Hindi "अब" (literally "ab").
// Strip WP keywords first so "palat" (contains 'a') never accidentally triggers AB.
function parseFlags(text: string): { isWP: boolean; isDouble: boolean } {
  const isWP =
    /\bwp\b/i.test(text) ||
    /\bw\.?\s*p\b/i.test(text) ||
    /\bw\s+p\b/i.test(text) ||
    /\bpalat(?:e|el)?\b/i.test(text) ||
    /पलट/.test(text);
  const cleaned = text
    .replace(/\bwp\b/gi, "")
    .replace(/\bw\.?\s*p\b/gi, "")
    .replace(/\bw\s+p\b/gi, "")
    .replace(/\bpalat(?:e|el)?\b/gi, "")
    .replace(/पलट/g, "")
    .trim();
  const isDouble = /[ab]/i.test(cleaned) || /अब/.test(cleaned);
  return { isWP, isDouble };
}

/**
 * Returns true if the numbers text (before the rate) contains any standalone
 * 3-digit number (000–999). Per the game rules, a 3-digit number always implies
 * an AB (double) bet.
 */
function has3DigitBet(numbersText: string): boolean {
  return /(?<!\d)\d{3}(?!\d)/.test(numbersText);
}

/**
 * Same-digit run (333, 4444, 44444, …): AB / अब → count 2×rate; lone A or B → 1×rate.
 * A/B/AB may appear anywhere in modifierSource (before/after digits or rate). Rate digits
 * are stripped so *20 does not interfere. No WP/palat here — those use the normal pair path.
 */
function solidRunAbMultiplier(modifierSource: string): { count: number; isDouble: boolean } {
  let s = modifierSource;
  if (/अब/.test(s)) return { count: 2, isDouble: true };
  // Strip rate chunks only (do not treat the "x" inside "Ax333…" as ×rate).
  s = s
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\*\s*\d+/g, ' ')
    .replace(/=+\s*\d+/g, ' ')
    .replace(/(?:^|[\s,])x\s*\d+(?=$|[\s,]|[^0-9])/gi, ' ');
  if (/AB/i.test(s)) return { count: 2, isDouble: true };
  const noAb = s.replace(/AB/gi, '');
  if (/(?:^|[^A-Za-z])A(?:[^A-Za-z]|$)/i.test(noAb) || /(?:^|[^A-Za-z])B(?:[^A-Za-z]|$)/i.test(noAb))
    return { count: 1, isDouble: false };
  return { count: 1, isDouble: false };
}

/** One same-digit run length ≥ 3; no other digits outside that run in the numbers chunk. */
function trySolidRunSegment(
  numbersText: string,
  rate: number,
  modifierSource: string,
): Segment | null {
  const nt = numbersText.trim();
  if (!nt || !Number.isFinite(rate) || rate <= 0) return null;
  if (/\b(?:wp|palat(?:e|el)?)\b/i.test(modifierSource) || /पलट/.test(modifierSource)) return null;

  const rm = nt.match(/(\d)\1{2,}/);
  if (!rm || rm.index === undefined) return null;
  const run = rm[0];
  const bi = rm.index;
  const ai = bi + run.length;
  if (/\d/.test(nt.slice(0, bi)) || /\d/.test(nt.slice(ai))) return null;

  const { count, isDouble } = solidRunAbMultiplier(modifierSource);
  const display = nt.replace(/^[\s*\-_.,:|]+|[\s*\-_.,:|]+$/g, '').trim() || run;
  return { line: display, rate, isWP: false, isDouble, count, lineTotal: count * rate };
}

/** Same-digit run (length ≥ 3) for multi-x chain values. */
const SAME_DIGIT_RUN = /^(\d)\1{2,}$/;
const X_RATE_RE = /(?<![A-Za-z])x\s*\d+/i;
const SEP_RATE_RE = /(?<![A-Za-z])(?:x|=+|\*)\s*(\d+)\s*([a-zA-Z]*)/gi;

/**
 * If `trimmed` is `B.1111x9999x50` / `1111x2222x3333x10` shape, return prefix,
 * number chunks, and rate; otherwise null. Used by merge logic and parser.
 */
function parseMultiXChainStructure(trimmed: string): { pre: string; nums: string[]; rate: number } | null {
  const lead = trimmed.match(/^(AB|A|B)\.?\s*/i);
  const pre = lead ? `${lead[1].toUpperCase()}.` : "";
  const rest = lead ? trimmed.slice(lead[0].length).trim() : trimmed;
  const compact = rest.replace(/\s+/g, "");
  // Chain mode is strict: only digits + x separators (prevents words from splitting on x).
  if (!/^[0-9xX]+$/.test(compact)) return null;
  const parts = compact.split(/x+/i).filter(Boolean);
  if (parts.length < 3) return null;
  if (!parts.every(p => /^\d+$/.test(p))) return null;
  const rate = parseInt(parts[parts.length - 1], 10);
  if (!(rate > 0)) return null;
  const numParts = parts.slice(0, -1);
  for (const n of numParts) {
    if (!SAME_DIGIT_RUN.test(n)) return null;
  }
  return { pre, nums: numParts, rate };
}

/**
 * Chains like `B.1111x9999x50` → same rate (50) applied to each same-digit run
 * (1111, 9999, …); each is parsed like `B.1111x50` / `B.9999x50`. Runs must be
 * length ≥ 3 and one repeated digit. Optional leading A./B./AB. applies to every value.
 */
function tryParseMultiXSameDigitChain(trimmed: string, parseOne: (s: string) => Segment[]): Segment[] | null {
  const st = parseMultiXChainStructure(trimmed);
  if (!st) return null;
  const { pre, nums: numParts, rate } = st;
  const out: Segment[] = [];
  for (const n of numParts) {
    const syn = `${pre}${n}x${rate}`;
    const sub = parseOne(syn);
    if (sub.length !== 1) return null;
    out.push({ ...sub[0], line: pre ? `${pre}${n}` : n });
  }
  return out;
}

/**
 * Strip chained market/game prefixes like `Harf.` `GB.` `usa.` (any case).
 * Never removes betting modifiers `A.` `B.` `AB.` at the current start of the line.
 */
function stripLeadingGameLabels(s: string): string {
  let t = s.trim();
  let prev = "";
  while (t !== prev) {
    prev = t;
    const m = t.match(/^([A-Za-z]+)\.\s*/);
    if (!m) break;
    const word = m[1];
    if (/^AB$/i.test(word) || /^A$/i.test(word) || /^B$/i.test(word)) break;
    t = t.slice(m[0].length);
  }
  return t;
}

// ─── Line parser ───────────────────────────────────────────────────────────────

export function processLine(line: string, opts?: { skipMultiX?: boolean }): Segment[] {
  // ── Normalize paren typos before parsing ──────────────────────────────────
  // Handles the common variations a human might type:
  //   (rate/suffix   (rate\suffix   (rate|suffix   (rate.suffix
  //   (rate suffix)  (ratesuffix)   ( rate )       (rate        ← missing close
  const trimmed = normalizeTrailingDashRate(
    normalizeTypoTolerantInput(stripLeadingGameLabels(line)).replace(/\s*in\s*to\s*/gi, "x"),
  )
    // After merges, stray leading ". " from skipped separator lines
    .replace(/^[\s.]+/, "")
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
  if (!opts?.skipMultiX) {
    const multi = tryParseMultiXSameDigitChain(trimmed, s => processLine(s, { skipMultiX: true }));
    if (multi) return multi;
  }
  const results: Segment[] = [];
  let match: RegExpExecArray | null;

  // Paren format: numbers(rate)[suffix]
  const parenPattern = /([^()]*)\((\d+)\)\s*([a-zA-Z]*)/gi;
  while ((match = parenPattern.exec(trimmed)) !== null) {
    const numbersPart = match[1];
    const rate = parseInt(match[2], 10);
    const suffix = match[3] ?? '';
    const solid = trySolidRunSegment(numbersPart, rate, match[0]);
    if (solid) {
      results.push(solid);
      continue;
    }
    const nums = (numbersPart.match(/(?<!\d)\d{2}(?!\d)/g) ?? []).map(Number);
    if (!nums.length) continue;
    const { isWP, isDouble: isDoubleFlagged } = parseFlags(suffix);
    const isDouble = isDoubleFlagged || has3DigitBet(numbersPart);
    const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const display = numbersPart.replace(/^[\s*\-_.,:|]+|[\s*\-_.,:|]+$/g, '').trim();
      results.push({ line: display || numbersPart.trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
    }
  }
  if (results.length) return results;

  // ── Unified separator format ──────────────────────────────────────────────────
  // Handles x / = / * as rate separators, with optional spaces anywhere.
  // A single pass finds every rate marker; the text before each is the numbers portion.
  // Covers: 32-23*5, 32-23 * 5, 32-23x5, 32-23 x 5, 32-23=5, 32-23===5, etc.
  const sepMatches = [...trimmed.matchAll(SEP_RATE_RE)];
  if (sepMatches.length > 0) {
    let prevEnd = 0;
    for (let si = 0; si < sepMatches.length; si++) {
      const m = sepMatches[si];
      const numbersText = trimmed.slice(prevEnd, m.index);
      const rate = parseInt(m[1], 10);
      const suffix = m[2] ?? '';
      const clauseEnd = (m.index ?? 0) + m[0].length;
      const segmentSlice = trimmed.slice(prevEnd, clauseEnd);
      const solid = trySolidRunSegment(numbersText, rate, segmentSlice);
      if (solid) {
        results.push(solid);
        prevEnd = (m.index ?? 0) + m[0].length;
        continue;
      }
      const nums = extractPairedNumbers(numbersText);
      if (nums.length > 0) {
        const { isWP, isDouble: isDoubleFlagged } = parseFlags(suffix);
        const isDouble = isDoubleFlagged || has3DigitBet(numbersText);
        const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
        if (count > 0) {
          const display = numbersText.replace(/^\D+/, '').replace(/\D+$/, '').trim();
          results.push({ line: display || numbersText.trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
        }
      }
      prevEnd = (m.index ?? 0) + m[0].length;
    }
    if (results.length) return results;
  }

  // ── Space-separated flag format ──────────────────────────────────────────────
  // Handles: "444 10 Ab", "56 74 50 wp", "13 31 15 palat"
  // Last number before a flag keyword = rate; everything before = numbers.
  {
    const flagMatch = trimmed.match(/\b(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i);
    if (flagMatch && flagMatch.index !== undefined) {
      const beforeFlag = trimmed.slice(0, flagMatch.index).trim();
      const flagText = trimmed.slice(flagMatch.index);
      const allNumMatches = [...beforeFlag.matchAll(/\d+/g)];
      if (allNumMatches.length >= 2) {
        const lastNum = allNumMatches[allNumMatches.length - 1];
        const rate = Number(lastNum[0]);
        const numbersText = beforeFlag.slice(0, lastNum.index!);
        const solidF = trySolidRunSegment(numbersText, rate, trimmed);
        if (solidF) {
          results.push(solidF);
        } else {
          const nums = extractPairedNumbers(numbersText);
          if (nums.length > 0) {
            const { isWP, isDouble: isDoubleFlagged } = parseFlags(flagText);
            const isDouble = isDoubleFlagged || has3DigitBet(numbersText);
            const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
            if (count > 0) {
              const display = numbersText.replace(/^\D+/, '').replace(/\D+$/, '').trim();
              results.push({ line: display || numbersText.trim(), rate, isWP, isDouble, count, lineTotal: count * rate });
            }
          }
        }
      }
    }
  }
  if (results.length) return results;

  // Plain comma format: last number = rate, any trailing text = WP indicator
  if (/,/.test(trimmed)) {
    const all = [...trimmed.matchAll(/\d+/g)];
    if (all.length >= 2) {
      const last = all[all.length - 1];
      const after = trimmed.slice((last.index ?? 0) + last[0].length);
      const { isWP: isWPFlag, isDouble: isDoubleFlagged } = parseFlags(after);
      // Strip known AB indicator before the WP fallback check so "अब" doesn't
      // accidentally trigger WP (which fires on any unrecognised trailing text).
      const afterForWP = after.replace(/अब/g, '').replace(/[ab]/gi, '').trim();
      const isWP = isWPFlag || (/\S/.test(afterForWP) && afterForWP.length > 0);
      const rate = Number(last[0]);
      const numbersText = trimmed.slice(0, last.index);
      const solidC = trySolidRunSegment(numbersText, rate, trimmed);
      if (solidC) {
        results.push(solidC);
      } else {
        // 3-digit numbers (000–999) in the bet text automatically imply AB
        const isDouble = isDoubleFlagged || has3DigitBet(numbersText);
        const nums = extractPairedNumbers(numbersText);
        if (nums.length > 0) {
          const count = countSegment(nums, isWP) * (isDouble ? 2 : 1);
          if (count > 0) {
            const display = numbersText.replace(/[,\s.]+$/, '').trim();
            results.push({ line: display, rate, isWP, isDouble, count, lineTotal: count * rate });
          }
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

/**
 * Best-effort cleanup for common typos / alternate keyboards before parsing.
 * Does not guess missing numbers; only normalizes separators and invisible chars.
 */
export function normalizeTypoTolerantInput(s: string): string {
  let t = s.normalize("NFKC");
  // Fancy spaces → ASCII space
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  // Zero-width / BOM
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Fullwidth ASCII digits → ASCII
  t = t.replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  // Between digits: `;` `|` `/` `\` or tabs often used instead of space (keep `,` for comma-rate lines)
  t = t.replace(/(?<=\d)[\t]*[;|/\\]+[\t]*(?=\d)/g, " ");
  // Middle dot · between digits
  t = t.replace(/(?<=\d)\s*\u00B7\s*(?=\d)/g, " ");
  // Collapse runs of spaces
  t = t.replace(/ +/g, " ").trim();
  return t;
}

/** Lines with no letters and no digits (e.g. ".", "---") — never stash or merge. */
function isSeparatorOnlyLine(line: string): boolean {
  return !/[0-9A-Za-z\u0900-\u0FFF]/.test(line);
}

/** `20 37 28 39 - 28` → `20 37 28 39 x28` (space + dash + space + rate at end only). */
function normalizeTrailingDashRate(s: string): string {
  return s.replace(/\s+[-–—]\s+(\d+)\s*$/g, " x$1");
}

export function calculateTotal(text: string): CalculationResult {
  const cleaned = preprocessText(text);
  const rawLines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  const mergedLines: string[] = [];
  let pending = '';

  const flushPending = () => {
    if (!pending) return;
    if (!(isSeparatorOnlyLine(pending) || (/^[\d\s\-_.,:|\/\\]*$/.test(pending) && !/\d/.test(pending)))) {
      mergedLines.push(pending);
    }
    pending = '';
  };

  for (const rawLine of rawLines) {
    const labelStripped = stripLeadingGameLabels(rawLine);
    const line = normalizeTrailingDashRate(
      normalizeTypoTolerantInput(labelStripped).replace(/\s*in\s*to\s*/gi, "x"),
    );

    if (isSeparatorOnlyLine(line)) continue;

    const hasExplicitRate =
      /\(\d+\)/.test(line) || X_RATE_RE.test(line) || /=+\s*\d+/.test(line) || /\*\s*\d+/.test(line);
    const hasCommaRate = /,/.test(line);
    const hasKnownFlag =
      /\b(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i.test(line) || /पलट/.test(line);

    // `B.1111x9999x50` must never absorb `pending` — glue would break the first `x`.
    const isSelfContainedMultiX = Boolean(parseMultiXChainStructure(line));

    if (!hasExplicitRate && !hasCommaRate) {
      const isPureNumbers = /^[\d\s\-_.,:|\/\\]+$/.test(line) && /\d/.test(line);
      if (hasKnownFlag) {
        flushPending();
        mergedLines.push(line);
      } else if (isPureNumbers) {
        pending = pending ? `${pending} ${line}` : line;
      } else {
        flushPending();
        mergedLines.push(line);
      }
    } else {
      if (pending) {
        if (isSelfContainedMultiX) {
          flushPending();
          mergedLines.push(line);
        } else if (!/\d/.test(pending)) {
          flushPending();
          mergedLines.push(line);
        } else {
          const endsWithPartialPair = /(?<!\d)\d$/.test(pending);
          const sep = endsWithPartialPair ? "" : " ";
          mergedLines.push(pending + sep + line);
          pending = "";
        }
      } else {
        mergedLines.push(line);
      }
    }
  }
  flushPending();

  const results: import('./types').Segment[] = [];
  const failedLines: string[] = [];

  for (const line of mergedLines) {
    const segs = processLine(line);
    if (segs.length > 0) {
      results.push(...segs);
    } else if (line.trim()) {
      failedLines.push(line.trim());
    }
  }

  return {
    results,
    total: results.reduce((s, r) => s + r.lineTotal, 0),
    ...(failedLines.length > 0 ? { failedLines } : {}),
  };
}

// ─── WhatsApp message parser ───────────────────────────────────────────────────

export interface ParsedMessage {
  id?: string;
  contact: string;
  date: string;
  timestamp: string;
  text: string;
  result: CalculationResult;
  slotId?: string;
}

export function parseWhatsAppMessages(input: string): ParsedMessage[] | null {
  if (!/\[[^\]]*\]\s*[^:\n]+:/.test(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n]+):\s*/g;
  const headers: Array<{ index: number; end: number; contact: string; date: string; timestamp: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    const content = match[1];
    const contact = match[2].trim();
    // Support both [6:16 pm, 12/4/2026], [14:26, 12/04/2026] and [12/04, 2:34 pm] formats
    const fullDateM  = content.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const shortDateM = content.match(/^(\d{1,2}\/\d{1,2})\s*,/);
    const year = new Date().getFullYear();
    const rawDate = fullDateM?.[1] ?? (shortDateM ? `${shortDateM[1]}/${year}` : '');
    // Normalize day and month to 2 digits so "12/4/2026" → "12/04/2026"
    const normalizedDate = rawDate
      ? rawDate.split('/').map((p, i) => (i < 2 ? p.padStart(2, '0') : p)).join('/')
      : '';
    const dateM = normalizedDate ? [null, normalizedDate] : null;
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

/** "DD/MM/YYYY" → "YYYY-MM-DD" */
export function toDateISO(date: string): string {
  const [d, m, y] = date.split("/");
  return `${y}-${(m ?? "01").padStart(2, "0")}-${(d ?? "01").padStart(2, "0")}`;
}

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
      ...(msg.slotId ? { slotId: msg.slotId } : {}),
    };
    const session = updated.find(s => s.contact === msg.contact && s.date === msg.date);
    if (session) {
      if (!session.messages.find(m => m.id === msgId)) session.messages.push(savedMsg);
    } else {
      updated.push({
        id: `${msg.contact}|${msg.date}`,
        contact: msg.contact,
        date: msg.date,
        dateISO: toDateISO(msg.date),
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { /* quota exceeded – ignore */ }
}

// ─── Game slots ────────────────────────────────────────────────────────────────

export const DEFAULT_GAME_SLOTS: GameSlot[] = [
  { id: 'usa',     name: 'USA',     emoji: '🇺🇸', time: '10:00', enabled: true },
  { id: 'india',   name: 'India',   emoji: '🇮🇳', time: '14:00', enabled: true },
  { id: 'japan',   name: 'Japan',   emoji: '🇯🇵', time: '18:00', enabled: true },
  { id: 'italy',   name: 'Italy',   emoji: '🇮🇹', time: '22:00', enabled: true },
  { id: 'vietnam', name: 'Vietnam', emoji: '🇻🇳', time: '02:00', enabled: true },
];

/** Returns minutes since midnight for a "HH:MM" string. */
export function slotMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Formats "14:00" → "2:00 PM". */
export function formatSlotTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Returns the currently active game slot — the next slot whose result hasn't
 * been announced yet (i.e. whose time hasn't passed).
 */
export function getCurrentSlot(slots: GameSlot[]): GameSlot {
  const enabled = slots.filter(s => s.enabled);
  if (!enabled.length) return DEFAULT_GAME_SLOTS[1]; // fallback India (index 1)
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const sorted = [...enabled].sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
  const next = sorted.find(s => slotMinutes(s.time) > cur);
  return (next ?? sorted[0]);
}

const SLOTS_KEY    = 'calc_slots_v1';
const SETTINGS_KEY = 'calc_settings_v1';
const PAYMENTS_KEY = 'calc_payments_v1';

export function loadGameSlots(): GameSlot[] {
  try { return JSON.parse(localStorage.getItem(SLOTS_KEY) ?? 'null') ?? DEFAULT_GAME_SLOTS; }
  catch { return DEFAULT_GAME_SLOTS; }
}
export function saveGameSlots(slots: GameSlot[]): void {
  try { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); } catch { /* quota exceeded – ignore */ }
}

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
