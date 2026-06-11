import { useState } from "react";
import type { MoneyPeriodPreset } from "./moneyDateFilter";
import { formatMonthKey } from "./moneyFormat";

export type MoneyTypeFilter = "all" | "expense" | "income";
export type MoneyTableSort = "date-desc" | "date-asc" | "debit-desc" | "credit-desc";

export type MoneyFilterBarProps = {
  filteredCount: number;
  totalCount: number;
  periodLabel: string;
  isLargeDataset: boolean;
  periodPreset: MoneyPeriodPreset;
  customMonth: string | null;
  availableMonths: string[];
  search: string;
  typeFilter: MoneyTypeFilter;
  accountFilter: string;
  categoryFilter: string;
  minAmount: string;
  maxAmount: string;
  showTransfers: boolean;
  loansOnly: boolean;
  excludeLoans: boolean;
  transferCount: number;
  uniqueAccounts: string[];
  uniqueCategories: string[];
  creditCardAccounts: ReadonlySet<string>;
  onSearchChange: (v: string) => void;
  onTypeFilterChange: (v: MoneyTypeFilter) => void;
  onAccountFilterChange: (v: string) => void;
  onCategoryFilterChange: (v: string) => void;
  onMinAmountChange: (v: string) => void;
  onMaxAmountChange: (v: string) => void;
  onPeriodSelect: (p: MoneyPeriodPreset) => void;
  onCustomMonthSelect: (m: string) => void;
  onShowTransfersChange: (v: boolean) => void;
  onLoansOnlyChange: (v: boolean) => void;
  onExcludeLoansChange: (v: boolean) => void;
  onClearAll: () => void;
};

const PERIOD_PRESETS: { id: MoneyPeriodPreset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-3-months", label: "3M" },
  { id: "last-6-months", label: "6M" },
  { id: "this-year", label: "YTD" },
  { id: "last-12-months", label: "12M" },
  { id: "all", label: "All" },
];

const inputCls =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/80";

const selectCls =
  "h-9 w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-[13px] text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/80";

function FilterField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
        checked
          ? "border-slate-800 bg-slate-800 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          checked ? "bg-white/30" : "bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export function countActiveFilters(p: {
  search: string;
  typeFilter: MoneyTypeFilter;
  accountFilter: string;
  categoryFilter: string;
  periodPreset: MoneyPeriodPreset;
  minAmount: string;
  maxAmount: string;
  showTransfers: boolean;
  loansOnly: boolean;
  excludeLoans: boolean;
}): number {
  let n = 0;
  if (p.search.trim()) n++;
  if (p.typeFilter !== "all") n++;
  if (p.accountFilter !== "all") n++;
  if (p.categoryFilter !== "all") n++;
  if (p.periodPreset !== "last-3-months" && p.periodPreset !== "all") n++;
  if (p.minAmount.trim()) n++;
  if (p.maxAmount.trim()) n++;
  if (p.showTransfers) n++;
  if (p.loansOnly) n++;
  if (p.excludeLoans) n++;
  return n;
}

