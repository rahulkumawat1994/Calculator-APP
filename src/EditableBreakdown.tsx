import { useState } from "react";
import type { CalculationResult, Segment } from "./types";
import { processLine } from "./calcUtils";

interface Props {
  result: CalculationResult;
  onChange: (updated: CalculationResult) => void;
  compact?: boolean; // smaller style for history panel
}

function rebuild(results: Segment[]): CalculationResult {
  return { results, total: results.reduce((s, r) => s + r.lineTotal, 0) };
}

export default function EditableBreakdown({ result, onChange, compact }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editLine, setEditLine] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editWP, setEditWP] = useState(false);
  const [editAB, setEditAB] = useState(false);

  const startEdit = (i: number, seg: Segment) => {
    setEditingIdx(i);
    setEditLine(seg.line);
    setEditRate(String(seg.rate));
    setEditWP(seg.isWP);
    setEditAB(seg.isDouble);
  };

  const cancelEdit = () => setEditingIdx(null);

  const saveEdit = () => {
    if (editingIdx === null) return;
    const suffix = `${editWP ? "wp" : ""}${editAB ? "ab" : ""}`;
    const parsed = processLine(`${editLine}(${editRate})${suffix}`);
    if (!parsed.length) return;
    onChange(rebuild(result.results.map((r, i) => (i === editingIdx ? parsed[0] : r))));
    setEditingIdx(null);
  };

  const deleteRow = (i: number) => {
    onChange(rebuild(result.results.filter((_, idx) => idx !== i)));
    if (editingIdx === i) setEditingIdx(null);
  };

  const numSize = compact ? "text-sm" : "text-[17px]";
  const totalSize = compact ? "text-base" : "text-[28px]";
  const circleSize = compact ? "w-5 h-5 text-[11px]" : "min-w-[28px] h-7 text-sm";

  return (
    <div className="space-y-2">
      {result.results.map((r, i) => (
        <div
          key={i}
          className={`rounded-xl border border-[#e8eef8] overflow-hidden ${
            i % 2 === 0 ? "bg-[#f4f8ff]" : "bg-white"
          }`}
        >
          {editingIdx === i ? (
            /* ── Edit mode ── */
            <div className="p-3 space-y-2 bg-blue-50">
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                    Numbers
                  </label>
                  <input
                    value={editLine}
                    onChange={e => setEditLine(e.target.value)}
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
                    value={editRate}
                    onChange={e => setEditRate(e.target.value)}
                    className="w-full text-sm border border-[#c5cfe0] focus:border-[#1d6fb8] rounded-lg px-2.5 py-1.5 outline-none bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editWP}
                    onChange={e => setEditWP(e.target.checked)}
                    className="w-4 h-4 accent-[#1d6fb8]"
                  />
                  <span className="font-semibold text-blue-700">WP</span>
                  <span className="text-gray-400 text-xs">(pairs)</span>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editAB}
                    onChange={e => setEditAB(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="font-semibold text-amber-700">AB</span>
                  <span className="text-gray-400 text-xs">(×2 count)</span>
                </label>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={cancelEdit}
                    className="text-sm text-gray-500 border border-gray-200 bg-white rounded-lg px-3 py-1 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="text-sm bg-[#1d6fb8] text-white font-semibold rounded-lg px-4 py-1 hover:bg-[#165fa3] transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <div className="flex items-start gap-2 p-3">
              <span
                className={`${circleSize} rounded-full bg-[#1d6fb8] text-white font-bold flex items-center justify-center shrink-0 mt-0.5`}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`${numSize} font-mono text-[#333] mb-1 break-all leading-relaxed`}>
                  {r.line}
                  {r.isWP && (
                    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ml-1.5 bg-blue-100 text-blue-700 align-middle">
                      WP
                    </span>
                  )}
                  {r.isDouble && (
                    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ml-1.5 bg-yellow-100 text-yellow-800 align-middle">
                      AB
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className={`${numSize} text-[#666]`}>
                    {r.count} × {r.rate}
                  </span>
                  <span className={`${compact ? "text-base" : "text-[20px]"} font-extrabold text-[#1d6fb8]`}>
                    = {r.lineTotal}
                  </span>
                </div>
              </div>

              {/* Edit / Delete buttons */}
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={() => startEdit(i, r)}
                  title="Edit this row"
                  className="text-[12px] text-[#1d6fb8] border border-[#c5cfe0] rounded-lg px-2 py-1 hover:bg-blue-50 transition-colors"
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteRow(i)}
                  title="Delete this row"
                  className="text-[12px] text-gray-400 border border-gray-200 rounded-lg px-2 py-1 hover:text-red-400 hover:border-red-200 transition-colors"
                >
                  🗑
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Total */}
      <div className="flex justify-between items-center px-4 py-3 bg-[#1d6fb8] rounded-xl">
        <span className="font-bold text-white">Grand Total</span>
        <span className={`${totalSize} font-extrabold text-white`}>{result.total}</span>
      </div>
    </div>
  );
}
