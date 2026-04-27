import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const VARIANT: Record<
  "primary" | "secondary" | "danger" | "outline" | "success",
  string
> = {
  primary:
    "bg-[#1d6fb8] text-white shadow-sm hover:bg-[#165fa3] border border-blue-600/20",
  secondary: "bg-gray-100 text-gray-700 border border-gray-200/80 hover:bg-gray-200/80",
  danger: "bg-red-600 text-white border border-red-700/20 hover:bg-red-700",
  outline:
    "bg-white text-gray-600 border-2 border-gray-200 hover:bg-gray-50",
  success: "bg-emerald-600 text-white border border-emerald-700/20 hover:bg-emerald-700",
};

export type ButtonVariant = keyof typeof VARIANT;

export type ButtonProps = {
  variant?: ButtonVariant;
  className?: string;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * App-wide button styles; pair with `className` for width (`w-full`, `flex-1`) and padding.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", className = "", type = "button", ...rest },
    ref
  ) {
    const base =
      "inline-flex items-center justify-center gap-1.5 rounded-[12px] font-semibold transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
    return (
      <button
        ref={ref}
        type={type}
        className={`${base} ${VARIANT[variant]} ${className}`.replace(/\s+/g, " ").trim()}
        {...rest}
      />
    );
  }
);
