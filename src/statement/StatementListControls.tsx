/** Bulk select / expand controls for local PDFs or cloud saves. */
export function StatementListControls({
  label,
  allSelected,
  someSelected,
  allCollapsed,
  deleteDisabled,
  deleteBusyLabel,
  deleteIdleLabel,
  onToggleSelectAll,
  onDeleteSelected,
  onToggleCollapseAll,
}: {
  label: string;
  allSelected: boolean;
  someSelected: boolean;
  allCollapsed: boolean;
  deleteDisabled?: boolean;
  deleteBusyLabel?: string;
  deleteIdleLabel: string;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  onToggleCollapseAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]/30"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={onToggleSelectAll}
          aria-label={`Select all ${label}`}
        />
        All
      </label>
      <button
        type="button"
        disabled={!someSelected || deleteDisabled}
        onClick={onDeleteSelected}
        className="inline-flex items-center justify-center rounded-xl border border-red-200/90 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40"
      >
        {deleteBusyLabel && deleteDisabled ? deleteBusyLabel : deleteIdleLabel}
      </button>
      <button
        type="button"
        disabled={deleteDisabled}
        onClick={onToggleCollapseAll}
        aria-expanded={!allCollapsed}
        className="inline-flex items-center justify-center rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
      >
        {allCollapsed ? "Expand all" : "Collapse all"}
      </button>
    </div>
  );
}
