import { useState } from "react";
import { createPortal } from "react-dom";
import type { CalculationResult, Segment } from "./types";
import {
  extractPairedNumbers,
  formatSegmentLineForPairListDisplay,
  processLine,
} from "./calcUtils";

interface Props {
  result: CalculationResult;
  onChange: (updated: CalculationResult) => void;
  compact?: boolean;
  /** When true, row 🗑 opens a confirm dialog (e.g. History) instead of deleting immediately. */
  confirmRowDelete?: boolean;
  /** When set, row numbers are toggles (blue / red) for multi-select bulk delete from the parent. */
  rowSelection?: {
    selectedIndices: ReadonlySet<number>;
    onToggleRowSelect: (rowIndex: number) => void;
  };
}

function rebuild(results: Segment[], failedLines?: string[]): CalculationResult {
  return {
    results,
    total: results.reduce((s, r) => s + r.lineTotal, 0),
    ...(failedLines && failedLines.length > 0 ? { failedLines } : {}),
  };
}

/** Comma jodi list: each jodi in nowrap so digits like 0 and 3 in 03 are never split across lines. */
function JodiListDisplay({ text }: { text: string }) {
  const parts = text.split(", ");
  if (parts.length === 0) return text;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? ", " : null}
          {p}
        </span>
      ))}
    </>
  );
}

// Hint for the numbers field on failed lines — align with extractPairedNumbers when possible.
function hintNumbers(line: string): string {
  const pairs = extractPairedNumbers(line);
  if (pairs.length > 0) {
    return pairs.map((p) => p.toString().padStart(2, "0")).join(" ");
  }
  return (line.match(/(?<!\d)\d{2}(?!\d)/g) ?? []).join(" ");
}

