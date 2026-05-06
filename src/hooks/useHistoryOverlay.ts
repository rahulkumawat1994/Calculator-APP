import { useEffect, useRef } from "react";

/**
 * Syncs an overlay (modal) with `history.pushState` so mobile / PWA "Back" closes
 * the overlay first. On programmatic close, removes the synthetic entry with `history.back()`.
 */
export function useHistoryOverlay(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ __ncHistoryOverlay: 1 }, "", window.location.href);
    let alive = true;

    const onPop = () => {
      if (!alive) return;
      alive = false;
      onCloseRef.current();
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (alive) {
        alive = false;
        window.history.back();
      }
    };
  }, [isOpen]);
}
