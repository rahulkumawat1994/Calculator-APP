import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  calcBillingPeriodUsage,
  billUnitsFromMeterReading,
  computeMeterAnalytics,
  estimateBill,
  formatElapsed,
  type DayUsage,
  type MetricDetail,
  type ReadingRow,
  type TrendPoint,
  type BillEstimate,
} from "./lib/electricityCalc";
import { BreakdownEditIcon, BreakdownDeleteIcon, BreakdownChevronIcon } from "./calculator/breakdownIcons";
import {
  BasementMeterIcon,
  BillingIcon,
  CalendarMonthIcon,
  ChartIcon,
  CloseIcon,
  DuplicateIcon,
  DownloadIcon,
  ElecBoltIcon,
  InsightIcon,
  MainMeterIcon,
  ModalTitle,
  OverviewIcon,
  PlusIcon,
  SimulatorIcon,
  TrendDownIcon,
  TrendUpIcon,
  CompareIcon,
} from "./electricity/electricityIcons";
import {
  MeterBillHero,
  MeterChip,
  MeterChipScroller,
  MeterDialPair,
  MeterExpandSection,
  MeterBottomBar,
  MeterModal,
  MeterConfirmDialog,
  MeterPrimaryButton,
  MeterSecondaryButton,
  MeterSectionHeading,
  MeterStatCard,
  MeterStatGrid,
  MeterSurface,
  meterCaption,
  meterLabel,
  type MeterHeroDetail,
  ReadingMobileCard,
  usePressableCard,
  useStickyCompact,
  MeterScrollHeader,
  MeterRateChip,
} from "./electricity/meterUi";

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

