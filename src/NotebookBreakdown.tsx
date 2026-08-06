import { useMemo, useState } from "react";
import {
  calculateTotalWithSources,
  extractPairedNumbers,
  formatSegmentLineForPairListDisplay,
  parseWhatsAppMessages,
  processLine,
  splitCommaGroupsAtPalatMarkers,
} from "@/lib";
import type { CalculationResult, Segment } from "@/types";
import {
  BreakdownEditForm,
  breakdownHintNumbers,
  rebuildCalculationResult,
} from "./EditableBreakdown";
import {
  findRateHighlightStart,
  shouldBoldRateOnLine,
} from "./notebookRateHighlight";
import { BreakdownEditIcon, BreakdownWarningIcon } from "./calculator/breakdownIcons";

interface Props {
  text: string;
  result: CalculationResult;
  onChange?: (updated: CalculationResult) => void;
  /** Open report modal with this failed line prefilled. */
  onReportFailedLine?: (failedLine: string) => void;
  /** 0 = 9px … 11 = 20px (see CHECK_FONT_LEVELS). */
  fontLevel?: number;
}

export const CHECK_FONT_SIZE_KEY = "calc-check-font-size";
export const CHECK_FONT_LEVELS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
const DEFAULT_FONT_LEVEL = 2; // 11px

export function getStoredCheckFontLevel(): number {
  try {
    const raw = localStorage.getItem(CHECK_FONT_SIZE_KEY);
    if (raw === null) return DEFAULT_FONT_LEVEL;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return DEFAULT_FONT_LEVEL;

    const levels = CHECK_FONT_LEVELS as readonly number[];
    // Pixel stored (9–20)
    if (v >= 9 && v <= 20) {
      const idx = levels.indexOf(v);
      return idx >= 0 ? idx : DEFAULT_FONT_LEVEL;
    }
    // Legacy: index on older scales
    for (const legacy of [
      [9, 11, 13, 15, 17, 20],
      [9, 11, 13, 15],
    ]) {
      if (v >= 0 && v < legacy.length) {
        const idx = levels.indexOf(legacy[v]!);
        if (idx >= 0) return idx;
      }
    }
    if (v >= 0 && v < levels.length) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_FONT_LEVEL;
}

export function persistCheckFontLevel(level: number): void {
  try {
    localStorage.setItem(CHECK_FONT_SIZE_KEY, String(checkFontSizePx(level)));
  } catch {
    /* ignore */
  }
}

export function checkFontSizePx(level: number): number {
  const i = Math.min(
    CHECK_FONT_LEVELS.length - 1,
    Math.max(0, Math.floor(level))
  );
  return CHECK_FONT_LEVELS[i]!;
}

function segmentTagsSuffix(seg: Segment): string {
  const tags: string[] = [];
  if (seg.isWP) tags.push("WP");
  if (seg.lane === "A") tags.push("A");
  if (seg.lane === "B") tags.push("B");
  if (seg.lane === "AB" || (!seg.lane && seg.isDouble)) tags.push("AB");
  return tags.length > 0 ? ` · ${tags.join(" ")}` : "";
}

function segmentRowRight(seg: Segment): string[] {
  const jodis = formatSegmentLineForPairListDisplay(seg);
  return [
    `${jodis}${segmentTagsSuffix(seg)}`,
    `${seg.count} × ${seg.rate} = ${seg.lineTotal}`,
  ];
}

function segmentsMatchParsed(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => {
    const o = b[i]!;
    return (
      seg.line === o.line &&
      seg.rate === o.rate &&
      seg.count === o.count &&
      seg.lineTotal === o.lineTotal &&
      seg.isWP === o.isWP &&
      seg.isDouble === o.isDouble &&
      seg.lane === o.lane
    );
  });
}

interface NotebookRow {
  left: string;
  /** Bold this rate number wherever it appears in `left`. */
  boldRate?: number;
  right: string[];
  key: string;
  groupIndex: number | null;
  error?: {
    failedLine: string;
    isLastInGroup: boolean;
  };
}

function MessageWithBoldRate({
  text,
  rate,
  fontSize,
}: {
  text: string;
  rate?: number;
  fontSize: number;
}) {
  if (rate == null) {
    return <span style={{ fontSize }}>{text}</span>;
  }
  let start = findRateHighlightStart(text, rate);
  if (start == null) {
    const trimmed = text.trim();
    if (trimmed === String(rate)) {
      const idx = text.indexOf(trimmed);
      start = idx >= 0 ? idx : 0;
    }
  }
  if (start == null) {
    return <span style={{ fontSize }}>{text}</span>;
  }
  const rateLen = String(rate).length;
  const before = text.slice(0, start);
  const highlighted = text.slice(start, start + rateLen);
  const after = text.slice(start + rateLen);
  return (
    <span style={{ fontSize }}>
      {before}
      <strong className="pc-check__rate-hl">
        {highlighted}
      </strong>
      {after}
    </span>
  );
}

