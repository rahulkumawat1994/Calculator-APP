import type { HTMLAttributes } from "react";

type LoadingStateProps = {
  message?: string;
} & HTMLAttributes<HTMLDivElement>;

/** Initial app / Suspense list placeholder. */
export function AppLoadingState({
  message = "Loading your data…",
  className = "",
  ...rest
}: LoadingStateProps) {
  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center gap-4 bg-[#eef2f7] ${className}`.replace(/\s+/g, " ").trim()}
      {...rest}
    >
      <div className="text-[48px]">🧮</div>
      <div className="text-[18px] font-bold text-[#1d6fb8]">{message}</div>
      <div className="text-[13px] text-gray-400">Connecting to database</div>
    </div>
  );
}

export function TabSuspenseFallback({
  message = "Loading…",
  className = "",
  ...rest
}: LoadingStateProps) {
  return (
    <div
      className={`py-12 text-center text-[15px] font-semibold text-[#1d6fb8] ${className}`.replace(/\s+/g, " ").trim()}
      {...rest}
    >
      {message}
    </div>
  );
}
