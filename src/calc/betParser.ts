import type { BetLane, Segment } from "../types";
import {
  normalizeIntoRateMarker,
  normalizeTrailingDashRate,
  normalizeTypoTolerantInput,
} from "./textNormalize";

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

/** Splits digit blocks into 2-digit pairs: "8307" → [83, 07], "9103" → [91, 03]. */
export function extractPairedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const block of text.match(/\d+/g) ?? []) {
    if (block.length === 1) continue;
    if (block.length === 2) { out.push(Number(block)); }
    else { for (let i = 0; i + 1 < block.length; i += 2) out.push(Number(block.slice(i, i + 2))); }
  }
  return out;
}

/** Comma-separated field is a same-digit run length ≥ 3 (444, 1111, …) — show whole token, not paired digits (44, 11). */
const COMMA_FIELD_SAME_DIGIT_RUN = /^(\d)\1{2,}$/;

/**
 * Comma-separated jodis for the breakdown UI. Uses the same {@link extractPairedNumbers} rules
 * as `processLine` so embedded runs (e.g. 9103 → 91, 03) match the row count. Falls back to
 * "standalone" two-digit regex + raw line for WP, solid, or other count mismatches.
 */
export function formatSegmentLineForPairListDisplay(segment: {
  line: string;
  count: number;
  isWP: boolean;
  isDouble: boolean;
}): string {
  if (/,/.test(segment.line)) {
    const fields = segment.line
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      fields.length > 0 &&
      fields.every((f) => COMMA_FIELD_SAME_DIGIT_RUN.test(f))
    ) {
      return fields.join(", ");
    }
  }
  // One same-digit run only, commas already stripped (e.g. "333,,,,,,100ab" → line "333"): show "333" not paired "33"
  const singleRun = segment.line.trim();
  if (COMMA_FIELD_SAME_DIGIT_RUN.test(singleRun)) {
    return singleRun;
  }
  const pairs = extractPairedNumbers(segment.line);
  const n = pairs.length;
  if (n > 0 && !segment.isWP) {
    if (
      segment.count === n ||
      (segment.isDouble && segment.count === 2 * n)
    ) {
      return pairs.map((p) => p.toString().padStart(2, "0")).join(", ");
    }
  }
  return (segment.line.match(/(?<!\d)\d{2}(?!\d)/g) ?? [segment.line]).join(", ");
}

// ─── Flag detector ─────────────────────────────────────────────────────────────
// WP keywords: "wp", "w.p", "palat", Hindi "पलट" (reverse/pair).
// AB keywords: letter 'a'/'b', OR Hindi "अब" (literally "ab").
// Strip WP keywords first so "palat" (contains 'a') never accidentally triggers AB.
function stripWpPalatWords(text: string): string {
  return text
    .replace(/\bwp\b/gi, "")
    .replace(/\bw\.?\s*p\b/gi, "")
    .replace(/\bw\s+p\b/gi, "")
    .replace(/\bpalat(?:e|el)?\b/gi, "")
    .replace(/पलट/g, "")
    .trim();
}

function parseFlags(text: string): { isWP: boolean; isDouble: boolean } {
  const isWP =
    /\bwp\b/i.test(text) ||
    /\bw\.?\s*p\b/i.test(text) ||
    /\bw\s+p\b/i.test(text) ||
    /\bpalat(?:e|el)?\b/i.test(text) ||
    /पलट/.test(text);
  const cleaned = stripWpPalatWords(text);
  const isDouble = /[ab]/i.test(cleaned) || /अब/.test(cleaned);
  return { isWP, isDouble };
}

/** UI lane chip for non-solid segments: explicit A/B/AB from suffix, else AB when doubled. */
function laneForNonSolid(flagText: string, isDouble: boolean, numbersText: string): BetLane | undefined {
  const explicit = parseLaneFromFlagText(flagText);
  if (explicit) return explicit;
  if (isDouble && has3DigitBet(numbersText)) return "AB";
  if (isDouble) return "AB";
  return undefined;
}

export function parseLaneFromFlagText(text: string): BetLane | undefined {
  const cleaned = stripWpPalatWords(text).replace(/[,.\s]+/g, " ").trim();
  if (!cleaned) return undefined;
  if (/अब/.test(cleaned)) return "AB";
  const alpha = cleaned.replace(/[^a-zA-Z]/g, "");
  if (!alpha) return undefined;
  const lower = alpha.toLowerCase();
  if (lower === "ab" || (lower.includes("a") && lower.includes("b"))) return "AB";
  if (/^a+$/i.test(alpha)) return "A";
  if (/^b+$/i.test(alpha)) return "B";
  return undefined;
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
function solidRunAbMultiplier(modifierSource: string): {
  count: number;
  isDouble: boolean;
  lane?: BetLane;
} {
  let s = modifierSource;
  if (/अब/.test(s)) return { count: 2, isDouble: true, lane: "AB" };
  // Strip rate chunks only (do not treat the "x" inside "Ax333…" as ×rate).
  s = s
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\*\s*\d+/g, ' ')
    .replace(/=+\s*\d+/g, ' ')
    .replace(/(?:^|[\s,])x\s*\d+(?=$|[\s,]|[^0-9])/gi, ' ');
  // A and B separated by punctuation/spaces; include "x" and "×" (letters otherwise) for AxB / A×B.
  // Literal "AB" with no separator is handled by the next check.
  if (/\bA(?:[^A-Za-z0-9]|x|×)+B\b/i.test(s)) return { count: 2, isDouble: true, lane: "AB" };
  if (/AB/i.test(s)) return { count: 2, isDouble: true, lane: "AB" };
  const noAb = s.replace(/AB/gi, '');
  const hasA = /(?:^|[^A-Za-z])A(?:[^A-Za-z]|$)/i.test(noAb);
  const hasB = /(?:^|[^A-Za-z])B(?:[^A-Za-z]|$)/i.test(noAb);
  if (hasA && hasB) return { count: 1, isDouble: false, lane: "AB" };
  if (hasA) return { count: 1, isDouble: false, lane: "A" };
  if (hasB) return { count: 1, isDouble: false, lane: "B" };
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

  const { count, isDouble, lane } = solidRunAbMultiplier(modifierSource);
  const display = nt.replace(/^[\s*\-_.,:|]+|[\s*\-_.,:|]+$/g, '').trim() || run;
  return { line: display, rate, isWP: false, isDouble, lane, count, lineTotal: count * rate };
}

