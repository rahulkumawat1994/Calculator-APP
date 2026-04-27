import type { ReactNode } from "react";

export type IconTabItem<T extends string> = { id: T; icon: string; label: string };

type IconTabBarProps<T extends string> = {
  items: readonly IconTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Sticky app shell under the system UI */
  className?: string;
  maxWidthClassName?: string;
  /** Shown in the right side of the bar, e.g. a menu action */
  trailing?: ReactNode;
};

/**
 * Sticky 4-tap primary navigation (Calculate / History / …) used in `App`.
 */
export function IconTabBar<T extends string>({
  items,
  value,
  onChange,
  className = "",
  maxWidthClassName = "max-w-[980px]",
  trailing = null,
}: IconTabBarProps<T>) {
  return (
    <div
      className={`sticky top-0 z-10 border-b-2 border-[#dde8f0] bg-white shadow-md ${className}`.replace(/\s+/g, " ").trim()}
    >
      <div
        className={`${maxWidthClassName} mx-auto flex items-stretch ${trailing ? "gap-1" : ""}`.replace(/\s+/g, " ").trim()}
      >
        {items.map(({ id, icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 border-b-[3px] pt-3 pb-2.5 transition-colors ${
              value === id
                ? "border-[#1d6fb8] text-[#1d6fb8]"
                : "border-transparent text-gray-400 active:text-gray-600"
            }`}
          >
            <span className="text-[22px] leading-none">{icon}</span>
            <span className="text-[11px] font-bold tracking-wide">{label}</span>
          </button>
        ))}
        {trailing}
      </div>
    </div>
  );
}
