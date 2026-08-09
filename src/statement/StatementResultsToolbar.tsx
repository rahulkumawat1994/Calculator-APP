import type { StatementPdfSortMode } from "./sortStatementPdfsByPeriod";

export function StatementResultsToolbar({
  canExport,
  onExport,
  cloudLoading,
  onRefreshCloud,
  sortMode,
  onSortModeChange,
  hasLocalPdfs,
  hasCloudSaves,
}: {
  canExport: boolean;
  onExport: () => void;
  cloudLoading: boolean;
  onRefreshCloud: () => void;
  sortMode: StatementPdfSortMode;
  onSortModeChange: (mode: StatementPdfSortMode) => void;
  hasLocalPdfs: boolean;
  hasCloudSaves: boolean;
}) {
  const sortLabel =
    hasLocalPdfs && hasCloudSaves
      ? "List order"
      : hasLocalPdfs
        ? "Upload order"
        : "Saved order";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!canExport}
        onClick={onExport}
        title={
          canExport
            ? "Download visible rows (uses current search and date filters)"
            : "Load statements or adjust filters to enable export"
        }
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-3.5 py-2 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-40"
      >
        <span aria-hidden>⤓</span>
        Export PDF
      </button>
      <button
        type="button"
        disabled={cloudLoading}
        onClick={onRefreshCloud}
        className="shrink-0 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
      >
        {cloudLoading ? "Reloading…" : "Reload saved"}
      </button>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <span className="hidden sm:inline text-slate-500">Sort</span>
        <select
          value={sortMode}
          onChange={(e) => onSortModeChange(e.target.value as StatementPdfSortMode)}
          className="cursor-pointer rounded-xl border border-slate-200/90 bg-white py-2 pl-3 pr-9 text-xs font-semibold text-slate-800 shadow-sm transition focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
          aria-label="Sort statements by period in file name"
        >
          <option value="upload">{sortLabel}</option>
          <option value="period-asc">Old → new (name)</option>
          <option value="period-desc">New → old (name)</option>
        </select>
      </label>
    </div>
  );
}
