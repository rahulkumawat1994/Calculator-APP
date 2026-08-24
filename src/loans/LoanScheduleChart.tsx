import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatLoanInr, parseLoanMoney } from "./loanCalc";
import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";

const MAX_CHART_POINTS = 60;

export default function LoanScheduleChart({ rows }: { rows: LoanScheduleRow[] }) {
  const chartData = rows.slice(0, MAX_CHART_POINTS).map((r, i) => ({
    label: r.installmentNo.trim() || r.dueDate.trim() || `#${i + 1}`,
    principal: parseLoanMoney(r.principal),
    interest: parseLoanMoney(r.interest),
  }));

  if (chartData.length === 0) return null;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatLoanInr(Number(v))} width={56} />
          <Tooltip
            formatter={(value, name) => [
              `₹${formatLoanInr(Number(value ?? 0))}`,
              String(name ?? ""),
            ]}
            labelFormatter={(label) => `EMI ${label}`}
          />
          <Bar dataKey="principal" stackId="a" fill="#6366f1" name="Principal" />
          <Bar dataKey="interest" stackId="a" fill="#f59e0b" name="Interest" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