export function MoneyFilterBar(props: MoneyFilterBarProps) {
  const activeCount = countActiveFilters(props);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const chips: { label: string; onRemove: () => void }[] = [];
  if (props.search.trim()) chips.push({ label: `“${props.search.trim()}”`, onRemove: () => props.onSearchChange("") });
  if (props.typeFilter !== "all")
    chips.push({
      label: props.typeFilter === "expense" ? "Debits" : "Credits",
      onRemove: () => props.onTypeFilterChange("all"),
    });
  if (props.accountFilter !== "all")
    chips.push({ label: props.accountFilter, onRemove: () => props.onAccountFilterChange("all") });
  if (props.categoryFilter !== "all")
    chips.push({ label: props.categoryFilter, onRemove: () => props.onCategoryFilterChange("all") });
  if (props.minAmount.trim() || props.maxAmount.trim())
    chips.push({
      label: `₹ ${props.minAmount || "0"} – ${props.maxAmount || "∞"}`,
      onRemove: () => {
        props.onMinAmountChange("");
        props.onMaxAmountChange("");
      },
    });
  if (props.loansOnly) chips.push({ label: "Loans only", onRemove: () => props.onLoansOnlyChange(false) });
  if (props.excludeLoans) chips.push({ label: "Hide loans", onRemove: () => props.onExcludeLoansChange(false) });
  if (props.showTransfers) chips.push({ label: "Transfers", onRemove: () => props.onShowTransfersChange(false) });

  return (
    <div className="sticky top-0 z-20 rounded-2xl border border-slate-200/90 bg-white/95 px-4 py-4 shadow-lg shadow-slate-200/50 backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-bold tracking-tight text-slate-900">Filters</h2>
            {activeCount > 0 ? (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">
            <span className="font-semibold tabular-nums text-slate-800">{props.filteredCount.toLocaleString()}</span>
            {" "}of {props.totalCount.toLocaleString()} transactions · {props.periodLabel}
            {props.isLargeDataset && props.periodPreset === "all" ? (
              <span className="text-amber-600"> · narrow the period</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {advancedOpen ? "Less" : "More"} options
          </button>
          {activeCount > 0 ? (
            <button
              type="button"
              onClick={props.onClearAll}
              className="h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-[12px] font-semibold text-red-700 hover:bg-red-100"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => props.onPeriodSelect(p.id)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
              props.periodPreset === p.id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {p.label}
          </button>
        ))}
        {props.periodPreset === "custom-month" && props.customMonth ? (
          <span className="flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white">
            {formatMonthKey(props.customMonth)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <FilterField label="Search" className="sm:col-span-2 lg:col-span-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input
              type="search"
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              placeholder="Transaction, memo, category…"
              className={`${inputCls} pl-9`}
            />
          </div>
        </FilterField>

        <FilterField label="Type">
          <select
            value={props.typeFilter}
            onChange={(e) => props.onTypeFilterChange(e.target.value as MoneyTypeFilter)}
            className={selectCls}
          >
            <option value="all">All types</option>
            <option value="expense">Debits only</option>
            <option value="income">Credits only</option>
          </select>
        </FilterField>

        <FilterField label="Account">
          <select
            value={props.accountFilter}
            onChange={(e) => props.onAccountFilterChange(e.target.value)}
            className={selectCls}
          >
            <option value="all">All accounts</option>
            {props.uniqueAccounts.map((a) => (
              <option key={a} value={a}>
                {props.creditCardAccounts.has(a) ? "💳 " : ""}
                {a}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Category">
          <select
            value={props.categoryFilter}
            onChange={(e) => props.onCategoryFilterChange(e.target.value)}
            className={selectCls}
          >
            <option value="all">All categories</option>
            {props.uniqueCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Month">
          <select
            value={props.periodPreset === "custom-month" ? props.customMonth ?? "" : ""}
            onChange={(e) => {
              if (e.target.value) props.onCustomMonthSelect(e.target.value);
            }}
            className={selectCls}
          >
            <option value="">Any in period…</option>
            {props.availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthKey(m)}
              </option>
            ))}
          </select>
        </FilterField>
      </div>

      {advancedOpen ? (
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label="Min amount (₹)">
            <input
              type="number"
              min={0}
              value={props.minAmount}
              onChange={(e) => props.onMinAmountChange(e.target.value)}
              placeholder="0"
              className={inputCls}
            />
          </FilterField>
          <FilterField label="Max amount (₹)">
            <input
              type="number"
              min={0}
              value={props.maxAmount}
              onChange={(e) => props.onMaxAmountChange(e.target.value)}
              placeholder="No limit"
              className={inputCls}
            />
          </FilterField>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-2">
            {props.transferCount > 0 ? (
              <Toggle
                checked={props.showTransfers}
                onChange={props.onShowTransfersChange}
                label="Transfers"
              />
            ) : null}
            <Toggle checked={props.loansOnly} onChange={props.onLoansOnlyChange} label="Loans only" />
            <Toggle checked={props.excludeLoans} onChange={props.onExcludeLoansChange} label="Hide loans" />
          </div>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            >
              {c.label}
              <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