type DayRow = ReadingRow;

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(rows: DayRow[], meterLabel: string) {
  const headers = ["Date","Time","Meter Reading (KWH)","Units Used","Duration","Avg kW","Rate (₹/unit)","Cost (₹)","Entered At","Note"];
  const lines = rows.map((r) => [
    r.dateISO,
    formatTime(r.readingTime),
    r.reading,
    r.units ?? "",
    r.elapsedHours != null ? formatElapsed(r.elapsedHours) : "",
    r.avgKw ?? "",
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
    <MeterSurface className="p-4 mb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            <ChartIcon className="h-5 w-5 text-gray-500" />
            Usage charts
          </h2>
          {trendPct != null && view !== "heatmap" && view !== "rolling7" && view !== "rolling30" && view !== "running" && (
            <p className={`inline-flex items-center gap-1 text-sm mt-1 ${trendPct >= 0 ? "text-red-500" : "text-emerald-600"}`}>
              {trendPct >= 0 ? <TrendUpIcon /> : <TrendDownIcon />}
              {Math.abs(trendPct)}% vs previous period
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {hasCost && (
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-medium">
              <button type="button" onClick={() => setMetric("units")} className={`px-4 py-2 min-h-[40px] ${metric === "units" ? "bg-blue-600 text-white" : "bg-white text-gray-600"}`}>KWH</button>
              <button type="button" onClick={() => setMetric("cost")} className={`px-4 py-2 min-h-[40px] border-l border-gray-200 ${metric === "cost" ? "bg-emerald-600 text-white" : "bg-white text-gray-600"}`}>₹ Cost</button>
            </div>
          )}
          <MeterChipScroller>
            {CHART_VIEWS.map((v) => (
              <MeterChip key={v.id} active={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </MeterChip>
            ))}
          </MeterChipScroller>
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
        <div className="h-36 flex items-center justify-center text-sm text-gray-500">Add at least 2 readings to see a chart.</div>
      ) : isLine ? (
        <ResponsiveContainer width="100%" height={168}>
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
        <ResponsiveContainer width="100%" height={168}>
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
    </MeterSurface>
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
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
          <SimulatorIcon className="h-4 w-4 text-gray-500" />
          Bill Simulator
        </h2>
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
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <CompareIcon className="h-4 w-4 text-gray-500" />
              Compare with a different slab scenario
            </h3>
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

// ─── Analysis components ──────────────────────────────────────────────────────

function BillHeroTile({
  label,
  bill,
  units,
  unitsLabel,
  soFar,
  avgHourly,
  avgHourlyNote,
  daysSinceBill,
  daysUntilNext,
  onShowFormula,
  tone = "blue",
}: {
  label: string;
  bill: BillEstimate;
  units: number;
  unitsLabel?: string;
  soFar?: { units: number; bill: BillEstimate };
  avgHourly?: number | null;
  avgHourlyNote?: string;
  daysSinceBill?: number | null;
  daysUntilNext?: number | null;
  onShowFormula?: () => void;
  tone?: "blue" | "violet";
}) {
  const slab = bill.slab;
  const slabRate = slab?.currentSlabRate;
  const details: MeterHeroDetail[] = [];

  if (soFar) {
    details.push({
      label: "This cycle so far",
      value: `${soFar.units.toFixed(1)} KWH`,
      sub: `₹${formatInr(soFar.bill.total)}`,
    });
  }
  if (daysSinceBill != null) {
    details.push({
      label: "Billing cycle",
      value: `${daysSinceBill}d since bill`,
      sub: daysUntilNext != null ? `~${daysUntilNext}d until next bill` : undefined,
    });
  }
  if (avgHourly != null) {
    details.push({
      label: "Avg pace",
      value: `${avgHourly.toFixed(3)} KWH/h`,
      sub: avgHourlyNote,
    });
  }
  if (slabRate != null) {
    details.push({
      label: "Slab rate",
      value: `₹${slabRate.toFixed(2)}/unit`,
      sub:
        slab?.unitsToNextSlab != null && slab.unitsToNextSlab > 0
          ? `${slab.unitsToNextSlab.toFixed(0)} KWH to next slab`
          : undefined,
    });
  }

  return (
    <MeterBillHero
      label={label}
      amount={`₹${formatInr(bill.total)}`}
      units={units.toFixed(1)}
      unitsLabel={unitsLabel ?? "Cycle total"}
      details={details.length ? details.slice(0, 4) : undefined}
      onTapFormula={onShowFormula}
      tone={tone}
    />
  );
}

function AnalyticsSection({
  title,
  hint,
  children,
  columns = 2,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  columns?: 2 | 3 | 4;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = (
    <MeterSectionHeading title={title} hint={collapsible && !open ? hint : collapsible ? undefined : hint} />
  );
  return (
    <div className="min-w-0">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mb-2 flex w-full min-h-[44px] items-center justify-between gap-2 text-left rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 active:bg-gray-100"
        >
          <div className="min-w-0">{heading}</div>
          <BreakdownChevronIcon className="h-5 w-5 shrink-0 text-gray-400" open={open} />
        </button>
      ) : (
        <div className="mb-2">{heading}</div>
      )}
      {open && <MeterStatGrid columns={columns}>{children}</MeterStatGrid>}
    </div>
  );
}

function ProjectionLegend() {
  return (
    <p className={`${meterCaption} space-y-1 sm:space-y-0`}>
      <span className="inline-flex items-center gap-1.5 sm:mr-3">
        <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
        <span><strong className="text-violet-600 font-medium">Next bill</strong> — billing cycle (what you pay)</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
        <span><strong className="text-gray-600 font-medium">Month forecast</strong> — calendar month only</span>
      </span>
    </p>
  );
}

function InsightList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/40 px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[44px] items-center justify-between gap-2 text-left"
      >
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
          <InsightIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          Insights ({items.length})
        </p>
        <BreakdownChevronIcon className="h-5 w-5 shrink-0 text-amber-500/60" open={open} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {items.map((t, i) => (
            <li key={i} className="text-sm text-gray-700 leading-snug flex items-start gap-2">
              <InsightIcon className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompareTile({
  label,
  value,
  unit,
  meta,
  variant = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  meta?: string[];
  variant?: "neutral" | "bill" | "calc";
}) {
  const shell =
    variant === "bill"
      ? "border-emerald-100/90 bg-gradient-to-br from-emerald-50/80 to-white"
      : variant === "calc"
        ? "border-blue-100/90 bg-gradient-to-br from-blue-50/60 to-white"
        : "border-gray-100 bg-white";
  const labelClass =
    variant === "bill" ? "text-emerald-600" : variant === "calc" ? "text-blue-600" : "text-gray-400";
  const valueClass =
    variant === "bill" ? "text-emerald-800" : variant === "calc" ? "text-blue-700" : "text-gray-900";
  return (
    <div className={`rounded-xl border px-3 py-3 min-w-0 ${shell}`}>
      <p className={`${meterLabel} ${labelClass}`}>{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums leading-tight sm:text-2xl ${valueClass}`}>
        {value}
        {unit && <span className="text-sm font-semibold opacity-60 ml-0.5">{unit}</span>}
      </p>
      {meta?.map((line) => (
        <p key={line} className={`${meterCaption} tabular-nums mt-1`}>{line}</p>
      ))}
    </div>
  );
}

function MatchPill({
  title,
  matchPct,
  detail,
  compact,
}: {
  title: string;
  matchPct: number;
  detail: string;
  compact?: boolean;
}) {
  const gap = +(100 - matchPct).toFixed(1);
  const tone = gap <= 2 ? "emerald" : gap <= 5 ? "amber" : "red";
  const palette = {
    emerald: {
      wrap: "border-emerald-100 bg-emerald-50/70",
      title: "text-emerald-700",
      bar: "bg-emerald-500",
      track: "bg-emerald-100",
    },
    amber: {
      wrap: "border-amber-100 bg-amber-50/70",
      title: "text-amber-800",
      bar: "bg-amber-500",
      track: "bg-amber-100",
    },
    red: {
      wrap: "border-red-100 bg-red-50/70",
      title: "text-red-800",
      bar: "bg-red-500",
      track: "bg-red-100",
    },
  }[tone];

  if (compact) {
    return (
      <p className={`mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] leading-snug ${palette.title}`}>
        <span className="font-bold tabular-nums">{matchPct}%</span>
        <span className="text-gray-400 font-medium">{title}</span>
        <span className="text-gray-500">· {detail}</span>
      </p>
    );
  }

  return (
    <div className={`rounded-lg border px-3 py-2 ${palette.wrap}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${palette.title}`}>{title}</span>
        <span className={`text-xs font-bold tabular-nums ${palette.title}`}>{matchPct}%</span>
      </div>
      <div className={`mt-1.5 h-1 rounded-full ${palette.track}`}>
        <div
          className={`h-full rounded-full transition-all ${palette.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, matchPct))}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-gray-500 leading-snug">{detail}</p>
    </div>
  );
}

function BillingPeriodCard({
  bp,
  days,
  readingCount,
  periodUsage,
  pUnits,
  billUnits,
  hasBillUsage,
  slabLine,
  slabEnergy,
  total,
  energy,
  fixedCharges,
  fuel,
  tax,
  onEdit,
  onDelete,
  isEditing,
}: {
  bp: ElectricityBillingPeriod;
  days: number;
  readingCount: number;
  periodUsage: ReturnType<typeof calcBillingPeriodUsage>;
  pUnits: number;
  billUnits: number | null;
  hasBillUsage: boolean;
  slabLine: string | null;
  slabEnergy: number;
  total: number;
  energy: number;
  fixedCharges: number;
  fuel: number;
  tax: number;
  isEditing?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pressable = usePressableCard(onEdit, onDelete);
  const hasBillAmount = bp.actualBillTotal != null && bp.actualBillTotal > 0;
  const usageMeta: string[] = [];
  if (periodUsage.startReading != null && periodUsage.endReading != null) {
    usageMeta.push(
      `${periodUsage.startReading.toLocaleString("en-IN")} → ${periodUsage.endReading.toLocaleString("en-IN")}`,
    );
  }
  if (periodUsage.lastReadingTimeMs != null) {
    usageMeta.push(
      `Logged ${formatDate(periodUsage.lastReadingDateISO!)} ${formatTime(periodUsage.lastReadingTimeMs)}`,
    );
  }
  const billMeta: string[] = [];
  if (bp.billMeterReading != null && periodUsage.startReading != null) {
    billMeta.push(
      `${periodUsage.startReading.toLocaleString("en-IN")} → ${bp.billMeterReading.toLocaleString("en-IN")}`,
    );
  }

  let usageMatch: { pct: number; detail: string } | null = null;
  if (hasBillUsage && billUnits != null) {
    const diff = billUnits - pUnits;
    const errorPct = +(Math.abs(diff) / billUnits * 100).toFixed(1);
    usageMatch = {
      pct: +(100 - errorPct).toFixed(1),
      detail:
        diff === 0
          ? "Readings match bill meter"
          : diff > 0
            ? `Bill charged ${diff.toFixed(1)} KWH more`
            : `Readings ${(-diff).toFixed(1)} KWH above bill`,
    };
  }

  let amountMatch: { pct: number; detail: string } | null = null;
  if (hasBillAmount) {
    const diff = bp.actualBillTotal! - total;
    const errorPct = +(Math.abs(diff) / bp.actualBillTotal! * 100).toFixed(1);
    amountMatch = {
      pct: +(100 - errorPct).toFixed(1),
      detail:
        diff === 0
          ? "Amount matches calculation"
          : diff > 0
            ? `You paid ₹${formatInr(diff)} less than calculated`
            : `Calculated ₹${formatInr(-diff)} above bill`,
    };
  }

  const amountBreakdown: string[] = [];
  if (fixedCharges > 0 || fuel > 0 || tax > 0) {
    amountBreakdown.push(
      `Energy ₹${formatInr(energy)}` +
        (fixedCharges > 0 ? ` · Fixed ₹${formatInr(fixedCharges)}` : "") +
        (fuel > 0 ? ` · Fuel ₹${formatInr(fuel)}` : "") +
        (tax > 0 ? ` · Tax ₹${formatInr(tax)}` : ""),
    );
  }

  return (
    <article
      {...pressable}
      className={`rounded-2xl border bg-white shadow-sm overflow-hidden select-none cursor-pointer transition-transform active:scale-[0.98] ${
        isEditing ? "border-amber-300 ring-2 ring-amber-200/80" : "border-gray-200/90"
      }`}
    >
      <header className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50/80 to-white">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm tracking-tight">
            {formatDate(bp.fromDate)} → {formatDate(bp.toDate)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{days} days</span>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{readingCount} readings</span>
            {slabLine && (
              <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600 tabular-nums">
                {slabLine} · ₹{formatInr(slabEnergy)}
              </span>
            )}
          </div>
          {isEditing && (
            <span className="mt-1.5 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
              Editing
            </span>
          )}
          {bp.note && <p className="mt-1.5 text-sm text-gray-500 italic leading-snug">{bp.note}</p>}
        </div>
      </header>

      <div className="p-3 space-y-3">
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Usage (KWH)</p>
          <div className={`grid gap-2 ${hasBillUsage ? "grid-cols-2" : "grid-cols-1"}`}>
            <CompareTile
              label="Readings"
              value={pUnits.toFixed(1)}
              unit="KWH"
              meta={usageMeta.length ? usageMeta : undefined}
              variant="neutral"
            />
            {hasBillUsage && billUnits != null && (
              <CompareTile
                label="Bill meter"
                value={billUnits.toFixed(1)}
                unit="KWH"
                meta={billMeta.length ? billMeta : undefined}
                variant="bill"
              />
            )}
          </div>
          {usageMatch && (
            <MatchPill title="usage" matchPct={usageMatch.pct} detail={usageMatch.detail} compact />
          )}
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Amount (₹)</p>
          <div className={`grid gap-2 ${hasBillAmount ? "grid-cols-2" : "grid-cols-1"}`}>
            <CompareTile
              label="Calculated"
              value={`₹${formatInr(total)}`}
              meta={amountBreakdown.length ? amountBreakdown : undefined}
              variant="calc"
            />
            {hasBillAmount && (
              <CompareTile label="You paid" value={`₹${formatInr(bp.actualBillTotal!)}`} variant="bill" />
            )}
          </div>
          {amountMatch && (
            <MatchPill title="bill" matchPct={amountMatch.pct} detail={amountMatch.detail} compact />
          )}
        </section>

        {!hasBillUsage && !hasBillAmount && (
          <p className="text-[11px] text-gray-400 leading-snug rounded-lg bg-gray-50 px-3 py-2">
            Tap{" "}
            <BreakdownEditIcon className="inline h-3.5 w-3.5 align-[-2px] text-gray-500" />
            {" "}to add <strong>meter at bill</strong> and <strong>amount paid</strong> — we’ll compare against your readings.
          </p>
        )}
        {!hasBillUsage && hasBillAmount && (
          <p className="text-[11px] text-gray-400 leading-snug">Add meter reading at bill to check KWH accuracy.</p>
        )}
        {hasBillUsage && !hasBillAmount && (
          <p className="text-[11px] text-gray-400 leading-snug">Add amount paid to check bill accuracy.</p>
        )}
      </div>
    </article>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

type FormMode = "add" | "edit";
type ActiveSection = "overview" | "billing" | "monthly" | "simulator";

const METERS: {
  id: ElectricityMeterId;
  label: string;
  shortLabel: string;
  Icon: typeof MainMeterIcon;
}[] = [
  { id: "main", label: "Main Meter", shortLabel: "Main", Icon: MainMeterIcon },
  { id: "basement", label: "Basement Meter", shortLabel: "Basement", Icon: BasementMeterIcon },
];

const SECTIONS: {
  id: ActiveSection;
  label: string;
  shortLabel: string;
  Icon: typeof OverviewIcon;
}[] = [
  { id: "overview", label: "Overview", shortLabel: "Overview", Icon: OverviewIcon },
  { id: "billing", label: "Billing", shortLabel: "Billing", Icon: BillingIcon },
  { id: "monthly", label: "Monthly", shortLabel: "Monthly", Icon: CalendarMonthIcon },
  { id: "simulator", label: "Simulator", shortLabel: "Sim", Icon: SimulatorIcon },
];

// ─── Main page ────────────────────────────────────────────────────────────────

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
  const { sentinelRef: navSentinelRef, compact: navCompact } = useStickyCompact(!loading);

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
  const [bpActual,      setBpActual]      = useState("");
  const [bpBillReading, setBpBillReading] = useState("");
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
  const periodUnits = analytics.periodUnits;
  const inBillingPeriod = analytics.lastBillDate != null;
  const avgUnitsPerDay = inBillingPeriod ? analytics.periodAvgPerDay : analytics.avgPerDay;
  const peakDayEntry: DayUsage | null = analytics.peakDay;
  const bestDayEntry: DayUsage | null = analytics.lowestDay;
  const todayUnits = analytics.todayUnits;
  const yesterdayUnits = analytics.yesterdayUnits;
  const trendDiff =
    todayUnits != null && yesterdayUnits != null ? +(todayUnits - yesterdayUnits).toFixed(2) : null;

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
  const currentCycleBill =
    inBillingPeriod && periodUnits > 0
      ? estimateBill(periodUnits, config, analytics.periodFixedCharges)
      : null;
  const projectedBill = analytics.periodProjectedBill;
  const projectedPeriodUnits = analytics.projectedPeriodUnits;
  const calendarMonthName = MONTH_SHORT[Number(todayISO().split("-")[1]) - 1];
  const daysLeftInMonth = (() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(0, lastDay - now.getDate());
  })();
  const activeMeta = METERS.find((m) => m.id === activeMeter)!;
  const ActiveMeterIcon = activeMeta.Icon;

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
  function resetBpForm() { setBpModalOpen(false); setBpEditId(null); setBpFrom(""); setBpTo(todayISO()); setBpActual(""); setBpBillReading(""); setBpNote(""); }
  function openAddBp() {
    // Auto-fill fromDate from end of last period or first reading date
    const lastPeriod = billingPeriods[0]; // newest first
    const autoFrom   = lastPeriod ? lastPeriod.toDate : (meterReadings[0]?.dateISO ?? "");
    resetBpForm(); setBpFrom(autoFrom); setBpModalOpen(true);
  }
  function startEditBp(bp: ElectricityBillingPeriod) {
    setBpEditId(bp.id); setBpFrom(bp.fromDate); setBpTo(bp.toDate);
    setBpActual(bp.actualBillTotal != null && bp.actualBillTotal > 0 ? String(bp.actualBillTotal) : "");
    setBpBillReading(
      bp.billMeterReading != null && bp.billMeterReading > 0
        ? String(bp.billMeterReading)
        : "",
    );
    setBpNote(bp.note ?? ""); setBpModalOpen(true);
  }

  async function handleSaveBp(e: React.FormEvent) {
    e.preventDefault();
    if (!bpFrom || !bpTo || bpFrom > bpTo) { toast.error("Enter a valid date range (from ≤ to)."); return; }
    setBpSaving(true);
    try {
      const actual = parseFloat(bpActual);
      const billReading = parseFloat(bpBillReading);
      const existing = bpEditId ? billingPeriods.find((p) => p.id === bpEditId) : null;
      const bp: ElectricityBillingPeriod = {
        id:           bpEditId ?? newBillingPeriodId(activeMeter),
        meterId:      activeMeter, fromDate: bpFrom, toDate: bpTo,
        fixedCharges: 0,
        createdAt:    existing?.createdAt ?? Date.now(),
        ...(bpNote.trim() ? { note: bpNote.trim() } : {}),
        ...( !isNaN(actual) && actual > 0 ? { actualBillTotal: actual } : {}),
        ...( !isNaN(billReading) && billReading > 0 ? { billMeterReading: billReading } : {}),
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
      <div className="max-w-3xl mx-auto px-4 sm:px-4 pt-5 md:pt-5 pb-24 md:pb-10">

        <MeterScrollHeader
          compact={navCompact}
          sentinelRef={navSentinelRef}
          title="Electricity"
          subtitle="Track KWH meter readings"
          titleIcon={<ElecBoltIcon className="h-5 w-5 text-amber-500 shrink-0" />}
          renderRate={(compact) => (
            <div className="shrink-0 text-right">
              <MeterRateChip
                compact={compact}
                onClick={openRateModal}
                label={config.useSlabRates ? "" : "Rate"}
                tone={
                  config.useSlabRates
                    ? "slab"
                    : config.pricePerUnit > 0
                      ? "default"
                      : "muted"
                }
              >
                {config.useSlabRates
                  ? (
                    <>
                      Slab
                      <ElecBoltIcon className={compact ? "h-3 w-3 text-purple-500" : "h-4 w-4 text-purple-500"} />
                    </>
                  )
                  : config.pricePerUnit > 0
                    ? compact
                      ? `₹${config.pricePerUnit}/u`
                      : `₹${config.pricePerUnit}/unit`
                    : "Set rate"}
              </MeterRateChip>
              {!compact && fixedCharges > 0 && (
                <span className={`mt-1 block ${meterCaption}`}>+₹{fixedCharges} fixed</span>
              )}
            </div>
          )}
          meters={METERS.map((m) => ({
            id: m.id,
            label: m.label,
            shortLabel: m.shortLabel,
            Icon: m.Icon,
            count: allReadings.filter((r) => r.meterId === m.id).length,
          }))}
          sections={SECTIONS.map((s) => ({
            id: s.id,
            label: s.label,
            shortLabel: s.shortLabel,
            Icon: s.Icon,
          }))}
          activeMeter={activeMeter}
          onMeterChange={(id) => {
            setActiveMeter(id as ElectricityMeterId);
            resetForm();
            setFilterFrom("");
            setFilterFromTime("");
            setFilterTo("");
            setFilterToTime("");
          }}
          activeSection={activeSection}
          onSectionChange={(id) => setActiveSection(id as ActiveSection)}
        />

        {/* ── Overview hero ── */}
        {activeSection === "overview" && meterReadings.length >= 2 && (
          <div className="mb-4 space-y-3">
            {(projectedBill || analytics.estimatedBill) && (
              projectedBill && projectedPeriodUnits != null ? (
                <BillHeroTile
                  label="Next bill estimate"
                  tone="violet"
                  bill={projectedBill}
                  units={projectedPeriodUnits}
                  unitsLabel="Cycle total"
                  avgHourly={analytics.periodAvgPerHour}
                  avgHourlyNote={
                    analytics.lastBillDate ? `since ${formatDate(analytics.lastBillDate)}` : undefined
                  }
                  daysSinceBill={analytics.daysSinceLastBill}
                  daysUntilNext={analytics.daysLeftInCycle}
                  soFar={
                    currentCycleBill && inBillingPeriod && periodUnits < projectedPeriodUnits - 0.05
                      ? { units: periodUnits, bill: currentCycleBill }
                      : undefined
                  }
                  onShowFormula={() => showMetric("Estimated / projected bill", "periodProjection")}
                />
              ) : (
                <BillHeroTile
                  label="Estimated bill"
                  bill={analytics.estimatedBill!}
                  units={totalUnits}
                  unitsLabel="Total usage"
                  avgHourly={analytics.avgPerHour}
                  avgHourlyNote="all readings"
                  onShowFormula={() => showMetric("Estimated / projected bill", "estimatedBill")}
                />
              )
            )}
            <MeterDialPair
              meterNow={lastReading != null ? lastReading.toLocaleString("en-IN") : "—"}
              previousLog={analytics.previousReading != null ? analytics.previousReading.toLocaleString("en-IN") : "—"}
            />
            <MeterStatGrid columns={2}>
              <MeterStatCard
                label="Today"
                value={todayUnits != null ? `${todayUnits.toFixed(1)} KWH` : "—"}
                sub={
                  trendDiff != null
                    ? trendDiff === 0
                      ? "same as yesterday"
                      : `${trendDiff > 0 ? "+" : ""}${trendDiff.toFixed(1)} vs yesterday`
                    : "prorated"
                }
                highlight
                onClick={() => showMetric("Today's usage", "today")}
              />
              <MeterStatCard
                label="This month"
                value={`${analytics.currentMonthUnits.toFixed(1)} KWH`}
                sub={
                  analytics.monthlyComparisonPct != null
                    ? `${analytics.monthlyComparisonPct >= 0 ? "+" : ""}${analytics.monthlyComparisonPct}% vs last month`
                    : `${calendarMonthName} so far`
                }
              />
            </MeterStatGrid>

            <MeterExpandSection
              title="More usage details"
              hint="Pace, range, patterns & insights"
              defaultOpen={false}
            >
              <ProjectionLegend />

              <AnalyticsSection title="Daily pace" hint="How you're using right now" columns={4}>
                <MeterStatCard
                  label="Today"
                  value={todayUnits != null ? `${todayUnits.toFixed(1)} KWH` : "—"}
                  sub={
                    trendDiff != null
                      ? trendDiff === 0
                        ? "same as yesterday"
                        : `${trendDiff > 0 ? "+" : ""}${trendDiff.toFixed(1)} vs yesterday`
                      : "prorated"
                  }
                  onClick={() => showMetric("Today's usage", "today")}
                />
                <MeterStatCard
                  label="This month"
                  value={`${analytics.currentMonthUnits.toFixed(1)} KWH`}
                  sub={
                    analytics.monthlyComparisonPct != null
                      ? `${analytics.monthlyComparisonPct >= 0 ? "+" : ""}${analytics.monthlyComparisonPct}% vs last month`
                      : `${calendarMonthName} so far`
                  }
                />
                {analytics.projectedMonthEndUnits != null && (
                  <MeterStatCard
                    label={`${calendarMonthName} forecast`}
                    value={`${analytics.projectedMonthEndUnits.toFixed(0)} KWH`}
                    sub={`calendar month · ${daysLeftInMonth}d left · not your bill`}
                    onClick={() => showMetric("Calendar month forecast", "monthProjection")}
                  />
                )}
                {analytics.last7AvgPerDay != null && (
                  <MeterStatCard label="7-day avg" value={`${analytics.last7AvgPerDay.toFixed(1)} KWH`} sub="per day" />
                )}
                {avgUnitsPerDay != null && (
                  <MeterStatCard
                    label={inBillingPeriod ? "Cycle avg" : "Daily avg"}
                    value={`${avgUnitsPerDay.toFixed(1)} KWH`}
                    sub={inBillingPeriod ? `since ${formatDate(analytics.lastBillDate!)}` : analytics.elapsedLabel}
                    onClick={() => showMetric("Average daily usage", "avgPerDay")}
                  />
                )}
                {analytics.avgPerHour != null && (
                  <MeterStatCard
                    label="Avg hourly"
                    value={`${analytics.avgPerHour.toFixed(3)} KWH`}
                    sub="per hour · all readings"
                    onClick={() => showMetric("Average hourly usage", "avgPerHour")}
                  />
                )}
              </AnalyticsSection>

              <AnalyticsSection title="Range & extremes" columns={4} collapsible defaultOpen={false}>
                <MeterStatCard
                  label="All-time"
                  value={`${totalUnits.toFixed(1)} KWH`}
                  sub={
                    firstReading != null && lastReading != null
                      ? `${firstReading.toLocaleString("en-IN")} → ${lastReading.toLocaleString("en-IN")}`
                      : undefined
                  }
                  onClick={() => showMetric("All-time units", "allTimeUnits")}
                />
                <MeterStatCard
                  label={inBillingPeriod ? "Since bill" : "Elapsed"}
                  value={inBillingPeriod ? analytics.periodElapsedLabel : analytics.elapsedLabel}
                  sub={`${(inBillingPeriod ? analytics.periodElapsedHours : analytics.elapsedHours).toFixed(0)} h`}
                  onClick={() => showMetric("Elapsed time", "elapsedTime")}
                />
                {peakDayEntry && (
                  <MeterStatCard
                    label="Peak day"
                    value={`${peakDayEntry.units.toFixed(1)} KWH`}
                    sub={formatDate(peakDayEntry.dateISO)}
                    onClick={() => showMetric("Peak day", "peakDay")}
                  />
                )}
                {bestDayEntry && analytics.days.length >= 2 && (
                  <MeterStatCard label="Lowest day" value={`${bestDayEntry.units.toFixed(1)} KWH`} sub={formatDate(bestDayEntry.dateISO)} />
                )}
              </AnalyticsSection>

              {(analytics.nightPct != null ||
                analytics.peakHour != null ||
                analytics.efficiencyScore != null ||
                analytics.medianDailyUsage != null ||
                (!config.useSlabRates && hasCostData)) && (
                <AnalyticsSection title="Patterns" columns={3} collapsible defaultOpen={false}>
                  {analytics.nightPct != null && (
                    <MeterStatCard label="Night" value={`${analytics.nightPct}%`} sub={`${analytics.nightUnits.toFixed(1)} KWH · 10pm–6am`} />
                  )}
                  {analytics.peakHour != null && (
                    <MeterStatCard
                      label="Peak hour"
                      value={`${String(analytics.peakHour).padStart(2, "0")}:00`}
                      sub={analytics.idleHour != null ? `quiet ${String(analytics.idleHour).padStart(2, "0")}:00` : undefined}
                    />
                  )}
                  {analytics.efficiencyScore != null && (
                    <MeterStatCard
                      label="Efficiency"
                      value={`${analytics.efficiencyScore}`}
                      sub="0–100"
                      onClick={() => showMetric("Efficiency score", "efficiencyScore")}
                    />
                  )}
                  {analytics.medianDailyUsage != null && (
                    <MeterStatCard label="Median day" value={`${analytics.medianDailyUsage.toFixed(1)} KWH`} sub="typical" />
                  )}
                  {!config.useSlabRates && hasCostData && (
                    <MeterStatCard label="Logged cost" value={`₹${formatInr(totalCost)}`} sub="per-reading rates" />
                  )}
                </AnalyticsSection>
              )}

              <InsightList items={analytics.insights} />
            </MeterExpandSection>
          </div>
        )}

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

          {/* Action row — desktop; mobile uses FAB */}
          <div className="hidden md:flex items-center justify-between gap-3 mb-3">
            <div className="flex gap-2">
              <MeterPrimaryButton onClick={openAddModal} icon={<PlusIcon className="h-5 w-5" />}>
                Add Reading
              </MeterPrimaryButton>
              {meterReadings.length > 0 && (
                <MeterSecondaryButton onClick={duplicateLast} icon={<DuplicateIcon className="h-5 w-5 text-gray-400" />}>
                  Duplicate last
                </MeterSecondaryButton>
              )}
            </div>
            {allRows.length > 0 && (
              <MeterSecondaryButton onClick={() => exportCSV(allRows, activeMeta.label)} icon={<DownloadIcon className="h-5 w-5" />}>
                Export CSV
              </MeterSecondaryButton>
            )}
          </div>

          {/* Filter bar */}
          {meterReadings.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-2.5 mb-2">
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

          {/* Readings — mobile cards */}
          {filteredRows.length > 0 && (
            <div className="md:hidden space-y-3 mb-4">
              {reversedRows.map((row, i) => (
                <ReadingMobileCard
                  key={row.id}
                  date={formatDate(row.dateISO)}
                  time={formatTime(row.readingTime)}
                  reading={row.reading.toLocaleString("en-IN")}
                  units={row.units != null ? row.units.toFixed(2) : null}
                  duration={row.elapsedHours != null ? formatElapsed(row.elapsedHours) : null}
                  avgKw={row.avgKw != null ? row.avgKw.toFixed(2) : null}
                  rate={!config.useSlabRates && row.pricePerUnit > 0 ? `₹${row.pricePerUnit}` : undefined}
                  cost={!config.useSlabRates && hasCostData && row.cost != null ? `₹${formatInr(row.cost)}` : undefined}
                  note={row.note}
                  isLatest={i === 0}
                  isEditing={editId === row.id}
                  showRate={!config.useSlabRates}
                  showCost={!config.useSlabRates && hasCostData}
                  onEdit={() => startEdit(row)}
                  onDelete={() => setDeleteReadingId(row.id)}
                />
              ))}
            </div>
          )}

          {/* Readings table — desktop */}
          {filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/80 p-10 text-center text-sm text-gray-500">
              {isFiltered ? "No readings match the selected range." : `No readings yet for ${activeMeta.label}.`}
            </div>
          ) : (
            <div className="hidden md:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-3 py-2.5 text-left   text-[11px] font-semibold uppercase tracking-wide text-gray-400">Date & Time</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Reading</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Units</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Duration</th>
                      <th className="px-3 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wide text-gray-400">Avg kW</th>
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
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            {row.elapsedHours != null
                              ? <span className="text-gray-600 text-xs font-medium" title={`${row.elapsedHours.toFixed(2)} hours since previous reading`}>{formatElapsed(row.elapsedHours)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            {row.avgKw != null
                              ? <span className="text-gray-600 text-xs">{row.avgKw.toFixed(2)}</span>
                              : <span className="text-gray-300">—</span>}
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
                              <button onClick={() => startEdit(row)} className="rounded-lg p-1 text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition-colors" title="Edit" aria-label="Edit reading">
                                <BreakdownEditIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => setDeleteReadingId(row.id)} className="rounded-lg p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors" title="Delete" aria-label="Delete reading">
                                <BreakdownDeleteIcon className="h-4 w-4" />
                              </button>
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
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs font-semibold text-gray-600">
                          {formatElapsed(filteredRows.reduce((s, r) => s + (r.elapsedHours ?? 0), 0))}
                        </td>
                        <td />
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <p className={`${meterCaption} sm:text-sm`}>Track each bill cycle — add a period when you receive a bill.</p>
            <MeterPrimaryButton onClick={openAddBp} icon={<PlusIcon className="h-5 w-5" />} className="hidden sm:inline-flex w-full sm:w-auto">
              Add Period
            </MeterPrimaryButton>
          </div>

          {billingPeriods.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center text-sm text-gray-400">
              No billing periods yet. Add one with bill date <strong>10 Jul 2026</strong> so “days until next bill” is correct.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {billingPeriods.map((bp) => {
                const periodUsage = calcBillingPeriodUsage(meterReadings, bp.fromDate, bp.toDate);
                const pUnits = periodUsage.units;
                const periodRows = allRows.filter((r) => r.dateISO >= bp.fromDate && r.dateISO <= bp.toDate);
                const days   = daysBetween(bp.fromDate, bp.toDate);
                const billUnits =
                  bp.billMeterReading != null
                    ? billUnitsFromMeterReading(bp.billMeterReading, periodUsage.startReading)
                    : bp.actualBillUnits ?? null;
                const hasBillUsage = billUnits != null && billUnits > 0;

                const bill = estimateBill(pUnits, config, fixedCharges);
                const slabResult = config.useSlabRates ? bill.slab : null;
                // Flat: prefer locked-in per-reading energy costs; slab/fuel/tax from bill helper.
                const energy = config.useSlabRates
                  ? bill.energyCharge
                  : periodRows.reduce((s, r) => s + (r.cost ?? 0), 0);
                const fuel = bill.fuelSurcharge;
                const subtotal = energy + fixedCharges + fuel;
                const tax = +((subtotal * ((config.taxPercent ?? 0) / 100))).toFixed(2);
                const total = +(subtotal + tax).toFixed(2);
                const slabLine =
                  slabResult?.lines[0]
                    ? `${slabResult.lines[0].units.toFixed(0)} × ₹${slabResult.lines[0].rate}`
                    : null;

                return (
                  <BillingPeriodCard
                    key={bp.id}
                    bp={bp}
                    days={days}
                    readingCount={periodRows.length}
                    periodUsage={periodUsage}
                    pUnits={pUnits}
                    billUnits={billUnits}
                    hasBillUsage={hasBillUsage}
                    slabLine={slabLine}
                    slabEnergy={energy}
                    total={total}
                    energy={energy}
                    fixedCharges={fixedCharges}
                    fuel={fuel}
                    tax={tax}
                    onEdit={() => startEditBp(bp)}
                    onDelete={() => setDeleteBpId(bp.id)}
                    isEditing={bpEditId === bp.id}
                  />
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

      {activeSection === "overview" && (
        <MeterBottomBar>
          {meterReadings.length > 0 && (
            <MeterSecondaryButton
              onClick={duplicateLast}
              icon={<DuplicateIcon className="h-5 w-5 text-gray-500" />}
              className="shrink-0"
            >
              Duplicate
            </MeterSecondaryButton>
          )}
          <MeterPrimaryButton onClick={openAddModal} icon={<PlusIcon className="h-5 w-5" />} className="flex-1">
            Add Reading
          </MeterPrimaryButton>
        </MeterBottomBar>
      )}

      {activeSection === "billing" && (
        <MeterBottomBar>
          <MeterPrimaryButton onClick={openAddBp} icon={<PlusIcon className="h-5 w-5" />} className="flex-1">
            Add Period
          </MeterPrimaryButton>
        </MeterBottomBar>
      )}

      {/* ══ READING MODAL ══ */}
      {modalOpen && (
        <MeterModal onClose={resetForm}>
            <div className={`flex items-center justify-between px-5 py-4 ${formMode === "edit" ? "bg-amber-50 border-b border-amber-200" : "bg-gray-50 border-b border-gray-200"}`}>
              <ModalTitle
                icon={
                  formMode === "edit"
                    ? <BreakdownEditIcon className="h-4 w-4 text-amber-600" />
                    : <ActiveMeterIcon className="h-4 w-4" />
                }
              >
                {formMode === "edit" ? `Edit Reading — ${activeMeta.label}` : `Add Reading — ${activeMeta.label}`}
              </ModalTitle>
              <button onClick={resetForm} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors" aria-label="Close">
                <CloseIcon className="h-4 w-4" />
              </button>
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
                  <ElecBoltIcon className="h-4 w-4 shrink-0 text-purple-500" />
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
        </MeterModal>
      )}

      {/* ══ BILLING PERIOD MODAL ══ */}
      {bpModalOpen && (
        <MeterModal onClose={resetBpForm} panelClassName="max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-200">
              <ModalTitle icon={<BillingIcon className="h-4 w-4" />}>
                {bpEditId ? "Edit" : "Add"} Billing Period
              </ModalTitle>
              <button onClick={resetBpForm} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200" aria-label="Close">
                <CloseIcon className="h-4 w-4" />
              </button>
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
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Meter at bill (KWH)</label>
                  <input type="number" value={bpBillReading} onChange={(e) => setBpBillReading(e.target.value)} placeholder="e.g. 38230" min="0" step="any"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <p className="text-[10px] text-gray-400">Dial reading when bill arrived</p>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-gray-500">Bill amount (₹)</label>
                  <input type="number" value={bpActual} onChange={(e) => setBpActual(e.target.value)} placeholder="e.g. 6281.50" min="0" step="0.01"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <p className="text-[10px] text-gray-400">
                Usage on bill = meter at bill minus start of period. May differ from calculated if your logs are on different days.
              </p>
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
        </MeterModal>
      )}

      {/* ══ RATE SETTINGS MODAL ══ */}
      {rateModalOpen && (
        <MeterModal onClose={() => setRateModalOpen(false)} panelClassName="max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <ModalTitle icon={<ElecBoltIcon className="h-4 w-4 text-amber-500" />}>
                Rate Settings — {activeMeta.label}
              </ModalTitle>
              <button onClick={() => setRateModalOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200" aria-label="Close">
                <CloseIcon className="h-4 w-4" />
              </button>
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
        </MeterModal>
      )}

      {/* ══ DELETE READING CONFIRM ══ */}
      {deleteReadingId && deleteReadingRow && (
        <MeterConfirmDialog
          onClose={() => setDeleteReadingId(null)}
          title="Delete reading?"
          detail={`${formatDate(deleteReadingRow.dateISO)} · ${formatTime(deleteReadingRow.readingTime)} · ${deleteReadingRow.reading.toLocaleString("en-IN")} KWH`}
          confirmLabel="Delete"
          onConfirm={handleDeleteReading}
          danger
        />
      )}

      {/* ══ DELETE BILLING PERIOD CONFIRM ══ */}
      {deleteBpId && deleteBpRow && (
        <MeterConfirmDialog
          onClose={() => setDeleteBpId(null)}
          title="Delete billing period?"
          detail={`${formatDate(deleteBpRow.fromDate)} → ${formatDate(deleteBpRow.toDate)}`}
          confirmLabel="Delete"
          onConfirm={handleDeleteBp}
          danger
        />
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
