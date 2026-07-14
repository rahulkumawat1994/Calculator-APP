import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  deleteElectricityBillingPeriod,
  deleteElectricityReading,
  loadElectricityBillingPeriods,
  loadElectricityConfig,
  loadElectricityReadings,
  newBillingPeriodId,
  newElectricityReadingId,
  saveElectricityBillingPeriod,
  saveElectricityConfig,
  saveElectricityReading,
  DEFAULT_SLAB_RATES,
  type ElectricityBillingPeriod,
  type ElectricityConfig,
  type ElectricityMeterId,
  type ElectricityReading,
  type ElectricitySlabRate,
} from "./data/firestoreDb";
import {
  calcSlabCost,
  buildRows,
  computeMeterAnalytics,
  estimateBill,
  type DayUsage,
  type MetricDetail,
  type TrendPoint,
} from "./lib/electricityCalc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function currentHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTH_SHORT[Number(m) - 1]} ${y}`;
}
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}
function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function buildReadingTime(dateISO: string, timeHHMM: string): number {
  const [h, min] = timeHHMM.split(":").map(Number);
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}
function msToHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function msToISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(fromISO: string, toISO: string): number {
  return Math.max(1, Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86400000) + 1);
}

type DayRow = ElectricityReading & { units: number | null; cost: number | null };

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(rows: DayRow[], meterLabel: string) {
  const headers = ["Date","Time","Meter Reading (KWH)","Units Used","Rate (₹/unit)","Cost (₹)","Entered At","Note"];
  const lines = rows.map((r) => [
    r.dateISO,
    formatTime(r.readingTime),
    r.reading,
    r.units ?? "",
    r.pricePerUnit || "",
    r.cost ?? "",
    formatDateTime(r.enteredAt),
    r.note ?? "",
  ].map((v) => `"${v}"`).join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `electricity_${meterLabel.replace(/\s+/g, "_")}_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Charts ───────────────────────────────────────────────────────────────────

type ChartView = "daily" | "weekly" | "monthly" | "rolling7" | "rolling30" | "running" | "heatmap";

const CHART_VIEWS: { id: ChartView; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "rolling7", label: "7d Avg" },
  { id: "rolling30", label: "30d Avg" },
  { id: "running", label: "Running" },
  { id: "heatmap", label: "Hours" },
];

function ChartSection({
  trends,
  hourlyHeat,
  useSlabRates,
  hasCostData,
}: {
  trends: {
    dailySeries: TrendPoint[];
    weeklySeries: TrendPoint[];
    monthlySeries: TrendPoint[];
    rolling7: TrendPoint[];
    rolling30: TrendPoint[];
    runningConsumption: TrendPoint[];
    runningCost: TrendPoint[];
    dailyPct: number | null;
    weeklyPct: number | null;
    monthlyPct: number | null;
  };
  hourlyHeat: { hour: number; units: number; hours: number }[];
  useSlabRates: boolean;
  hasCostData: boolean;
}) {
  const [view, setView] = useState<ChartView>("daily");
  const [metric, setMetric] = useState<"units" | "cost">("units");
  const hasCost = !useSlabRates && hasCostData;
  const activeMetric = metric === "cost" && !hasCost ? "units" : metric;

  const data: TrendPoint[] =
    view === "daily" ? trends.dailySeries
    : view === "weekly" ? trends.weeklySeries
    : view === "monthly" ? trends.monthlySeries
    : view === "rolling7" ? trends.rolling7
    : view === "rolling30" ? trends.rolling30
    : view === "running"
      ? (activeMetric === "cost" ? trends.runningCost.map((p) => ({ ...p, units: p.cost })) : trends.runningConsumption)
      : [];

  const maxVal = data.length ? Math.max(...data.map((d) => (activeMetric === "cost" && view !== "running" ? d.cost : d.units))) : 0;
  const barColor = activeMetric === "units" ? "#3b82f6" : "#10b981";
  const isLine = view === "rolling7" || view === "rolling30" || view === "running";
  const trendPct = view === "weekly" ? trends.weeklyPct : view === "monthly" ? trends.monthlyPct : trends.dailyPct;
  const maxHourUnits = Math.max(0.001, ...hourlyHeat.map((h) => h.units));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Usage Charts</h2>
          {trendPct != null && view !== "heatmap" && view !== "rolling7" && view !== "rolling30" && view !== "running" && (
            <p className={`text-[11px] mt-0.5 ${trendPct >= 0 ? "text-red-500" : "text-emerald-600"}`}>
              {trendPct >= 0 ? "▲" : "▼"} {Math.abs(trendPct)}% vs previous period
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
            <button type="button" onClick={() => setMetric("units")} className={`px-2.5 py-1 ${metric === "units" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>KWH</button>
            {hasCost && <button type="button" onClick={() => setMetric("cost")} className={`px-2.5 py-1 border-l border-gray-200 ${metric === "cost" ? "bg-emerald-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>₹ Cost</button>}
          </div>
          <div className="flex flex-wrap rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
            {CHART_VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} className={`px-2 py-1 border-l border-gray-200 first:border-l-0 ${view === v.id ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>

      {view === "heatmap" ? (
        <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5">
          {hourlyHeat.map((h) => {
            const intensity = h.units / maxHourUnits;
            return (
              <div key={h.hour} title={`${h.hour}:00 — ${h.units.toFixed(2)} KWH`}
                className="rounded-lg px-1 py-2 text-center"
                style={{ background: `rgba(37, 99, 235, ${0.08 + intensity * 0.75})` }}>
                <p className="text-[10px] font-semibold text-gray-700">{String(h.hour).padStart(2, "0")}</p>
                <p className="text-[9px] text-gray-600 tabular-nums">{h.units.toFixed(1)}</p>
              </div>
            );
          })}
        </div>
      ) : data.length === 0 ? (
        <div className="h-36 flex items-center justify-center text-sm text-gray-400">Add at least 2 readings to see a chart.</div>
      ) : isLine ? (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const val = payload[0].value as number;
              return (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
                  <p className="font-semibold text-gray-700 mb-1">{label}</p>
                  <p className="text-gray-600">{activeMetric === "cost" && view === "running" ? `₹${val.toFixed(2)}` : `${val.toFixed(2)} KWH`}</p>
                </div>
              );
            }} />
            <Line type="monotone" dataKey="units" stroke={barColor} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => activeMetric === "cost" ? `₹${v}` : `${v}`} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as TrendPoint;
              const val = activeMetric === "cost" ? row.cost : row.units;
              return (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
                  <p className="font-semibold text-gray-700 mb-1">{label}</p>
                  <p className="text-gray-600">{activeMetric === "units" ? `${val.toFixed(2)} KWH` : `₹${val.toFixed(2)}`}</p>
                </div>
              );
            }} />
            <Bar dataKey={activeMetric === "cost" ? "cost" : "units"} radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((entry, i) => {
                const val = activeMetric === "cost" ? entry.cost : entry.units;
                return <Cell key={i} fill={val === maxVal ? (activeMetric === "units" ? "#1d4ed8" : "#059669") : barColor} fillOpacity={0.85} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Bill Simulator ───────────────────────────────────────────────────────────

const REFERENCE_UNITS = [50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000];

function SlabTable({ slabs, label, highlight }: { slabs: ElectricitySlabRate[]; label: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border overflow-hidden ${highlight ? "border-purple-200" : "border-gray-200"}`}>
      <div className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${highlight ? "bg-purple-100 text-purple-700" : "bg-gray-50 text-gray-500"}`}>
        {label}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-3 py-1.5 text-left text-gray-400 font-medium">Slab</th>
            <th className="px-3 py-1.5 text-right text-gray-400 font-medium">₹/unit</th>
          </tr>
        </thead>
        <tbody>
          {slabs.map((s, i) => {
            const from = i === 0 ? 0 : slabs[i - 1].upTo + 1;
            const label = s.upTo >= 999999 ? `${from}+ units` : `${from}–${s.upTo} units`;
            return (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-3 py-1.5 text-gray-600">{label}</td>
                <td className="px-3 py-1.5 text-right font-medium text-gray-700">₹{s.rate.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimulatorSection({
  currentSlabs,
  fixedCharges,
  avgMonthlyUnits,
}: {
  currentSlabs: ElectricitySlabRate[];
  fixedCharges: number;
  avgMonthlyUnits: number | null;
}) {
  const [units,       setUnits]       = useState(String(avgMonthlyUnits ?? 300));
  const [scenarioSlabs, setScenarioSlabs] = useState<ElectricitySlabRate[]>(() =>
    currentSlabs.map((s) => ({ ...s, rate: +(s.rate * 1.1).toFixed(2) })) // default +10%
  );
  const [showScenario, setShowScenario] = useState(false);

  const num         = parseFloat(units);
  const validUnits  = !isNaN(num) && num >= 0;
  const currentCost = validUnits ? calcSlabCost(num, currentSlabs) : null;
  const scenarioCost = validUnits && showScenario ? calcSlabCost(num, scenarioSlabs) : null;
  const diff         = currentCost && scenarioCost ? scenarioCost.total - currentCost.total : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Units input */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">🔮 Bill Simulator</h2>
        <p className="text-xs text-gray-400 mb-3">Enter total units — the matching slab rate applies to every unit (not progressive bands).</p>
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-gray-500">Total units (KWH)</label>
            <input
              type="number" value={units} onChange={(e) => setUnits(e.target.value)}
              placeholder="e.g. 350" min="0" step="1"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {avgMonthlyUnits != null && (
            <button onClick={() => setUnits(String(avgMonthlyUnits))}
              className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 hover:bg-gray-100">
              Use my avg<br/><span className="font-semibold text-gray-700">{avgMonthlyUnits} KWH</span>
            </button>
          )}
        </div>

        {/* Current slab result */}
        {currentCost && currentCost.lines.length > 0 && (
          <div className="mt-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 overflow-hidden">
              <div className="px-3 py-2 bg-blue-100/60 border-b border-blue-100">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Current Rates — Breakdown</p>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {currentCost.lines.map((line, i) => (
                    <tr key={i} className="border-b border-blue-50 last:border-0">
                      <td className="px-3 py-1.5 text-gray-600">{line.label}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{line.units.toFixed(2)} units × ₹{line.rate}</td>
                      <td className="px-3 py-1.5 text-right font-medium text-gray-700 tabular-nums">₹{formatInr(line.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-3 py-2 bg-blue-100/60 border-t border-blue-100">
                <span className="text-xs text-blue-600 font-medium">Energy charge</span>
                <span className="text-sm font-bold text-blue-700">₹{formatInr(currentCost.total)}</span>
              </div>
              {fixedCharges > 0 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-blue-100">
                  <span className="text-xs text-gray-500">+ Fixed charges</span>
                  <span className="text-xs font-medium text-gray-600">₹{formatInr(fixedCharges)}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-3 py-2.5 bg-blue-600 border-t border-blue-700">
                <span className="text-xs text-blue-100 font-semibold">TOTAL BILL</span>
                <span className="text-base font-bold text-white">₹{formatInr(currentCost.total + fixedCharges)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Reference table for different unit levels */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Quick Reference — Bill at different consumption</h3>
          <p className="text-xs text-gray-400 mt-0.5">Based on current slab rates{fixedCharges > 0 ? ` + ₹${fixedCharges} fixed charges` : ""}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase text-gray-400">Units</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase text-gray-400">Energy (₹)</th>
                {fixedCharges > 0 && <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase text-gray-400">Total (₹)</th>}
                {showScenario && <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase text-purple-500">Scenario (₹)</th>}
                {showScenario && <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase text-red-400">Diff (₹)</th>}
              </tr>
            </thead>
            <tbody>
              {REFERENCE_UNITS.map((u) => {
                const cur  = calcSlabCost(u, currentSlabs);
                const scen = showScenario ? calcSlabCost(u, scenarioSlabs) : null;
                const d    = scen ? scen.total - cur.total : null;
                const isHighlight = validUnits && Math.abs(u - num) < 25;
                return (
                  <tr key={u} className={`border-b border-gray-50 last:border-0 ${isHighlight ? "bg-yellow-50/60" : "hover:bg-gray-50/60"}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-700">
                      {u} KWH
                      {isHighlight && <span className="ml-1.5 text-[10px] bg-yellow-200 text-yellow-800 rounded px-1 py-0.5">≈ your usage</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">₹{formatInr(cur.total)}</td>
                    {fixedCharges > 0 && <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">₹{formatInr(cur.total + fixedCharges)}</td>}
                    {showScenario && scen && <td className="px-4 py-2.5 text-right tabular-nums text-purple-700 font-medium">₹{formatInr(scen.total + fixedCharges)}</td>}
                    {showScenario && d != null && <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${d > 0 ? "text-red-500" : "text-emerald-600"}`}>{d > 0 ? "+" : ""}₹{formatInr(d)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scenario comparison */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">🆚 Compare with a different slab scenario</h3>
            <p className="text-xs text-gray-400 mt-0.5">See what your bill would be if the electricity board revises the rates next year</p>
          </div>
          <button onClick={() => setShowScenario((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${showScenario ? "bg-purple-600" : "bg-gray-300"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showScenario ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        {showScenario && (<>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setScenarioSlabs(currentSlabs.map((s) => ({ ...s, rate: +(s.rate * 1.10).toFixed(2) })))}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">+10% rates</button>
            <button onClick={() => setScenarioSlabs(currentSlabs.map((s) => ({ ...s, rate: +(s.rate * 1.20).toFixed(2) })))}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">+20% rates</button>
            <button onClick={() => setScenarioSlabs(currentSlabs.map((s) => ({ ...s, rate: +(s.rate * 1.30).toFixed(2) })))}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">+30% rates</button>
            <button onClick={() => setScenarioSlabs([...currentSlabs])}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100">Reset</button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <SlabTable slabs={currentSlabs} label="Current Rates" />
            <SlabTable slabs={scenarioSlabs} label="Scenario Rates" highlight />
          </div>

          {/* Editable scenario slabs */}
          <div className="rounded-xl border border-purple-100 overflow-hidden">
            <div className="px-3 py-2 bg-purple-50 border-b border-purple-100">
              <p className="text-[11px] font-semibold text-purple-700 uppercase tracking-wide">Edit scenario rates</p>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {scenarioSlabs.map((slab, i) => {
                  const from  = i === 0 ? 0 : scenarioSlabs[i - 1].upTo + 1;
                  const label = slab.upTo >= 999999 ? `${from}+ units` : `${from}–${slab.upTo} units`;
                  return (
                    <tr key={i} className="border-b border-purple-50 last:border-0">
                      <td className="px-3 py-2 text-gray-600 w-40">{label}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-gray-400">₹</span>
                          <input type="number" value={slab.rate} min="0" step="0.01"
                            onChange={(e) => { const v = [...scenarioSlabs]; v[i] = { ...v[i], rate: Number(e.target.value) }; setScenarioSlabs(v); }}
                            className="w-16 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-purple-400" />
                          <span className="text-gray-400 text-[10px]">/unit</span>
                          <span className="ml-2 text-[10px] text-purple-400">(was ₹{currentSlabs[i]?.rate ?? "?"})</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Side-by-side for current units input */}
          {currentCost && scenarioCost && (
            <div className="mt-3 flex gap-3">
              <div className="flex-1 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center">
                <p className="text-[10px] text-blue-500 uppercase font-semibold mb-1">Current bill ({units} KWH)</p>
                <p className="text-xl font-bold text-blue-700">₹{formatInr(currentCost.total + fixedCharges)}</p>
              </div>
              <div className="flex-1 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-center">
                <p className="text-[10px] text-purple-600 uppercase font-semibold mb-1">Scenario bill ({units} KWH)</p>
                <p className="text-xl font-bold text-purple-700">₹{formatInr(scenarioCost.total + fixedCharges)}</p>
              </div>
              {diff != null && (
                <div className={`flex-1 rounded-xl border px-4 py-3 text-center ${diff > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <p className={`text-[10px] uppercase font-semibold mb-1 ${diff > 0 ? "text-red-500" : "text-emerald-600"}`}>Difference</p>
                  <p className={`text-xl font-bold ${diff > 0 ? "text-red-600" : "text-emerald-600"}`}>{diff > 0 ? "+" : ""}₹{formatInr(diff)}</p>
                </div>
              )}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, highlight, onClick,
}: {
  label: string; value: string; sub?: string; highlight?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-[130px] text-left rounded-2xl border px-4 py-3 shadow-sm transition-colors ${highlight ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"} ${onClick ? "hover:border-blue-300 cursor-pointer" : "cursor-default"}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-xl sm:text-2xl font-bold leading-tight ${highlight ? "text-blue-700" : "text-gray-800"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </button>
  );
}

function InsightList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 mb-4">
      <h2 className="text-sm font-semibold text-amber-900 mb-2">Insights</h2>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-xs text-amber-900/90 flex gap-2">
            <span className="text-amber-500 shrink-0">•</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const METERS: { id: ElectricityMeterId; label: string; icon: string }[] = [
  { id: "main",     label: "Main Meter",     icon: "🏠" },
  { id: "basement", label: "Basement Meter", icon: "🏗️" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

type FormMode = "add" | "edit";
  type ActiveSection = "overview" | "billing" | "monthly" | "simulator";

export default function ElectricityPage() {
  const [allReadings,     setAllReadings]     = useState<ElectricityReading[]>([]);
  const [billingPeriods,  setBillingPeriods]  = useState<ElectricityBillingPeriod[]>([]);
  const [config,          setConfig]          = useState<ElectricityConfig>({ pricePerUnit: 0, useSlabRates: false, slabRates: DEFAULT_SLAB_RATES, fixedChargesMain: 0, fixedChargesBasement: 0, taxPercent: 0, fuelSurchargePerUnit: 0 });
  const [taxInput,        setTaxInput]        = useState("");
  const [fuelInput,       setFuelInput]       = useState("");
  const [metricDetail,    setMetricDetail]    = useState<{ title: string; detail: MetricDetail } | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [activeMeter,     setActiveMeter]     = useState<ElectricityMeterId>("main");
  const [activeSection,   setActiveSection]   = useState<ActiveSection>("overview");

  // Reading modal
  const [modalOpen,  setModalOpen]  = useState(false);
  const [formMode,   setFormMode]   = useState<FormMode>("add");
  const [editId,     setEditId]     = useState<string | null>(null);
  const [date,       setDate]       = useState(todayISO());
  const [timeVal,    setTimeVal]    = useState(currentHHMM());
  const [readingVal, setReadingVal] = useState("");
  const [rateVal,    setRateVal]    = useState("");
  const [noteVal,    setNoteVal]    = useState("");
  const [saving,     setSaving]     = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Billing period modal
  const [bpModalOpen,   setBpModalOpen]   = useState(false);
  const [bpEditId,      setBpEditId]      = useState<string | null>(null);
  const [bpFrom,        setBpFrom]        = useState("");
  const [bpTo,          setBpTo]          = useState(todayISO());
  const [bpFixed,       setBpFixed]       = useState("");
  const [bpNote,        setBpNote]        = useState("");
  const [bpSaving,      setBpSaving]      = useState(false);

  // Rate settings modal
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [priceInput,    setPriceInput]    = useState("");
  const [fixedInput,    setFixedInput]    = useState("");
  const [useSlabs,      setUseSlabs]      = useState(false);
  const [slabDraft,     setSlabDraft]     = useState<ElectricitySlabRate[]>(DEFAULT_SLAB_RATES);
  // Keep legacy ref for focus
  const [editingPrice,  setEditingPrice]  = useState(false);
  const priceInputRef = useRef<HTMLInputElement>(null);

  // Delete confirms
  const [deleteReadingId, setDeleteReadingId] = useState<string | null>(null);
  const [deleteBpId,      setDeleteBpId]      = useState<string | null>(null);

  // Filter
  const [filterFrom,     setFilterFrom]     = useState("");
  const [filterFromTime, setFilterFromTime] = useState("");
  const [filterTo,       setFilterTo]       = useState("");
  const [filterToTime,   setFilterToTime]   = useState("");

  // ── Load ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [cfg, rows, bps] = await Promise.all([
        loadElectricityConfig(),
        loadElectricityReadings(),
        loadElectricityBillingPeriods(activeMeter),
      ]);
      setConfig(cfg);
      setRateVal(cfg.pricePerUnit > 0 ? String(cfg.pricePerUnit) : "");
      setAllReadings(rows);
      setBillingPeriods(bps);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload billing periods when switching meter
  useEffect(() => {
    loadElectricityBillingPeriods(activeMeter).then(setBillingPeriods);
  }, [activeMeter]);

  useEffect(() => {
    if (editingPrice && priceInputRef.current) { priceInputRef.current.focus(); priceInputRef.current.select(); }
  }, [editingPrice]);

  // ── Derived data ──
  const meterReadings = allReadings
    .filter((r) => r.meterId === activeMeter)
    .sort((a, b) => a.readingTime - b.readingTime);

  const allRows = buildRows(meterReadings);

  const fromMs = filterFrom ? buildReadingTime(filterFrom, filterFromTime || "00:00") : null;
  const toMs   = filterTo   ? buildReadingTime(filterTo,   filterToTime   || "23:59") : null;
  const filteredRows   = allRows.filter((r) => {
    if (fromMs != null && r.readingTime < fromMs) return false;
    if (toMs   != null && r.readingTime > toMs)   return false;
    return true;
  });
  const reversedRows = [...filteredRows].reverse();
  const isFiltered   = !!(filterFrom || filterTo);

  const fixedCharges = activeMeter === "main" ? config.fixedChargesMain : config.fixedChargesBasement;
  const hasCostData = allRows.some((r) => r.cost != null);
  const totalCost = allRows.reduce((s, r) => s + (r.cost ?? 0), 0);

  const analytics = useMemo(
    () =>
      computeMeterAnalytics(meterReadings, config, {
        fixedCharges,
        billingPeriods,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when reading set / config / periods change
    [activeMeter, allReadings, config, fixedCharges, billingPeriods],
  );

  const totalUnits = analytics.totalUnits;
  const avgUnitsPerDay = analytics.avgPerDay;
  const projectedCost = analytics.periodProjectedBill?.total ?? null;
  const peakDayEntry: DayUsage | null = analytics.peakDay;
  const bestDayEntry: DayUsage | null = analytics.lowestDay;
  const todayUnits = analytics.todayUnits;
  const yesterdayUnits = analytics.yesterdayUnits;
  const trendDiff =
    todayUnits != null && yesterdayUnits != null ? +(todayUnits - yesterdayUnits).toFixed(2) : null;

  const lastPeriod = billingPeriods[0];
  const today = todayISO();
  const periodStartDate = lastPeriod ? lastPeriod.toDate : (meterReadings[0]?.dateISO ?? today);
  const daysElapsed = daysBetween(periodStartDate, today);
  const avgPeriodDays =
    billingPeriods.length >= 2
      ? Math.round(billingPeriods.reduce((s, p) => s + daysBetween(p.fromDate, p.toDate), 0) / billingPeriods.length)
      : 30;
  const daysLeft = Math.max(0, avgPeriodDays - daysElapsed);

  const monthlySummary = analytics.months.map((m) => ({
    key: m.key,
    label: m.label,
    units: m.units,
    cost: m.cost ?? 0,
    days: m.hours > 0 ? +(m.hours / 24).toFixed(2) : 0,
    readings: allRows.filter((r) => r.dateISO.startsWith(m.key) && r.units != null).length,
    avgPerDay: m.avgPerDay,
  }));
  const firstReading = meterReadings[0]?.reading;
  const lastReading = analytics.currentReading;
  const activeMeta = METERS.find((m) => m.id === activeMeter)!;

  const showMetric = (title: string, key: keyof typeof analytics.metrics) => {
    const detail = analytics.metrics[key];
    if (detail) setMetricDetail({ title, detail });
  };

  // ── Readings form helpers ──
  function resetForm() { setModalOpen(false); setFormMode("add"); setEditId(null); setDate(todayISO()); setTimeVal(currentHHMM()); setReadingVal(""); setRateVal(config.pricePerUnit > 0 ? String(config.pricePerUnit) : ""); setNoteVal(""); }
  function openAddModal() { resetForm(); setModalOpen(true); }
  function duplicateLast() {
    const last = meterReadings[meterReadings.length - 1];
    if (!last) return openAddModal();
    setFormMode("add"); setEditId(null);
    setDate(todayISO()); setTimeVal(currentHHMM());
    setReadingVal(String(last.reading));
    setRateVal(last.pricePerUnit > 0 ? String(last.pricePerUnit) : (config.pricePerUnit > 0 ? String(config.pricePerUnit) : ""));
    setNoteVal("");
    setModalOpen(true);
  }
  function startEdit(row: ElectricityReading) {
    setFormMode("edit"); setEditId(row.id);
    setDate(msToISO(row.readingTime)); setTimeVal(msToHHMM(row.readingTime));
    setReadingVal(String(row.reading));
    setRateVal(row.pricePerUnit > 0 ? String(row.pricePerUnit) : "");
    setNoteVal(row.note ?? "");
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const num  = parseFloat(readingVal);
    const rate = parseFloat(rateVal);
    if (!date || !timeVal || isNaN(num) || num < 0) { toast.error("Enter a valid date, time, and meter reading."); return; }
    setSaving(true);
    try {
      const rec: ElectricityReading = {
        id:           formMode === "edit" && editId ? editId : newElectricityReadingId(activeMeter),
        meterId:      activeMeter, dateISO: date, reading: num,
        readingTime:  buildReadingTime(date, timeVal), enteredAt: Date.now(),
        pricePerUnit: !isNaN(rate) && rate > 0 ? rate : 0,
        ...(noteVal.trim() ? { note: noteVal.trim() } : {}),
      };
      await saveElectricityReading(rec);
      setAllReadings((prev) => [...prev.filter((r) => r.id !== rec.id), rec]);
      resetForm();
      toast.success(formMode === "edit" ? "Reading updated." : "Reading saved.");
    } catch { toast.error("Failed to save reading."); } finally { setSaving(false); }
  }

  // ── Billing period helpers ──
  function resetBpForm() { setBpModalOpen(false); setBpEditId(null); setBpFrom(""); setBpTo(todayISO()); setBpFixed(""); setBpNote(""); }
  function openAddBp() {
    // Auto-fill fromDate from end of last period or first reading date
    const lastPeriod = billingPeriods[0]; // newest first
    const autoFrom   = lastPeriod ? lastPeriod.toDate : (meterReadings[0]?.dateISO ?? "");
    resetBpForm(); setBpFrom(autoFrom); setBpModalOpen(true);
  }
  function startEditBp(bp: ElectricityBillingPeriod) {
    setBpEditId(bp.id); setBpFrom(bp.fromDate); setBpTo(bp.toDate);
    setBpFixed(bp.fixedCharges > 0 ? String(bp.fixedCharges) : "");
    setBpNote(bp.note ?? ""); setBpModalOpen(true);
  }

  async function handleSaveBp(e: React.FormEvent) {
    e.preventDefault();
    if (!bpFrom || !bpTo || bpFrom > bpTo) { toast.error("Enter a valid date range (from ≤ to)."); return; }
    setBpSaving(true);
    try {
      const fixed = parseFloat(bpFixed);
      const bp: ElectricityBillingPeriod = {
        id:           bpEditId ?? newBillingPeriodId(activeMeter),
        meterId:      activeMeter, fromDate: bpFrom, toDate: bpTo,
        fixedCharges: !isNaN(fixed) && fixed > 0 ? fixed : 0,
        createdAt:    Date.now(),
        ...(bpNote.trim() ? { note: bpNote.trim() } : {}),
      };
      await saveElectricityBillingPeriod(bp);
      setBillingPeriods((prev) => [...prev.filter((p) => p.id !== bp.id), bp].sort((a, b) => b.fromDate.localeCompare(a.fromDate)));
      resetBpForm();
      toast.success("Billing period saved.");
    } catch { toast.error("Failed to save billing period."); } finally { setBpSaving(false); }
  }

  // ── Rate settings modal ──
  function openRateModal() {
    setPriceInput(String(config.pricePerUnit));
    setFixedInput(String(fixedCharges || ""));
    setTaxInput(String(config.taxPercent || ""));
    setFuelInput(String(config.fuelSurchargePerUnit || ""));
    setUseSlabs(config.useSlabRates);
    setSlabDraft(config.slabRates?.length ? config.slabRates : DEFAULT_SLAB_RATES);
    setRateModalOpen(true);
  }

  async function handleSavePrice() {
    const num   = parseFloat(priceInput);
    const fixed = parseFloat(fixedInput);
    const tax   = parseFloat(taxInput);
    const fuel  = parseFloat(fuelInput);
    if (!useSlabs && (isNaN(num) || num < 0)) { toast.error("Enter a valid flat rate."); return; }
    try {
      const newCfg: ElectricityConfig = {
        ...config,
        pricePerUnit:         !isNaN(num) && num >= 0 ? num : config.pricePerUnit,
        useSlabRates:         useSlabs,
        slabRates:            slabDraft,
        fixedChargesMain:     activeMeter === "main"     ? (!isNaN(fixed) && fixed >= 0 ? fixed : config.fixedChargesMain)     : config.fixedChargesMain,
        fixedChargesBasement: activeMeter === "basement" ? (!isNaN(fixed) && fixed >= 0 ? fixed : config.fixedChargesBasement) : config.fixedChargesBasement,
        taxPercent:           !isNaN(tax) && tax >= 0 ? tax : 0,
        fuelSurchargePerUnit: !isNaN(fuel) && fuel >= 0 ? fuel : 0,
      };
      await saveElectricityConfig(newCfg);
      setConfig(newCfg);
      setRateVal(!useSlabs && num > 0 ? String(num) : "");
      setRateModalOpen(false); setEditingPrice(false);
      toast.success("Rate settings saved.");
    } catch { toast.error("Failed to save settings."); }
  }

  // ── Deletes ──
  async function handleDeleteReading() {
    if (!deleteReadingId) return;
    try {
      await deleteElectricityReading(deleteReadingId);
      setAllReadings((prev) => prev.filter((r) => r.id !== deleteReadingId));
      if (editId === deleteReadingId) resetForm();
      toast.success("Reading deleted.");
    } catch { toast.error("Failed to delete."); } finally { setDeleteReadingId(null); }
  }
  async function handleDeleteBp() {
    if (!deleteBpId) return;
    try {
      await deleteElectricityBillingPeriod(deleteBpId);
      setBillingPeriods((prev) => prev.filter((p) => p.id !== deleteBpId));
      toast.success("Billing period deleted.");
    } catch { toast.error("Failed to delete."); } finally { setDeleteBpId(null); }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] text-gray-500 text-sm">Loading…</div>
  );

  const deleteReadingRow = deleteReadingId ? allReadings.find((r) => r.id === deleteReadingId) : null;
  const deleteBpRow      = deleteBpId      ? billingPeriods.find((p) => p.id === deleteBpId)  : null;

  return (
    <div className="min-h-screen bg-[#eef2f7]">
      <div className="max-w-[720px] mx-auto px-3 pt-6 pb-20">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800">⚡ Electricity Tracker</h1>
            <p className="text-xs text-gray-400 mt-0.5">Daily KWH meter readings</p>
          </div>
          {/* Rate settings button */}
          <button onClick={openRateModal} className="group flex flex-col items-end" title="Tap to edit rate settings">
            <span className="text-[11px] text-gray-400 group-hover:text-blue-500">
              {config.useSlabRates ? "Slab rates" : "₹ per unit"}
            </span>
            <span className="text-lg font-bold text-gray-700 group-hover:text-blue-600">
              {config.useSlabRates
                ? <span className="text-sm font-semibold text-purple-600">Slab ⚡</span>
                : config.pricePerUnit > 0 ? `₹${config.pricePerUnit}` : <span className="text-gray-300 text-sm">Set rate →</span>}
            </span>
            {fixedCharges > 0 && <span className="text-[10px] text-gray-400">+₹{fixedCharges} fixed</span>}
          </button>
        </div>

        {/* ── Meter tabs ── */}
        <div className="flex gap-2 mb-5">
          {METERS.map((m) => {
            const active = activeMeter === m.id;
            const count  = allReadings.filter((r) => r.meterId === m.id).length;
            return (
              <button key={m.id} onClick={() => { setActiveMeter(m.id); resetForm(); setFilterFrom(""); setFilterFromTime(""); setFilterTo(""); setFilterToTime(""); }}
                className={`flex-1 flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${active ? "border-blue-300 bg-blue-600 text-white shadow-md" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                <span>{m.icon}</span><span>{m.label}</span>
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        {/* ── Dashboard cards (tap a card for formula) ── */}
        {meterReadings.length >= 2 && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <StatCard label="Current reading" value={lastReading != null ? lastReading.toLocaleString("en-IN") : "—"} sub="KWH on meter" />
              <StatCard label="Previous reading" value={analytics.previousReading != null ? analytics.previousReading.toLocaleString("en-IN") : "—"} sub="prior entry" />
              <StatCard label="Total units" value={`${totalUnits.toFixed(2)} KWH`}
                sub={firstReading != null && lastReading != null ? `${firstReading.toLocaleString("en-IN")} → ${lastReading.toLocaleString("en-IN")}` : undefined}
                onClick={() => showMetric("Total units", "totalUnits")} />
              <StatCard label="Elapsed time" value={analytics.elapsedLabel}
                sub={`${analytics.elapsedHours.toFixed(1)} hours`}
                onClick={() => showMetric("Elapsed time", "elapsedTime")} />
              {analytics.avgPerHour != null && (
                <StatCard label="Avg hourly" value={`${analytics.avgPerHour.toFixed(3)} KWH`}
                  sub="timestamp-based" onClick={() => showMetric("Average hourly usage", "avgPerHour")} />
              )}
              {avgUnitsPerDay != null && (
                <StatCard label="Avg / day" value={`${avgUnitsPerDay.toFixed(2)} KWH`}
                  sub={`over ${analytics.elapsedLabel}`}
                  onClick={() => showMetric("Average daily usage", "avgPerDay")} />
              )}
              <StatCard label="Today" value={todayUnits != null ? `${todayUnits.toFixed(2)} KWH` : "—"}
                sub="prorated by hours" onClick={() => showMetric("Today's usage", "today")} />
              <StatCard label="This month" value={`${analytics.currentMonthUnits.toFixed(2)} KWH`}
                sub={analytics.monthlyComparisonPct != null
                  ? `${analytics.monthlyComparisonPct >= 0 ? "+" : ""}${analytics.monthlyComparisonPct}% vs last month pace`
                  : "month-to-date"} />
              {analytics.projectedMonthEndUnits != null && (
                <StatCard label="Projected month" value={`${analytics.projectedMonthEndUnits.toFixed(0)} KWH`}
                  sub="end-of-month estimate" />
              )}
              {(analytics.estimatedBill || projectedCost != null) && (
                <StatCard
                  label="Estimated bill"
                  value={`₹${formatInr(projectedCost ?? analytics.estimatedBill!.total)}`}
                  sub={lastPeriod
                    ? `${daysElapsed}d since last bill · ${daysLeft}d left`
                    : analytics.estimatedBill?.costPerUnit != null
                      ? `≈ ₹${analytics.estimatedBill.costPerUnit.toFixed(2)}/unit`
                      : "billing estimate"}
                  highlight
                  onClick={() => showMetric("Estimated / projected bill", projectedCost != null ? "periodProjection" : "estimatedBill")}
                />
              )}
              {peakDayEntry && (
                <StatCard label="Peak day" value={`${peakDayEntry.units.toFixed(2)} KWH`}
                  sub={formatDate(peakDayEntry.dateISO)} onClick={() => showMetric("Peak day", "peakDay")} />
              )}
              {bestDayEntry && analytics.days.length >= 2 && (
                <StatCard label="Lowest day" value={`${bestDayEntry.units.toFixed(2)} KWH`} sub={formatDate(bestDayEntry.dateISO)} />
              )}
              {analytics.efficiencyScore != null && (
                <StatCard label="Efficiency" value={`${analytics.efficiencyScore}`}
                  sub="0–100 score" onClick={() => showMetric("Efficiency score", "efficiencyScore")} />
              )}
              {!config.useSlabRates && hasCostData && (
                <StatCard label="Total cost" value={`₹${formatInr(totalCost)}`} sub="sum of reading costs" />
              )}
              {trendDiff != null && (
                <StatCard
                  label="Today vs yesterday"
                  value={`${trendDiff > 0 ? "+" : ""}${trendDiff.toFixed(2)} KWH`}
                  sub={trendDiff > 0 ? "using more than yesterday" : trendDiff < 0 ? "using less than yesterday" : "same as yesterday"}
                />
              )}
              {analytics.nightPct != null && (
                <StatCard label="Night share" value={`${analytics.nightPct}%`}
                  sub={`${analytics.nightUnits.toFixed(1)} KWH · 10pm–6am`} />
              )}
              {analytics.last7AvgPerDay != null && (
                <StatCard label="Last 7d avg" value={`${analytics.last7AvgPerDay.toFixed(2)} KWH`} sub="per day (elapsed hours)" />
              )}
              {analytics.medianDailyUsage != null && (
                <StatCard label="Median day" value={`${analytics.medianDailyUsage.toFixed(2)} KWH`} sub="daily median" />
              )}
              {analytics.peakHour != null && (
                <StatCard label="Peak hour" value={`${String(analytics.peakHour).padStart(2, "0")}:00`}
                  sub={analytics.idleHour != null ? `idle ${String(analytics.idleHour).padStart(2, "0")}:00` : "highest hour-of-day"} />
              )}
              {analytics.estimatedBill?.slab && (
                <StatCard
                  label="Current slab"
                  value={`₹${analytics.estimatedBill.slab.currentSlabRate?.toFixed(2) ?? "—"}`}
                  sub={analytics.estimatedBill.slab.unitsToNextSlab != null
                    ? `${analytics.estimatedBill.slab.unitsToNextSlab.toFixed(0)} units to next slab`
                    : "top slab"}
                />
              )}
            </div>
            <InsightList items={analytics.insights} />
          </>
        )}

        {/* ── Section tabs ── */}
        <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-2xl p-1 shadow-sm">
          {([["overview","📋 Overview"],["billing","🧾 Billing"],["monthly","📅 Monthly"],["simulator","🔮 Simulator"]] as [ActiveSection, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setActiveSection(id)}
              className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition-all ${activeSection === id ? "bg-blue-600 text-white shadow" : "text-gray-500 hover:bg-gray-50"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ══ OVERVIEW SECTION ══ */}
        {activeSection === "overview" && (<>
          {allRows.length >= 2 && (
            <ChartSection
              trends={analytics.trends}
              hourlyHeat={analytics.hourlyHeat}
              useSlabRates={config.useSlabRates}
              hasCostData={hasCostData}
            />
          )}

          {/* Action row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              <button onClick={openAddModal} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 active:scale-95">
                <span className="text-base leading-none">+</span> Add Reading
              </button>
              {meterReadings.length > 0 && (
                <button onClick={duplicateLast} title="Pre-fill with last reading's KWH"
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
                  ⎘ Duplicate last
                </button>
              )}
            </div>
            {allRows.length > 0 && (
              <button onClick={() => exportCSV(allRows, activeMeta.label)}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 shadow-sm">
                ⬇ Export CSV
              </button>
            )}
          </div>

          {/* Filter bar */}
          {meterReadings.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-3 mb-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">From</label>
                  <div className="flex gap-1.5">
                    <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <input type="time" value={filterFromTime} onChange={(e) => setFilterFromTime(e.target.value)} disabled={!filterFrom} className="w-24 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40" />
                  </div>
                </div>
                <span className="text-gray-300 text-lg self-end pb-2">→</span>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">To</label>
                  <div className="flex gap-1.5">
                    <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <input type="time" value={filterToTime} onChange={(e) => setFilterToTime(e.target.value)} disabled={!filterTo} className="w-24 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40" />
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end pb-0.5">
                  {isFiltered && <button onClick={() => { setFilterFrom(""); setFilterFromTime(""); setFilterTo(""); setFilterToTime(""); }} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">Clear</button>}
                  {isFiltered && <span className="text-xs text-gray-400">{filteredRows.length} of {allRows.length}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Readings table */}
          {filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-400">
              {isFiltered ? "No readings match the selected range." : `No readings yet for ${activeMeta.label}.`}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-3 py-2.5 text-left   text-[11px] font-semibold uppercase tracking-wide text-gray-400">Date & Time</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Reading</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Units</th>
                      {!config.useSlabRates && <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Rate</th>}
                      {!config.useSlabRates && hasCostData && <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">Cost (₹)</th>}
                      <th className="px-3 py-2.5 text-left   text-[11px] font-semibold uppercase tracking-wide text-gray-400">Entered</th>
                      <th className="px-3 py-2.5 text-left   text-[11px] font-semibold uppercase tracking-wide text-gray-400">Note</th>
                      <th className="px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {reversedRows.map((row, i) => {
                      const isEditing = editId === row.id;
                      return (
                        <tr key={row.id} className={`border-b border-gray-50 last:border-0 ${isEditing ? "bg-amber-50/60" : i === 0 ? "bg-blue-50/40" : "hover:bg-gray-50/60"}`}>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <p className="font-medium text-gray-700">{formatDate(row.dateISO)}</p>
                            <p className="text-[11px] text-gray-400">{formatTime(row.readingTime)}</p>
                            {i === 0 && !isEditing && <span className="text-[10px] bg-blue-100 text-blue-600 rounded px-1 py-0.5 font-semibold">Latest</span>}
                            {isEditing && <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1 py-0.5 font-semibold">Editing</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{row.reading.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            {row.units != null ? <span className={`font-medium ${row.units < 0 ? "text-red-500" : peakDayEntry && row.dateISO === peakDayEntry.dateISO ? "text-orange-500 font-bold" : "text-gray-700"}`}>{row.units.toFixed(2)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          {!config.useSlabRates && (
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {row.pricePerUnit > 0 ? <span className="text-gray-500 text-[11px]">₹{row.pricePerUnit}</span> : <span className="text-gray-300">—</span>}
                            </td>
                          )}
                          {!config.useSlabRates && hasCostData && <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{row.cost != null ? `₹${formatInr(row.cost)}` : <span className="text-gray-300">—</span>}</td>}
                          <td className="px-3 py-2.5 whitespace-nowrap"><span className="text-[11px] text-gray-400" title={formatDateTime(row.enteredAt)}>{formatTime(row.enteredAt)}</span></td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs max-w-[90px] truncate">{row.note ?? ""}</td>
                          <td className="px-2 py-2.5">
                            <div className="flex gap-1">
                              <button onClick={() => startEdit(row)} className="rounded-lg p-1 text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition-colors" title="Edit">✏️</button>
                              <button onClick={() => setDeleteReadingId(row.id)} className="rounded-lg p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors" title="Delete">🗑</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filteredRows.length >= 2 && (
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td className="px-3 py-2.5 text-xs font-bold text-gray-500 uppercase">{isFiltered ? "Filtered total" : "Total"}</td>
                        <td /><td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-800">{filteredRows.reduce((s, r) => s + (r.units ?? 0), 0).toFixed(2)}</td>
                        {!config.useSlabRates && <td />}
                        {!config.useSlabRates && hasCostData && <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-800">₹{formatInr(filteredRows.reduce((s, r) => s + (r.cost ?? 0), 0))}</td>}
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>)}

        {/* ══ BILLING PERIODS SECTION ══ */}
        {activeSection === "billing" && (<>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-500">Track each bill cycle — add a period when you receive a bill.</p>
            <button onClick={openAddBp} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 active:scale-95">
              <span>+</span> Add Period
            </button>
          </div>

          {billingPeriods.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center text-sm text-gray-400">
              No billing periods yet. Add one when your next bill arrives.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {billingPeriods.map((bp) => {
                const periodRows = allRows.filter((r) => r.dateISO >= bp.fromDate && r.dateISO <= bp.toDate);
                const pUnits = periodRows.reduce((s, r) => s + (r.units ?? 0), 0);
                const days   = daysBetween(bp.fromDate, bp.toDate);

                const bill = estimateBill(pUnits, config, bp.fixedCharges);
                const slabResult = config.useSlabRates ? bill.slab : null;
                // Flat: prefer locked-in per-reading energy costs; slab/fuel/tax from bill helper.
                const energy = config.useSlabRates
                  ? bill.energyCharge
                  : periodRows.reduce((s, r) => s + (r.cost ?? 0), 0);
                const fuel = bill.fuelSurcharge;
                const subtotal = energy + bp.fixedCharges + fuel;
                const tax = +((subtotal * ((config.taxPercent ?? 0) / 100))).toFixed(2);
                const total = +(subtotal + tax).toFixed(2);

                return (
                  <div key={bp.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{formatDate(bp.fromDate)} → {formatDate(bp.toDate)}</p>
                        <p className="text-xs text-gray-400">{days} days · {periodRows.length} readings · {pUnits.toFixed(2)} KWH</p>
                        {bp.note && <p className="text-xs text-gray-500 mt-0.5 italic">{bp.note}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => startEditBp(bp)} className="rounded-lg p-1.5 text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition-colors">✏️</button>
                        <button onClick={() => setDeleteBpId(bp.id)} className="rounded-lg p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">🗑</button>
                      </div>
                    </div>

                    {/* Slab breakdown table */}
                    {slabResult && slabResult.lines.length > 0 && (
                      <div className="mb-3 rounded-xl border border-purple-100 bg-purple-50/50 overflow-hidden">
                        <div className="px-3 py-1.5 bg-purple-100/60 border-b border-purple-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-600">⚡ Slab rate (all units)</p>
                        </div>
                        <table className="w-full text-xs">
                          <tbody>
                            {slabResult.lines.map((line, i) => (
                              <tr key={i} className="border-b border-purple-100/50 last:border-0">
                                <td className="px-3 py-1.5 text-gray-600">{line.label}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{line.units.toFixed(2)} units</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">× ₹{line.rate}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-700">= ₹{formatInr(line.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <div className="flex-1 min-w-[100px] rounded-xl bg-gray-50 px-3 py-2">
                        <p className="text-[10px] text-gray-400 uppercase font-semibold">Energy cost</p>
                        <p className="font-bold text-gray-800">₹{formatInr(energy)}</p>
                        {config.useSlabRates && <p className="text-[10px] text-purple-500">All units @ slab rate</p>}
                      </div>
                      {bp.fixedCharges > 0 && (
                        <div className="flex-1 min-w-[100px] rounded-xl bg-gray-50 px-3 py-2">
                          <p className="text-[10px] text-gray-400 uppercase font-semibold">Fixed charges</p>
                          <p className="font-bold text-gray-800">₹{formatInr(bp.fixedCharges)}</p>
                        </div>
                      )}
                      {fuel > 0 && (
                        <div className="flex-1 min-w-[100px] rounded-xl bg-gray-50 px-3 py-2">
                          <p className="text-[10px] text-gray-400 uppercase font-semibold">Fuel surcharge</p>
                          <p className="font-bold text-gray-800">₹{formatInr(fuel)}</p>
                        </div>
                      )}
                      {tax > 0 && (
                        <div className="flex-1 min-w-[100px] rounded-xl bg-gray-50 px-3 py-2">
                          <p className="text-[10px] text-gray-400 uppercase font-semibold">Tax</p>
                          <p className="font-bold text-gray-800">₹{formatInr(tax)}</p>
                        </div>
                      )}
                      <div className="flex-1 min-w-[100px] rounded-xl bg-blue-50 border border-blue-100 px-3 py-2">
                        <p className="text-[10px] text-blue-500 uppercase font-semibold">Total bill</p>
                        <p className="font-bold text-blue-700 text-lg">₹{formatInr(total)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>)}

        {/* ══ MONTHLY SUMMARY SECTION ══ */}
        {activeSection === "monthly" && (<>
          {monthlySummary.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center text-sm text-gray-400">
              No data yet. Add readings to see monthly summaries.
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left   text-[11px] font-semibold uppercase tracking-wide text-gray-400">Month</th>
                      <th className="px-4 py-3 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Units (KWH)</th>
                      <th className="px-4 py-3 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Avg/day</th>
                      {!config.useSlabRates && hasCostData && <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">Cost (₹)</th>}
                      <th className="px-4 py-3 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Readings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySummary.map((row, i) => (
                      <tr key={row.key} className={`border-b border-gray-50 last:border-0 ${i === 0 ? "bg-blue-50/30" : "hover:bg-gray-50/60"}`}>
                        <td className="px-4 py-3 font-semibold text-gray-700">{row.label}{i === 0 && <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 rounded px-1 py-0.5 font-semibold">Current</span>}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 font-medium">{row.units.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">{row.avgPerDay > 0 ? row.avgPerDay.toFixed(2) : "—"}</td>
                        {!config.useSlabRates && hasCostData && <td className="px-4 py-3 text-right tabular-nums text-gray-700">₹{formatInr(row.cost)}</td>}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-400">{row.readings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>)}
        {/* ══ SIMULATOR SECTION ══ */}
        {activeSection === "simulator" && (
          <SimulatorSection
            currentSlabs={config.slabRates ?? DEFAULT_SLAB_RATES}
            fixedCharges={fixedCharges}
            avgMonthlyUnits={avgUnitsPerDay != null ? +(avgUnitsPerDay * 30).toFixed(1) : null}
          />
        )}
      </div>

      {/* ══ READING MODAL ══ */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className={`flex items-center justify-between px-5 py-4 ${formMode === "edit" ? "bg-amber-50 border-b border-amber-200" : "bg-gray-50 border-b border-gray-200"}`}>
              <h2 className="text-sm font-semibold text-gray-800">
                {formMode === "edit" ? `✏️ Edit Reading — ${activeMeta.label}` : `${activeMeta.icon} Add Reading — ${activeMeta.label}`}
              </h2>
              <button onClick={resetForm} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors">✕</button>
            </div>
            <form ref={formRef} onSubmit={handleSave} className="p-5 flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="flex flex-col gap-1 w-36">
                  <label className="text-xs font-medium text-gray-500">Time of reading</label>
                  <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} required className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Meter reading (KWH)</label>
                  <input type="number" value={readingVal} onChange={(e) => setReadingVal(e.target.value)} placeholder="e.g. 5120.5" min="0" step="any" required className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                {!config.useSlabRates && (
                  <div className="flex flex-col gap-1 w-36">
                    <label className="text-xs font-medium text-gray-500">₹ per unit</label>
                    <input type="number" value={rateVal} onChange={(e) => setRateVal(e.target.value)} placeholder={config.pricePerUnit > 0 ? String(config.pricePerUnit) : "e.g. 6.5"} min="0" step="any" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    {!rateVal && config.pricePerUnit > 0 && <p className="text-[10px] text-gray-400">Defaults to ₹{config.pricePerUnit}</p>}
                  </div>
                )}
              </div>
              {config.useSlabRates && (
                <div className="flex items-center gap-2 rounded-xl bg-purple-50 border border-purple-100 px-3 py-2">
                  <span className="text-purple-500 text-sm">⚡</span>
                  <p className="text-xs text-purple-700">Slab rates active — total period units pick one slab; all units are billed at that rate.</p>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Note (optional)</label>
                <input type="text" value={noteVal} onChange={(e) => setNoteVal(e.target.value)} placeholder="e.g. AC running all day" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-gray-400">Same date is fine — entries are independent.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={resetForm} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={saving} className={`rounded-xl px-5 py-2 text-sm font-semibold text-white shadow active:scale-95 disabled:opacity-50 ${formMode === "edit" ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"}`}>
                    {saving ? "Saving…" : formMode === "edit" ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ BILLING PERIOD MODAL ══ */}
      {bpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-800">🧾 {bpEditId ? "Edit" : "Add"} Billing Period</h2>
              <button onClick={resetBpForm} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200">✕</button>
            </div>
            <form onSubmit={handleSaveBp} className="p-5 flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Period start</label>
                  <input type="date" value={bpFrom} onChange={(e) => setBpFrom(e.target.value)} required className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Bill date (end)</label>
                  <input type="date" value={bpTo} onChange={(e) => setBpTo(e.target.value)} required className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Fixed charges (₹) — meter rent, taxes, etc.</label>
                <input type="number" value={bpFixed} onChange={(e) => setBpFixed(e.target.value)} placeholder="e.g. 150" min="0" step="0.01"
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                {fixedCharges > 0 && !bpFixed && <p className="text-[10px] text-gray-400">Your default is ₹{fixedCharges}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Note (optional)</label>
                <input type="text" value={bpNote} onChange={(e) => setBpNote(e.target.value)} placeholder="e.g. Bill received 10 Jul"
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={resetBpForm} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={bpSaving} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50">
                  {bpSaving ? "Saving…" : "Save Period"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ RATE SETTINGS MODAL ══ */}
      {rateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-800">⚡ Rate Settings — {activeMeta.label}</h2>
              <button onClick={() => setRateModalOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200">✕</button>
            </div>

            <div className="overflow-y-auto p-5 flex flex-col gap-5">
              {/* Flat vs Slab toggle */}
              <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Use slab rates</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total units choose one slab; all units charged at that rate</p>
                </div>
                <button type="button" onClick={() => setUseSlabs((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${useSlabs ? "bg-purple-600" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${useSlabs ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Slab table */}
              {useSlabs ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Slab Rates</p>
                    <button type="button" onClick={() => setSlabDraft(DEFAULT_SLAB_RATES)}
                      className="text-xs text-blue-500 hover:underline">Reset to defaults</button>
                  </div>
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-gray-400">Slab (up to units)</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-gray-400">₹/unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slabDraft.map((slab, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="px-3 py-2 text-gray-600 text-xs">
                              {i === 0 ? "0" : slabDraft[i - 1].upTo + 1}
                              {" – "}
                              {slab.upTo >= 999999 ? (
                                <span className="text-gray-400">Above {slabDraft[i - 1]?.upTo ?? 0}</span>
                              ) : (
                                <input type="number" value={slab.upTo} min={i === 0 ? 1 : slabDraft[i - 1].upTo + 1} step="1"
                                  onChange={(e) => { const v = [...slabDraft]; v[i] = { ...v[i], upTo: Number(e.target.value) }; setSlabDraft(v); }}
                                  className="w-16 rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-gray-400 text-xs">₹</span>
                                <input type="number" value={slab.rate} min="0" step="0.01"
                                  onChange={(e) => { const v = [...slabDraft]; v[i] = { ...v[i], rate: Number(e.target.value) }; setSlabDraft(v); }}
                                  className="w-16 rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">Last slab always covers everything above its start. Edit the "up to" limits for each row.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">Flat rate (₹/unit)</label>
                  <input ref={priceInputRef} type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="e.g. 6.5" min="0" step="0.01"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              )}

              {/* Fixed charges / tax / fuel */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Default fixed charges for {activeMeta.label} (₹)</label>
                <input type="number" value={fixedInput} onChange={(e) => setFixedInput(e.target.value)}
                  placeholder="e.g. 150 (meter rent)" min="0" step="0.01"
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Tax / duty (%)</label>
                  <input type="number" value={taxInput} onChange={(e) => setTaxInput(e.target.value)}
                    placeholder="e.g. 5" min="0" step="0.01"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Fuel surcharge (₹/unit)</label>
                  <input type="number" value={fuelInput} onChange={(e) => setFuelInput(e.target.value)}
                    placeholder="e.g. 0.50" min="0" step="0.01"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <p className="text-[10px] text-gray-400 -mt-2">Bill = energy + fuel + fixed, then tax % on that subtotal.</p>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setRateModalOpen(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSavePrice} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700">Save Settings</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ DELETE READING CONFIRM ══ */}
      {deleteReadingId && deleteReadingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">Delete reading?</p>
            <p className="mt-1 text-xs text-gray-500">{formatDate(deleteReadingRow.dateISO)} · {formatTime(deleteReadingRow.readingTime)} · {deleteReadingRow.reading.toLocaleString("en-IN")} KWH</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setDeleteReadingId(null)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleDeleteReading} className="rounded-xl bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ DELETE BILLING PERIOD CONFIRM ══ */}
      {deleteBpId && deleteBpRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">Delete billing period?</p>
            <p className="mt-1 text-xs text-gray-500">{formatDate(deleteBpRow.fromDate)} → {formatDate(deleteBpRow.toDate)}</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setDeleteBpId(null)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleDeleteBp} className="rounded-xl bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ METRIC FORMULA DETAIL ══ */}
      {metricDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3" onClick={() => setMetricDetail(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800">{metricDetail.title}</p>
            <p className="mt-3 text-2xl font-bold text-blue-700">
              {metricDetail.detail.value == null ? "—" : String(metricDetail.detail.value)}
              {metricDetail.detail.unit ? ` ${metricDetail.detail.unit}` : ""}
            </p>
            <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Formula</p>
              <p className="text-xs text-gray-700 font-mono">{metricDetail.detail.formula}</p>
            </div>
            <p className="mt-3 text-xs text-gray-500 leading-relaxed">{metricDetail.detail.details}</p>
            <button type="button" onClick={() => setMetricDetail(null)}
              className="mt-4 w-full rounded-xl bg-gray-900 py-2 text-sm font-semibold text-white">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
