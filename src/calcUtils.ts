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
 * Same-digit run (333, 4444, 44444, …): AB / अब / A…B (any punctuation between A & B) → count 2×rate; lone A or B → 1×rate.
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
  // A and B separated by punctuation/spaces; include "x" and "×" (letters otherwise) for AxB / A×B.
  // Literal "AB" with no separator is handled by the next check.
  if (/\bA(?:[^A-Za-z0-9]|x|×)+B\b/i.test(s)) return { count: 2, isDouble: true };
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
  // Tolerate light separator typos between chunks (e.g. "B..2222.x7777x50").
  // Keep letters intact so accidental words still fail strict chain mode below.
  const compact = rest.replace(/[\s._|:/\\-]+/g, "");
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
 * Never removes betting modifiers `A.` `B.` `AB.` or `AxB.` / `AxB ` at the current start of the line.
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
    // Same-digit AB marker written as AxB (often after a game label, e.g. Harf.AxB. 6666x50)
    if (/^axb$/i.test(word)) break;
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
    normalizeIntoRateMarker(normalizeTypoTolerantInput(stripLeadingGameLabels(line))),
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
  // Multiplication sign from WhatsApp/keyboards -> ASCII x for rate parsing.
  t = t.replace(/×/g, "x");
  // "Rs" / "rs" (rupees) as rate, common in market lines: "55 rs10", "20.02.rs5"
  t = t.replace(/(?<![A-Za-z])rs\s*(\d{1,5})/gi, "x$1");
  // Fancy spaces → ASCII space
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  // Zero-width / BOM
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Fullwidth ASCII digits → ASCII
  t = t.replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  // "NN/rate" with a slash (WhatsApp pastes: 43/10, 07/20) — must run *before* slash→space below
  // so the rate is not split into a loose "NN DD" line. Whitelist the denominator to typical stakes
  // and avoid mistaking calendar fragments like 12/04 (→ would match rate 4 if we only used \d+).
  t = t.replace(
    /\b(\d{2})\/(5|10|15|20|25|30|40|50|100)\b/g,
    "$1x$2",
  );
  // Between digits: `;` `|` `/` `\` or tabs often used instead of space (keep `,` for comma-rate lines)
  t = t.replace(/(?<=\d)[\t]*[;|/\\]+[\t]*(?=\d)/g, " ");
  // Same-digit run (3+ identical digits) then AB / A / B then rate, with no x/=/*
  // (common paste: "000B100", "000A100", "000AB100"). Rewrites so SEP_RATE_RE applies;
  // suffix letter is preserved for solidRunAbMultiplier (A/B = 1×, AB = 2×).
  t = t.replace(/\b((\d)\2{2,})\s*(AB|A|B)\s*(\d+)\b/gi, (_, run, _d, mark, rate) => `${run}x${rate}${mark}`);
  // Some users type A/B marker letters directly before rate marker:
  //   222bbb=50  /  999abx10
  // Insert a separator so rate parsing still recognizes =/x/* markers.
  t = t.replace(/(?<=\d)\s*([ab]+)\s*(?=(?:x|=+|\*)\s*\d)/gi, " $1 ");
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

/** Levenshtein distance — small strings only (typo detection for "into"). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Letter run before trailing rate digits is meant as "into" (×rate) but mis-typed
 * (e.g. ilto, olto, iltu, nlto). Covers many combinations via edit distance, not a fixed list.
 */
function looksLikeIntoTypo(letters: string): boolean {
  const t = letters.toLowerCase();
  // "into" is 4 chars; shorter runs (e.g. "int") are too ambiguous vs real words
  if (t.length < 4 || t.length > 9) return false;
  // Do not treat known bet flags as "into"
  if (/^(wp|ab|palat|palatel)$/i.test(t)) return false;
  const targets = ["into", "intu"];
  return targets.some((target) => levenshtein(t, target) <= 2);
}

/**
 * Hindi-style "into" (often written "in to") means ×rate. Tolerate common phone typos
 * ("intu", "ijto", "ilto", "olto", …) via explicit patterns + fuzzy end-of-line match.
 * Require a digit immediately before the letter run so we don't rewrite e.g. "in town 10".
 */
