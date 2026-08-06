import type { CalculationAuditLog, ReportIssueLog } from "@/data/firestoreDb";
import { formatAuditDateTimeParts } from "@/lib";
import { formatAuditModeLabel } from "./adminUi";

const CARD_BASE =
  "relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.04] transition-[box-shadow,border-color,transform] active:scale-[0.998] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gradient-to-b before:from-blue-500 before:to-sky-400 before:content-['']";
const CARD_SELECTED =
  "border-red-200/90 shadow-[0_8px_30px_-12px_rgba(239,68,68,0.15)] ring-2 ring-red-500/20 before:from-red-500 before:to-orange-400";
const CARD_FIXED =
  "border-emerald-200/80 ring-emerald-500/10 before:from-emerald-500 before:to-teal-400";
const CARD_HEADER =
  "border-b border-slate-100/90 bg-gradient-to-br from-slate-50/95 via-white to-sky-50/35 px-4 py-3.5 pl-5";
const META_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400";
const INPUT_PANEL =
  "max-h-32 overflow-auto rounded-xl border border-slate-200/70 bg-slate-50/90 p-3 font-mono text-[11px] leading-relaxed text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] whitespace-pre-wrap wrap-break-word";
const ACTION_FOOTER =
  "flex gap-2.5 border-t border-slate-100/90 bg-gradient-to-b from-slate-50/70 to-slate-50/30 p-3.5";

function SelectIndexButton({
  index,
  selected,
  disabled,
  onClick,
}: {
  index: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={selected ? "Deselect row" : "Select row for bulk actions"}
      aria-pressed={selected}
      aria-label={`Row ${index}${selected ? ", selected" : ""}`}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl text-[13px] font-bold transition-all disabled:opacity-40 ${
        selected
          ? "bg-red-600 text-white shadow-md ring-2 ring-red-500/30"
          : "bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm ring-1 ring-blue-500/25 hover:from-blue-700 hover:to-blue-800"
      }`}
    >
      <span>{index}</span>
    </button>
  );
}

function DateTimeBlock({ createdAt }: { createdAt?: number }) {
  const { date, time } = formatAuditDateTimeParts(createdAt);
  if (date === "-") {
    return <span className="text-[13px] text-slate-500">—</span>;
  }
  return (
    <div className="min-w-0 leading-tight">
      <p className="truncate text-[14px] font-semibold text-slate-900">{date}</p>
      {time ? (
        <p className="mt-0.5 text-[12px] font-medium tabular-nums text-slate-500">
          {time}
        </p>
      ) : null}
    </div>
  );
}

function ModeChip({ mode }: { mode: string }) {
  const label = formatAuditModeLabel(mode);
  const isWa = mode === "wa";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ${
        isWa
          ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
          : "bg-indigo-50 text-indigo-700 ring-indigo-100"
      }`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ failedCount }: { failedCount?: number }) {
  const n = failedCount ?? 0;
  if (n > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100/95 px-2.5 py-1 text-[10px] font-bold text-amber-900 ring-1 ring-amber-200/80">
        Failed ({n})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
      OK
    </span>
  );
}

