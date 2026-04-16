import { useEffect, useState } from "react";
import type { MessagePayload } from "firebase/messaging";
import { getFirebaseMessaging } from "./firebase";
import { registerReportPush } from "./reportPush";

/** User opted in to browser push for new `report_issue_logs` (admin switch). */
export const REPORT_PUSH_ENABLED_KEY = "admin_report_issue_push";

export const REPORT_PUSH_CHANGED_EVENT = "report-issue-push-changed";

function readPushEnabled(): boolean {
  try {
    return localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Foreground FCM: show OS notification via SW (no Toastify). */
async function showForegroundReportNotification(payload: MessagePayload): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const n = payload.notification;
  const title = n?.title ?? "New pattern issue report";
  const fromData =
    typeof payload.data?.inputPreview === "string" ? payload.data.inputPreview : "";
  const body = (n?.body || fromData || "(no preview)").trim();
  const tag =
    (typeof payload.data?.logId === "string" && payload.data.logId) ||
    `report-${Date.now()}`;

  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(title, {
    body,
    tag,
    silent: false,
    data: { ...(payload.data as Record<string, string> | undefined) },
  });
}

/**
 * Keeps FCM token fresh and shows foreground pushes as system notifications only.
 * Mount once at app root (runs on /admin and main app so push works on any tab).
 */
export function useReportIssuePush(): void {
  const [enabled, setEnabled] = useState(readPushEnabled);

  useEffect(() => {
    const sync = () => setEnabled(readPushEnabled());
    const onStorage = (e: StorageEvent) => {
      if (e.key === REPORT_PUSH_ENABLED_KEY || e.key === null) sync();
    };
    window.addEventListener(REPORT_PUSH_CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(REPORT_PUSH_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!enabled || typeof Notification === "undefined") return;
    if (Notification.permission === "denied") {
      try {
        localStorage.removeItem(REPORT_PUSH_ENABLED_KEY);
      } catch {
        /* ignore */
      }
      setEnabled(false);
      window.dispatchEvent(new Event(REPORT_PUSH_CHANGED_EVENT));
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      await registerReportPush().catch(() => {});
      if (cancelled) return;

      const { onMessage } = await import("firebase/messaging");
      const messaging = await getFirebaseMessaging();
      if (cancelled || !messaging) return;

      const ret = onMessage(messaging, (payload) => {
        void showForegroundReportNotification(payload);
      });
      if (typeof ret === "function") unsubscribe = ret;
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled]);
}