function normalizeIntoRateMarker(s: string): string {
  let out = s
    .replace(/\s*ij\s*to(?=\s*\d)/gi, "x")
    .replace(/\s*in\s*t[ou](?=\s*\d)/gi, "x");
  // After a digit: [letters typo "into"] [rate] at end of string → xrate
  out = out.replace(
    /(?<=\d)([a-zA-Z]{2,})\s*(\d{1,5})\s*$/gi,
    (full, letters: string, rate: string) => (looksLikeIntoTypo(letters) ? `x${rate}` : full),
  );
  return out;
}

/**
 * After the last x/=/\* rate on a line, users sometimes paste another number row without its own rate
 * (e.g. `DS.65..x15 49.53..02.`). Split so merge / inherit-rate logic can attach the right ×rate.
 */
function splitTrailingNumberRunAfterLastRate(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  const matches = [...t.matchAll(SEP_RATE_RE)];
  if (matches.length === 0) return [t];
  const lastM = matches[matches.length - 1];
  const end = (lastM.index ?? 0) + lastM[0].length;
  const tail = t.slice(end).trim();
  if (!tail) return [t];
  if (!/^\d/.test(tail)) return [t];
  if (!/^[\d\s._|:/\\-]+$/.test(tail)) return [t];
  // At least two XX groups (avoid splitting `32x5 10` into orphan `10`)
  if (!/(?<!\d)\d{2}(?:[\s._]+\d{2})+/.test(tail)) return [t];
  const head = t.slice(0, end).trim();
  if (!head) return [tail];
  return [head, tail];
}

/**
 * Pasted lists like
 *   `03,01,10,30,.....`
 *   `,20`
 * put the only rate on the line after the number row. Merging into `03,01,10,30,20`
 * makes "last number = rate" unambiguous. Safe when `prev` is already a comma list with
 * **≥3** two-digit tokens; `,rate` is digits only (optionally more commas).
 */
