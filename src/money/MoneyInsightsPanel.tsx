import { formatMoney } from "./moneyFormat";
import type { MoneyInsights } from "./moneyInsights";
import { MoneySection } from "./MoneyProUi";

type MoneyInsightsPanelProps = {
  insights: MoneyInsights;
};

function toneClass(tone: MoneyInsights["recommendations"][0]["tone"]): string {
  switch (tone) {
    case "positive":
      return "border-emerald-200 bg-emerald-50/80";
    case "warning":
      return "border-amber-200 bg-amber-50/80";
    case "action":
      return "border-blue-200 bg-blue-50/60";
  }
}

function toneIcon(tone: MoneyInsights["recommendations"][0]["tone"]): string {
  switch (tone) {
    case "positive":
      return "✓";
    case "warning":
      return "!";
    case "action":
      return "→";
  }
}

export function MoneyInsightsPanel({ insights }: MoneyInsightsPanelProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <MoneySection
        title="Loan payoff plan"
        subtitle={`${insights.monthCount} month${insights.monthCount === 1 ? "" : "s"} analyzed`}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800/70">
              Avg loan/EMI
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums text-amber-950">
              {formatMoney(insights.avgMonthlyLoanPayments)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Share of income
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums text-slate-900">
              {insights.loanShareOfIncomePct.toFixed(0)}%
            </p>
            <p className="text-[10px] text-slate-500">target &lt; 35%</p>
          </div>
        </div>

        {insights.loanGroups.length > 0 ? (
          <div className="mt-4 space-y-2">
            {insights.loanGroups.map((g) => (
              <div
                key={g.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{g.label}</p>
                  <p className="text-[11px] text-slate-500">
                    {g.paymentCount} payments · typical {formatMoney(g.typicalEmi || g.monthlyAvg)}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-bold tabular-nums text-amber-800">
                  {formatMoney(g.monthlyAvg)}/mo
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-slate-500">
            No loan/EMI detected — use category “Loan” or payee names with EMI.
          </p>
        )}

        {insights.suggestedExtraLoanPayment > 0 ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-800">
              Suggested extra payment
            </p>
            <p className="mt-1 text-[22px] font-bold tabular-nums text-slate-900">
              +{formatMoney(insights.suggestedExtraLoanPayment)}/mo
            </p>
          </div>
        ) : null}
      </MoneySection>

      <MoneySection title="Savings opportunities" subtitle="Trims based on your spending history">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/70">
              Avg surplus
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums text-emerald-950">
              {formatMoney(Math.max(insights.avgMonthlyNet, 0))}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Annual potential
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums text-slate-900">
              {formatMoney(insights.projectedAnnualSavings)}
            </p>
          </div>
        </div>

        {insights.savingsOpportunities.length > 0 ? (
          <div className="mt-4 space-y-2">
            {insights.savingsOpportunities.map((s) => (
              <div key={s.category} className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{s.category}</p>
                  <p className="shrink-0 text-[12px] font-bold tabular-nums text-emerald-700">
                    ~{formatMoney(s.potentialMonthlySave)}/mo
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Avg {formatMoney(s.monthlyAvg)}/mo · {s.pctOfSpending.toFixed(0)}% of spend
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </MoneySection>

      <MoneySection
        title="What to do next"
        subtitle="Actionable steps from your filtered data"
        className="lg:col-span-2"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {insights.recommendations.map((r, i) => (
            <div
              key={`${r.title}-${i}`}
              className={`rounded-xl border px-4 py-3 ${toneClass(r.tone)}`}
            >
              <p className="flex items-start gap-2 text-[13px] font-bold text-slate-900">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] shadow-sm">
                  {toneIcon(r.tone)}
                </span>
                {r.title}
              </p>
              <p className="mt-2 pl-7 text-[12px] leading-relaxed text-slate-600">{r.detail}</p>
            </div>
          ))}
        </div>
      </MoneySection>
    </div>
  );
}