/** Same-digit run (length ≥ 3) for multi-x chain values. */
const SAME_DIGIT_RUN = /^(\d)\1{2,}$/;
export const X_RATE_RE = /(?<![A-Za-z])x\s*\d+/i;
export const SEP_RATE_RE = /(?<![A-Za-z])(?:x|=+|\*)\s*(\d+)\s*([a-zA-Z]*)/gi;

/**
 * If `trimmed` is `B.1111x9999x50` / `1111x2222x3333x10` shape, return prefix,
 * number chunks, and rate; otherwise null. Used by merge logic and parser.
 */
export function parseMultiXChainStructure(trimmed: string): { pre: string; nums: string[]; rate: number } | null {
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
  let laneFromPre: BetLane | undefined;
  if (/^AB\./i.test(pre)) laneFromPre = "AB";
  else if (/^A\./i.test(pre)) laneFromPre = "A";
  else if (/^B\./i.test(pre)) laneFromPre = "B";

  for (const n of numParts) {
    const syn = `${pre}${n}x${rate}`;
    const sub = parseOne(syn);
    if (sub.length !== 1) return null;
    const first = sub[0]!;
    out.push({ ...first, line: pre ? `${pre}${n}` : n, lane: first.lane ?? laneFromPre });
  }
  return out;
}

/**
 * Strip chained market/game prefixes like `Harf.` `GB.` `usa.` (any case).
 * Never removes betting modifiers `A.` `B.` `AB.` or `AxB.` / `AxB ` at the current start of the line.
 */
export function stripLeadingGameLabels(s: string): string {
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
      const lane = laneForNonSolid(suffix, isDouble, numbersPart);
      results.push({ line: display || numbersPart.trim(), rate, isWP, isDouble, lane, count, lineTotal: count * rate });
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
          const lane = laneForNonSolid(suffix, isDouble, numbersText);
          results.push({ line: display || numbersText.trim(), rate, isWP, isDouble, lane, count, lineTotal: count * rate });
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
              const lane = laneForNonSolid(flagText, isDouble, numbersText);
              results.push({ line: display || numbersText.trim(), rate, isWP, isDouble, lane, count, lineTotal: count * rate });
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
            const lane = laneForNonSolid(after, isDouble, numbersText);
            results.push({ line: display, rate, isWP, isDouble, lane, count, lineTotal: count * rate });
          }
        }
      }
    }
  }
  if (results.length) return results;

  // ── Harf / haruf single-digit bet ────────────────────────────────────────────
  // "9 harufx20", "9 harf x20", "9 hrf into 20"
  // The keyword implies AB (both sides) unless an explicit A or B suffix overrides.
  {
    const harfRE = /\b(?:haruf|harf|hrf)\b/i;
    if (harfRE.test(trimmed)) {
      // Remove keyword; if "x" was glued directly to the keyword ("harufx20") a space
      // appears — SEP_RATE_RE will still find it since the preceding char is now a space.
      const noHarf = trimmed.replace(/\b(?:haruf|harf|hrf)\b\s*/gi, ' ').replace(/ +/g, ' ').trim();
      const cleaned = normalizeTrailingDashRate(normalizeIntoRateMarker(noHarf));
      const sepM = [...cleaned.matchAll(SEP_RATE_RE)];
      if (sepM.length > 0) {
        const last = sepM[sepM.length - 1]!;
        const rate = parseInt(last[1], 10);
        if (rate > 0) {
          const suffix = last[2] ?? '';
          const beforeRate = cleaned.slice(0, last.index).trim();
          // Single isolated digit — the "harf" number (0–9).
          const digitM = beforeRate.match(/(?<!\d)(\d)(?!\d)/);
          if (digitM) {
            const lane = parseLaneFromFlagText(suffix) ?? 'AB';
            const count = lane === 'AB' ? 2 : 1;
            results.push({
              line: digitM[1]!,
              rate,
              isWP: false,
              isDouble: lane === 'AB',
              lane,
              count,
              lineTotal: count * rate,
            });
          }
        }
      }
    }
  }
  return results;
}
