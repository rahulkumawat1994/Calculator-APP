import { useEffect, useRef } from "react";
import type { MessagePayload } from "firebase/messaging";
import { getFirebaseMessaging } from "./firebase";
import { registerReportPush } from "./reportPush";

export const REPORT_PUSH_ENABLED_KEY = "admin_report_issue_push";
export const REPORT_PUSH_CHANGED_EVENT = "report-issue-push-changed";

function isReportPushEnabled(): boolean {
  try {
    return localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

async function showReportIssueNotification(payload: MessagePayload): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const d = payload.data;
  const n = payload.notification;
  const title =
    (typeof d?.title === "string" && d.title) ||
    n?.title ||
    "New pattern issue report";
  const body =
    (typeof d?.body === "string" && d.body) ||
    n?.body ||
    (typeof d?.inputPreview === "string" ? d.inputPreview : "") ||
    "(no preview)";
  const tag = (typeof d?.logId === "string" && d.logId) || `report-${Date.now()}`;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, data: d });
  } catch (e) {
    console.warn("[report push] showNotification failed:", e);
    try {
      new Notification(title, { body });
    } catch (e2) {
      console.warn("[report push] new Notification failed:", e2);
    }
  }
}

/**
 * When admin has enabled report push, keep the FCM token fresh and show
 * system notifications for report_issue messages (foreground).
 */
export function useReportIssuePush(): void {
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clear = () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };

    const start = () => {
      clear();
      if (!isReportPushEnabled()) return;

      void (async () => {
        await registerReportPush().catch(() => {});
        const messaging = await getFirebaseMessaging();
        if (cancelled || !messaging) return;
        const { onMessage } = await import("firebase/messaging");
        unsubRef.current = onMessage(messaging, (payload) => {
          const ty = payload.data?.type;
          if (typeof ty === "string" && ty !== "report_issue") return;
          void showReportIssueNotification(payload);
        });
      })();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === REPORT_PUSH_ENABLED_KEY || e.key === null) start();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(REPORT_PUSH_CHANGED_EVENT, start);
    start();

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REPORT_PUSH_CHANGED_EVENT, start);
      clear();
    };
  }, []);
}
