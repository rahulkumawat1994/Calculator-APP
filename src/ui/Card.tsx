import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

const SURFACE: Record<"default" | "panel" | "tight" | "inset", string> = {
  /** In-app content blocks (History, settings, etc.) */
  default: "bg-white rounded-[20px] border-2 border-[#e4edf8] shadow-sm",
  /** Modal and dialog bodies (tighter border + stronger shadow) */
  panel: "w-full overflow-hidden bg-white rounded-[20px] border-2 border-[#dde8f0] shadow-2xl",
  /** Same as default, alias for call sites that are “tight” visually */
  tight: "bg-white rounded-[20px] border-2 border-[#e4edf8] shadow-sm",
  /** Slightly smaller radius, e.g. empty states */
  inset: "bg-white rounded-[18px] border-2 border-[#e4edf8] shadow-sm",
};

const PADDING: Record<"none" | "sm" | "md" | "lg", string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

const OVERFLOW: Record<"auto" | "hidden" | "visible", string> = {
  auto: "overflow-auto",
  hidden: "overflow-hidden",
  visible: "overflow-visible",
};

export type CardProps = {
  /** Visual shell */
  surface?: keyof typeof SURFACE;
  padding?: keyof typeof PADDING;
  /** Adds overflow class when not “visible” */
  overflow?: keyof typeof OVERFLOW;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Rounded app “card” surfaces shared across main tabs, settings, and dialogs.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className = "",
    surface = "default",
    padding = "none",
    overflow: ov,
    style,
    ...rest
  },
  ref
) {
  const ovClass = ov ? OVERFLOW[ov] : "";
  return (
    <div
      ref={ref}
      className={`${SURFACE[surface]} ${PADDING[padding]} ${ovClass} ${className}`.replace(/\s+/g, " ").trim()}
      style={style}
      {...rest}
    />
  );
});
