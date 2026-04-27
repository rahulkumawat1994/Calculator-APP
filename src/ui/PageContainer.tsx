import type { ReactNode } from "react";
import type { HTMLAttributes } from "react";

const MAX: Record<"app" | "wide" | "settings", string> = {
  app: "max-w-[680px] mx-auto px-3 pt-5 pb-16",
  /** Games / some tools */
  wide: "max-w-[860px] mx-auto px-3 pt-5 pb-16",
  /** Settings / narrow forms */
  settings: "max-w-[540px] mx-auto",
};

export type PageContainerProps = {
  variant?: keyof typeof MAX;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Constrains main scroll width for tab content. Does not set `w-full` so parents can size.
 */
export function PageContainer({
  variant = "app",
  className = "",
  children,
  ...rest
}: PageContainerProps) {
  return (
    <div
      className={`${MAX[variant]} ${className}`.replace(/\s+/g, " ").trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
