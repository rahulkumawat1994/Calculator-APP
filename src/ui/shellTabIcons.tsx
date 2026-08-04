import type { ReactNode } from "react";

type TabIconProps = {
  className?: string;
};

function TabIcon({
  className = "",
  children,
}: TabIconProps & { children: ReactNode }) {
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

export function TabCalculateIcon({ className }: TabIconProps) {
  return (
    <TabIcon className={className}>
      <rect x="5" y="2.5" width="14" height="19" rx="2.25" />
      <path d="M8.5 7h7" />
      <circle cx="8.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10 18.5h4" />
    </TabIcon>
  );
}

export function TabPaymentsIcon({ className }: TabIconProps) {
  return (
    <TabIcon className={className}>
      <path d="M3 9.5h18" />
      <path d="M5.5 6.5h13a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2Z" />
      <circle cx="16" cy="13.5" r="1.35" fill="currentColor" stroke="none" />
      <path d="M8 13.5h4.5" />
    </TabIcon>
  );
}

export function TabSettingsIcon({ className }: TabIconProps) {
  return (
    <TabIcon className={className}>
      <path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </TabIcon>
  );
}

export function TabAdminIcon({ className }: TabIconProps) {
  return (
    <TabIcon className={className}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5.5" rx="1.5" />
      <rect x="13.5" y="12" width="7" height="8.5" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </TabIcon>
  );
}

export function TabLoginIcon({ className }: TabIconProps) {
  return (
    <TabIcon className={className}>
      <path d="M15 3.5h4.5v17H15" />
      <path d="M10.5 12H3.5" />
      <path d="m7 8.5-3.5 3.5L7 15.5" />
    </TabIcon>
  );
}
