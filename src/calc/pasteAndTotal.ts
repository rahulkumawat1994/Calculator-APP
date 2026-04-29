import {
  processLine,
  stripLeadingGameLabels,
  parseMultiXChainStructure,
  X_RATE_RE,
  SEP_RATE_RE,
} from "./betParser";
import {
  normalizeIntoRateMarker,
  normalizeTrailingDashRate,
  normalizeTypoTolerantInput,
  preprocessText,
} from "./textNormalize";
import type { CalculationResult, Segment } from "../types";

/** Lines with no letters and no digits (e.g. ".", "---") — never stash or merge. */
function isSeparatorOnlyLine(line: string): boolean {
  return !/[0-9A-Za-z\u0900-\u0FFF]/.test(line);
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
 * Some pastes omit the trailing comma on the first row (`…10,00` then newline) but the
 * next row is still `04,59,…×30` — merge those too (insert `,` between rows when needed).
 * If we do not join them, the first line is parsed with the last two-digit as the
 * (wrong) rate, and the second line is parsed as a second segment.
 * Absorb any middle lines that are still comma-lists with no rate marker, then the
 * first line with `,…(x/=/\*)(rate)`.
 */
function mergeTrailingCommaListWithXOnLaterLine(lines: string[]): string[] {
  const hasExplicit =
    (s: string) =>
      /\(\d+\)/.test(s) || X_RATE_RE.test(s) || /=+\s*\d+/.test(s) || /\*\s*\d+/.test(s);
  /** Join two comma-list fragments: if `acc` already ends with `,`, WhatsApp glue is direct. */
  const glueCommaFragments = (acc: string, fragment: string): string => {
    const f = fragment.replace(/^\s+/, "");
    if (/,[\s]*$/.test(acc)) return acc + f;
    return `${acc},${f}`;
  };
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i]!.trim();
    const next = i + 1 < lines.length ? lines[i + 1]!.trim() : "";
    const trailingCommaStart = /,/.test(start) && !hasExplicit(start) && /,\s*$/.test(start);
    const noTrailingCommaButContinues =
      /,/.test(start) &&
      !hasExplicit(start) &&
      !/,\s*$/.test(start) &&
      next.length > 0 &&
      hasExplicit(lines[i + 1]!) &&
      /,/.test(lines[i + 1]!) &&
      /^\d/.test(next);
    if (!trailingCommaStart && !noTrailingCommaButContinues) {
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
        acc = glueCommaFragments(acc, n);
        out.push(acc);
        i = j + 1;
        merged = true;
        break;
      }
      if (hasExplicit(n) && !/,/.test(n)) {
        break;
      }
      if (/,/.test(n) && !hasExplicit(n)) {
        acc = glueCommaFragments(acc, n);
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

/**
 * Strips a leading slot code with **no** dot: `FB 31.67…` (WhatsApp). `stripLeadingGameLabels`
 * only handles `Harf.` / `Gali.`-style `Word.`, so leading `FB ` left letters on the
 * line, broke `isPureNumbers` and pending-merge with a following `.…xN` line.
 * Only strip when the rest clearly starts a jodi list, so e.g. `SG harf AxB …` is unchanged.
 */
function stripLooseSlotMarketPrefixForNumberLine(line: string): string {
  const t = line.replace(/^\uFEFF/, "").trim();
  if (!t) return line;
  const m = t.match(
    /^(?:FB|FD|GL|DB|SG|DS|GB|Gali)\b\.?\s*/i,
  );
  if (!m) return line;
  const rest = t.slice(m[0].length);
  const trimmed = rest.trimStart();
  if (trimmed.length === 0) return t;
  const c = trimmed[0]!;
  const looksLikeNumberListStart =
    /\d/.test(c) ||
    c === "." ||
    c === "," ||
    c === "…" ||
    c === "।" ||
    /[\u0966-\u096F]/.test(c);
  if (looksLikeNumberListStart) return rest.trim();
  return line;
}

export function calculateTotal(text: string): CalculationResult {
  const cleaned = preprocessText(text);
  const rawLines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const logicalLines: string[] = [];
  for (const rawLine of rawLines) {
    const afterLoose = stripLooseSlotMarketPrefixForNumberLine(rawLine);
    const labelStripped = stripLeadingGameLabels(afterLoose);
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
          /** Prefer previous clause rate; if none yet (first rows of paste), use ×rate on this line (e.g. `58…65.` + `44…x10`). */
          const rateForDotMerge =
            lastInheritedRate ?? lastExplicitRateInLine(line);
          if (
            pureP &&
            endsWithDot &&
            rateForDotMerge != null &&
            looksLikeDotSeparatedPairContinuation(body)
          ) {
            pushMerged(mergePendingBodyWithInheritedRate(p, body, rateForDotMerge));
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

  const results: Segment[] = [];
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
