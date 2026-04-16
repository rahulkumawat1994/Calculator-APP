import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

export const REPORT_NOTIFY_STORAGE_KEY = "admin_report_browser_notify";

export const REPORT_NOTIFY_CHANGED_EVENT = "report-notify-pref-changed";

function readNotifyArmed(): boolean {
  try {
    return localStorage.getItem(REPORT_NOTIFY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Listens for new `report_issue_logs` while the main app is open (any tab).
 * Enable once from /admin; preference lives in localStorage on this browser.
 */
export function useReportIssueNotifications(): void {
  const [armed, setArmed] = useState(readNotifyArmed);

  useEffect(() => {
    const sync = () => setArmed(readNotifyArmed());
    const onStorage = (e: StorageEvent) => {
      if (e.key === REPORT_NOTIFY_STORAGE_KEY || e.key === null) sync();
    };
    window.addEventListener(REPORT_NOTIFY_CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(REPORT_NOTIFY_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (armed && Notification.permission === "denied") {
      try {
        localStorage.removeItem(REPORT_NOTIFY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      setArmed(false);
      window.dispatchEvent(new Event(REPORT_NOTIFY_CHANGED_EVENT));
    }
  }, [armed]);

  useEffect(() => {
    if (!armed || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const q = query(
      collection(db, "report_issue_logs"),
      orderBy("createdAt", "desc"),
      limit(40),
    );
    const seenIds = new Set<string>();
    let primed = false;

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (!primed) {
          snapshot.docs.forEach((d) => seenIds.add(d.id));
          primed = true;
          return;
        }
        for (const ch of snapshot.docChanges()) {
          if (ch.type !== "added") continue;
          const id = ch.doc.id;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const d = ch.doc.data() as { input?: string };
          const body =
            (d.input ?? "").replace(/\s+/g, " ").trim().slice(0, 140) ||
            "(no input preview)";
          try {
            new Notification("New pattern issue report", { body, tag: id });
          } catch {
            /* ignore */
          }
        }
      },
      (err) => console.warn("[report notify] report_issue_logs listener:", err),
    );
    return () => unsub();
  }, [armed]);
}
