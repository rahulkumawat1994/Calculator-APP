import { useEffect, useRef } from "react";
import { toast } from "react-toastify";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import type { MessagePayload } from "firebase/messaging";
import { db, getFirebaseMessaging } from "./firebase";
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

/** Avoid double toast/notification when both FCM and Firestore see the same report. */
const shownReportIds = new Set<string>();
const DEDUPE_MS = 120_000;

function markShown(reportId: string): boolean {
  if (!reportId || shownReportIds.has(reportId)) return false;
  shownReportIds.add(reportId);
  window.setTimeout(() => shownReportIds.delete(reportId), DEDUPE_MS);
  return true;
}

function adminPanelUrl(): string {
  if (typeof window === "undefined") return "/admin";
  return `${window.location.origin}/admin`;
}

async function showReportAlert(
  reportId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!markShown(reportId)) return;

  toast.info(`${title}: ${body.slice(0, 100)}${body.length > 100 ? "…" : ""}`, {
    toastId: `report-alert-${reportId}`,
  });

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const clickUrl =
    (data?.clickUrl != null && String(data.clickUrl).trim()) || adminPanelUrl();
  const merged = {
    logId: reportId,
    type: "report_issue",
    ...data,
    clickUrl,
  };
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      tag: `report-${reportId}`,
      data: merged,
    });
  } catch (e) {
    console.warn("[report alert] showNotification failed:", e);
    try {
      new Notification(title, { body });
    } catch (e2) {
      console.warn("[report alert] new Notification failed:", e2);
    }
  }
}

async function showReportIssueNotification(payload: MessagePayload): Promise<void> {
  const d = payload.data;
  const n = payload.notification;
  const title =
    (d?.title != null && String(d.title).trim()) ||
    n?.title ||
    "New pattern issue report";
  const body =
    (d?.body != null && String(d.body).trim()) ||
    n?.body ||
    (d?.inputPreview != null ? String(d.inputPreview) : "") ||
    "(no preview)";
  const reportId =
    (d?.logId != null && String(d.logId)) || `fcm-${Date.now()}`;
  await showReportAlert(reportId, title, body, d as Record<string, unknown> | undefined);
}

/**
 * When admin enables report alerts:
 * - Firestore listener: works on Spark (no Cloud Functions); needs an open tab.
 * - FCM onMessage: optional when Functions + Blaze push to this token (deduped by report id).
 */
export function useReportIssuePush(): void {
  const fcmUnsubRef = useRef<(() => void) | null>(null);
  const fsUnsubRef = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clear = () => {
      fcmUnsubRef.current?.();
      fcmUnsubRef.current = null;
      fsUnsubRef.current?.();
      fsUnsubRef.current = null;
    };

    const start = () => {
      clear();
      if (!isReportPushEnabled()) return;

      const q = query(
        collection(db, "report_issue_logs"),
        orderBy("createdAt", "desc"),
        limit(1),
      );

      let fsPrimed = false;
      let lastFsId: string | null = null;

      fsUnsubRef.current = onSnapshot(
        q,
        (snap) => {
          const docSnap = snap.docs[0];
          if (!docSnap) return;
          const id = docSnap.id;
          if (!fsPrimed) {
            fsPrimed = true;
            lastFsId = id;
            return;
          }
          if (id === lastFsId) return;
          lastFsId = id;
          const raw = docSnap.get("input");
          const inputPreview =
            typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 140) : "";
          const body = inputPreview || "(no preview)";
          void showReportAlert(id, "New pattern issue report", body, {
            logId: id,
            type: "report_issue",
            inputPreview: body,
            clickUrl: adminPanelUrl(),
          });
        },
        (err) => console.warn("[report alert] Firestore listener:", err),
      );

      void (async () => {
        await registerReportPush().catch(() => {});
        const messaging = await getFirebaseMessaging();
        if (cancelled || !messaging) return;
        const { onMessage } = await import("firebase/messaging");
        fcmUnsubRef.current = onMessage(messaging, (payload) => {
          const rawTy = payload.data?.type;
          const ty = rawTy != null ? String(rawTy) : "";
          if (ty !== "" && ty !== "report_issue") return;
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
