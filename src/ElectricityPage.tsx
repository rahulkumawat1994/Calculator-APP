import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  Bar, BarChart, CartesianGrid, Cell,
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

// ─── Slab cost calculation ────────────────────────────────────────────────────

interface SlabLineItem { label: string; units: number; rate: number; cost: number }

function calcSlabCost(totalUnits: number, slabs: ElectricitySlabRate[]): { total: number; lines: SlabLineItem[] } {
  let remaining = Math.max(0, totalUnits);
  let prevLimit = 0;
  let total     = 0;
  const lines: SlabLineItem[] = [];

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const ceiling   = slab.upTo >= 999999 ? Infinity : slab.upTo;
    const slabWidth = ceiling === Infinity ? remaining : Math.min(remaining, slab.upTo - prevLimit);
    if (slabWidth <= 0) { prevLimit = slab.upTo; continue; }
    const cost = +(slabWidth * slab.rate).toFixed(2);
    const fromUnit = prevLimit + 1;
    const toUnit   = ceiling === Infinity ? Math.round(prevLimit + slabWidth) : slab.upTo;
    lines.push({
      label: ceiling === Infinity ? `${fromUnit}+ units` : `${fromUnit}–${toUnit} units`,
      units: +slabWidth.toFixed(3),
      rate:  slab.rate,
      cost,
    });
    total     += cost;
    remaining -= slabWidth;
    prevLimit  = slab.upTo;
  }
  return { total: +total.toFixed(2), lines };
}

// ─── Row with computed diff ───────────────────────────────────────────────────

interface DayRow extends ElectricityReading {
  units: number | null;
  cost:  number | null;
}

function buildRows(readings: ElectricityReading[]): DayRow[] {
  const sorted = [...readings].sort((a, b) => a.readingTime - b.readingTime);
  return sorted.map((r, i) => {
    const prev  = sorted[i - 1];
    const units = prev != null ? +(r.reading - prev.reading).toFixed(3) : null;
    const cost  = units != null && r.pricePerUnit > 0 ? +(units * r.pricePerUnit).toFixed(2) : null;
    return { ...r, units, cost };
  });
}

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

// ─── Monthly summary ──────────────────────────────────────────────────────────

interface MonthSummary { key: string; label: string; units: number; cost: number; days: number; readings: number }

function buildMonthlySummary(rows: DayRow[]): MonthSummary[] {
  const map = new Map<string, MonthSummary>();
  for (const r of rows) {
    if (r.units == null) continue;
    const [y, m] = r.dateISO.split("-");
    const key    = `${y}-${m}`;
    const label  = `${MONTH_SHORT[Number(m) - 1]} ${y}`;
    const prev   = map.get(key) ?? { key, label, units: 0, cost: 0, days: 0, readings: 0 };
    map.set(key, {
      ...prev,
      units:    +(prev.units + r.units).toFixed(3),
      cost:     +(prev.cost  + (r.cost ?? 0)).toFixed(2),
      readings: prev.readings + 1,
    });
  }
  // Count distinct days per month
  const dayMap = new Map<string, Set<string>>();
  for (const r of rows) {
    const [y, m] = r.dateISO.split("-");
    const key = `${y}-${m}`;
    if (!dayMap.has(key)) dayMap.set(key, new Set());
    dayMap.get(key)!.add(r.dateISO);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, v]) => ({ ...v, days: dayMap.get(key)?.size ?? 0 }));
}

// ─── Chart ────────────────────────────────────────────────────────────────────

type ChartView = "daily" | "weekly" | "monthly";
interface ChartPoint { label: string; units: number; cost: number }

function buildChartData(rows: DayRow[], view: ChartView): ChartPoint[] {
  const map = new Map<string, { units: number; cost: number }>();
  for (const r of rows) {
    if (r.units == null) continue;
    let key: string;
    if (view === "daily") {
      const [, m, d] = r.dateISO.split("-");
      key = `${Number(d)} ${MONTH_SHORT[Number(m) - 1]}`;
    } else if (view === "weekly") {
      const d    = new Date(r.readingTime);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const wk   = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
      key = `W${wk} '${String(d.getFullYear()).slice(2)}`;
    } else {
      const [y, m] = r.dateISO.split("-");
      key = `${MONTH_SHORT[Number(m) - 1]} '${y.slice(2)}`;
    }
    const prev = map.get(key) ?? { units: 0, cost: 0 };
    map.set(key, { units: +(prev.units + r.units).toFixed(3), cost: +(prev.cost + (r.cost ?? 0)).toFixed(2) });
  }
  return [...map.entries()].map(([label, v]) => ({ label, units: v.units, cost: v.cost }));
}