const GROUP_ROW_CLASS = [
  "pc-check__row--g0",
  "pc-check__row--g1",
  "pc-check__row--g2",
  "pc-check__row--g3",
] as const;

function rowBgClass(row: NotebookRow): string {
  if (row.error) return "pc-check__row--error";
  if (row.groupIndex === null) return "pc-check__row--plain";
  return GROUP_ROW_CLASS[row.groupIndex % GROUP_ROW_CLASS.length]!;
}

function rawLineMatchesFailed(raw: string, failed: string): boolean {
  const r = raw.trim();
  const f = failed.trim();
  if (!r || !f) return false;
  return r === f || f.includes(r) || r.includes(f);
}

function boldRateForLine(
  left: string,
  rate: number,
  isLastSourceLine: boolean,
): number | undefined {
  return shouldBoldRateOnLine(left, rate, {
    isLastSourceLineOfSegment: isLastSourceLine,
  })
    ? rate
    : undefined;
}

/** One pasted raw line can produce multiple parsed segments (e.g. palat comma split). */
function rawLineMapsToMultipleSegments(srcIndices: number[][]): boolean {
  const rawToSeg = new Map<number, number[]>();
  for (let si = 0; si < srcIndices.length; si++) {
    for (const ri of srcIndices[si] ?? []) {
      const list = rawToSeg.get(ri) ?? [];
      list.push(si);
      rawToSeg.set(ri, list);
    }
  }
  return [...rawToSeg.values()].some((list) => list.length > 1);
}

function attachFailedLines(rows: NotebookRow[], failedLines: string[]): NotebookRow[] {
  const next = rows.map((r) => ({ ...r }));
  const unmatched: string[] = [];

  for (const failed of failedLines) {
    const hit: number[] = [];
    for (let i = 0; i < next.length; i++) {
      if (next[i]!.error) continue;
      if (rawLineMatchesFailed(next[i]!.left, failed)) hit.push(i);
    }

    if (hit.length === 0) {
      unmatched.push(failed);
      continue;
    }

    hit.forEach((idx, j) => {
      const isLast = j === hit.length - 1;
      next[idx] = {
        ...next[idx]!,
        groupIndex: null,
        error: { failedLine: failed, isLastInGroup: isLast },
        right: isLast
          ? ["Could not read this line", "Not added to total"]
          : ["Not counted (continued)"],
      };
    });
  }

  for (const failed of unmatched) {
    next.push({
      left: failed,
      right: ["Could not read this line", "Not added to total"],
      key: `failed-${failed}`,
      groupIndex: null,
      error: { failedLine: failed, isLastInGroup: true },
    });
  }

  return next;
}

