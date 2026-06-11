import type { ReactNode } from "react";

export function MoneySection({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STAT_STYLES = {
  income: {
    card: "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white",
    value: "text-emerald-900",
  },
  expense: {
    card: "border-red-200/70 bg-gradient-to-br from-red-50 to-white",
    value: "text-red-900",
  },
  net: {
    card: "border-blue-200/70 bg-gradient-to-br from-blue-50 to-white",
    value: "text-blue-900",
  },
  neutral: {
    card: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-white",
    value: "text-slate-900",
  },
} as const;

export function MoneyStatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: keyof typeof STAT_STYLES;
}) {
  const s = STAT_STYLES[accent];
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${s.card}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-[26px] font-bold leading-none tabular-nums tracking-tight ${s.value}`}>
        {value}
      </p>
      {sub ? <p className="mt-2 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function MoneyMetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur-sm">
      {children}
    </span>
  );
}
