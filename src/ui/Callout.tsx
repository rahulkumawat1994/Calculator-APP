import type { ReactNode } from "react";
import type { HTMLAttributes } from "react";

const TONE: Record<"amber" | "red" | "slate" | "sky", string> = {
  amber: "bg-amber-50 border-2 border-amber-300 text-amber-800",
  red: "bg-red-50 border-2 border-red-200 text-red-800",
  slate: "bg-slate-50 border-2 border-slate-200 text-slate-800",
  sky: "bg-sky-50/80 border-2 border-sky-200 text-sky-900",
};

export type CalloutProps = {
  tone: keyof typeof TONE;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Bordered, rounded in-flow notices (e.g. unsaved changes, inline validation).
 */
export function Callout({ tone, children, className = "", ...rest }: CalloutProps) {
  return (
    <div
      className={`rounded-[14px] px-4 py-3 text-[14px] ${TONE[tone]} ${className}`.replace(/\s+/g, " ").trim()}
      role="status"
      {...rest}
    >
      {children}
    </div>
  );
}
