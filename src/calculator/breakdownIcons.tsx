import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

function StrokeIcon({
  className = "",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function BreakdownEditIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </StrokeIcon>
  );
}

export function BreakdownDeleteIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 6h18" />
      <path d="M8.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V6" />
      <path d="M19.5 6l-.8 13.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3L4.5 6" />
      <path d="M10 11v5.5" />
      <path d="M14 11v5.5" />
    </StrokeIcon>
  );
}

export function BreakdownWarningIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.1 18.1A1.5 1.5 0 0 0 3.5 20h17a1.5 1.5 0 0 0 1.4-1.9L13.7 3.9a1.5 1.5 0 0 0-2.8 0Z" />
    </StrokeIcon>
  );
}

export function BreakdownChevronIcon({
  className = "h-4 w-4",
  open = false,
}: IconProps & { open?: boolean }) {
  return (
    <StrokeIcon
      className={`${className} transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  );
}

export function BreakdownIconButton({
  label,
  onClick,
  tone = "neutral",
  className = "",
}: {
  label: string;
  onClick: () => void;
  tone?: "neutral" | "edit" | "danger";
  className?: string;
}) {
  const tones = {
    neutral:
      "border-slate-200/90 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700",
    edit:
      "border-blue-200/80 bg-white text-blue-600 hover:border-blue-300 hover:bg-sky-50 hover:text-blue-700",
    danger:
      "border-red-200/90 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100 hover:text-red-700",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition active:scale-[0.97] ${tones[tone]} ${className}`}
    >
      {tone === "edit" ? (
        <BreakdownEditIcon />
      ) : tone === "danger" ? (
        <BreakdownDeleteIcon />
      ) : null}
    </button>
  );
}
