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

/** Next row looks like `56.18…94` or `87...94..01` (dot-separated pairs, single or multi-dot), not `10 20` style. */
function looksLikeDotSeparatedPairContinuation(s: string): boolean {
  return /\d{2}\.+\d{2}/.test(s);
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
    /^(?:FB|FD|GL|DB|SG|DS|GB|Gali|HRF|Harf)\b\.?\s*/i,
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
  /** Each pure-number line as it was pushed into pending (untrimmed of accumulator joins). */
  let pendingLines: string[] = [];
  let lastInheritedRate: number | null = null;

  const resetPending = () => {
    pending = "";
    pendingLines = [];
  };

  const pushMerged = (s: string) => {
    const t = s.trim();
    if (!t) return;
    mergedLines.push(t);
    const r = lastExplicitRateInLine(t);
    if (r != null) lastInheritedRate = r;
  };

  /**
   * Two consecutive pure-number rows with no rate context: line 1 is values, line 2 is rates,
   * paired positionally (`54..14..08` + `10..20..15` → `54x10`, `14x20`, `08x15`).
   * Only fires when no explicit rate has been seen yet in the message (else inherit-rate path applies).
   * Both lines must have ≥2 two-digit value tokens and an equal count of 1-4 digit positive rate tokens.
   */
  const tryFlushAsValueRatePairs = (): boolean => {
    if (pendingLines.length !== 2) return false;
    if (lastInheritedRate != null) return false;
    const l1 = pendingLines[0]!;
    const l2 = pendingLines[1]!;
    const isPureLine = (s: string) => /^[\d\s\-_.,:|\/\\]+$/.test(s) && /\d/.test(s);
    if (!isPureLine(l1) || !isPureLine(l2)) return false;
    const valTokens = l1.match(/\d+/g) ?? [];
    const rateTokens = l2.match(/\d+/g) ?? [];
    if (valTokens.length < 2) return false;
    if (rateTokens.length !== valTokens.length) return false;
    if (!valTokens.every((t) => t.length === 2)) return false;
    if (!rateTokens.every((t) => t.length >= 1 && t.length <= 4 && parseInt(t, 10) > 0)) return false;
    for (let i = 0; i < valTokens.length; i++) {
      pushMerged(`${valTokens[i]}x${rateTokens[i]}`);
    }
    resetPending();
    return true;
  };

  const flushPending = () => {
    if (!pending) return;
    if (tryFlushAsValueRatePairs()) return;
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
    resetPending();
  };

  for (const line of withCommaXMerge) {
    const hasExplicitRate =
      /\(\d+\)/.test(line) || X_RATE_RE.test(line) || /=+\s*\d+/.test(line) || /\*\s*\d+/.test(line);
    const hasCommaRate = /,/.test(line);
    const hasKnownFlag =
      /\b(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i.test(line) || /पलट/.test(line);

    // `B.1111x9999x50` must never absorb `pending` — glue would break the first `x`.
    const isSelfContainedMultiX = Boolean(parseMultiXChainStructure(line));
    // Harf lines are always self-contained — never merge pending numbers into them.
    const isHarfLine = /\b(?:haruf|harf|hrf)\b/i.test(line);

    if (!hasExplicitRate && !hasCommaRate) {
      const isPureNumbers = /^[\d\s\-_.,:|\/\\]+$/.test(line) && /\d/.test(line);
      if (hasKnownFlag || isHarfLine) {
        flushPending();
        pushMerged(line);
      } else if (isPureNumbers) {
        pending = pending ? `${pending} ${line}` : line;
        pendingLines.push(line);
      } else {
        flushPending();
        pushMerged(line);
      }
    } else {
      if (pending) {
        if (isSelfContainedMultiX || isHarfLine) {
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
            resetPending();
          } else {
            flushPending();
            pushMerged(line);
          }
        } else {
          const endsWithPartialPair = /(?<!\d)\d$/.test(pending);
          const sep = endsWithPartialPair ? "" : " ";
          pushMerged(pending + sep + line);
          resetPending();
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

// ─── Source-tracked variant ────────────────────────────────────────────────────

/**
 * Identical pipeline to {@link calculateTotal} but tracks which original
 * (pre-normalisation) raw input lines produced each parsed segment.
 *
 * `segmentSourceIndices[i]` contains the indices into `rawLines` that were
 * merged to produce `results[i]`.  Combined with the returned `rawLines`
 * array and a forward-scan against the original input text, the admin panel
 * can highlight the exact (positionally-correct) source line even when the
 * same content appears multiple times in the input.
 */
export interface CalculationResultWithSources {
  result: CalculationResult;
  /** Parallel to `result.results`: indices into `rawLines` that produced each segment. */
  segmentSourceIndices: number[][];
  /** The rawLines array (trimmed, non-empty lines after preprocessText). */
  rawLines: string[];
}

/** A logical line paired with the rawLine indices it came from. */
type TL = { line: string; src: number[] };

function _mergeCommaOnlyRateContinuationTL(pairs: TL[]): TL[] {
  const out: TL[] = [];
  for (const pair of pairs) {
    const rateOnly = /^\s*,+\s*(\d{1,5})\s*$/.exec(pair.line);
    if (rateOnly && out.length) {
      const rate = rateOnly[1]!;
      const prev = out[out.length - 1]!;
      const core = prev.line.replace(/[.,\s]+$/g, "").replace(/^[\s,]+/, "");
      const twoDigitFieldCount = core
        .split(/,+/)
        .map((s) => s.replace(/[^\d]/g, ""))
        .filter((s) => s.length === 2).length;
      if (/,/.test(prev.line) && twoDigitFieldCount >= 3) {
        out[out.length - 1] = { line: `${core},${rate}`, src: [...prev.src, ...pair.src] };
        continue;
      }
    }
    out.push(pair);
  }
  return out;
}

function _mergeTrailingCommaListWithXOnLaterLineTL(pairs: TL[]): TL[] {
  const hasExplicit = (s: string) =>
    /\(\d+\)/.test(s) || X_RATE_RE.test(s) || /=+\s*\d+/.test(s) || /\*\s*\d+/.test(s);
  const glue = (acc: TL, frag: TL): TL => {
    const f = frag.line.replace(/^\s+/, "");
    return {
      line: /,[\s]*$/.test(acc.line) ? acc.line + f : `${acc.line},${f}`,
      src: [...acc.src, ...frag.src],
    };
  };
  const out: TL[] = [];
  let i = 0;
  while (i < pairs.length) {
    const start = pairs[i]!;
    const startLine = start.line.trim();
    const nextLine = i + 1 < pairs.length ? pairs[i + 1]!.line.trim() : "";
    const trailingCommaStart =
      /,/.test(startLine) && !hasExplicit(startLine) && /,\s*$/.test(startLine);
    const noTrailingCommaButContinues =
      /,/.test(startLine) &&
      !hasExplicit(startLine) &&
      !/,\s*$/.test(startLine) &&
      nextLine.length > 0 &&
      i + 1 < pairs.length &&
      hasExplicit(pairs[i + 1]!.line) &&
      /,/.test(pairs[i + 1]!.line) &&
      /^\d/.test(nextLine);
    if (!trailingCommaStart && !noTrailingCommaButContinues) {
      out.push(pairs[i]!);
      i += 1;
      continue;
    }
    let acc: TL = { line: start.line.replace(/\s+$/g, ""), src: [...start.src] };
    let j = i + 1;
    let merged = false;
    while (j < pairs.length) {
      const n = pairs[j]!;
      if (hasExplicit(n.line) && /,/.test(n.line)) {
        acc = glue(acc, n);
        out.push(acc);
        i = j + 1;
        merged = true;
        break;
      }
      if (hasExplicit(n.line) && !/,/.test(n.line)) break;
      if (/,/.test(n.line) && !hasExplicit(n.line)) { acc = glue(acc, n); j += 1; continue; }
      break;
    }
    if (merged) continue;
    out.push(pairs[i]!);
    i += 1;
  }
  return out;
}

export function calculateTotalWithSources(text: string): CalculationResultWithSources {
  const cleaned = preprocessText(text);
  const rawLines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  // Phase 1 — normalise each raw line, track its index in rawLines
  const logicalPairs: TL[] = [];
  for (let ri = 0; ri < rawLines.length; ri++) {
    const rawLine = rawLines[ri]!;
    const afterLoose = stripLooseSlotMarketPrefixForNumberLine(rawLine);
    const labelStripped = stripLeadingGameLabels(afterLoose);
    const line = normalizeTrailingDashRate(
      normalizeIntoRateMarker(normalizeTypoTolerantInput(labelStripped)),
    );
    if (isSeparatorOnlyLine(line)) continue;
    for (const s of splitTrailingNumberRunAfterLastRate(line)) {
      logicalPairs.push({ line: s, src: [ri] });
    }
  }

  // Phase 2 — same two merge passes, now with source tracking
  const withCommaCont = _mergeCommaOnlyRateContinuationTL(logicalPairs);
  const withCommaXMerge = _mergeTrailingCommaListWithXOnLaterLineTL(withCommaCont);

  // Phase 3 — pending / merge loop (mirror of calculateTotal)
  const mergedPairs: TL[] = [];
  let pendingTL: TL | null = null;
  let pendingLineStrs: string[] = [];
  let lastInheritedRateTL: number | null = null;

  const pushMergedTL = (tp: TL) => {
    const t = tp.line.trim();
    if (!t) return;
    mergedPairs.push({ line: t, src: tp.src });
    const r = lastExplicitRateInLine(t);
    if (r != null) lastInheritedRateTL = r;
  };
  const resetPendingTL = () => { pendingTL = null; pendingLineStrs = []; };

  const tryFlushAsValueRatePairsTL = (): boolean => {
    if (pendingLineStrs.length !== 2 || lastInheritedRateTL != null || !pendingTL) return false;
    const l1 = pendingLineStrs[0]!;
    const l2 = pendingLineStrs[1]!;
    const isPure = (s: string) => /^[\d\s\-_.,:|\/\\]+$/.test(s) && /\d/.test(s);
    if (!isPure(l1) || !isPure(l2)) return false;
    const valToks = l1.match(/\d+/g) ?? [];
    const rateToks = l2.match(/\d+/g) ?? [];
    if (valToks.length < 2 || rateToks.length !== valToks.length) return false;
    if (!valToks.every((t) => t.length === 2)) return false;
    if (!rateToks.every((t) => t.length >= 1 && t.length <= 4 && parseInt(t, 10) > 0)) return false;
    for (let i = 0; i < valToks.length; i++) {
      pushMergedTL({ line: `${valToks[i]}x${rateToks[i]}`, src: [...pendingTL.src] });
    }
    resetPendingTL();
    return true;
  };

  const flushPendingTL = () => {
    if (!pendingTL) return;
    if (tryFlushAsValueRatePairsTL()) return;
    let toPush = pendingTL.line;
    const isPurePending = /^[\d\s\-_.,:|\/\\]+$/.test(pendingTL.line) && /\d/.test(pendingTL.line);
    if (isPurePending && lastInheritedRateTL != null) {
      const endsWithPartialPair = /(?<!\d)\d$/.test(pendingTL.line);
      const sep = endsWithPartialPair ? "" : " ";
      toPush = `${pendingTL.line}${sep}x${lastInheritedRateTL}`;
    }
    if (!(isSeparatorOnlyLine(toPush) || (/^[\d\s\-_.,:|\/\\]*$/.test(toPush) && !/\d/.test(toPush)))) {
      pushMergedTL({ line: toPush, src: pendingTL.src });
    }
    resetPendingTL();
  };

  for (const tp of withCommaXMerge) {
    const { line } = tp;
    const hasExplicitRate =
      /\(\d+\)/.test(line) || X_RATE_RE.test(line) || /=+\s*\d+/.test(line) || /\*\s*\d+/.test(line);
    const hasCommaRate = /,/.test(line);
    const hasKnownFlag =
      /\b(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i.test(line) || /पलट/.test(line);
    const isSelfContainedMultiX = Boolean(parseMultiXChainStructure(line));
    const isHarfLine = /\b(?:haruf|harf|hrf)\b/i.test(line);

    if (!hasExplicitRate && !hasCommaRate) {
      const isPureNumbers = /^[\d\s\-_.,:|\/\\]+$/.test(line) && /\d/.test(line);
      if (hasKnownFlag || isHarfLine) {
        flushPendingTL();
        pushMergedTL(tp);
      } else if (isPureNumbers) {
        if (pendingTL) {
          pendingTL = { line: `${pendingTL.line} ${line}`, src: [...pendingTL.src, ...tp.src] };
        } else {
          pendingTL = { ...tp };
        }
        pendingLineStrs.push(line);
      } else {
        flushPendingTL();
        pushMergedTL(tp);
      }
    } else {
      if (pendingTL) {
        if (isSelfContainedMultiX || isHarfLine) {
          flushPendingTL();
          pushMergedTL(tp);
        } else if (!/\d/.test(pendingTL.line)) {
          flushPendingTL();
          pushMergedTL(tp);
        } else if (isSelfContainedDigitRowWithRate(line, pendingTL.line)) {
          const p = pendingTL.line.trim();
          const pureP = /^[\d\s\-_.,:|\/\\]+$/.test(p) && /\d/.test(p);
          const endsWithDot = /\.\s*$/.test(p);
          const body = stripTrailingSeparatorRateTail(line);
          const rateForDotMerge = lastInheritedRateTL ?? lastExplicitRateInLine(line);
          if (pureP && endsWithDot && rateForDotMerge != null && looksLikeDotSeparatedPairContinuation(body)) {
            pushMergedTL({
              line: mergePendingBodyWithInheritedRate(p, body, rateForDotMerge),
              src: [...pendingTL.src, ...tp.src],
            });
            resetPendingTL();
          } else {
            flushPendingTL();
            pushMergedTL(tp);
          }
        } else {
          const endsWithPartialPair = /(?<!\d)\d$/.test(pendingTL.line);
          const sep = endsWithPartialPair ? "" : " ";
          pushMergedTL({ line: pendingTL.line + sep + line, src: [...pendingTL.src, ...tp.src] });
          resetPendingTL();
        }
      } else {
        pushMergedTL(tp);
      }
    }
  }
  flushPendingTL();

  // Phase 4 — run processLine and attach rawLine indices to each produced segment
  const results: Segment[] = [];
  const segmentSourceIndices: number[][] = [];
  const failedLines: string[] = [];

  for (const mp of mergedPairs) {
    const segs = processLine(mp.line);
    if (segs.length > 0) {
      for (const seg of segs) {
        results.push(seg);
        segmentSourceIndices.push(mp.src);
      }
    } else if (mp.line.trim()) {
      failedLines.push(mp.line.trim());
    }
  }

  return {
    result: {
      results,
      total: results.reduce((s, r) => s + r.lineTotal, 0),
      ...(failedLines.length > 0 ? { failedLines } : {}),
    },
    segmentSourceIndices,
    rawLines,
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
