import { formatStatementInrMoney } from "./statementMoneyParse";

export function profitLossTextClass(net: number): string {
  if (net > 0) return "text-emerald-800";
  if (net < 0) return "text-red-800";
  return "text-slate-700";
}

export function profitLossLabel(net: number): string {
  if (net > 0) return "Profit";
  if (net < 0) return "Loss";
  return "Even";
}

/** One-line deposits / withdrawals / net summary for a file card header. */
export function StatementFileMoneySummary({
  label,
  deposits,
  withdrawals,
  net,
  filtersActive,
}: {
  label: string;
  deposits: number;
  withdrawals: number;
  net: number;
  filtersActive: boolean;
}) {
  return (
    <div className="w-full border-t border-slate-200/90 pt-3 text-xs leading-relaxed text-slate-600">
      <span className="font-semibold text-slate-800">{label}</span>
      {" · "}
      Deposits{" "}
      <strong className="font-mono tabular-nums text-slate-900">
        {formatStatementInrMoney(deposits)}
      </strong>
      {" − "}
      Withdrawals{" "}
      <strong className="font-mono tabular-nums text-slate-900">
        {formatStatementInrMoney(withdrawals)}
      </strong>
      {" = "}
      <strong className={`font-mono tabular-nums ${profitLossTextClass(net)}`}>
        {formatStatementInrMoney(net)}
      </strong>
      <span className={`font-semibold ${profitLossTextClass(net)}`}>
        {" "}
        ({profitLossLabel(net)})
      </span>
      {filtersActive ? <span className="font-normal text-slate-500"> · filtered rows</span> : null}
    </div>
  );
}
