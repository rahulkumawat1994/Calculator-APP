import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  computeAccountBreakdown,
  computeCategoryBreakdown,
  computeMonthlyBreakdown,
  computeMoneySummary,
  countTransferTransactions,
  filterMoneyTransactions,
  isTransferTransaction,
  largestExpenses,
  topExpenseCategories,
} from "./money/moneyAnalytics";
import { formatMoney, formatShortDate } from "./money/moneyFormat";
import { parseMoneyExcelBuffer } from "./money/parseMoneyExcel";
import {
  isCreditCardAccount,
  loadCreditCardAccounts,
  mergeCreditCardAccounts,
  saveCreditCardAccounts,
} from "./money/moneyAccountTypes";
import {
  defaultPeriodForRowCount,
  listTransactionMonths,
  loadMoneyCustomMonth,
  loadMoneyPeriodPreset,
  periodPresetLabel,
  resolveMoneyPeriodRange,
  saveMoneyCustomMonth,
  saveMoneyPeriodPreset,
  trimMonthlyForChart,
  type MoneyPeriodPreset,
} from "./money/moneyDateFilter";
import { MoneyFilterBar, type MoneyTableSort } from "./money/MoneyFilterBar";
import { MoneyInsightsPanel } from "./money/MoneyInsightsPanel";
import { MoneyOverviewChart } from "./money/MoneyOverviewChart";
import { computeMoneyInsights, mergeChartMonths } from "./money/moneyInsights";
import { MoneyMetaPill, MoneySection, MoneyStatCard } from "./money/MoneyProUi";
import type { MoneyDataset } from "./money/moneyTypes";
import { Button } from "./ui";

const STORAGE_KEY = "money-view-dataset-v1";
const SHOW_TRANSFERS_KEY = "money-view-show-transfers-v1";
const TABLE_PAGE = 50;

const CATEGORY_COLORS = [
  "#0f766e",
  "#1d4ed8",
  "#c2410c",
  "#be123c",
  "#6d28d9",
  "#0891b2",
  "#ca8a04",
  "#4338ca",
];

