import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { BreakdownChevronIcon } from "../calculator/breakdownIcons";

/** Mobile-first typography & surfaces for the meter tracker */
export const meterLabel = "text-xs font-medium uppercase tracking-wide text-gray-500";
export const meterValue = "text-lg font-bold tabular-nums text-gray-900 sm:text-xl";
export const meterCaption = "text-xs text-gray-500 leading-snug";

export const METER_LONG_PRESS_MS = 500;

/** Sentinel + IntersectionObserver: compact when user scrolls past the header. */
export function useStickyCompact(enabled = true) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setCompact(false);
      return;
    }

    const el = sentinelRef.current;
    if (!el) return;

    const onIntersect: IntersectionObserverCallback = ([entry]) => {
      setCompact(!entry.isIntersecting);
    };

    const observer = new IntersectionObserver(onIntersect, {
      threshold: 0,
      root: null,
    });
    observer.observe(el);

    // Sync once on mount (observer can lag on first paint)
    const rect = el.getBoundingClientRect();
    setCompact(rect.top < 0);

    return () => observer.disconnect();
  }, [enabled]);

  return { sentinelRef, compact };
}

export function MeterNavStickyShell({
  compact,
  sentinelRef,
  children,
  mobileOnly = false,
}: {
  compact: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  mobileOnly?: boolean;
}) {
  const shell = mobileOnly
    ? compact
      ? "bg-white/90 backdrop-blur-xl border-b border-gray-200/70 shadow-[0_1px_0_rgba(0,0,0,0.05),0_8px_20px_-6px_rgba(0,0,0,0.1)] py-2 -mx-4 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
      : "mb-4"
    : compact
      ? "bg-white/95 backdrop-blur-md border-b border-gray-200/80 shadow-sm py-2 -mx-4 px-4 sm:mx-0 sm:px-0"
      : "mb-4";

  return (
    <>
      <div ref={sentinelRef} className="h-px w-full shrink-0" aria-hidden />
      <div className="sticky top-0 z-30">
        <div className={`transition-all duration-200 ease-out ${shell}`}>{children}</div>
      </div>
    </>
  );
}

type MeterNavMeter = {
  id: string;
  label: string;
  shortLabel?: string;
  Icon: ComponentType<{ className?: string }>;
  count: number;
};

type MeterNavSection = {
  id: string;
  label: string;
  shortLabel?: string;
  Icon: ComponentType<{ className?: string }>;
};

