import { useMemo } from "react";
import { formatMoney, formatMonthKey } from "./moneyFormat";

export type OverviewChartPoint = {
  month: string;
  income: number;
  expenses: number;
  net: number;
  loanPayments: number;
};

type MoneyOverviewChartProps = {
  points: OverviewChartPoint[];
};

const W = 860;
const H = 300;
const PAD = { top: 24, right: 16, bottom: 52, left: 58 };

function yScale(value: number, maxY: number, plotH: number): number {
  if (maxY <= 0) return PAD.top + plotH;
  return PAD.top + plotH - (value / maxY) * plotH;
}

function fmtAxis(n: number): string {
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

export function MoneyOverviewChart({ points }: MoneyOverviewChartProps) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { maxY, barW, gap, netPath, loanPath } = useMemo(() => {
    if (points.length === 0) {
      return { maxY: 1, barW: 0, gap: 0, netPath: "", loanPath: "" };
    }

    const maxVal = Math.max(
      ...points.flatMap((p) => [p.income, p.expenses, p.loanPayments, Math.abs(p.net)]),
      1,
    );
    const maxY = maxVal * 1.12;
    const groupW = plotW / points.length;
    const barW = Math.min(18, groupW * 0.22);
    const gap = barW * 0.35;

    const netCoords: string[] = [];
    const loanCoords: string[] = [];

    points.forEach((p, i) => {
      const cx = PAD.left + i * groupW + groupW / 2;
      netCoords.push(`${cx},${yScale(Math.max(p.net, 0), maxY, plotH)}`);
      loanCoords.push(`${cx},${yScale(p.loanPayments, maxY, plotH)}`);
    });

    return {
      maxY,
      barW,
      gap,
      netPath: netCoords.join(" "),
      loanPath: loanCoords.join(" "),
    };
  }, [points, plotH, plotW]);

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-gray-500">No monthly data to chart.</p>
    );
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxY);
  const groupW = plotW / points.length;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[640px] w-full"
        role="img"
        aria-label="Income, expenses, net savings, and loan payments by month"
      >
        {yTicks.map((tick) => {
          const y = yScale(tick, maxY, plotH);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="#e4edf8"
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="fill-gray-400 text-[10px]">
                {fmtAxis(tick)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) => {
          const gx = PAD.left + i * groupW + groupW / 2;
          const incomeH = plotH - (yScale(p.income, maxY, plotH) - PAD.top);
          const expenseH = plotH - (yScale(p.expenses, maxY, plotH) - PAD.top);
          const loanH = plotH - (yScale(p.loanPayments, maxY, plotH) - PAD.top);
          const incomeX = gx - barW - gap;
          const expenseX = gx - barW / 2;
          const loanX = gx + gap;

          return (
            <g key={p.month}>
              <rect
                x={incomeX}
                y={yScale(p.income, maxY, plotH)}
                width={barW}
                height={Math.max(incomeH, p.income > 0 ? 2 : 0)}
                rx={3}
                fill="#10b981"
                opacity={0.85}
              >
                <title>{`${formatMonthKey(p.month)} income: ${formatMoney(p.income)}`}</title>
              </rect>
              <rect
                x={expenseX}
                y={yScale(p.expenses, maxY, plotH)}
                width={barW}
                height={Math.max(expenseH, p.expenses > 0 ? 2 : 0)}
                rx={3}
                fill="#f87171"
                opacity={0.85}
              >
                <title>{`${formatMonthKey(p.month)} expenses: ${formatMoney(p.expenses)}`}</title>
              </rect>
              <rect
                x={loanX}
                y={yScale(p.loanPayments, maxY, plotH)}
                width={barW}
                height={Math.max(loanH, p.loanPayments > 0 ? 2 : 0)}
                rx={3}
                fill="#f59e0b"
                opacity={0.9}
              >
                <title>{`${formatMonthKey(p.month)} loans: ${formatMoney(p.loanPayments)}`}</title>
              </rect>
              <text
                x={gx}
                y={H - 18}
                textAnchor="middle"
                className="fill-gray-500 text-[9px]"
                transform={
                  points.length > 8
                    ? `rotate(-35, ${gx}, ${H - 18})`
                    : undefined
                }
              >
                {formatMonthKey(p.month).replace(" ", "\u2011")}
              </text>
            </g>
          );
        })}

        {netPath ? (
          <polyline
            points={netPath}
            fill="none"
            stroke="#1d6fb8"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {loanPath ? (
          <polyline
            points={loanPath}
            fill="none"
            stroke="#d97706"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        ) : null}

        {points.map((p, i) => {
          const gx = PAD.left + i * groupW + groupW / 2;
          const ny = yScale(Math.max(p.net, 0), maxY, plotH);
          return (
            <circle key={`${p.month}-net`} cx={gx} cy={ny} r={3.5} fill="#1d6fb8">
              <title>{`${formatMonthKey(p.month)} net: ${formatMoney(p.net)}`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-emerald-500/85" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-red-400/85" /> Expenses
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-amber-500/90" /> Loan/EMI
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-[#1d6fb8]" /> Net savings (line)
        </span>
      </div>
    </div>
  );
}
