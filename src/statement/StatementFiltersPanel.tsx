import type { SavedTransactionSearch } from "./savedTransactionSearches";

function ViewToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
        checked
          ? "border-[#1d6fb8]/35 bg-sky-50/80 ring-1 ring-[#1d6fb8]/15"
          : "border-slate-200/90 bg-white hover:border-slate-300"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]/30"
      />
      <span className="min-w-0">
        <span className="text-xs font-semibold text-slate-800">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{description}</span>
      </span>
    </label>
  );
}

export function StatementFiltersPanel({
  transactionSearchRaw,
  onTransactionSearchChange,
  onSaveSearch,
  txnDateFrom,
  txnDateTo,
  onTxnDateFromChange,
  onTxnDateToChange,
  onClearDates,
  dateRangeInverted,
  showOnlyPageTotals,
  onShowOnlyPageTotalsChange,
  showPdfPrintedTotals,
  onShowPdfPrintedTotalsChange,
  pdfPrintedTotalsAvailable,
  savedTxnSearches,
  onApplySavedSearch,
  onRemoveSavedSearch,
}: {
  transactionSearchRaw: string;
  onTransactionSearchChange: (v: string) => void;
  onSaveSearch: () => void;
  txnDateFrom: string;
  txnDateTo: string;
  onTxnDateFromChange: (v: string) => void;
  onTxnDateToChange: (v: string) => void;
  onClearDates: () => void;
  dateRangeInverted: boolean;
  showOnlyPageTotals: boolean;
  onShowOnlyPageTotalsChange: (v: boolean) => void;
  showPdfPrintedTotals: boolean;
  onShowPdfPrintedTotalsChange: (v: boolean) => void;
  pdfPrintedTotalsAvailable: boolean;
  savedTxnSearches: SavedTransactionSearch[];
  onApplySavedSearch: (s: SavedTransactionSearch) => void;
  onRemoveSavedSearch: (id: string) => void;
}) {
  const hasDateFilter = txnDateFrom || txnDateTo;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Find transactions</h3>
        <p className="mt-0.5 text-xs text-slate-500">Search narration and narrow by txn date.</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div>
            <label htmlFor="stmt-txn-search" className="text-xs font-medium text-slate-600">
              Search narration
            </label>
            <div className="relative mt-1.5">
              <input
                id="stmt-txn-search"
                type="text"
                value={transactionSearchRaw}
                onChange={(e) => onTransactionSearchChange(e.target.value)}
                placeholder="Name, UPI id, keyword…"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200/90 bg-white py-2.5 pl-3 pr-16 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/15"
              />
              <button
                type="button"
                disabled={!transactionSearchRaw.trim()}
                onClick={onSaveSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#1d6fb8] hover:bg-sky-50 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="stmt-date-from" className="text-xs font-medium text-slate-600">From</label>
            <input
              id="stmt-date-from"
              type="date"
              value={txnDateFrom}
              onChange={(e) => onTxnDateFromChange(e.target.value)}
              className="mt-1.5 w-full min-w-40 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/15"
            />
          </div>
          <div>
            <label htmlFor="stmt-date-to" className="text-xs font-medium text-slate-600">Through</label>
            <input
              id="stmt-date-to"
              type="date"
              value={txnDateTo}
              onChange={(e) => onTxnDateToChange(e.target.value)}
              className="mt-1.5 w-full min-w-40 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/15"
            />
          </div>
        </div>
        {hasDateFilter && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClearDates}
              className="text-xs font-semibold text-slate-600 underline-offset-2 hover:underline"
            >
              Clear dates
            </button>
            {dateRangeInverted && (
              <span className="text-xs text-amber-800">Using earlier date as end of range.</span>
            )}
          </div>
        )}
        {savedTxnSearches.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Saved searches">
            {savedTxnSearches.map((s) => (
              <li key={s.id}>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 py-1 pl-3 pr-0.5 text-xs ring-1 ring-slate-200/80">
                  <button
                    type="button"
                    title={s.raw}
                    onClick={() => onApplySavedSearch(s)}
                    className="max-w-48 truncate font-semibold text-slate-800 hover:underline"
                  >
                    {s.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSavedSearch(s.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${s.label}`}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Table view</h3>
        <p className="mt-0.5 text-xs text-slate-500">How rows and totals appear in the list below.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ViewToggle
            checked={showOnlyPageTotals}
            onChange={onShowOnlyPageTotalsChange}
            label="Page totals only"
            description="Hide transaction rows; expand a page to see its lines."
          />
          {pdfPrintedTotalsAvailable ? (
            <ViewToggle
              checked={showPdfPrintedTotals}
              onChange={onShowPdfPrintedTotalsChange}
              label="PDF printed totals"
              description="Show bank footer totals under each page for checking."
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
