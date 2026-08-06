export function formatAuditModeLabel(mode: string): string {
  if (mode === "wa") return "WhatsApp";
  if (mode === "manual") return "Manual";
  return mode;
}

export function AdminPanelLabel({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function AdminStatTile({
  label,
  value,
  tone = "slate",
  title,
}: {
  label: string;
  value: string;
  tone?: "slate" | "blue" | "amber" | "emerald";
  title?: string;
}) {
  const tones = {
    slate: "border-slate-200/80 bg-slate-50/70 text-slate-900",
    blue: "border-blue-100/80 bg-blue-50/50 text-blue-900",
    amber: "border-amber-100/80 bg-amber-50/50 text-amber-900",
    emerald: "border-emerald-100/80 bg-emerald-50/50 text-emerald-900",
  };
  const labelTones = {
    slate: "text-slate-500",
    blue: "text-blue-700/80",
    amber: "text-amber-800/80",
    emerald: "text-emerald-700/80",
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${tones[tone]}`}
      title={title}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.06em] ${labelTones[tone]}`}
      >
        {label}
      </p>
      <p className="mt-1 text-[16px] font-bold tabular-nums leading-none">
        {value}
      </p>
    </div>
  );
}

type AdminSelectionAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  title?: string;
};

export function AdminSelectionActionBar({
  count,
  itemLabel = "selected",
  onClear,
  clearDisabled,
  actions,
  ariaLabel,
}: {
  count: number;
  itemLabel?: string;
  onClear: () => void;
  clearDisabled?: boolean;
  actions: AdminSelectionAction[];
  ariaLabel: string;
}) {
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
      <div className="pointer-events-auto mx-auto w-full max-w-[1300px] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div
          role="toolbar"
          aria-label={ariaLabel}
          className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_-8px_40px_-12px_rgba(15,23,42,0.18),0_0_0_1px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/5 backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/95 to-white px-4 py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold tabular-nums text-slate-900">
                {count} {itemLabel}
              </p>
              <p className="text-[11px] text-slate-500">Choose an action below</p>
            </div>
            <button
              type="button"
              onClick={onClear}
              disabled={clearDisabled}
              className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-45"
            >
              Clear
            </button>
          </div>
          <div
            className={`grid gap-2.5 p-3 ${
              actions.length > 1 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.title}
                className={`flex min-h-12 items-center justify-center rounded-xl px-3 text-[14px] font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-45 ${
                  action.variant === "danger"
                    ? "border border-red-300 bg-red-600 text-white hover:bg-red-700"
                    : "border border-blue-200 bg-white text-blue-700 hover:bg-sky-50"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminSortButton({
  label,
  active,
  direction,
  onClick,
  title,
  activeTone = "orange",
}: {
  label: string;
  active: boolean;
  direction: "off" | "asc" | "desc";
  onClick: () => void;
  title: string;
  activeTone?: "orange" | "blue";
}) {
  const activeClass =
    activeTone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 ring-1 ring-blue-100"
      : "border-orange-200 bg-orange-50 text-orange-800 ring-1 ring-orange-100";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-sort={
        direction === "off"
          ? "none"
          : direction === "asc"
            ? "ascending"
            : "descending"
      }
      title={title}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold shadow-sm transition ${
        active
          ? activeClass
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      {direction === "asc" ? (
        <span aria-hidden>▲</span>
      ) : direction === "desc" ? (
        <span aria-hidden>▼</span>
      ) : (
        <span className="font-normal text-slate-300" aria-hidden>
          ↕
        </span>
      )}
    </button>
  );
}