// Shared edit form used for both editing existing rows and fixing failed lines
function EditForm({
  line, rate, isWP, isAB,
  onLineChange, onRateChange, onWPChange, onABChange,
  onSave, onCancel, context,
}: {
  line: string; rate: string; isWP: boolean; isAB: boolean;
  onLineChange: (v: string) => void; onRateChange: (v: string) => void;
  onWPChange: (v: boolean) => void; onABChange: (v: boolean) => void;
  onSave: () => void; onCancel: () => void;
  context?: string; // original failed text shown as hint
}) {
  return (
    <div className="p-3 space-y-2 bg-blue-50">
      {context && (
        <div className="text-[11px] text-gray-500 font-mono bg-white border border-gray-200 rounded-lg px-2 py-1 truncate">
          Original: <span className="text-red-500">{context}</span>
        </div>
      )}
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
            Numbers
          </label>
          <input
            value={line}
            onChange={e => onLineChange(e.target.value)}
            placeholder="e.g. 56 57 58"
            className="w-full text-sm font-mono border border-[#c5cfe0] focus:border-[#1d6fb8] rounded-lg px-2.5 py-1.5 outline-none bg-white"
          />
        </div>
        <div className="w-[72px] shrink-0">
          <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
            Rate
          </label>
          <input
            type="number"
            value={rate}
            onChange={e => onRateChange(e.target.value)}
            placeholder="50"
            className="w-full text-sm border border-[#c5cfe0] focus:border-[#1d6fb8] rounded-lg px-2.5 py-1.5 outline-none bg-white"
          />
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={isWP} onChange={e => onWPChange(e.target.checked)} className="w-4 h-4 accent-[#1d6fb8]" />
          <span className="font-semibold text-blue-700">WP</span>
          <span className="text-gray-400 text-xs">(pairs)</span>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={isAB} onChange={e => onABChange(e.target.checked)} className="w-4 h-4 accent-amber-500" />
          <span className="font-semibold text-amber-700">AB</span>
          <span className="text-gray-400 text-xs">(×2 count)</span>
        </label>
        <div className="flex gap-2 ml-auto">
          <button onClick={onCancel} className="text-sm text-gray-500 border border-gray-200 bg-white rounded-lg px-3 py-1 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onSave} className="text-sm bg-[#1d6fb8] text-white font-semibold rounded-lg px-4 py-1 hover:bg-[#165fa3] transition-colors">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EditableBreakdown({
  result,
  onChange,
  compact,
  confirmRowDelete,
  rowSelection,
}: Props) {
  // Editing existing rows
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editLine, setEditLine] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editWP, setEditWP] = useState(false);
  const [editAB, setEditAB] = useState(false);

  // Fixing failed lines
  const [fixingLine, setFixingLine] = useState<string | null>(null);
  const [fixLine, setFixLine] = useState("");
  const [fixRate, setFixRate] = useState("");
  const [fixWP, setFixWP] = useState(false);
  const [fixAB, setFixAB] = useState(false);

  const [pendingRowDeleteIdx, setPendingRowDeleteIdx] = useState<number | null>(null);

  const failedLines = result.failedLines ?? [];

  // ── Existing row edit ────────────────────────────────────────────────────────
  const startEdit = (i: number, seg: Segment) => {
    setEditingIdx(i);
    setEditLine(seg.line);
    setEditRate(String(seg.rate));
    setEditWP(seg.isWP);
    setEditAB(seg.isDouble);
    setFixingLine(null);
  };

  const cancelEdit = () => setEditingIdx(null);

  const saveEdit = () => {
    if (editingIdx === null) return;
    const suffix = `${editWP ? "wp" : ""}${editAB ? "ab" : ""}`;
    const parsed = processLine(`${editLine}(${editRate})${suffix}`);
    if (!parsed.length) return;
    // Replace the edited row with all segments returned (processLine may return multiple)
    const before = result.results.slice(0, editingIdx);
    const after  = result.results.slice(editingIdx + 1);
    onChange(rebuild([...before, ...parsed, ...after], failedLines));
    setEditingIdx(null);
  };

  const runDeleteRow = (i: number) => {
    onChange(rebuild(result.results.filter((_, idx) => idx !== i), failedLines));
    if (editingIdx === i) setEditingIdx(null);
  };

  const requestDeleteRow = (i: number) => {
    if (confirmRowDelete) setPendingRowDeleteIdx(i);
    else runDeleteRow(i);
  };

  const confirmPendingRowDelete = () => {
    if (pendingRowDeleteIdx !== null) runDeleteRow(pendingRowDeleteIdx);
    setPendingRowDeleteIdx(null);
  };

  // ── Failed line fix ──────────────────────────────────────────────────────────
  const startFix = (line: string) => {
    setFixingLine(line);
    setFixLine(hintNumbers(line));
    setFixRate("");
    setFixWP(false);
    setFixAB(false);
    setEditingIdx(null);
  };

  const cancelFix = () => setFixingLine(null);

  const saveFix = () => {
    if (!fixingLine) return;
    const suffix = `${fixWP ? "wp" : ""}${fixAB ? "ab" : ""}`;
    const parsed = processLine(`${fixLine}(${fixRate})${suffix}`);
    if (!parsed.length) return;
    onChange(rebuild(
      [...result.results, ...parsed],
      failedLines.filter(l => l !== fixingLine)
    ));
    setFixingLine(null);
  };

  const skipFailedLine = (line: string) => {
    onChange(rebuild(result.results, failedLines.filter(l => l !== line)));
  };

  const numSize = compact ? "text-sm" : "text-[17px]";
  const totalSize = compact ? "text-base" : "text-[28px]";
  const circleSize = compact ? "w-5 h-5 text-[11px]" : "min-w-[28px] h-7 text-sm";

  const rowDeleteModal =
    confirmRowDelete &&
    pendingRowDeleteIdx !== null &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[20000] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={e => {
              if (e.target === e.currentTarget) setPendingRowDeleteIdx(null);
            }}
          >
            <div
              className="bg-white rounded-[20px] shadow-2xl w-full max-w-[400px] overflow-hidden border-2 border-[#dde8f0]"
              role="dialog"
              aria-labelledby="eb-delete-row-title"
              aria-modal="true"
            >
              <div className="px-5 py-4 border-b border-[#e7eef7]">
                <h2 id="eb-delete-row-title" className="text-[18px] font-extrabold text-red-700">
                  Delete this line?
                </h2>
                <p className="text-[13px] text-gray-600 mt-2 leading-snug">
                  This removes one betting row from the breakdown and updates the total.
                </p>
              </div>
              <div className="p-4 flex gap-2">
                <button
                  type="button"
                  onClick={confirmPendingRowDelete}
                  className="flex-1 py-3 rounded-[12px] text-[15px] font-bold bg-red-600 text-white active:opacity-90"
                >
                  Yes, Delete
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRowDeleteIdx(null)}
                  className="flex-1 py-3 rounded-[12px] text-[15px] font-semibold bg-gray-100 text-gray-700 active:opacity-90"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-2">

      {/* ── Error banner + failed lines ── */}
      {failedLines.length > 0 && (
        <div className="rounded-xl border border-red-200 overflow-hidden">
          {/* Banner */}
          <div className="flex items-start gap-2 p-3 bg-red-50">
            <span className="text-red-500 text-lg shrink-0">⚠️</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700">
                {failedLines.length} line{failedLines.length > 1 ? "s" : ""} could not be parsed
              </p>
              <p className="text-xs text-red-500 mt-0.5">Fix or skip each one below</p>
            </div>
          </div>

          {/* Failed lines directly below banner */}
          <div className="divide-y divide-red-100">
            {failedLines.map(line => (
              <div key={line}>
                {fixingLine === line ? (
                  <EditForm
                    line={fixLine} rate={fixRate} isWP={fixWP} isAB={fixAB}
                    onLineChange={setFixLine} onRateChange={setFixRate}
                    onWPChange={setFixWP} onABChange={setFixAB}
                    onSave={saveFix} onCancel={cancelFix}
                    context={line}
                  />
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50">
                    <span className="text-red-400 shrink-0 text-sm">↳</span>
                    <span className="flex-1 font-mono text-sm text-red-700 truncate min-w-0" title={line}>
                      {line}
                    </span>
                    <button
                      onClick={() => startFix(line)}
                      className="text-xs font-semibold bg-[#1d6fb8] text-white rounded-lg px-2.5 py-1 shrink-0 hover:bg-[#165fa3] transition-colors"
                    >
                      Fix ✏️
                    </button>
                    <button
                      onClick={() => skipFailedLine(line)}
                      className="text-xs text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1 shrink-0 hover:text-red-400 transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Parsed rows ── */}
      {result.results.map((r, i) => (
        <div
          key={`${i}-${r.line}-${r.rate}`}
          className={`rounded-xl border border-[#e8eef8] overflow-hidden ${
            i % 2 === 0 ? "bg-[#f4f8ff]" : "bg-white"
          }`}
        >
          {editingIdx === i ? (
            <EditForm
              line={editLine} rate={editRate} isWP={editWP} isAB={editAB}
              onLineChange={setEditLine} onRateChange={setEditRate}
              onWPChange={setEditWP} onABChange={setEditAB}
              onSave={saveEdit} onCancel={cancelEdit}
            />
          ) : (
            <div className="flex items-start gap-2 p-3">
              {rowSelection ? (
                <button
                  type="button"
                  title="Tap to select or deselect for bulk delete"
                  aria-pressed={rowSelection.selectedIndices.has(i)}
                  onClick={e => {
                    e.stopPropagation();
                    rowSelection.onToggleRowSelect(i);
                  }}
                  className={`${circleSize} rounded-full font-bold flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    rowSelection.selectedIndices.has(i)
                      ? "bg-red-600 text-white ring-2 ring-red-800 shadow-sm"
                      : "bg-[#1d6fb8] text-white hover:bg-[#165fa3]"
                  }`}
                >
                  {i + 1}
                </button>
              ) : (
                <span className={`${circleSize} rounded-full bg-[#1d6fb8] text-white font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                  {i + 1}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={`${numSize} font-mono text-[#333] mb-1 min-w-0 wrap-break-word leading-relaxed`}
                >
                  <JodiListDisplay text={formatSegmentLineForPairListDisplay(r)} />
                  {r.isWP && <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ml-1.5 bg-blue-100 text-blue-700 align-middle">WP</span>}
                  {r.isDouble && <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ml-1.5 bg-yellow-100 text-yellow-800 align-middle">AB</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span className={`${numSize} text-[#666]`}>{r.count} × {r.rate}</span>
                  <span className={`${compact ? "text-base" : "text-[20px]"} font-extrabold text-[#1d6fb8]`}>= {r.lineTotal}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => startEdit(i, r)} title="Edit" className="text-[12px] text-[#1d6fb8] border border-[#c5cfe0] rounded-lg px-2 py-1 hover:bg-blue-50 transition-colors">✏️</button>
                <button onClick={() => requestDeleteRow(i)} title="Delete" className="text-[12px] text-gray-400 border border-gray-200 rounded-lg px-2 py-1 hover:text-red-400 hover:border-red-200 transition-colors">🗑</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* ── Grand Total ── */}
      <div className="flex justify-between items-center px-4 py-3 bg-[#1d6fb8] rounded-xl">
        <span className="font-bold text-white">Grand Total</span>
        <span className={`${totalSize} font-extrabold text-white`}>{result.total}</span>
      </div>

      {rowDeleteModal}
    </div>
  );
}