function MeterSegmented({
  meters,
  activeMeter,
  onMeterChange,
  size = "default",
}: {
  meters: MeterNavMeter[];
  activeMeter: string;
  onMeterChange: (id: string) => void;
  size?: "default" | "tight" | "micro";
}) {
  const micro = size === "micro";
  const tight = size === "tight" || micro;
  return (
    <div
      className={`flex gap-0.5 bg-gray-100/95 p-0.5 ring-1 ring-gray-200/60 ${
        micro ? "rounded-md" : tight ? "rounded-lg" : "rounded-xl"
      }`}
    >
      {meters.map((m) => {
        const active = activeMeter === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onMeterChange(m.id)}
            className={`flex flex-1 items-center justify-center gap-0.5 font-semibold transition-all duration-200 active:scale-[0.98] ${
              micro
                ? "rounded py-0.5 min-h-6 text-[10px]"
                : tight
                  ? "rounded-md py-1 min-h-7 text-[11px]"
                  : "rounded-[10px] py-2.5 min-h-[44px] text-sm"
            } ${
              active
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/[0.04]"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            <m.Icon
              className={`shrink-0 ${
                micro ? "h-2.5 w-2.5" : tight ? "h-3 w-3" : "h-4 w-4"
              } ${active ? "text-blue-600" : "text-gray-400"}`}
            />
            <span className="truncate">{m.shortLabel ?? m.label}</span>
            {m.count > 0 && !micro && (
              <span
                className={`rounded-full font-bold leading-none ${
                  tight ? "px-1 py-0.5 text-[8px]" : "px-1.5 py-0.5 text-[10px]"
                } ${active ? "bg-blue-100 text-blue-700" : "bg-gray-200/90 text-gray-600"}`}
              >
                {m.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MeterUnderlineTabs({
  sections,
  activeSection,
  onSectionChange,
  size = "default",
}: {
  sections: MeterNavSection[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  size?: "default" | "tight" | "micro";
}) {
  const micro = size === "micro";
  const tight = size === "tight" || micro;
  return (
    <div className={`flex border-b border-gray-200/90 ${tight ? "-mx-0.5" : ""}`}>
      {sections.map(({ id, label, shortLabel, Icon }) => {
        const active = activeSection === id;
        const tabLabel = tight ? shortLabel ?? label : label;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            aria-label={label}
            className={`relative flex flex-1 items-center justify-center transition-colors active:opacity-80 ${
              micro
                ? "min-h-6 py-0.5 px-0.5"
                : tight
                  ? "flex-col gap-0 py-1.5 min-h-8 px-0.5"
                  : "flex-col gap-1 py-2.5 min-h-[48px] px-1"
            }`}
          >
            <Icon
              className={`shrink-0 ${
                micro ? "h-3.5 w-3.5" : tight ? "h-3.5 w-3.5" : "h-4 w-4"
              } ${active ? "text-blue-600" : "text-gray-400"}`}
            />
            {!micro && (
              <span
                className={`truncate max-w-full font-medium leading-tight ${
                  tight ? "text-[10px]" : "text-xs"
                } ${active ? "text-blue-600 font-semibold" : "text-gray-500"}`}
              >
                {tabLabel}
              </span>
            )}
            {active && (
              <span
                className={`absolute bottom-0 rounded-full bg-blue-600 ${
                  micro ? "left-1.5 right-1.5 h-[2px]" : tight ? "left-1 right-1 h-[2px]" : "left-2 right-2 h-0.5"
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function MeterNavMeters({
  meters,
  activeMeter,
  onMeterChange,
  layout,
}: {
  meters: MeterNavMeter[];
  activeMeter: string;
  onMeterChange: (id: string) => void;
  layout: "cards" | "segmented" | "segmented-tight" | "segmented-micro";
}) {
  if (layout.startsWith("segmented")) {
    const size =
      layout === "segmented-micro"
        ? "micro"
        : layout === "segmented-tight"
          ? "tight"
          : "default";
    return (
      <MeterSegmented
        meters={meters}
        activeMeter={activeMeter}
        onMeterChange={onMeterChange}
        size={size}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {meters.map((m) => {
        const active = activeMeter === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onMeterChange(m.id)}
            className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 min-h-[52px] text-sm font-semibold transition-all active:scale-[0.98] ${
              active
                ? "border-blue-400 bg-blue-600 text-white shadow-md shadow-blue-600/20"
                : "border-gray-200 bg-white text-gray-700"
            }`}
          >
            <m.Icon className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-gray-500"}`} />
            <span className="truncate">{m.label}</span>
            {m.count > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {m.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MeterNavSections({
  sections,
  activeSection,
  onSectionChange,
  layout,
}: {
  sections: MeterNavSection[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  layout: "cards" | "underline" | "underline-tight" | "underline-micro";
}) {
  if (layout.startsWith("underline")) {
    const size =
      layout === "underline-micro"
        ? "micro"
        : layout === "underline-tight"
          ? "tight"
          : "default";
    return (
      <MeterUnderlineTabs
        sections={sections}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        size={size}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {sections.map(({ id, label, Icon }) => {
        const active = activeSection === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 rounded-xl border py-2.5 min-h-[52px] text-sm font-semibold transition-all active:scale-[0.98] ${
              active
                ? "border-blue-400 bg-blue-600 text-white shadow-md"
                : "border-gray-200 bg-white text-gray-600"
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-gray-400"}`} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Rate control — pill chip for flat rate; plain text for slab */
export function MeterRateChip({
  onClick,
  compact,
  label,
  children,
  tone = "default",
}: {
  onClick: () => void;
  compact?: boolean;
  label: string;
  children: ReactNode;
  tone?: "default" | "slab" | "muted";
}) {
  if (tone === "slab") {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Tap to edit slab rates"
        className={`shrink-0 inline-flex items-center gap-1 font-semibold text-purple-600 transition-opacity active:opacity-60 ${
          compact ? "text-xs" : "text-base"
        }`}
      >
        {children}
      </button>
    );
  }

  const toneClass =
    tone === "muted"
      ? "bg-gray-100 text-gray-500 ring-gray-200/80"
      : compact
        ? "bg-gray-100 text-gray-800 ring-gray-200/80"
        : "bg-white text-gray-800 ring-gray-200/60 hover:bg-gray-50 shadow-sm";

  return (
    <button
      type="button"
      onClick={onClick}
      title="Tap to edit rate settings"
      className={`shrink-0 rounded-full ring-1 transition-all active:scale-[0.97] ${toneClass} ${
        compact ? "px-2 py-0.5 min-h-6" : "px-3.5 py-2 min-h-[44px]"
      }`}
    >
      <span
        className={`block font-semibold uppercase tracking-wide ${
          compact ? "text-[8px] text-gray-500 leading-none" : meterLabel
        }`}
      >
        {label}
      </span>
      <span
        className={
          compact ? "text-[10px] font-bold tabular-nums leading-tight" : "text-base font-bold tabular-nums"
        }
      >
        {children}
      </span>
    </button>
  );
}

/** Unified scroll header: title, rate, meters, sections — compact sticky bar on mobile scroll. */
export function MeterScrollHeader({
  compact,
  sentinelRef,
  title,
  subtitle,
  titleIcon,
  renderRate,
  meters,
  sections,
  activeMeter,
  onMeterChange,
  activeSection,
  onSectionChange,
}: {
  compact: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  title: string;
  subtitle?: string;
  titleIcon?: ReactNode;
  renderRate: (compact: boolean) => ReactNode;
  meters: MeterNavMeter[];
  sections: MeterNavSection[];
  activeMeter: string;
  onMeterChange: (id: string) => void;
  activeSection: string;
  onSectionChange: (id: string) => void;
}) {
  const activeMeterLabel =
    meters.find((m) => m.id === activeMeter)?.shortLabel ??
    meters.find((m) => m.id === activeMeter)?.label;

  return (
    <>
      {/* Mobile: full header scrolls away; fixed compact bar when scrolled */}
      <div className="md:hidden">
        <div className="relative mb-4 overflow-hidden rounded-2xl border border-gray-200/70 bg-gradient-to-br from-white via-white to-blue-50/50 shadow-sm ring-1 ring-black/[0.03]">
          <div
            className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-amber-400/15 blur-2xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl"
            aria-hidden
          />
          <div className="relative p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 tracking-tight">
                  {titleIcon}
                  {title}
                </h1>
                {subtitle && <p className={`mt-1 ${meterCaption}`}>{subtitle}</p>}
              </div>
              {renderRate(false)}
            </div>
            <div className="mt-4">
              <MeterNavMeters
                meters={meters}
                activeMeter={activeMeter}
                onMeterChange={onMeterChange}
                layout="segmented"
              />
            </div>
            <div className="mt-3 -mx-1">
              <MeterNavSections
                sections={sections}
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                layout="underline"
              />
            </div>
          </div>
        </div>

        {/* When this line scrolls above the viewport, show the fixed bar */}
        <div ref={sentinelRef} className="h-px w-full shrink-0" aria-hidden />
      </div>

      {/* Fixed top bar — always in viewport when compact (sticky was broken: bar was below fold) */}
      <div
        className={`md:hidden fixed inset-x-0 top-0 z-40 transition-transform duration-300 ease-out will-change-transform ${
          compact ? "translate-y-0" : "-translate-y-full pointer-events-none"
        }`}
        aria-hidden={!compact}
      >
        <div
          className="bg-white/95 backdrop-blur-xl border-b border-gray-200/80 shadow-[0_1px_0_rgba(0,0,0,0.06),0_8px_20px_-8px_rgba(0,0,0,0.12)] pt-[max(0.25rem,env(safe-area-inset-top))]"
        >
          <div className="mx-auto max-w-3xl px-4 py-1.5 pb-1.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1 min-w-0 [&_svg]:h-3.5 [&_svg]:w-3.5">
                {titleIcon}
                <span className="text-[13px] font-semibold text-gray-900 tracking-tight truncate">
                  {title}
                </span>
                {activeMeterLabel && (
                  <span className="text-[11px] font-medium text-gray-400 truncate shrink-0">
                    · {activeMeterLabel}
                  </span>
                )}
              </div>
              {renderRate(true)}
            </div>
            <MeterNavMeters
              meters={meters}
              activeMeter={activeMeter}
              onMeterChange={onMeterChange}
              layout="segmented-micro"
            />
            <div className="mt-1">
              <MeterNavSections
                sections={sections}
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                layout="underline-micro"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: expanded header + tabs */}
      <div className="hidden md:block mb-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
              {titleIcon}
              {title}
            </h1>
            {subtitle && <p className={`mt-0.5 ${meterCaption}`}>{subtitle}</p>}
          </div>
          {renderRate(false)}
        </div>
        <MeterNavMeters
          meters={meters}
          activeMeter={activeMeter}
          onMeterChange={onMeterChange}
          layout="cards"
        />
        <div className="mt-4">
          <MeterNavSections
            sections={sections}
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            layout="cards"
          />
        </div>
      </div>
    </>
  );
}

export function usePressableCard(onTap: () => void, onLongPress: () => void) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => {
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      onTap();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onTap();
      }
    },
    onPointerDown: () => {
      longPressed.current = false;
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true;
        onLongPress();
      }, METER_LONG_PRESS_MS);
    },
    onPointerUp: clearLongPress,
    onPointerLeave: clearLongPress,
    onPointerCancel: clearLongPress,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

export function MeterModal({
  onClose,
  children,
  panelClassName = "max-w-md",
}: {
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      onClick={onClose}
    >
      <div
        className={`w-full rounded-2xl bg-white shadow-2xl overflow-hidden ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function MeterConfirmDialog({
  onClose,
  title,
  detail,
  confirmLabel,
  onConfirm,
  danger,
}: {
  onClose: () => void;
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="mt-1 text-sm text-gray-500">{detail}</p>
        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 min-h-[40px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-3 py-2 text-sm font-semibold text-white min-h-[40px] ${
              danger ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export type MeterHeroDetail = {
  label: string;
  value: string;
  sub?: string;
};

export function MeterSurface({
  children,
  className = "",
  borderless = false,
}: {
  children: ReactNode;
  className?: string;
  borderless?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-white ${borderless ? "" : "border border-gray-200/90 shadow-sm"} ${className}`}
    >
      {children}
    </div>
  );
}

export function MeterStatCard({
  label,
  value,
  sub,
  highlight,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`min-w-0 w-full text-left rounded-xl border px-3 py-3 transition-colors active:scale-[0.98] ${
        highlight ? "border-blue-200 bg-blue-50/70" : "border-gray-100 bg-gray-50/80"
      } ${onClick ? "hover:border-blue-200 hover:bg-blue-50/50 cursor-pointer" : "cursor-default"}`}
    >
      <p className={`${meterLabel} truncate`}>{label}</p>
      <p
        className={`mt-1 ${meterValue} leading-tight ${
          highlight ? "text-blue-700" : ""
        }`}
      >
        {value}
      </p>
      {sub && <p className={`mt-1 ${meterCaption} truncate`}>{sub}</p>}
    </button>
  );
}

export function MeterDialPair({
  meterNow,
  previousLog,
}: {
  meterNow: string;
  previousLog: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm">
        <p className={meterLabel}>Meter now</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 leading-tight">{meterNow}</p>
        <p className={meterCaption}>KWH on dial</p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm">
        <p className={meterLabel}>Previous log</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-gray-700 leading-tight">{previousLog}</p>
        <p className={meterCaption}>last entry</p>
      </div>
    </div>
  );
}

export type MeterBillHeroTone = "blue" | "violet";

type BillHeroToneConfig = {
  shell: string;
  label: string;
  sub: string;
  amount: string;
  pillShell: string;
  pillLabel: string;
  pillValue: string;
  pillUnit: string;
  detailValue: string;
  detailSub: string;
  footerBorder: string;
  footerBg: string;
  formulaBtn: string;
  detailShells: [string, string, string, string];
  detailLabels: [string, string, string, string];
};

const billHeroTones: Record<MeterBillHeroTone, BillHeroToneConfig> = {
  blue: {
    shell: "border-blue-500/20 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 shadow-lg shadow-blue-900/20",
    label: "text-blue-100",
    sub: "text-blue-100/75",
    amount: "text-white",
    pillShell: "bg-white/12 border-white/20 backdrop-blur-sm",
    pillLabel: "text-blue-100/80",
    pillValue: "text-white",
    pillUnit: "text-blue-100/70",
    detailValue: "text-white",
    detailSub: "text-blue-100/65",
    footerBorder: "border-white/10",
    footerBg: "bg-black/5",
    formulaBtn: "bg-white/15 text-white active:bg-white/25",
    detailShells: [
      "bg-white/10 border-white/10",
      "bg-white/10 border-white/10",
      "bg-white/10 border-white/10",
      "bg-white/10 border-white/10",
    ],
    detailLabels: [
      "text-blue-100/70",
      "text-blue-100/70",
      "text-blue-100/70",
      "text-blue-100/70",
    ],
  },
  violet: {
    shell: "border-violet-200/90 bg-gradient-to-br from-violet-50 via-white to-indigo-50 shadow-md shadow-violet-200/25",
    label: "text-violet-700",
    sub: "text-violet-600/80",
    amount: "text-violet-950",
    pillShell: "bg-white/90 border-violet-200/70 shadow-sm",
    pillLabel: "text-violet-600",
    pillValue: "text-violet-950",
    pillUnit: "text-violet-500",
    detailValue: "text-gray-900",
    detailSub: "text-gray-500",
    footerBorder: "border-violet-200/40",
    footerBg: "bg-violet-50/40",
    formulaBtn: "bg-violet-100 text-violet-800 active:bg-violet-200/80",
    detailShells: [
      "bg-white border-violet-200/70 shadow-sm",
      "bg-violet-100/60 border-violet-200/50",
      "bg-indigo-50 border-indigo-200/60",
      "bg-fuchsia-50 border-fuchsia-200/50",
    ],
    detailLabels: [
      "text-violet-600",
      "text-violet-700",
      "text-indigo-600",
      "text-fuchsia-600",
    ],
  },
};

export function MeterBillHero({
  label,
  amount,
  units,
  unitsLabel = "Cycle total",
  details,
  onTapFormula,
  tone = "blue",
}: {
  label: string;
  amount: string;
  units: string;
  unitsLabel?: string;
  details?: MeterHeroDetail[];
  onTapFormula?: () => void;
  tone?: MeterBillHeroTone;
}) {
  const t = billHeroTones[tone];

  return (
    <div className={`rounded-2xl overflow-hidden border shadow-lg ${t.shell}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-xs font-semibold uppercase tracking-wider ${t.label}`}>{label}</p>
          {onTapFormula && (
            <button
              type="button"
              onClick={onTapFormula}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shrink-0 ${t.formulaBtn}`}
            >
              How calculated
              <BreakdownChevronIcon className="h-3.5 w-3.5 -rotate-90" />
            </button>
          )}
        </div>

        {onTapFormula ? (
          <button
            type="button"
            onClick={onTapFormula}
            className="w-full text-left mt-3 active:opacity-95"
          >
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-3xl sm:text-[2rem] font-bold tabular-nums leading-none tracking-tight ${t.amount}`}>
                  {amount}
                </p>
                <p className={`mt-1.5 text-sm ${t.sub}`}>estimated bill</p>
              </div>
              <div className={`shrink-0 rounded-xl border px-3 py-2 text-right ${t.pillShell}`}>
                <p className={`text-[11px] font-medium uppercase tracking-wide ${t.pillLabel}`}>{unitsLabel}</p>
                <p className={`text-2xl font-bold tabular-nums leading-tight ${t.pillValue}`}>{units}</p>
                <p className={`text-xs font-medium ${t.pillUnit}`}>KWH</p>
              </div>
            </div>
          </button>
        ) : (
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-3xl sm:text-[2rem] font-bold tabular-nums leading-none tracking-tight ${t.amount}`}>
                {amount}
              </p>
              <p className={`mt-1.5 text-sm ${t.sub}`}>estimated bill</p>
            </div>
            <div className={`shrink-0 rounded-xl border px-3 py-2 text-right ${t.pillShell}`}>
              <p className={`text-[11px] font-medium uppercase tracking-wide ${t.pillLabel}`}>{unitsLabel}</p>
              <p className={`text-2xl font-bold tabular-nums leading-tight ${t.pillValue}`}>{units}</p>
              <p className={`text-xs font-medium ${t.pillUnit}`}>KWH</p>
            </div>
          </div>
        )}
      </div>

      {details && details.length > 0 && (
        <div className={`grid grid-cols-2 gap-2 px-3 pb-3 border-t ${t.footerBorder} ${t.footerBg}`}>
          {details.map((d, i) => (
            <div
              key={d.label}
              className={`rounded-xl border px-2.5 py-2.5 min-h-[56px] ${t.detailShells[i % 4]}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${t.detailLabels[i % 4]}`}>{d.label}</p>
              <p className={`mt-0.5 text-sm font-semibold tabular-nums leading-snug ${t.detailValue}`}>{d.value}</p>
              {d.sub && <p className={`mt-0.5 text-xs ${t.detailSub} leading-snug`}>{d.sub}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MeterExpandSection({
  title,
  hint,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <MeterSurface className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[48px] items-center justify-between gap-3 px-4 py-3 text-left active:bg-gray-50"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
            {badge && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {badge}
              </span>
            )}
          </div>
          {hint && !open && <p className={`mt-0.5 ${meterCaption}`}>{hint}</p>}
        </div>
        <BreakdownChevronIcon className="h-5 w-5 shrink-0 text-gray-400" open={open} />
      </button>
      {open && <div className="border-t border-gray-100 px-4 py-4 space-y-4">{children}</div>}
    </MeterSurface>
  );
}

export function MeterSectionHeading({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {hint && <p className={`mt-0.5 ${meterCaption}`}>{hint}</p>}
    </div>
  );
}

export function MeterStatGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const grid =
    columns === 4
      ? "grid grid-cols-2 gap-2.5 sm:grid-cols-4"
      : columns === 3
        ? "grid grid-cols-2 gap-2.5 sm:grid-cols-3"
        : "grid grid-cols-2 gap-2.5";
  return <div className={grid}>{children}</div>;
}

export function MeterChipScroller({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function MeterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 min-h-[40px] text-sm font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white shadow-sm"
          : "border border-gray-200 bg-white text-gray-600 active:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export function MeterPrimaryButton({
  onClick,
  icon,
  children,
  className = "",
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 min-h-[44px] text-sm font-semibold text-white shadow-md shadow-blue-600/15 hover:bg-blue-700 active:scale-[0.98] ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function MeterSecondaryButton({
  onClick,
  icon,
  children,
  className = "",
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 min-h-[44px] text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.98] ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function MeterBottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200/80 bg-white/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto max-w-3xl flex gap-2">{children}</div>
    </div>
  );
}

export function MeterFab({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <MeterBottomBar>
      <MeterPrimaryButton onClick={onClick} icon={icon} className="flex-1">
        {children}
      </MeterPrimaryButton>
    </MeterBottomBar>
  );
}

export function ReadingMobileCard({
  date,
  time,
  reading,
  units,
  duration,
  avgKw,
  rate,
  cost,
  note,
  isLatest,
  isEditing,
  showRate,
  showCost,
  onEdit,
  onDelete,
}: {
  date: string;
  time: string;
  reading: string;
  units: string | null;
  duration: string | null;
  avgKw: string | null;
  rate?: string | null;
  cost?: string | null;
  note?: string;
  isLatest?: boolean;
  isEditing?: boolean;
  showRate?: boolean;
  showCost?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pressable = usePressableCard(onEdit, onDelete);

  return (
    <article
      {...pressable}
      className={`rounded-2xl border bg-white p-4 shadow-sm select-none cursor-pointer transition-transform active:scale-[0.98] ${
        isEditing ? "border-amber-200 bg-amber-50/40" : isLatest ? "border-blue-200/80" : "border-gray-100"
      }`}
    >
      <div className="min-w-0">
        <p className="text-base font-semibold text-gray-800">{date}</p>
        <p className="text-sm text-gray-500">{time}</p>
        {isLatest && !isEditing && (
          <span className="mt-1 inline-block rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
            Latest
          </span>
        )}
        {isEditing && (
          <span className="mt-1 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
            Editing
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className={meterLabel}>Reading</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-gray-800">{reading}</p>
        </div>
        <div>
          <p className={meterLabel}>Units</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-gray-800">{units ?? "—"}</p>
        </div>
        <div>
          <p className={meterLabel}>Duration</p>
          <p className="mt-0.5 text-sm font-medium text-gray-700">{duration ?? "—"}</p>
        </div>
        <div>
          <p className={meterLabel}>Avg kW</p>
          <p className="mt-0.5 text-sm font-medium text-gray-700">{avgKw ?? "—"}</p>
        </div>
        {showRate && rate && (
          <div>
            <p className={meterLabel}>Rate</p>
            <p className="mt-0.5 text-sm font-medium text-gray-700">{rate}</p>
          </div>
        )}
        {showCost && cost && (
          <div>
            <p className={meterLabel}>Cost</p>
            <p className="mt-0.5 text-sm font-bold text-gray-800">{cost}</p>
          </div>
        )}
      </div>
      {note && <p className={`mt-3 ${meterCaption} line-clamp-2`}>{note}</p>}
    </article>
  );
}