import type { ReactNode } from "react";

export type IconTabItem<T extends string> = {
  id: T;
  icon: ReactNode;
  label: string;
};

type IconTabBarProps<T extends string> = {
  items: readonly IconTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Sticky app shell under the system UI */
  className?: string;
  maxWidthClassName?: string;
  /** Shown in the right side of the bar, e.g. a menu action */
  trailing?: ReactNode;
  variant?: "light" | "premium";
};

type IconTabBarActionProps = {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "light" | "premium";
};

function tabIconSlot(icon: ReactNode) {
  return (
    <span className="flex h-[22px] w-[22px] items-center justify-center [&>svg]:h-full [&>svg]:w-full">
      {icon}
    </span>
  );
}

export function IconTabBarAction({
  icon,
  label,
  href,
  onClick,
  variant = "light",
}: IconTabBarActionProps) {
  const isPremium = variant === "premium";
  const className = `pc-tab-bar__action flex shrink-0 flex-col items-center gap-0.5 border-b-[3px] border-transparent px-3 pt-3 pb-2.5 transition-colors ${
    isPremium
      ? "text-slate-400 hover:text-[#4f46e5] active:text-[#4338ca]"
      : "text-gray-400 hover:text-[#1d6fb8] active:text-[#155a94]"
  }`;

  const content = (
    <>
      {tabIconSlot(icon)}
      <span className="text-[11px] font-bold tracking-wide">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

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
  variant = "light",
}: IconTabBarProps<T>) {
  const isPremium = variant === "premium";
  return (
    <div
      className={`sticky top-0 z-10 border-b-2 shadow-md ${
        isPremium
          ? "pc-tab-bar border-[#e2e8f0] bg-white/95 backdrop-blur-xl shadow-sm"
          : "border-[#dde8f0] bg-white"
      } ${className}`.replace(/\s+/g, " ").trim()}
    >
      <div
        className={`${maxWidthClassName} mx-auto flex items-stretch ${trailing ? "gap-1" : ""}`.replace(/\s+/g, " ").trim()}
      >
        {items.map(({ id, icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`pc-tab-bar__tab flex-1 flex flex-col items-center gap-0.5 border-b-[3px] pt-3 pb-2.5 transition-colors ${
              value === id
                ? isPremium
                  ? "pc-tab-bar__tab--active border-[#4f46e5] text-[#4f46e5]"
                  : "border-[#1d6fb8] text-[#1d6fb8]"
                : isPremium
                  ? "border-transparent text-slate-400 active:text-slate-500"
                  : "border-transparent text-gray-400 active:text-gray-600"
            }`}
          >
            {tabIconSlot(icon)}
            <span className="text-[11px] font-bold tracking-wide">{label}</span>
          </button>
        ))}
        {trailing}
      </div>
    </div>
  );
}