function mergeCommaOnlyRateContinuationLine(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const rateOnly = /^\s*,+\s*(\d{1,5})\s*$/.exec(line);
    if (rateOnly && out.length) {
      const rate = rateOnly[1]!;
      const prev = out[out.length - 1]!;
      const core = prev.replace(/[.,\s]+$/g, "").replace(/^[\s,]+/, "");
      const twoDigitFieldCount = core
        .split(/,+/)
        .map((s) => s.replace(/[^\d]/g, ""))
        .filter((s) => s.length === 2).length;
      if (/,/.test(prev) && twoDigitFieldCount >= 3) {
        out[out.length - 1] = `${core},${rate}`;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * WhatsApp / narrow screens often break a long comma list across lines, with a trailing
 * `,` on the first line(s) and the rate (×70, x50, *10) only on the last line, e.g.
 *   `FB 43,97,62,98,`
 *   `33,79,26,89×70`
 * If we do not join them, the first line is parsed with the last two-digit as the
 * (wrong) rate, and the second line is parsed as a second segment.
 * Absorb any middle lines that are still comma-lists with no rate marker, then the
 * first line with `,…(x/=/\*)(rate)`.
 */
function mergeTrailingCommaListWithXOnLaterLine(lines: string[]): string[] {
  const hasExplicit =
    (s: string) =>
      /\(\d+\)/.test(s) || X_RATE_RE.test(s) || /=+\s*\d+/.test(s) || /\*\s*\d+/.test(s);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i]!.trim();
    if (!/,/.test(start) || hasExplicit(start) || !/,\s*$/.test(start)) {
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    let acc = lines[i]!.replace(/\s+$/g, "");
    let j = i + 1;
    let merged = false;
    while (j < lines.length) {
      const n = lines[j]!;
      if (hasExplicit(n) && /,/.test(n)) {
        acc = acc + n;
        out.push(acc);
        i = j + 1;
        merged = true;
        break;
      }
      if (hasExplicit(n) && !/,/.test(n)) {
        break;
      }
      if (/,/.test(n) && !hasExplicit(n)) {
        acc = acc + n;
        j += 1;
        continue;
      }
      break;
    }
    if (merged) continue;
    out.push(lines[i]!);
    i += 1;
  }
  return out;
}

/** Last explicit ×rate (or last (rate)) in a merged line — used to repeat rate for continuation rows. */
function lastExplicitRateInLine(line: string): number | null {
  const ms = [...line.matchAll(SEP_RATE_RE)];
  if (ms.length) {
    const n = parseInt(ms[ms.length - 1][1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const ps = [...line.matchAll(/\(\s*(\d+)\s*\)/g)];
  if (ps.length) {
    const n = parseInt(ps[ps.length - 1][1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Row that begins with digits and has its own ×rate — usually do not glue prior `pending` into it.
 * Exceptions:
 * - `pending` digits-only and **no** trailing `.` → merge into this line; keep this line’s ×rate (`74…` + `24…x5`).
 * - `pending` ends with `.` and next row is `NN.NN…` pairs → merge with **previous** clause’s ×rate (ignore this line’s ×10; e.g. `49…02.` + `56…x10` → 18×15).
 */
function isSelfContainedDigitRowWithRate(line: string, pendingTrimmed: string): boolean {
  const t = line.trim();
  if (!/^\d/.test(t)) return false;
  const hasExplicitRate =
    /\(\d+\)/.test(t) || X_RATE_RE.test(t) || /=+\s*\d+/.test(t) || /\*\s*\d+/.test(t);
  if (!hasExplicitRate) return false;
  if (/^\s*(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i.test(t)) return false;
  const p = pendingTrimmed.trim();
  const purePending = p && /^[\d\s\-_.,:|\/\\]+$/.test(p) && /\d/.test(p);
  if (purePending && !/\.\s*$/.test(p)) return false;
  return true;
}

/** Remove trailing × / = / * rate (and optional letter flags) for merge helpers only. */
function stripTrailingSeparatorRateTail(line: string): string {
  return line.replace(/\s*(?:x|=+|\*)\s*\d+\s*[a-zA-Z]*$/i, "").trim();
}

/** Next row looks like `56.18…94` (dot-separated pairs), not `10 20` style. */
function looksLikeDotSeparatedPairContinuation(s: string): boolean {
  return /\d{2}\.\d{2}/.test(s);
}

function mergePendingBodyWithInheritedRate(pending: string, continuationBody: string, rate: number): string {
  const p = pending.trim();
  const b = continuationBody.trim();
  const sep = /(?<!\d)\d$/.test(p) ? "" : " ";
  return `${p}${sep}${b} x${rate}`;
}

export function calculateTotal(text: string): CalculationResult {
  const cleaned = preprocessText(text);
  const rawLines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const logicalLines: string[] = [];
  for (const rawLine of rawLines) {
    const labelStripped = stripLeadingGameLabels(rawLine);
    const line = normalizeTrailingDashRate(
      normalizeIntoRateMarker(normalizeTypoTolerantInput(labelStripped)),
    );
    if (isSeparatorOnlyLine(line)) continue;
    logicalLines.push(...splitTrailingNumberRunAfterLastRate(line));
  }
  const withCommaCont = mergeCommaOnlyRateContinuationLine(logicalLines);
  const withCommaXMerge = mergeTrailingCommaListWithXOnLaterLine(withCommaCont);

  const mergedLines: string[] = [];
  let pending = '';
  let lastInheritedRate: number | null = null;

  const pushMerged = (s: string) => {
    const t = s.trim();
    if (!t) return;
    mergedLines.push(t);
    const r = lastExplicitRateInLine(t);
    if (r != null) lastInheritedRate = r;
  };

  const flushPending = () => {
    if (!pending) return;
    let toPush = pending;
    const isPurePending = /^[\d\s\-_.,:|\/\\]+$/.test(pending) && /\d/.test(pending);
    if (isPurePending && lastInheritedRate != null) {
      const endsWithPartialPair = /(?<!\d)\d$/.test(pending);
      const sep = endsWithPartialPair ? "" : " ";
      toPush = `${pending}${sep}x${lastInheritedRate}`;
    }
    if (!(isSeparatorOnlyLine(toPush) || (/^[\d\s\-_.,:|\/\\]*$/.test(toPush) && !/\d/.test(toPush)))) {
      pushMerged(toPush);
    }
    pending = "";
  };

  for (const line of withCommaXMerge) {
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
        pushMerged(line);
      } else if (isPureNumbers) {
        pending = pending ? `${pending} ${line}` : line;
      } else {
        flushPending();
        pushMerged(line);
      }
    } else {
      if (pending) {
        if (isSelfContainedMultiX) {
          flushPending();
          pushMerged(line);
        } else if (!/\d/.test(pending)) {
          flushPending();
          pushMerged(line);
        } else if (isSelfContainedDigitRowWithRate(line, pending)) {
          const p = pending.trim();
          const pureP = /^[\d\s\-_.,:|\/\\]+$/.test(p) && /\d/.test(p);
          const endsWithDot = /\.\s*$/.test(p);
          const body = stripTrailingSeparatorRateTail(line);
          if (pureP && endsWithDot && lastInheritedRate != null && looksLikeDotSeparatedPairContinuation(body)) {
            pushMerged(mergePendingBodyWithInheritedRate(p, body, lastInheritedRate));
            pending = "";
          } else {
            flushPending();
            pushMerged(line);
          }
        } else {
          const endsWithPartialPair = /(?<!\d)\d$/.test(pending);
          const sep = endsWithPartialPair ? "" : " ";
          pushMerged(pending + sep + line);
          pending = "";
        }
      } else {
        pushMerged(line);
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

/** How confident we are that every line followed known pattern rules (money-sensitive UI). */
export interface PatternAccuracyBreakdown {
  /** 0–100 with one decimal; never rounded up so tiny doubts stay visible (e.g. 99.9). */
  scorePercent: number;
  /** Human-readable causes of any deduction. */
  reasons: string[];
}

/**
 * Conservative score from parser output: any failed line or WA time fallback lowers the score
 * by small steps so sub‑1% doubt can appear (e.g. 99.9%).
 */
export function computePatternAccuracy(
  result: CalculationResult,
  opts?: { waSlotFallbackCount?: number },
): PatternAccuracyBreakdown {
  const reasons: string[] = [];
  let raw = 100;
  const fails = result.failedLines ?? [];
  for (const line of fails) {
    raw -= 0.25;
    const preview = line.length > 56 ? `${line.slice(0, 56)}…` : line;
    reasons.push(`Line not matched by pattern rules: ${preview}`);
  }
  const fb = Math.max(0, opts?.waSlotFallbackCount ?? 0);
  if (fb > 0) {
    raw -= fb * 0.12;
    reasons.push(
      `${fb} WhatsApp message(s) had no clear time — the game from the menu was used as fallback.`,
    );
  }
  raw = Math.max(0, Math.min(100, raw));
  const scorePercent = Math.floor(raw * 10) / 10;
  return { scorePercent, reasons };
}

// ─── Indian market line prefixes → game slot (Payments / History tagging) ─────

/** Regex + hints to match a configured {@link GameSlot} by `id` / `name` (Hindi or English). */
const MARKET_SLOT_RULES: { re: RegExp; hints: string[] }[] = [
  // Delhi / DB
  { re: /^दिल्ली\s*बजार\b\.?/iu, hints: ["दिल्ली बजार", "दिल्ली", "delhi", "bazaar", "db"] },
  {
    re: /^DB\s*\/\s*दिल्ली(?:\s+बजार)?\.?/iu,
    hints: ["दिल्ली", "delhi", "bazaar", "db"],
  },
  { re: /^DB\b\.?/i, hints: ["दिल्ली", "delhi", "bazaar", "db"] },
  // Shri Ganesh / SG
  { re: /^श्री\s*गणेश\b\.?/iu, hints: ["श्री गणेश", "श्री", "गणेश", "ganesh", "shri", "sg"] },
  { re: /^SG\s*\/\s*श्री(?:\s*गणेश)?\b\.?/iu, hints: ["श्री", "गणेश", "ganesh", "shri", "sg"] },
  { re: /^SG\b\.?/i, hints: ["श्री", "गणेश", "ganesh", "shri", "sg"] },
  // Faridabad / FB / FD
  { re: /^फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FB\s*\/\s*फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FD\s*\/\s*फरीदाबाद\b\.?/iu, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FB\b\.?/i, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  { re: /^FD\b\.?/i, hints: ["फरीदाबाद", "faridabad", "fb", "fd"] },
  // Gali / GL
  { re: /^गली\b\.?/iu, hints: ["गली", "gali", "gl"] },
  { re: /^Gali\b\.?/i, hints: ["गली", "gali", "gl"] },
  { re: /^GL\s*\/\s*गली\b\.?/iu, hints: ["गली", "gali", "gl"] },
  { re: /^GL\b\.?/i, hints: ["गली", "gali", "gl"] },
  // Ghaziabad / GB
  { re: /^गाजियाबाद\b\.?/iu, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  { re: /^GB\s*\/\s*गाजियाबाद\b\.?/iu, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  { re: /^GB\b\.?/i, hints: ["गाजियाबाद", "ghaziabad", "gb"] },
  // Disawar / DS
  { re: /^दिसावर\b\.?/iu, hints: ["दिसावर", "disawar", "disawer", "ds"] },
  { re: /^Disawar\b\.?/i, hints: ["disawar", "disawer", "दिसावर", "ds"] },
  { re: /^Disawer\b\.?/i, hints: ["disawer", "disawar", "दिसावर", "ds"] },
  { re: /^DS\s*\/\s*दिसावर\b\.?/iu, hints: ["दिसावर", "disawar", "disawer", "ds"] },
  { re: /^DS\b\.?/i, hints: ["दिसावर", "disawar", "disawer", "ds"] },
];

function hintMatchesSlot(slot: GameSlot, rawHint: string): boolean {
  const hint = rawHint.normalize("NFKC").trim().toLowerCase();
  if (!hint) return false;
  const id = slot.id.normalize("NFKC").trim().toLowerCase();
  const name = slot.name.normalize("NFKC").trim().toLowerCase();
  if (hint.length <= 2) {
    return id === hint || id.endsWith(`_${hint}`) || name === hint;
  }
  return name.includes(hint) || id.includes(hint);
}

/** First enabled slot (by time order) that matches any hint. */
export function pickSlotByMarketHints(
  slots: GameSlot[],
  hints: string[],
): GameSlot | null {
  const enabled = slots.filter((s) => s.enabled);
  const sorted = [...enabled].sort(
    (a, b) => slotMinutes(a.time) - slotMinutes(b.time),
  );
  for (const slot of sorted) {
    if (hints.some((h) => hintMatchesSlot(slot, h))) return slot;
  }
  return null;
}

/**
 * Disawar / DS (late draw, often ~3am): History uses the **same** local calendar day
 * as when you save. All other markets default to the **previous** day (day games).
 */
const SAME_DAY_LEDGER_HINTS = [
  "दिसावर",
  "disawar",
  "disawer",
  "deasawer",
  "ds",
] as const;

export function slotUsesSameCalendarDayLedger(slot: GameSlot): boolean {
  return SAME_DAY_LEDGER_HINTS.some((h) => hintMatchesSlot(slot, h));
}

function formatLocalLedgerDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * `DD/MM/YYYY` for History / Games when saving **manual** (non‑WhatsApp) Calculator
 * rows on `operationDay` (local date bucket). Day markets → previous calendar day;
 * Disawar (name/id hints) → same day. WhatsApp saves use the date from the chat header.
 */
export function ledgerDateStringForSlot(
  slot: GameSlot,
  operationDay: Date = new Date(),
): string {
  const cal = new Date(
    operationDay.getFullYear(),
    operationDay.getMonth(),
    operationDay.getDate(),
  );
  if (slotUsesSameCalendarDayLedger(slot)) {
    return formatLocalLedgerDate(cal);
  }
  cal.setDate(cal.getDate() - 1);
  return formatLocalLedgerDate(cal);
}

/**
 * If the line starts with a known market tag (DB / GL / …), returns that slot.
 * Uses configured slot names/ids — set games in Settings to match local spellings.
 */
/** Strip leading market tag from a line when it maps to a slot; otherwise unchanged. */
export function stripLeadingMarketPrefix(
  line: string,
  slots: GameSlot[],
): { slot: GameSlot | null; rest: string } {
  const t = line.replace(/^\uFEFF/, "").trim();
  if (!t) return { slot: null, rest: line };
  for (const rule of MARKET_SLOT_RULES) {
    const m = rule.re.exec(t);
    if (!m) continue;
    const slot = pickSlotByMarketHints(slots, rule.hints);
    if (!slot) continue;
    const rest = t.slice(m[0].length).trim();
    return { slot, rest };
  }
  return { slot: null, rest: line };
}

export function detectSlotFromMarketLine(
  line: string,
  slots: GameSlot[],
): GameSlot | null {
  return stripLeadingMarketPrefix(line, slots).slot;
}

export interface MarketTextChunk {
  slotId: string;
  text: string;
  /** True if a market prefix line set or switched the slot for this chunk. */
  touchedByMarketLabel: boolean;
}

/**
 * Split plain (non‑WhatsApp) paste into chunks by leading market labels so each chunk
 * can be saved under the right game. Lines without a label stay under the previous slot
 * (or `fallbackSlot` until the first label).
 */
export function splitPlainTextByMarketSlots(
  text: string,
  slots: GameSlot[],
  fallbackSlot: GameSlot,
): MarketTextChunk[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [{ slotId: fallbackSlot.id, text: "", touchedByMarketLabel: false }];
  }

  const chunks: MarketTextChunk[] = [];
  let curSlotId = fallbackSlot.id;
  let curLines: string[] = [];
  let curTouched = false;

  const flush = () => {
    if (curLines.length === 0) return;
    chunks.push({
      slotId: curSlotId,
      text: curLines.join("\n"),
      touchedByMarketLabel: curTouched,
    });
    curLines = [];
    curTouched = false;
  };

  for (const line of lines) {
    const { slot, rest } = stripLeadingMarketPrefix(line, slots);
    if (slot) {
      flush();
      curSlotId = slot.id;
      curTouched = true;
      if (rest) curLines.push(rest);
    } else {
      curLines.push(line);
    }
  }
  flush();

  if (chunks.length === 0) {
    return [{ slotId: fallbackSlot.id, text: text.trim(), touchedByMarketLabel: false }];
  }
  return chunks;
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

/**
 * When a paste looks like WhatsApp and contains **more than one distinct contact**
 * (each with at least one non-empty message body), returns one combined snippet per
 * contact so the UI can open separate text areas. Otherwise `null` (keep one area).
 */
export function splitWhatsAppInputByContact(input: string): { contact: string; text: string }[] | null {
  if (!/\[[^\]]*\]\s*[^:\n]+:/.test(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n]+):\s*/g;
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

  return order.map(contact => ({
    contact,
    text: chunksByContact.get(contact)!.join("\n\n"),
  }));
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

/** Firestore / History "Other entries" bucket — same key as History `openSlotIds` for unslotted. */
export const SESSION_SLOT_KEY_UNSLOTTED = "__unslotted__" as const;

function slotKeyForSavedMessage(m: SavedMessage): string {
  return m.slotId ?? SESSION_SLOT_KEY_UNSLOTTED;
}

export function mergeSavedMessages(msgs: SavedMessage[]): CalculationResult {
  return {
    results: msgs.flatMap(m => (m.overrideResult ?? m.result).results),
    total:   msgs.reduce((s, m) => s + (m.overrideResult ?? m.result).total, 0),
  };
}

function sessionSingleSlotKey(session: SavedSession): string | null {
  const keys = new Set(session.messages.map(slotKeyForSavedMessage));
  if (keys.size !== 1) return null;
  return session.messages.length ? slotKeyForSavedMessage(session.messages[0]) : null;
}

/** One slot (or unslotted bucket) totals for a saved session — used by History & GamesView. */
export function sessionLedgerForSlotKey(
  session: SavedSession,
  slotKey: string,
): CalculationResult | null {
  const msgs =
    slotKey === SESSION_SLOT_KEY_UNSLOTTED
      ? session.messages.filter(m => !m.slotId)
      : session.messages.filter(m => m.slotId === slotKey);
  if (!msgs.length) return null;
  const merged = mergeSavedMessages(msgs);
  const only = sessionSingleSlotKey(session);
  return (
    session.slotOverrides?.[slotKey]
    ?? (session.overrideResult && only === slotKey ? session.overrideResult : undefined)
    ?? merged
  );
}

/** Whole-session day totals (all slots + overrides) for History day row & GamesView aggregates. */
export function mergeSessionLedgerResult(session: SavedSession): CalculationResult {
  const so = session.slotOverrides;
  if (so && Object.keys(so).length > 0) {
    const orderedKeys: string[] = [];
    const seen = new Set<string>();
    for (const m of session.messages) {
      const k = slotKeyForSavedMessage(m);
      if (!seen.has(k)) {
        seen.add(k);
        orderedKeys.push(k);
      }
    }
    for (const k of Object.keys(so)) {
      if (!seen.has(k)) {
        seen.add(k);
        orderedKeys.push(k);
      }
    }
    const results: Segment[] = [];
    let total = 0;
    for (const k of orderedKeys) {
      const slotOv = so[k];
      if (slotOv) {
        results.push(...slotOv.results);
        total += slotOv.total;
        continue;
      }
      const msgs = session.messages.filter(m => slotKeyForSavedMessage(m) === k);
      const merged = mergeSavedMessages(msgs);
      results.push(...merged.results);
      total += merged.total;
    }
    return { results, total };
  }
  if (session.overrideResult) return session.overrideResult;
  return mergeSavedMessages(session.messages);
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

/** Example games only — not loaded automatically; users add games in Settings. */
export const DEFAULT_GAME_SLOTS: GameSlot[] = [
  { id: 'usa',     name: 'USA',     emoji: '🇺🇸', time: '10:00', enabled: true },
  { id: 'india',   name: 'India',   emoji: '🇮🇳', time: '14:00', enabled: true },
  { id: 'japan',   name: 'Japan',   emoji: '🇯🇵', time: '18:00', enabled: true },
  { id: 'italy',   name: 'Italy',   emoji: '🇮🇹', time: '22:00', enabled: true },
  { id: 'vietnam', name: 'Vietnam', emoji: '🇻🇳', time: '02:00', enabled: true },
];

/**
 * When no games exist yet, Calculator uses this only for in-memory UI / audit metadata.
 * Never persist this id to sessions or payments.
 */
export const NO_CONFIGURED_SLOTS_PLACEHOLDER_ID = "__no_slots_configured__";

const NO_CONFIGURED_SLOTS_PLACEHOLDER: GameSlot = {
  id:   NO_CONFIGURED_SLOTS_PLACEHOLDER_ID,
  name: "Add games in Settings",
  emoji: "⚙️",
  time: "12:00",
  enabled: true,
};

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
  if (!enabled.length) {
    if (slots.length > 0) return slots[0];
    return NO_CONFIGURED_SLOTS_PLACEHOLDER;
  }
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const sorted = [...enabled].sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
  const next = sorted.find(s => slotMinutes(s.time) > cur);
  return (next ?? sorted[0]);
}

/** localStorage key for game slots (migrate / reconcile with Firestore). */
export const GAME_SLOTS_LS_KEY = "calc_slots_v1";
const SETTINGS_KEY = "calc_settings_v1";
const PAYMENTS_KEY = "calc_payments_v1";

export function loadGameSlots(): GameSlot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_SLOTS_LS_KEY) ?? "null");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
export function saveGameSlots(slots: GameSlot[]): void {
  try {
    localStorage.setItem(GAME_SLOTS_LS_KEY, JSON.stringify(slots));
  } catch {
    /* quota exceeded – ignore */
  }
}

/** True if the user has any saved games (non-empty list). */
export function slotsDifferFromDefault(slots: GameSlot[]): boolean {
  return slots.length > 0;
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
