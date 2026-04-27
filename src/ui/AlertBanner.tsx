import type { ReactNode } from "react";
import type { HTMLAttributes } from "react";

const TONE: Record<"warning" | "error" | "info", string> = {
  warning: "bg-orange-50 border-b-2 border-orange-200 text-orange-700",
  error: "bg-red-50 border-b-2 border-red-200 text-red-700",
  info: "bg-sky-50 border-b-2 border-sky-200 text-sky-800",
};

export type AlertBannerProps = {
  tone: keyof typeof TONE;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Full-bleed strip under a header (database warnings, write errors, etc.)
 */
export function AlertBanner({ tone, children, className = "", ...rest }: AlertBannerProps) {
  return (
    <div
      className={`px-4 py-2 text-center text-[13px] font-semibold ${TONE[tone]} ${className}`.replace(/\s+/g, " ").trim()}
      role="status"
      {...rest}
    >
      {children}
    </div>
  );
}