const CHART_VIEWS: { id: ChartView; label: string }[] = [
  { id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" },
];

function ChartSection({ rows, useSlabRates }: { rows: DayRow[]; useSlabRates: boolean }) {
  const [view,   setView]   = useState<ChartView>("daily");
  const [metric, setMetric] = useState<"units" | "cost">("units");
  const hasCost  = !useSlabRates && rows.some((r) => r.pricePerUnit > 0);
  const activeMetric = metric === "cost" && !hasCost ? "units" : metric;
  const data     = buildChartData(rows, view);
  const maxVal   = data.length ? Math.max(...data.map((d) => d[activeMetric])) : 0;
  const barColor = activeMetric === "units" ? "#3b82f6" : "#10b981";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">📊 Usage Chart</h2>
        <div className="flex gap-1.5">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setMetric("units")} className={`px-2.5 py-1 ${metric === "units" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>KWH</button>
            {hasCost && <button onClick={() => setMetric("cost")} className={`px-2.5 py-1 border-l border-gray-200 ${metric === "cost" ? "bg-emerald-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>₹ Cost</button>}
          </div>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
            {CHART_VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)} className={`px-2.5 py-1 border-l border-gray-200 first:border-l-0 ${view === v.id ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="h-36 flex items-center justify-center text-sm text-gray-400">Add at least 2 readings to see a chart.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => activeMetric === "cost" ? `₹${v}` : `${v}`} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const val = payload[0].value as number;
              return (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
                  <p className="font-semibold text-gray-700 mb-1">{label}</p>
                  <p className="text-gray-600">{activeMetric === "units" ? `${val.toFixed(2)} KWH` : `₹${val.toFixed(2)}`}</p>
                </div>
              );
            }} />
            <Bar dataKey={activeMetric} radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry[activeMetric] === maxVal ? (activeMetric === "units" ? "#1d4ed8" : "#059669") : barColor} fillOpacity={0.85} />
              ))}
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
        <p className="text-xs text-gray-400 mb-3">Enter total units consumed to see exactly how the slab rates apply and what your bill will be.</p>
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

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`flex-1 min-w-[130px] rounded-2xl border px-4 py-3 shadow-sm ${highlight ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold leading-tight ${highlight ? "text-blue-700" : "text-gray-800"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
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
  const [config,          setConfig]          = useState<ElectricityConfig>({ pricePerUnit: 0, useSlabRates: false, slabRates: DEFAULT_SLAB_RATES, fixedChargesMain: 0, fixedChargesBasement: 0 });
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

  const totalUnits  = allRows.reduce((s, r) => s + (r.units ?? 0), 0);
  const totalCost   = allRows.reduce((s, r) => s + (r.cost  ?? 0), 0);
  const hasCostData = allRows.some((r) => r.cost != null);

  // Daily average (based on all readings with unit diffs)
  const rowsWithUnits = allRows.filter((r) => r.units != null && r.units >= 0);
  const avgUnitsPerDay = rowsWithUnits.length > 0 && meterReadings.length >= 2
    ? rowsWithUnits.reduce((s, r) => s + (r.units ?? 0), 0) /
      Math.max(1, daysBetween(meterReadings[0].dateISO, meterReadings[meterReadings.length - 1].dateISO))
    : null;

  const fixedCharges = activeMeter === "main" ? config.fixedChargesMain : config.fixedChargesBasement;
  const latestRate   = [...meterReadings].reverse().find((r) => r.pricePerUnit > 0)?.pricePerUnit ?? config.pricePerUnit;

  // Billing-period-aware projection
  const today           = todayISO();
  const lastPeriod      = billingPeriods[0]; // newest first
  const periodStartDate = lastPeriod ? lastPeriod.toDate : (meterReadings[0]?.dateISO ?? today);
  const daysElapsed     = daysBetween(periodStartDate, today);

  // Avg billing period length from past periods (fallback: 30 days)
  const avgPeriodDays = billingPeriods.length >= 2
    ? Math.round(billingPeriods.reduce((s, p) => s + daysBetween(p.fromDate, p.toDate), 0) / billingPeriods.length)
    : 30;
  const daysLeft      = Math.max(0, avgPeriodDays - daysElapsed);

  // Units consumed in current period (since last bill)
  const currentPeriodRows  = allRows.filter((r) => r.dateISO > periodStartDate);
  const currentPeriodUnits = currentPeriodRows.reduce((s, r) => s + (r.units ?? 0), 0);
  const projectedTotalUnits = currentPeriodUnits + (avgUnitsPerDay ?? 0) * daysLeft;

  // Projected cost — slab or flat
  const projectedCost = avgUnitsPerDay != null
    ? config.useSlabRates
      ? calcSlabCost(projectedTotalUnits, config.slabRates ?? DEFAULT_SLAB_RATES).total + fixedCharges
      : latestRate > 0
        ? +(avgUnitsPerDay * daysLeft * latestRate + fixedCharges).toFixed(2)
        : null
    : null;

  // Daily totals map (used for peak/best day)
  const dailyTotalsMap = new Map<string, number>();
  for (const r of allRows) {
    if (r.units == null) continue;
    dailyTotalsMap.set(r.dateISO, (dailyTotalsMap.get(r.dateISO) ?? 0) + r.units);
  }
  const dailyEntries = [...dailyTotalsMap.entries()];

  // Peak day — highest DAILY total (not single reading)
  const peakDayEntry  = dailyEntries.length > 0 ? dailyEntries.reduce((a, b) => b[1] > a[1] ? b : a) : null;
  // Best day — lowest DAILY total
  const bestDayEntry  = dailyEntries.length > 0 ? dailyEntries.reduce((a, b) => b[1] < a[1] ? b : a) : null;

  // Today's usage so far
  const todayUnits = dailyTotalsMap.get(today) ?? null;
  // Trend: compare today-so-far with the same elapsed hours yesterday
  const yesterdayISO = (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]!; })();
  const yesterdayUnits = dailyTotalsMap.get(yesterdayISO) ?? null;
  const trendDiff = todayUnits != null && yesterdayUnits != null ? +(todayUnits - yesterdayUnits).toFixed(2) : null;

  // Overnight base load: units from last reading of day N to first reading of day N+1
  const overnightUnits: number[] = [];
  const dates = [...new Set(allRows.map((r) => r.dateISO))].sort();
  for (let i = 0; i + 1 < dates.length; i++) {
    const lastOfDay  = [...allRows].reverse().find((r) => r.dateISO === dates[i]);
    const firstOfNext = allRows.find((r) => r.dateISO === dates[i + 1]);
    if (lastOfDay && firstOfNext && firstOfNext.units != null) {
      overnightUnits.push(firstOfNext.units);
    }
  }
  const avgOvernightLoad = overnightUnits.length > 0 ? +(overnightUnits.reduce((a, b) => a + b, 0) / overnightUnits.length).toFixed(2) : null;

  const monthlySummary = buildMonthlySummary(allRows);
  const firstReading   = meterReadings[0]?.reading;
  const lastReading    = meterReadings[meterReadings.length - 1]?.reading;
  const activeMeta     = METERS.find((m) => m.id === activeMeter)!;

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
    setUseSlabs(config.useSlabRates);
    setSlabDraft(config.slabRates?.length ? config.slabRates : DEFAULT_SLAB_RATES);
    setRateModalOpen(true);
  }

  async function handleSavePrice() {
    const num   = parseFloat(priceInput);
    const fixed = parseFloat(fixedInput);
    if (!useSlabs && (isNaN(num) || num < 0)) { toast.error("Enter a valid flat rate."); return; }
    try {
      const newCfg: ElectricityConfig = {
        ...config,
        pricePerUnit:         !isNaN(num) && num >= 0 ? num : config.pricePerUnit,
        useSlabRates:         useSlabs,
        slabRates:            slabDraft,
        fixedChargesMain:     activeMeter === "main"     ? (!isNaN(fixed) && fixed >= 0 ? fixed : config.fixedChargesMain)     : config.fixedChargesMain,
        fixedChargesBasement: activeMeter === "basement" ? (!isNaN(fixed) && fixed >= 0 ? fixed : config.fixedChargesBasement) : config.fixedChargesBasement,
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
                ? <span className="text-sm font-semibold text-purple-600">Tiered ⚡</span>
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

        {/* ── Summary cards ── */}
        {meterReadings.length >= 2 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <StatCard label="Total units" value={`${totalUnits.toFixed(2)} KWH`}
              sub={firstReading != null && lastReading != null ? `${firstReading.toLocaleString("en-IN")} → ${lastReading.toLocaleString("en-IN")}` : undefined} />
            {!config.useSlabRates && hasCostData && <StatCard label="Total cost" value={`₹${formatInr(totalCost)}`} sub="based on rate at each reading" />}
            {avgUnitsPerDay != null && <StatCard label="Avg / day" value={`${avgUnitsPerDay.toFixed(2)} KWH`} sub={`over ${daysBetween(meterReadings[0].dateISO, meterReadings[meterReadings.length-1].dateISO)} days`} />}
            {projectedCost != null && (
              <StatCard
                label="Projected bill"
                value={`₹${formatInr(projectedCost)}`}
                sub={lastPeriod
                  ? `${daysElapsed}d since last bill · ${daysLeft}d left (est.)`
                  : `${daysLeft} days left (est.)`}
                highlight
              />
            )}
            {peakDayEntry && <StatCard label="Peak day" value={`${peakDayEntry[1].toFixed(2)} KWH`} sub={formatDate(peakDayEntry[0])} />}
            {bestDayEntry && dailyEntries.length >= 2 && <StatCard label="Best day" value={`${bestDayEntry[1].toFixed(2)} KWH`} sub={formatDate(bestDayEntry[0])} />}
            {trendDiff != null && (
              <StatCard
                label="Today vs yesterday"
                value={`${trendDiff > 0 ? "+" : ""}${trendDiff.toFixed(2)} KWH`}
                sub={trendDiff > 0 ? "using more than yesterday" : trendDiff < 0 ? "using less than yesterday" : "same as yesterday"}
              />
            )}
            {avgOvernightLoad != null && (
              <StatCard label="Avg night load" value={`${avgOvernightLoad.toFixed(2)} KWH`} sub="overnight (last eve → first morn)" />
            )}
          </div>
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
          {allRows.length >= 2 && <ChartSection rows={allRows} useSlabRates={config.useSlabRates} />}

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
                            {row.units != null ? <span className={`font-medium ${row.units < 0 ? "text-red-500" : peakDayEntry && row.dateISO === peakDayEntry[0] ? "text-orange-500 font-bold" : "text-gray-700"}`}>{row.units.toFixed(2)}</span> : <span className="text-gray-300">—</span>}
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

                // Cost calculation: slab or flat
                const slabResult = config.useSlabRates
                  ? calcSlabCost(pUnits, config.slabRates ?? DEFAULT_SLAB_RATES)
                  : null;
                const pCost = slabResult ? slabResult.total : periodRows.reduce((s, r) => s + (r.cost ?? 0), 0);
                const total = +(pCost + bp.fixedCharges).toFixed(2);

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
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-600">⚡ Tiered Rate Breakdown</p>
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
                        <p className="font-bold text-gray-800">₹{formatInr(pCost)}</p>
                        {config.useSlabRates && <p className="text-[10px] text-purple-500">Tiered rates</p>}
                      </div>
                      {bp.fixedCharges > 0 && (
                        <div className="flex-1 min-w-[100px] rounded-xl bg-gray-50 px-3 py-2">
                          <p className="text-[10px] text-gray-400 uppercase font-semibold">Fixed charges</p>
                          <p className="font-bold text-gray-800">₹{formatInr(bp.fixedCharges)}</p>
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
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">{row.days > 0 ? (row.units / row.days).toFixed(2) : "—"}</td>
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
                  <p className="text-xs text-purple-700">Tiered rates active — cost is calculated per billing period, not per reading.</p>
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
                  <p className="text-sm font-semibold text-gray-700">Use tiered / slab rates</p>
                  <p className="text-xs text-gray-400 mt-0.5">Rate changes based on total units consumed</p>
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

              {/* Fixed charges */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Default fixed charges for {activeMeta.label} (₹)</label>
                <input type="number" value={fixedInput} onChange={(e) => setFixedInput(e.target.value)}
                  placeholder="e.g. 150 (meter rent + taxes)" min="0" step="0.01"
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <p className="text-[10px] text-gray-400">Added to billing period totals by default. You can override per period.</p>
              </div>
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
    </div>
  );
}
