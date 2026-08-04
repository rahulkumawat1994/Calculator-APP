import type { HTMLAttributes } from "react";
import "./app-loading.css";
import { TabCalculateIcon } from "./shellTabIcons";

type LoadingStateProps = {
  message?: string;
  subtitle?: string;
} & HTMLAttributes<HTMLDivElement>;

/** Initial app / Suspense list placeholder. */
export function AppLoadingState({
  message = "Loading your data",
  subtitle = "Connecting to database",
  className = "",
  ...rest
}: LoadingStateProps) {
  return (
    <div
      className={`app-load ${className}`.replace(/\s+/g, " ").trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      {...rest}
    >
      <div className="app-load__bg" aria-hidden>
        <div className="app-load__orb app-load__orb--1" />
        <div className="app-load__orb app-load__orb--2" />
        <div className="app-load__orb app-load__orb--3" />
      </div>

      <div className="app-load__card">
        <div className="app-load__icon-wrap" aria-hidden>
          <div className="app-load__ring" />
          <TabCalculateIcon className="app-load__icon" />
        </div>

        <h1 className="app-load__title">{message}</h1>

        <p className="app-load__subtitle">
          {subtitle}
          <span className="app-load__dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </p>

        <div className="app-load__progress" aria-hidden>
          <div className="app-load__progress-bar" />
        </div>
      </div>
    </div>
  );
}

export function TabSuspenseFallback({
  message = "Loading",
  className = "",
  ...rest
}: LoadingStateProps) {
  return (
    <div
      className={`app-load-inline ${className}`.replace(/\s+/g, " ").trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      {...rest}
    >
      <div className="app-load-inline__spinner" aria-hidden />
      <p className="app-load-inline__text">{message}</p>
    </div>
  );
}
