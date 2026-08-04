import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalculationAuditLog } from "@/data/firestoreDb";
import { filterRowsByGameMonth } from "@/lib/audit/auditDateFilter";
import { computeAuditAnalytics } from "@/lib/audit/auditAnalytics";

function formatInr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function StatCard({
  label,
  value,
  sub,
  accent = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "slate" | "blue" | "emerald" | "amber" | "rose" | "violet";
}) {
  const accents = {
    slate: "border-slate-200/80 bg-slate-50/60 text-slate-900",
    blue: "border-blue-100/80 bg-blue-50/50 text-blue-900",
    emerald: "border-emerald-100/80 bg-emerald-50/50 text-emerald-900",
    amber: "border-amber-100/80 bg-amber-50/50 text-amber-900",
    rose: "border-rose-100/80 bg-rose-50/50 text-rose-900",
    violet: "border-violet-100/80 bg-violet-50/50 text-violet-900",
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${accents[accent]}`}
      title={sub}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums">{value}</p>
      {sub ? (
        <p className="mt-0.5 text-[11px] font-medium opacity-75">{sub}</p>
      ) : null}
    </div>
  );
}

export default function AdminAuditAnalytics({
  rows,
  differsById,
  scopeLabel,
}: {
  rows: CalculationAuditLog[];
  differsById: Map<string, { parsedTotal: number; differs: boolean }>;
  scopeLabel: string;
}) {
  const [selectedMonth, setSelectedMonth] = useState("");

  const monthlyOverview = useMemo(
    () => computeAuditAnalytics(rows, differsById),
    [rows, differsById],
  );

  const monthScopedRows = useMemo(
    () => filterRowsByGameMonth(rows, selectedMonth),
    [rows, selectedMonth],
  );

  const analytics = useMemo(
    () => computeAuditAnalytics(monthScopedRows, differsById),
    [monthScopedRows, differsById],
  );

  const selectedMonthSummary = useMemo(
    () =>
      selectedMonth
        ? monthlyOverview.monthly.find((m) => m.month === selectedMonth)
        : null,
    [monthlyOverview.monthly, selectedMonth],
  );

  const monthBounds = useMemo(() => {
    const months = monthlyOverview.monthly.map((m) => m.month);
    if (!months.length) return { min: "", max: "" };
    return { min: months[0]!, max: months[months.length - 1]! };
  }, [monthlyOverview.monthly]);

  const chartTitleSuffix = selectedMonth
    ? selectedMonthSummary?.label ?? selectedMonth
    : "all days in view";

  return (
    <div className="border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-slate-900">Analytics</h3>
          <p className="text-[11px] text-slate-500">{scopeLabel}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Month
            </span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              min={monthBounds.min || undefined}
              max={monthBounds.max || undefined}
              className="h-10 min-w-[10.5rem] rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 text-[13px] text-slate-900 shadow-inner outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              aria-label="Select month for daily earnings"
            />
          </label>
          {selectedMonth ? (
            <button
              type="button"
              onClick={() => setSelectedMonth("")}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              All months
            </button>
          ) : null}
        </div>
      </div>

      {selectedMonth && selectedMonthSummary ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Month total"
            value={`₹${formatInr(selectedMonthSummary.total)}`}
            sub={`${selectedMonthSummary.count} calculations`}
            accent="blue"
          />
          <StatCard
            label="Month profit"
            value={`₹${formatInr(selectedMonthSummary.profit)}`}
            sub="5% of month total"
            accent="emerald"
          />
          <StatCard
            label="Daily average"
            value={`₹${formatInr(
              analytics.daily.length > 0
                ? Math.round(selectedMonthSummary.total / analytics.daily.length)
                : 0,
            )}`}
            sub={`${analytics.daily.length} active day(s)`}
          />
          <StatCard
            label="Profit / day"
            value={`₹${formatInr(
              analytics.daily.length > 0
                ? Math.round(selectedMonthSummary.profit / analytics.daily.length)
                : 0,
            )}`}
            sub="avg on active days"
            accent="emerald"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label={selectedMonth ? "Period total" : "Total"}
          value={`₹${formatInr(analytics.totalAmount)}`}
          accent="blue"
        />
        <StatCard
          label="Average"
          value={`₹${formatInr(analytics.avgAmount)}`}
          sub="per calculation"
        />
        <StatCard
          label="Profit (5%)"
          value={`₹${formatInr(analytics.profit5Pct)}`}
          sub={`avg ₹${formatInr(analytics.avgProfit)} / calc`}
          accent="emerald"
        />
        <StatCard
          label="Manual"
          value={String(analytics.manualCount)}
          sub={`${analytics.waCount} WhatsApp`}
          accent="violet"
        />
        <StatCard
          label="Failed lines"
          value={String(analytics.failedRowCount)}
          sub={
            analytics.totalFailedLines > 0
              ? `${analytics.totalFailedLines} line(s) total`
              : "all OK"
          }
          accent={analytics.failedRowCount > 0 ? "amber" : "slate"}
        />
        <StatCard
          label="Parser drift"
          value={String(analytics.differsCount)}
          sub={
            analytics.differsCount > 0
              ? "saved ≠ current engine"
              : "all match"
          }
          accent={analytics.differsCount > 0 ? "rose" : "slate"}
        />
      </div>

      {monthlyOverview.monthly.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-violet-200/70 bg-violet-50/20 p-3">
            <p className="mb-2 text-[11px] font-semibold text-violet-900">
              Monthly total (₹)
            </p>
            <div className="h-48 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyOverview.monthly}
                  margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9d5ff" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#6b21a8" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#6b21a8" }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      `₹${formatInr(value)}`,
                      "Total",
                    ]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      borderColor: "#ddd6fe",
                    }}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} name="Total">
                    {monthlyOverview.monthly.map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={
                          entry.month === selectedMonth ? "#7c3aed" : "#a78bfa"
                        }
                        onClick={() => setSelectedMonth(entry.month)}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3">
            <p className="mb-2 text-[11px] font-semibold text-emerald-900">
              Monthly profit (5%)
            </p>
            <div className="h-48 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyOverview.monthly}
                  margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1fae5" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#047857" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#047857" }}
                    tickFormatter={(v) => `₹${v}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      `₹${formatInr(value)}`,
                      "Profit",
                    ]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      borderColor: "#a7f3d0",
                    }}
                  />
                  <Bar dataKey="profit" radius={[4, 4, 0, 0]} name="Profit">
                    {monthlyOverview.monthly.map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={
                          entry.month === selectedMonth ? "#059669" : "#34d399"
                        }
                        onClick={() => setSelectedMonth(entry.month)}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}

      {monthlyOverview.monthly.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-slate-500">
          Click a month bar to see daily breakdown below
        </p>
      ) : null}

      {analytics.daily.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3">
            <p className="mb-2 text-[11px] font-semibold text-slate-700">
              Daily total (₹) · {chartTitleSuffix}
            </p>
            <div className="h-44 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.daily}
                  margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      `₹${formatInr(value)}`,
                      "Total",
                    ]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      borderColor: "#e2e8f0",
                    }}
                  />
                  <Bar
                    dataKey="total"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                    name="Total"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3">
            <p className="mb-2 text-[11px] font-semibold text-emerald-900">
              Daily profit (5%) · {chartTitleSuffix}
            </p>
            <div className="h-44 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.daily}
                  margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1fae5" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#047857" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#047857" }}
                    tickFormatter={(v) => `₹${v}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      `₹${formatInr(value)}`,
                      "Profit",
                    ]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      borderColor: "#a7f3d0",
                    }}
                  />
                  <Bar
                    dataKey="profit"
                    fill="#059669"
                    radius={[4, 4, 0, 0]}
                    name="Profit"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {analytics.topSlots.length > 0 ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 lg:col-span-2 xl:col-span-1">
              <p className="mb-2 text-[11px] font-semibold text-slate-700">
                Top slots / games
              </p>
              <ul className="space-y-2">
                {analytics.topSlots.map((slot) => (
                  <li
                    key={slot.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/60 bg-white px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-slate-800">
                        {slot.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {slot.count} calc{slot.count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[12px] font-bold tabular-nums text-blue-700">
                        ₹{formatInr(slot.total)}
                      </p>
                      <p className="text-[10px] font-semibold tabular-nums text-emerald-700">
                        +₹{formatInr(slot.profit)} profit
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : selectedMonth ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
          No calculations in {selectedMonthSummary?.label ?? selectedMonth} for
          the current filters.
        </p>
      ) : null}

      <p className="mt-3 text-[11px] font-medium text-slate-500">
        {analytics.rowCount} calculation{analytics.rowCount === 1 ? "" : "s"}{" "}
        {selectedMonth ? "in selected month" : "in view"}
      </p>
    </div>
  );
}
