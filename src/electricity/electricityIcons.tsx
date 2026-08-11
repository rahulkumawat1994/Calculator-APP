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

export function ElecBoltIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </StrokeIcon>
  );
}

export function MainMeterIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 10.5V20a1 1 0 0 0 1 1H9.5v-5h5v5H19a1 1 0 0 0 1-1v-9.5" />
    </StrokeIcon>
  );
}

export function BasementMeterIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6 22V8l6-4 6 4v14" />
      <path d="M6 12h12" />
      <path d="M10 22v-4h4v4" />
    </StrokeIcon>
  );
}

export function OverviewIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </StrokeIcon>
  );
}

export function BillingIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6 2h9l3 3v17l-2-1.5L8 22l-2-1.5L4 22V2Z" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </StrokeIcon>
  );
}

export function CalendarMonthIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </StrokeIcon>
  );
}

export function SimulatorIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M9 3h6v5l4 9a2 2 0 0 1-1.8 2.9H6.8a2 2 0 0 1-1.8-2.9l4-9V3Z" />
      <path d="M9 3h6" />
      <path d="M10 12h4" />
    </StrokeIcon>
  );
}

export function PlusIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </StrokeIcon>
  );
}

export function CloseIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m18 6-12 12" />
      <path d="m6 6 12 12" />
    </StrokeIcon>
  );
}

export function DownloadIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 21h16" />
    </StrokeIcon>
  );
}

export function DuplicateIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </StrokeIcon>
  );
}

export function TrendUpIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m18 15-6-6-6 6" />
    </StrokeIcon>
  );
}

export function TrendDownIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  );
}

export function InsightIcon({ className = "h-2.5 w-2.5" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 1 4 12.7V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.3A7 7 0 0 1 12 2Z" />
    </StrokeIcon>
  );
}

export function ChartIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V8" />
      <path d="M17 16v-9" />
    </StrokeIcon>
  );
}

export function CompareIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M16 3h5v5" />
      <path d="m21 3-7 7" />
      <path d="M8 21H3v-5" />
      <path d="m3 21 7-7" />
    </StrokeIcon>
  );
}

export function ModalTitle({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
      <span className="shrink-0 text-gray-500">{icon}</span>
      <span>{children}</span>
    </h2>
  );
}