/** Build Check rows for one paste snippet (one WA message body or full plain text). */
export function buildNotebookRowsSingle(
  text: string,
  result: CalculationResult,
  groupIndexOffset = 0,
): NotebookRow[] {
  const { rawLines, segmentSourceIndices, result: parsedFromText } =
    calculateTotalWithSources(text);
  const useSourceLayout = segmentsMatchParsed(
    result.results,
    parsedFromText.results
  );

  const rows: NotebookRow[] = [];
  const keyPrefix =
    groupIndexOffset > 0 ? `g${groupIndexOffset}-` : "";

  const segmentNotebookLeftFallback = (seg: Segment): string => {
    const suffix = seg.isWP ? " पलट के साथ" : "";
    return `${seg.line},,,,${seg.rate}${suffix}`;
  };

  const segmentNotebookLeft = (
    seg: Segment,
    segIdx: number,
    srcIndices: number[][],
    rawToSegIdxs: Map<number, number[]>,
  ): string => {
    const rawIdx = srcIndices[segIdx]?.[0];
    if (rawIdx === undefined) return segmentNotebookLeftFallback(seg);
    const raw = rawLines[rawIdx]!;
    const segIdxsOnRaw = rawToSegIdxs.get(rawIdx) ?? [];
    const posOnRaw = segIdxsOnRaw.indexOf(segIdx);
    const chunks = splitCommaGroupsAtPalatMarkers(raw);
    if (chunks && posOnRaw >= 0 && chunks[posOnRaw] !== undefined) {
      return chunks[posOnRaw]!;
    }
    return segmentNotebookLeftFallback(seg);
  };

  const pushSegmentRows = (
    segments: Segment[],
    srcIndices?: number[][],
  ) => {
    const rawToSegIdxs = new Map<number, number[]>();
    if (srcIndices) {
      for (let si = 0; si < srcIndices.length; si++) {
        for (const ri of srcIndices[si] ?? []) {
          const list = rawToSegIdxs.get(ri) ?? [];
          if (!list.includes(si)) list.push(si);
          rawToSegIdxs.set(ri, list);
        }
      }
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const left =
        srcIndices != null
          ? segmentNotebookLeft(seg, i, srcIndices, rawToSegIdxs)
          : seg.line;
      rows.push({
        left,
        boldRate: boldRateForLine(left, seg.rate, true),
        right: segmentRowRight(seg),
        key: `${keyPrefix}seg-${i}-${seg.line}-${seg.rate}-${seg.count}-${seg.lineTotal}`,
        groupIndex: i + groupIndexOffset,
      });
    }
  };

  const pushSourceLayoutRows = (
    segments: Segment[],
    srcIndices: number[][],
  ) => {
    const lineToSeg = new Map<number, number>();
    for (let segIdx = 0; segIdx < srcIndices.length; segIdx++) {
      for (const ri of srcIndices[segIdx] ?? []) {
        lineToSeg.set(ri, segIdx);
      }
    }

    for (let ri = 0; ri < rawLines.length; ri++) {
      const left = rawLines[ri]!;
      const segIdx = lineToSeg.get(ri);
      if (segIdx === undefined) {
        rows.push({
          left,
          right: ["—"],
          key: `${keyPrefix}raw-${ri}-${left}`,
          groupIndex: null,
        });
        continue;
      }
      const srcIdxs = srcIndices[segIdx] ?? [];
      const isLast = ri === Math.max(...srcIdxs);
      const seg = segments[segIdx];
      if (!seg) {
        rows.push({
          left,
          right: ["—"],
          key: `${keyPrefix}raw-${ri}-${left}`,
          groupIndex: null,
        });
        continue;
      }
      const gi = segIdx + groupIndexOffset;
      if (isLast) {
        rows.push({
          left,
          boldRate: boldRateForLine(left, seg.rate, true),
          right: segmentRowRight(seg),
          key: `${keyPrefix}raw-${ri}-seg-${segIdx}`,
          groupIndex: gi,
        });
      } else {
        const pairs = extractPairedNumbers(left);
        const partial =
          pairs.length > 0
            ? pairs.map((p) => p.toString().padStart(2, "0")).join(", ")
            : "↳ continues";
        rows.push({
          left,
          boldRate: boldRateForLine(left, seg.rate, false),
          right: [partial],
          key: `${keyPrefix}raw-${ri}-cont`,
          groupIndex: gi,
        });
      }
    }
  };

  const multiSegPerRawLine = rawLineMapsToMultipleSegments(segmentSourceIndices);

  if (multiSegPerRawLine) {
    pushSegmentRows(result.results, segmentSourceIndices);
  } else if (useSourceLayout) {
    pushSourceLayoutRows(result.results, segmentSourceIndices);
  } else if (segmentSourceIndices.length > 0) {
    // Re-parse layout still matches raw lines; stored segments may differ after multi-WA merge.
    const segments = result.results.map(
      (seg, i) => seg ?? parsedFromText.results[i]!,
    );
    pushSourceLayoutRows(segments, segmentSourceIndices);
  } else {
    pushSegmentRows(result.results);
  }

  return rows;
}

function buildNotebookRows(text: string, result: CalculationResult) {
  const waMsgs = parseWhatsAppMessages(text);
  let rows: NotebookRow[];

  if (waMsgs && waMsgs.length > 0) {
    rows = [];
    let segOffset = 0;
    let groupOffset = 0;
    for (const m of waMsgs) {
      const n = m.result.results.length;
      const slice: CalculationResult = {
        results: result.results.slice(segOffset, segOffset + n),
        total: result.results
          .slice(segOffset, segOffset + n)
          .reduce((s, r) => s + r.lineTotal, 0),
      };
      rows.push(...buildNotebookRowsSingle(m.text, slice, groupOffset));
      segOffset += n;
      groupOffset += n;
    }
  } else {
    rows = buildNotebookRowsSingle(text, result);
  }

  const failedLines = result.failedLines ?? [];
  if (failedLines.length === 0) return rows;
  return attachFailedLines(rows, failedLines);
}

