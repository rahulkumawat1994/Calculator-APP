import { useState } from "react";
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

interface Props {
  text: string;
  result: CalculationResult;
  onChange?: (updated: CalculationResult) => void;
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
      <strong className="font-extrabold text-[#1d6fb8] underline underline-offset-2">
        {highlighted}
      </strong>
      {after}
    </span>
  );
}

const GROUP_BG = [
  "bg-[#f4f8ff]",
  "bg-[#fffef5]",
  "bg-[#f0fdf6]",
  "bg-[#fdf4ff]",
] as const;

function rowBgClass(row: NotebookRow): string {
  if (row.error) return "bg-red-50";
  return groupBgClass(row.groupIndex);
}

function groupBgClass(groupIndex: number | null): string {
  if (groupIndex === null) return "bg-white";
  return GROUP_BG[groupIndex % GROUP_BG.length]!;
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
          ? ["⚠ Could not read this line", "Not added to total"]
          : ["↳ not counted"],
      };
    });
  }

  for (const failed of unmatched) {
    next.push({
      left: failed,
      right: ["⚠ Could not read this line", "Not added to total"],
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
  fontLevel = DEFAULT_FONT_LEVEL,
}: Props) {
  const rows = buildNotebookRows(text, result);
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
    <div className="space-y-2">
      {failedLines.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <span className="text-red-500 text-base shrink-0" aria-hidden>
            ⚠
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-red-700">
              {failedLines.length} line{failedLines.length > 1 ? "s" : ""} could
              not be read
            </p>
            <p className="text-[11px] text-red-500 mt-0.5">
              Shown in red below — not included in the total
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#d5e4f5] overflow-hidden bg-[#fffef8]">
        <div className="grid grid-cols-2 border-b-2 border-[#c5d9ea] bg-[#f6f9fd]">
          <div className="px-2.5 py-1.5 border-r border-[#dde8f0]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Your message
            </span>
          </div>
          <div className="px-2.5 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Calculation
            </span>
          </div>
        </div>

        {rows.length === 0 && failedLines.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-gray-500">
            No lines to show
          </div>
        )}

        {rows.map((row) => (
          <div key={row.key}>
            <div
              className={`grid grid-cols-2 border-b min-h-[36px] items-start ${rowBgClass(row)} ${
                row.error ? "border-red-100" : "border-[#e8eef5]"
              }`}
            >
              <div
                className={`px-2.5 py-2 border-r font-mono wrap-break-word leading-relaxed ${
                  row.error
                    ? "border-red-100 text-red-800"
                    : "border-[#e8eef5] text-[#333]"
                }`}
              >
                <MessageWithBoldRate
                  text={row.left}
                  rate={row.boldRate}
                  fontSize={cellPx}
                />
              </div>
              <div className="px-2.5 py-2 space-y-0.5">
                {row.right.map((line, j) => (
                  <div
                    key={j}
                    className={`font-mono leading-relaxed wrap-break-word ${
                      row.error
                        ? "text-red-600 font-semibold"
                        : j === 0
                          ? "text-gray-600"
                          : "font-bold text-[#1d6fb8]"
                    }`}
                    style={{ fontSize: cellPx }}
                  >
                    {line}
                  </div>
                ))}
                {row.error?.isLastInGroup && onChange && fixingLine !== row.error.failedLine && (
                  <div className="flex gap-1.5 pt-1.5">
                    <button
                      type="button"
                      onClick={() => startFix(row.error!.failedLine)}
                      className="font-semibold bg-[#1d6fb8] text-white rounded-md px-2 py-0.5 hover:bg-[#165fa3]"
                      style={{ fontSize: btnPx }}
                    >
                      Fix
                    </button>
                    <button
                      type="button"
                      onClick={() => skipFailedLine(row.error!.failedLine)}
                      className="text-gray-500 border border-gray-200 rounded-md px-2 py-0.5 hover:text-red-500"
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

        <div className="grid grid-cols-2 bg-[#eef4fc] border-t-2 border-[#c5d9ea]">
          <div className="px-2.5 py-2.5 border-r border-[#dde8f0]" />
          <div className="px-2.5 py-2.5">
            {sumLine && (
              <div
                className="font-mono text-gray-500 mb-0.5"
                style={{ fontSize: sumPx }}
              >
                {sumLine}
              </div>
            )}
            <div
              className="font-mono font-extrabold text-[#1d6fb8] tabular-nums"
              style={{ fontSize: totalPx }}
            >
              Total {result.total}
            </div>
            {failedLines.length > 0 && (
              <div
                className="font-mono text-red-500 mt-1"
                style={{ fontSize: sumPx }}
              >
                {failedLines.length} line{failedLines.length > 1 ? "s" : ""} not counted
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
