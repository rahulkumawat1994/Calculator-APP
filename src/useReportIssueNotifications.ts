import { useEffect, useRef, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { toast } from "react-toastify";
import { db, getFirebaseMessaging } from "./firebase";

export const REPORT_NOTIFY_STORAGE_KEY = "admin_report_browser_notify";

export const REPORT_NOTIFY_CHANGED_EVENT = "report-notify-pref-changed";

/** Max `createdAt` we have already surfaced (avoids duplicate toasts after tab sleep / mobile throttle). */
const REPORT_NOTIFY_WATERMARK_KEY = "report_notify_watermark_ts";

function readNotifyArmed(): boolean {
  try {
    return localStorage.getItem(REPORT_NOTIFY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readWatermark(): number {
  try {
    const v = localStorage.getItem(REPORT_NOTIFY_WATERMARK_KEY);
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeWatermarkMax(ts: number): void {
  if (!Number.isFinite(ts) || ts <= 0) return;
  try {
    const prev = readWatermark();
    if (ts > prev) localStorage.setItem(REPORT_NOTIFY_WATERMARK_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

function previewBody(input: string): string {
  return (input ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || "(no input preview)";
}

function pingNewReport(docId: string, input: string, createdAt: number): void {
  writeWatermarkMax(createdAt);
  const body = previewBody(input);

  try {
    toast.info(`New pattern issue: ${body}`, {
      toastId: `report-issue-${docId}`,
      autoClose: 9000,
      closeOnClick: true,
    });
  } catch {
    /* ignore */
  }

  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(120);
    }
  } catch {
    /* ignore */
  }

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification("New pattern issue report", {
      body,
      tag: docId,
      silent: false,
    });
  } catch {
    /* ignore */
  }
}

type ListenerState = { seenIds: Set<string>; primed: boolean };

/**
 * Listens for new `report_issue_logs` while this origin has a tab open (/admin or main app).
 * Enable once from /admin; preference lives in localStorage on this browser.
 *
 * Mobile Chrome often throttles the Firestore socket while the tab is in the background, so we also
 * poll on visibility / online and show in-app toasts (more reliable than OS banners on phones).
 */
export function useReportIssueNotifications(): void {
  const [armed, setArmed] = useState(readNotifyArmed);
  const listenerStateRef = useRef<ListenerState | null>(null);
  const flushBusyRef = useRef(false);

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

  /** Foreground FCM (background uses firebase-messaging-sw.js). */
  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    void (async () => {
      const { onMessage } = await import("firebase/messaging");
      const messaging = await getFirebaseMessaging();
      if (cancelled || !messaging) return;
      onMessage(messaging, (payload) => {
        if (!readNotifyArmed()) return;
        const logId = payload.data?.logId ?? `fcm-${Date.now()}`;
        const input = payload.data?.inputPreview ?? payload.notification?.body ?? "";
        pingNewReport(logId, input, Date.now());
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [armed]);

  useEffect(() => {
    if (!armed || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const st: ListenerState = { seenIds: new Set(), primed: false };
    listenerStateRef.current = st;

    const q = query(
      collection(db, "report_issue_logs"),
      orderBy("createdAt", "desc"),
      limit(40),
    );

    const primeWatermark = (snapshot: { docs: { id: string; data: () => unknown }[] }) => {
      let maxTs = 0;
      for (const d of snapshot.docs) {
        const row = d.data() as { createdAt?: number };
        const ts = row.createdAt ?? 0;
        if (ts > maxTs) maxTs = ts;
      }
      writeWatermarkMax(maxTs);
    };

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (!st.primed) {
          snapshot.docs.forEach((d) => st.seenIds.add(d.id));
          primeWatermark(snapshot);
          st.primed = true;
          return;
        }
        for (const ch of snapshot.docChanges()) {
          if (ch.type !== "added") continue;
          const id = ch.doc.id;
          if (st.seenIds.has(id)) continue;
          st.seenIds.add(id);
          const d = ch.doc.data() as { input?: string; createdAt?: number };
          pingNewReport(id, d.input ?? "", d.createdAt ?? 0);
        }
      },
      (err) => console.warn("[report notify] report_issue_logs listener:", err),
    );
    return () => {
      unsub();
      if (listenerStateRef.current === st) listenerStateRef.current = null;
    };
  }, [armed]);

  useEffect(() => {
    if (!armed || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const flushMissed = async () => {
      const st = listenerStateRef.current;
      if (!st?.primed || flushBusyRef.current) return;
      flushBusyRef.current = true;
      try {
        const wm = readWatermark();
        const qCatch = query(
          collection(db, "report_issue_logs"),
          where("createdAt", ">", wm),
          orderBy("createdAt", "asc"),
          limit(25),
        );
        const snap = await getDocs(qCatch);
        for (const d of snap.docs) {
          if (st.seenIds.has(d.id)) continue;
          st.seenIds.add(d.id);
          const data = d.data() as { input?: string; createdAt?: number };
          pingNewReport(d.id, data.input ?? "", data.createdAt ?? 0);
        }
      } catch (e) {
        console.warn("[report notify] catch-up poll failed:", e);
      } finally {
        flushBusyRef.current = false;
      }
    };

    let t: ReturnType<typeof setTimeout> | null = null;
    const scheduleFlush = () => {
      if (t != null) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        void flushMissed();
      }, 450);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") scheduleFlush();
    };
    const onOnline = () => scheduleFlush();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    void flushMissed();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") scheduleFlush();
    }, 120_000);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.clearInterval(intervalId);
      if (t != null) clearTimeout(t);
    };
  }, [armed]);
}
