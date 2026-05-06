import { useCallback, useEffect, useState } from "react";

export type ShellTab = "calculator" | "games" | "settings";

export function shellTabFromHash(): ShellTab {
  const h = window.location.hash.replace(/^#/, "").toLowerCase();
  if (h === "games" || h === "payments") return "games";
  if (h === "settings") return "settings";
  return "calculator";
}

function hashForTab(tab: ShellTab): string {
  if (tab === "calculator") return "";
  return `#${tab}`;
}

/**
 * Primary shell tabs (Calculate / Payments / Settings) driven by `location.hash`
 * so the system back button walks tabs before leaving the app.
 */
export function useShellTab(): [ShellTab, (tab: ShellTab) => void] {
  const [tab, setTab] = useState<ShellTab>(() =>
    typeof window !== "undefined" ? shellTabFromHash() : "calculator",
  );

  useEffect(() => {
    const sync = () => setTab(shellTabFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const setTabFromUi = useCallback((next: ShellTab) => {
    const want = hashForTab(next);
    const cur = window.location.hash || "";
    if (cur !== want) {
      window.location.hash = want;
    } else {
      setTab(next);
    }
  }, []);

  return [tab, setTabFromUi];
}
