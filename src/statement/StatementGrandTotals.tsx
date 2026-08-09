import { formatStatementInrMoney } from "./statementMoneyParse";

function netTone(net: number): { box: string; text: string; label: string } {
  if (net > 0) return { box: "border-emerald-200/70 bg-emerald-50/50", text: "text-emerald-800", label: "Net in" };
  if (net < 0) return { box: "border-red-200/80 bg-red-50/50", text: "text-red-800", label: "Net out" };
  return { box: "border-slate-200 bg-slate-50", text: "text-slate-700", label: "Even" };
}

export function StatementGrandTotals({
  deposits,
  withdrawals,
  net,
  scopeLabel,
  filtersActive,
  pageTotalsOnly,
}: {
  deposits: number;
  withdrawals: number;
  net: number;
  scopeLabel: string;
  filtersActive: boolean;
  pageTotalsOnly: boolean;
}) {
  const tone = netTone(net);
  const meta = [
    scopeLabel,
    filtersActive ? "filtered" : null,
    pageTotalsOnly ? "page totals view" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 shadow-sm ${tone.box}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{meta}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white/90 px-4 py-3 ring-1 ring-slate-900/5">
          <p className="text-xs font-medium text-slate-500">Deposits</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {formatStatementInrMoney(deposits)}
          </p>
        </div>
        <div className="rounded-xl bg-white/90 px-4 py-3 ring-1 ring-slate-900/5">
          <p className="text-xs font-medium text-slate-500">Withdrawals</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {formatStatementInrMoney(withdrawals)}
          </p>
        </div>
        <div className="rounded-xl bg-white/90 px-4 py-3 ring-1 ring-slate-900/5">
          <p className="text-xs font-medium text-slate-500">{tone.label}</p>
          <p className={`mt-1 font-mono text-xl font-semibold tracking-tight sm:text-2xl ${tone.text}`}>
            {formatStatementInrMoney(net)}
          </p>
          <p className={`mt-0.5 text-[11px] font-medium ${tone.text}`}>Deposits − withdrawals</p>
        </div>
      </div>
    </div>
  );
}