export function AdminAuditMobileCard({
  row,
  rowIndex,
  selected,
  differs,
  parsedTotal,
  disabled,
  busy,
  onToggleSelect,
  onView,
  onDelete,
  onCopyInput,
}: {
  row: CalculationAuditLog;
  rowIndex: number;
  selected: boolean;
  differs?: boolean;
  parsedTotal?: number;
  disabled?: boolean;
  busy?: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onDelete: () => void;
  onCopyInput: () => void;
}) {
  const slotLabel =
    row.mode === "wa" && row.waSlotsSummary
      ? row.waSlotsSummary
      : row.selectedSlotName ?? row.selectedSlotId ?? "—";

  return (
    <article className={`${CARD_BASE} ${selected ? CARD_SELECTED : ""}`}>
      <div className={CARD_HEADER}>
        <div className="flex items-start gap-3">
          <SelectIndexButton
            index={rowIndex + 1}
            selected={selected}
            disabled={disabled || busy}
            onClick={onToggleSelect}
          />
          <div className="min-w-0 flex-1">
            <DateTimeBlock createdAt={row.createdAt} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <ModeChip mode={row.mode} />
              <StatusBadge failedCount={row.failedCount} />
              {differs ? (
                <span
                  className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-700 ring-1 ring-orange-200/80"
                  title={`Current parser: ₹${parsedTotal ?? "—"}`}
                >
                  Differs
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100/80 pt-3">
          <div className="min-w-0 flex-1">
            <p className={META_LABEL}>Slot</p>
            <p className="mt-0.5 truncate text-[13px] font-medium text-slate-700">
              {slotLabel}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={META_LABEL}>Total</p>
            <p className="mt-0.5 text-[22px] font-bold tabular-nums leading-none tracking-tight text-blue-600">
              ₹{row.total.toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3.5 pl-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className={META_LABEL}>Pasted input</p>
          <button
            type="button"
            onClick={onCopyInput}
            className="rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-sky-50/80 hover:text-blue-700"
          >
            Copy
          </button>
        </div>
        <pre className={INPUT_PANEL}>{row.input}</pre>
      </div>

      <div className={ACTION_FOOTER}>
        <button
          type="button"
          onClick={onView}
          disabled={busy}
          className="flex h-11 flex-1 items-center justify-center rounded-xl border border-blue-200/80 bg-white text-[13px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-sky-50/80 active:scale-[0.98] disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled || busy}
          className="flex h-11 flex-1 items-center justify-center rounded-xl border border-red-200/80 bg-gradient-to-b from-red-50/90 to-red-50/50 text-[13px] font-semibold text-red-700 shadow-sm transition hover:from-red-100/90 hover:to-red-100/60 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : "Delete"}
        </button>
      </div>
    </article>
  );
}

export function AdminReportMobileCard({
  row,
  rowIndex,
  selected,
  disabled,
  busy,
  busyFixed,
  onToggleSelect,
  onToggleFixed,
  onDelete,
}: {
  row: ReportIssueLog;
  rowIndex: number;
  selected: boolean;
  disabled?: boolean;
  busy?: boolean;
  busyFixed?: boolean;
  onToggleSelect: () => void;
  onToggleFixed: (fixed: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={`${CARD_BASE} ${
        selected ? CARD_SELECTED : row.fixed ? CARD_FIXED : ""
      }`}
    >
      <div className={CARD_HEADER}>
        <div className="flex items-start gap-3">
          <SelectIndexButton
            index={rowIndex + 1}
            selected={selected}
            disabled={disabled || busy}
            onClick={onToggleSelect}
          />
          <div className="min-w-0 flex-1">
            <DateTimeBlock createdAt={row.createdAt} />
            {row.fixed ? (
              <span className="mt-2 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
                Fixed
              </span>
            ) : (
              <span className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200/80">
                Needs review
              </span>
            )}
          </div>
          <label className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm">
            <input
              type="checkbox"
              checked={row.fixed === true}
              disabled={disabled || busy || busyFixed}
              onChange={(e) => onToggleFixed(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
              title="Mark as fixed"
            />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              Fixed
            </span>
          </label>
        </div>
      </div>

      <div className="space-y-3.5 px-4 py-3.5 pl-5">
        <div>
          <p className={META_LABEL}>Reported input</p>
          <pre className={`${INPUT_PANEL} mt-2`}>{row.input}</pre>
        </div>
        <div>
          <p className={META_LABEL}>Expected result</p>
          <pre className={`${INPUT_PANEL} mt-2`}>{row.expected || "—"}</pre>
        </div>
        {row.note ? (
          <div>
            <p className={META_LABEL}>User note</p>
            <pre className={`${INPUT_PANEL} mt-2`}>{row.note}</pre>
          </div>
        ) : null}
      </div>

      <div className={ACTION_FOOTER}>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled || busy}
          className="flex h-11 w-full items-center justify-center rounded-xl border border-red-200/80 bg-gradient-to-b from-red-50/90 to-red-50/50 text-[13px] font-semibold text-red-700 shadow-sm transition hover:from-red-100/90 hover:to-red-100/60 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : "Delete report"}
        </button>
      </div>
    </article>
  );
}