export default function NotebookBreakdown({
  text,
  result,
  onChange,
  onReportFailedLine,
  fontLevel = DEFAULT_FONT_LEVEL,
}: Props) {
  const rows = useMemo(
    () => buildNotebookRows(text, result),
    [text, result],
  );
  const failedLines = result.failedLines ?? [];
  const partTotals = result.results.map((r) => r.lineTotal);
  const sumLine =
    partTotals.length > 1 ? partTotals.join(" + ") : null;

  const cellPx = checkFontSizePx(fontLevel);
  const totalPx = cellPx + 4;
  const sumPx = Math.max(9, cellPx - 1);
  const btnPx = Math.max(9, cellPx - 1);

  const [fixingLine, setFixingLine] = useState<string | null>(null);
  const [fixLine, setFixLine] = useState("");
  const [fixRate, setFixRate] = useState("");
  const [fixWP, setFixWP] = useState(false);
  const [fixAB, setFixAB] = useState(false);

  const startFix = (line: string) => {
    setFixingLine(line);
    setFixLine(breakdownHintNumbers(line));
    setFixRate("");
    setFixWP(false);
    setFixAB(false);
  };

  const saveFix = () => {
    if (!fixingLine || !onChange) return;
    const suffix = `${fixWP ? "wp" : ""}${fixAB ? "ab" : ""}`;
    const parsed = processLine(`${fixLine}(${fixRate})${suffix}`);
    if (!parsed.length) return;
    onChange(
      rebuildCalculationResult(
        [...result.results, ...parsed],
        failedLines.filter((l) => l !== fixingLine)
      )
    );
    setFixingLine(null);
  };

  const skipFailedLine = (line: string) => {
    if (!onChange) return;
    onChange(
      rebuildCalculationResult(
        result.results,
        failedLines.filter((l) => l !== line)
      )
    );
  };

  return (
    <div className="pc-check">
      {failedLines.length > 0 && (
        <div data-parse-error-banner className="pc-check__alert">
          <span className="pc-check__alert-icon" aria-hidden>
            <BreakdownWarningIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="pc-check__alert-title">
              {failedLines.length} line{failedLines.length > 1 ? "s" : ""} could
              not be read
            </p>
            <p className="pc-check__alert-desc">
              Highlighted in red below — not included in the total
            </p>
          </div>
        </div>
      )}

      <div className="pc-check__table">
        <div className="pc-check__head">
          <div className="pc-check__head-cell">Your message</div>
          <div className="pc-check__head-cell">Calculation</div>
        </div>

        {rows.length === 0 && failedLines.length === 0 && (
          <div className="pc-check__empty">No lines to show</div>
        )}

        {rows.map((row) => (
          <div key={row.key}>
            <div className={`pc-check__row ${rowBgClass(row)}`}>
              <div className="pc-check__cell-left">
                <MessageWithBoldRate
                  text={row.left}
                  rate={row.boldRate}
                  fontSize={cellPx}
                />
              </div>
              <div className="pc-check__cell-right">
                {row.right.map((line, j) => (
                  <div
                    key={j}
                    className={`pc-check__calc-line ${
                      row.error
                        ? "pc-check__calc-line--error"
                        : j === 0
                          ? "pc-check__calc-line--meta"
                          : "pc-check__calc-line--total"
                    }`}
                    style={{ fontSize: cellPx }}
                  >
                    {line}
                  </div>
                ))}
                {row.error?.isLastInGroup && onChange && fixingLine !== row.error.failedLine && (
                  <div className="pc-check__actions">
                    <button
                      type="button"
                      onClick={() => startFix(row.error!.failedLine)}
                      className="pc-check__btn pc-check__btn--primary"
                      style={{ fontSize: btnPx }}
                    >
                      <BreakdownEditIcon className="h-3.5 w-3.5" />
                      Fix
                    </button>
                    {onReportFailedLine && (
                      <button
                        type="button"
                        onClick={() => onReportFailedLine(row.error!.failedLine)}
                        className="pc-check__btn pc-check__btn--report"
                        style={{ fontSize: btnPx }}
                      >
                        Report
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => skipFailedLine(row.error!.failedLine)}
                      className="pc-check__btn pc-check__btn--ghost"
                      style={{ fontSize: btnPx }}
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            </div>
            {fixingLine === row.error?.failedLine && onChange && (
              <BreakdownEditForm
                line={fixLine}
                rate={fixRate}
                isWP={fixWP}
                isAB={fixAB}
                onLineChange={setFixLine}
                onRateChange={setFixRate}
                onWPChange={setFixWP}
                onABChange={setFixAB}
                onSave={saveFix}
                onCancel={() => setFixingLine(null)}
                context={row.error.failedLine}
              />
            )}
          </div>
        ))}

        <div className="pc-check__foot">
          <div className="pc-check__foot-left" />
          <div className="pc-check__foot-right">
            {sumLine && (
              <div className="pc-check__sum" style={{ fontSize: sumPx }}>
                {sumLine}
              </div>
            )}
            <div className="pc-check__total" style={{ fontSize: totalPx }}>
              Total {result.total}
            </div>
            {failedLines.length > 0 && (
              <div className="pc-check__foot-note">
                {failedLines.length} line{failedLines.length > 1 ? "s" : ""} not
                counted
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