function loadShowTransfers(): boolean {
  try {
    return localStorage.getItem(SHOW_TRANSFERS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveShowTransfers(show: boolean) {
  try {
    localStorage.setItem(SHOW_TRANSFERS_KEY, show ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function loadStoredDataset(): MoneyDataset | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MoneyDataset;
    parsed.transactions = parsed.transactions.map((t) => ({
      ...t,
      date: t.dateRaw ? new Date(t.dateRaw) : null,
    }));
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredDataset(dataset: MoneyDataset | null) {
  if (!dataset) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
}

function netToneClass(n: number): string {
  if (n > 0) return "text-emerald-600";
  if (n < 0) return "text-red-600";
  return "text-slate-600";
}

function netBgClass(n: number): string {
  if (n > 0) return "border-emerald-200/80 bg-emerald-50/80";
  if (n < 0) return "border-red-200/80 bg-red-50/80";
  return "border-slate-200 bg-slate-50/80";
}

function parseAmountInput(raw: string): number | undefined {
  const n = parseFloat(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function sortTransactions(rows: MoneyDataset["transactions"], sort: MoneyTableSort) {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "date-asc": {
        const ta = a.date?.getTime() ?? 0;
        const tb = b.date?.getTime() ?? 0;
        return ta - tb;
      }
      case "debit-desc":
        return b.payment - a.payment;
      case "credit-desc":
        return b.deposit - a.deposit;
      case "date-desc":
      default: {
        const ta = a.date?.getTime() ?? 0;
        const tb = b.date?.getTime() ?? 0;
        return tb - ta;
      }
    }
  });
  return copy;
}

export default function MoneyViewPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dataset, setDataset] = useState<MoneyDataset | null>(() => loadStoredDataset());
  const [uploading, setUploading] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "income">("all");
  const [search, setSearch] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [loansOnly, setLoansOnly] = useState(false);
  const [excludeLoans, setExcludeLoans] = useState(false);
  const [tableSort, setTableSort] = useState<MoneyTableSort>("date-desc");
  const [showTransfers, setShowTransfers] = useState(() => loadShowTransfers());
  const [creditCardAccounts, setCreditCardAccounts] = useState<Set<string>>(
    () => loadCreditCardAccounts(),
  );
  const [periodPreset, setPeriodPreset] = useState<MoneyPeriodPreset>(() => loadMoneyPeriodPreset());
  const [customMonth, setCustomMonth] = useState<string | null>(() => loadMoneyCustomMonth());
  const [tableLimit, setTableLimit] = useState(TABLE_PAGE);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const transactions = dataset?.transactions ?? [];
  const availableMonths = useMemo(() => listTransactionMonths(transactions), [transactions]);
  const periodRange = useMemo(
    () => resolveMoneyPeriodRange(periodPreset, customMonth),
    [periodPreset, customMonth],
  );

  useEffect(() => {
    setTableLimit(TABLE_PAGE);
  }, [
    periodPreset,
    customMonth,
    accountFilter,
    categoryFilter,
    typeFilter,
    search,
    showTransfers,
    minAmount,
    maxAmount,
    loansOnly,
    excludeLoans,
  ]);

  useEffect(() => {
    if (periodPreset === "custom-month" && !customMonth && availableMonths[0]) {
      setCustomMonth(availableMonths[0]);
      saveMoneyCustomMonth(availableMonths[0]);
    }
  }, [periodPreset, customMonth, availableMonths]);

  useEffect(() => {
    if (loansOnly) setExcludeLoans(false);
  }, [loansOnly]);

  useEffect(() => {
    if (excludeLoans) setLoansOnly(false);
  }, [excludeLoans]);

  const transferCount = useMemo(() => countTransferTransactions(transactions), [transactions]);
  const analyticsCtx = useMemo(() => ({ creditCardAccounts }), [creditCardAccounts]);

  const filtered = useMemo(
    () =>
      sortTransactions(
        filterMoneyTransactions(transactions, {
          account: accountFilter,
          category: categoryFilter,
          type: typeFilter,
          search,
          hideTransfers: !showTransfers,
          loansOnly,
          excludeLoans,
          minAmount: parseAmountInput(minAmount),
          maxAmount: parseAmountInput(maxAmount),
          from: periodRange.from,
          to: periodRange.to,
        }),
        tableSort,
      ),
    [
      transactions,
      accountFilter,
      categoryFilter,
      typeFilter,
      search,
      showTransfers,
      loansOnly,
      excludeLoans,
      minAmount,
      maxAmount,
      periodRange.from,
      periodRange.to,
      tableSort,
    ],
  );

  const summary = useMemo(() => computeMoneySummary(filtered, analyticsCtx), [filtered, analyticsCtx]);
  const categories = useMemo(
    () => computeCategoryBreakdown(filtered, analyticsCtx),
    [filtered, analyticsCtx],
  );
  const monthly = useMemo(
    () => computeMonthlyBreakdown(filtered, analyticsCtx),
    [filtered, analyticsCtx],
  );
  const chartMonths = useMemo(() => trimMonthlyForChart(monthly, 12), [monthly]);
  const insights = useMemo(
    () => computeMoneyInsights(filtered, monthly, categories, analyticsCtx),
    [filtered, monthly, categories, analyticsCtx],
  );
  const chartPoints = useMemo(
    () => mergeChartMonths(chartMonths, insights.loanMonthly),
    [chartMonths, insights.loanMonthly],
  );
  const accounts = useMemo(
    () => computeAccountBreakdown(filtered, analyticsCtx),
    [filtered, analyticsCtx],
  );
  const topCats = useMemo(() => topExpenseCategories(categories), [categories]);
  const bigExpenses = useMemo(() => largestExpenses(filtered, 8), [filtered]);

  const uniqueAccounts = useMemo(
    () => [...new Set(transactions.map((t) => t.account).filter(Boolean))].sort(),
    [transactions],
  );
  const uniqueCategories = useMemo(
    () => [...new Set(transactions.map((t) => t.category))].sort(),
    [transactions],
  );
  const totalCatExpenses = useMemo(
    () => topCats.reduce((s, c) => s + c.expenses, 0) || 1,
    [topCats],
  );

  const clearAllFilters = useCallback(() => {
    setAccountFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setSearch("");
    setMinAmount("");
    setMaxAmount("");
    setLoansOnly(false);
    setExcludeLoans(false);
    setShowTransfers(false);
    saveShowTransfers(false);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseMoneyExcelBuffer(buffer, file.name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDataset(result.dataset);
      saveStoredDataset(result.dataset);
      const accountNames = [
        ...new Set(result.dataset.transactions.map((t) => t.account).filter(Boolean)),
      ];
      setCreditCardAccounts(mergeCreditCardAccounts(accountNames));
      const defaultPeriod = defaultPeriodForRowCount(result.dataset.meta.rowCount);
      setPeriodPreset(defaultPeriod);
      saveMoneyPeriodPreset(defaultPeriod);
      const months = listTransactionMonths(result.dataset.transactions);
      if (months[0]) {
        setCustomMonth(months[0]);
        saveMoneyCustomMonth(months[0]);
      }
      setAccountsOpen(accountNames.length <= 3);
      clearAllFilters();
      toast.success(`Loaded ${result.dataset.meta.rowCount} transactions`);
    } finally {
      setUploading(false);
    }
  }, [clearAllFilters]);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const clearData = useCallback(() => {
    setDataset(null);
    saveStoredDataset(null);
    toast.info("Cleared saved data");
  }, []);

  const selectPeriod = useCallback((preset: MoneyPeriodPreset) => {
    setPeriodPreset(preset);
    saveMoneyPeriodPreset(preset);
  }, []);

  const selectCustomMonth = useCallback((month: string) => {
    setPeriodPreset("custom-month");
    saveMoneyPeriodPreset("custom-month");
    setCustomMonth(month);
    saveMoneyCustomMonth(month);
  }, []);

  const toggleCreditCardAccount = useCallback((account: string) => {
    setCreditCardAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      saveCreditCardAccounts(next);
      return next;
    });
  }, []);

  const periodLabel = periodPresetLabel(periodPreset, customMonth);
  const isLargeDataset = transactions.length >= 500;
  const visibleTransactions = filtered.slice(0, tableLimit);

  const dateRangeLabel =
    summary.dateRange.from && summary.dateRange.to
      ? `${formatShortDate(summary.dateRange.from)} – ${formatShortDate(summary.dateRange.to)}`
      : "No dates";

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">
      <header className="border-b border-slate-800/20 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Personal finance
            </p>
            <h1 className="mt-1 text-[24px] font-bold tracking-tight">Money View</h1>
            <p className="mt-1 text-[13px] text-slate-400">
              Analyze spending, loans, and savings from your register
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[13px] font-medium text-slate-200 transition hover:bg-white/10"
            >
              Calculator
            </a>
            {dataset ? (
              <Button
                variant="outline"
                className="border-white/20 bg-transparent px-3 py-2 text-[13px] text-white hover:bg-white/10"
                onClick={clearData}
              >
                Clear data
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="bg-white px-4 py-2 text-[13px] font-bold text-slate-900 hover:bg-slate-100"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Reading…" : dataset ? "Replace file" : "Upload Excel"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 pb-20">
        {!dataset ? (
          <div
            className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center shadow-sm transition hover:border-slate-400 hover:shadow-md"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-white">
              ↑
            </div>
            <p className="mt-4 text-[18px] font-bold text-slate-900">Upload your register Excel</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-500">
              Columns: Account, Date, Transaction, Memo, Category, Debit, Credit
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <MoneyMetaPill>{dataset.meta.fileName}</MoneyMetaPill>
              <MoneyMetaPill>{dataset.meta.rowCount.toLocaleString()} rows</MoneyMetaPill>
              <MoneyMetaPill>{dateRangeLabel}</MoneyMetaPill>
              {creditCardAccounts.size > 0 ? (
                <MoneyMetaPill>{creditCardAccounts.size} credit cards</MoneyMetaPill>
              ) : null}
            </div>

            <MoneyFilterBar
              filteredCount={filtered.length}
              totalCount={transactions.length}
              periodLabel={periodLabel}
              isLargeDataset={isLargeDataset}
              periodPreset={periodPreset}
              customMonth={customMonth}
              availableMonths={availableMonths}
              search={search}
              typeFilter={typeFilter}
              accountFilter={accountFilter}
              categoryFilter={categoryFilter}
              minAmount={minAmount}
              maxAmount={maxAmount}
              showTransfers={showTransfers}
              loansOnly={loansOnly}
              excludeLoans={excludeLoans}
              transferCount={transferCount}
              uniqueAccounts={uniqueAccounts}
              uniqueCategories={uniqueCategories}
              creditCardAccounts={creditCardAccounts}
              onSearchChange={setSearch}
              onTypeFilterChange={setTypeFilter}
              onAccountFilterChange={setAccountFilter}
              onCategoryFilterChange={setCategoryFilter}
              onMinAmountChange={setMinAmount}
              onMaxAmountChange={setMaxAmount}
              onPeriodSelect={selectPeriod}
              onCustomMonthSelect={selectCustomMonth}
              onShowTransfersChange={(v) => {
                setShowTransfers(v);
                saveShowTransfers(v);
              }}
              onLoansOnlyChange={setLoansOnly}
              onExcludeLoansChange={setExcludeLoans}
              onClearAll={() => {
                clearAllFilters();
                setPeriodPreset("last-3-months");
                saveMoneyPeriodPreset("last-3-months");
              }}
            />

            {uniqueAccounts.length > 0 ? (
              <MoneySection
                title="Account setup"
                subtitle="Mark credit cards so bill payments are not counted as income"
                action={
                  <button
                    type="button"
                    onClick={() => setAccountsOpen((o) => !o)}
                    className="text-[12px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    {accountsOpen ? "Collapse" : "Expand"}
                  </button>
                }
              >
                {accountsOpen ? (
                  <div className="flex flex-wrap gap-2">
                    {uniqueAccounts.map((account) => {
                      const isCC = isCreditCardAccount(account, creditCardAccounts);
                      return (
                        <button
                          key={account}
                          type="button"
                          onClick={() => toggleCreditCardAccount(account)}
                          className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
                            isCC
                              ? "border-amber-300 bg-amber-50 text-amber-900"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {isCC ? "Credit card · " : "Bank · "}
                          {account}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-500">
                    {creditCardAccounts.size} credit card{creditCardAccounts.size === 1 ? "" : "s"} ·{" "}
                    {uniqueAccounts.length} accounts configured
                  </p>
                )}
              </MoneySection>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MoneyStatCard
                label="Income"
                value={formatMoney(summary.totalIncome)}
                sub={`${summary.incomeCount} credits`}
                accent="income"
              />
              <MoneyStatCard
                label="Expenses"
                value={formatMoney(summary.totalExpenses)}
                sub={`${summary.expenseCount} debits`}
                accent="expense"
              />
              <MoneyStatCard
                label="Net savings"
                value={formatMoney(summary.net)}
                sub={summary.net >= 0 ? "Income minus expenses" : "Over budget"}
                accent="net"
              />
              <MoneyStatCard
                label="Loan / EMI avg"
                value={formatMoney(insights.avgMonthlyLoanPayments)}
                sub={`${insights.loanShareOfIncomePct.toFixed(0)}% of income`}
                accent="neutral"
              />
            </div>

            <MoneySection
              title="Financial overview"
              subtitle={
                monthly.length > chartMonths.length
                  ? `Latest ${chartMonths.length} months · income, expenses, loans & net`
                  : "Income, expenses, loan/EMI, and net savings by month"
              }
            >
              <MoneyOverviewChart points={chartPoints} />
            </MoneySection>

            <MoneyInsightsPanel insights={insights} />

            <div className="grid gap-5 lg:grid-cols-2">
              <MoneySection title="Spending by category" subtitle="Share of debits in this period">
                {topCats.length === 0 ? (
                  <p className="text-[13px] text-slate-500">No categories in this view.</p>
                ) : (
                  <div className="space-y-4">
                    {topCats.map((c, i) => {
                      const pct = (c.expenses / totalCatExpenses) * 100;
                      return (
                        <div key={c.category}>
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px]">
                            <span className="truncate font-semibold text-slate-800">{c.category}</span>
                            <span className="shrink-0 tabular-nums font-bold text-slate-900">
                              {formatMoney(c.expenses)}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                              }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-slate-400">
                            {pct.toFixed(1)}% · {c.count} txn{c.count === 1 ? "" : "s"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </MoneySection>

              <MoneySection title="Largest debits" subtitle="Top payments in filtered view">
                {bigExpenses.length === 0 ? (
                  <p className="text-[13px] text-slate-500">No debits match filters.</p>
                ) : (
                  <div className="space-y-2">
                    {bigExpenses.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-slate-900">
                            {t.transaction || t.memo || "—"}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {t.date ? formatShortDate(t.date) : t.dateRaw} · {t.category}
                          </p>
                        </div>
                        <span className="shrink-0 text-[14px] font-bold tabular-nums text-red-600">
                          −{formatMoney(t.payment)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </MoneySection>
            </div>

            {accounts.length > 0 ? (
              <MoneySection title="By account" subtitle="Breakdown for filtered transactions">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="pb-2 pr-3 font-semibold">Account</th>
                        <th className="pb-2 pr-3 text-right font-semibold">Debits</th>
                        <th className="pb-2 pr-3 text-right font-semibold">Credits</th>
                        <th className="pb-2 text-right font-semibold">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => (
                        <tr key={a.account} className="border-b border-slate-100">
                          <td className="py-2.5 pr-3 font-medium text-slate-800">
                            {a.isCreditCard ? "💳 " : "🏦 "}
                            {a.account}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-red-600">
                            {formatMoney(a.expenses)}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-600">
                            {a.isCreditCard ? formatMoney(a.cardPayments) : formatMoney(a.income)}
                          </td>
                          <td className={`py-2.5 text-right tabular-nums font-bold ${netToneClass(a.net)}`}>
                            {formatMoney(a.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </MoneySection>
            ) : null}

            <MoneySection
              title="Transactions"
              subtitle={`${filtered.length.toLocaleString()} rows match your filters`}
              action={
                <select
                  value={tableSort}
                  onChange={(e) => setTableSort(e.target.value as MoneyTableSort)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="debit-desc">Largest debit</option>
                  <option value="credit-desc">Largest credit</option>
                </select>
              }
            >
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-3 font-semibold">Date</th>
                      <th className="px-3 py-3 font-semibold">Transaction</th>
                      <th className="px-3 py-3 font-semibold">Category</th>
                      <th className="px-3 py-3 font-semibold">Account</th>
                      <th className="px-3 py-3 text-right font-semibold">Debit</th>
                      <th className="px-3 py-3 text-right font-semibold">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-12 text-center text-slate-500">
                          No transactions match your filters.
                        </td>
                      </tr>
                    ) : (
                      visibleTransactions.map((t, idx) => {
                        const isTransfer = isTransferTransaction(t);
                        return (
                          <tr
                            key={t.id}
                            className={`border-t border-slate-100 transition hover:bg-slate-50/80 ${
                              idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                            } ${isTransfer ? "!bg-violet-50/60" : ""}`}
                          >
                            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-600">
                              {t.date ? formatShortDate(t.date) : t.dateRaw || "—"}
                            </td>
                            <td className="max-w-[220px] px-3 py-2.5">
                              <p className="truncate font-medium text-slate-900">
                                {t.transaction || "—"}
                              </p>
                              {t.memo ? (
                                <p className="truncate text-[11px] text-slate-400">{t.memo}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {t.category}
                              {isTransfer ? (
                                <span className="ml-1.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                                  Transfer
                                </span>
                              ) : null}
                            </td>
                            <td className="max-w-[120px] truncate px-3 py-2.5 text-slate-500">
                              {t.account || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-red-600">
                              {t.payment > 0 ? formatMoney(t.payment) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-600">
                              {t.deposit > 0 ? formatMoney(t.deposit) : "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {filtered.length > tableLimit ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="text-[12px] text-slate-500">
                    Showing {tableLimit.toLocaleString()} of {filtered.length.toLocaleString()}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="px-3 py-1.5 text-[12px]"
                    onClick={() => setTableLimit((n) => n + TABLE_PAGE)}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}

              <div className={`mt-4 rounded-xl border px-4 py-3 ${netBgClass(summary.net)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-slate-800">Filtered totals</span>
                  <div className="flex flex-wrap gap-4 tabular-nums">
                    <span className="text-red-600">Debits {formatMoney(summary.totalExpenses)}</span>
                    <span className="text-emerald-600">Credits {formatMoney(summary.totalIncome)}</span>
                    <span className={`font-bold ${netToneClass(summary.net)}`}>
                      Net {formatMoney(summary.net)}
                    </span>
                  </div>
                </div>
              </div>
            </MoneySection>
          </>
        )}
      </main>
    </div>
  );
}
