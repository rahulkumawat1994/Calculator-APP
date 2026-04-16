import { deleteToken, getToken } from "firebase/messaging";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { db, getFirebaseMessaging } from "./firebase";

const DEVICE_ID_STORAGE_KEY = "report_push_device_id";

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `device-${Date.now()}`;
  }
}

export type RegisterPushResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_vapid" | "unsupported" | "permission_denied" | "invalid_vapid" | "error";
      detail?: string;
    };

function readVapidKey(): string | undefined {
  const v = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim();
  return v && v.length > 20 ? v : undefined;
}

/**
 * Register this browser for report-issue push: FCM token stored at
 * report_push_tokens/{deviceId} (merge) so refreshes do not spam new docs.
 */
export async function registerReportPush(): Promise<RegisterPushResult> {
  const vapidKey = readVapidKey();
  if (!vapidKey) return { ok: false, reason: "no_vapid" };

  const messaging = await getFirebaseMessaging();
  if (!messaging) return { ok: false, reason: "unsupported", detail: "FCM not supported in this browser" };

  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    return { ok: false, reason: "permission_denied" };
  }

  try {
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      type: "classic",
      scope: "/",
    });
    await navigator.serviceWorker.ready;

    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: "error", detail: "Empty FCM token" };

    const deviceId = getOrCreateDeviceId();
    await setDoc(
      doc(db, "report_push_tokens", deviceId),
      {
        token,
        updatedAt: Date.now(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : "",
      },
      { merge: true },
    );
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid.*vapid|vapid.*invalid|401|403/i.test(msg)) {
      return { ok: false, reason: "invalid_vapid", detail: msg };
    }
    return { ok: false, reason: "error", detail: msg };
  }
}

export async function unregisterReportPush(): Promise<void> {
  const messaging = await getFirebaseMessaging();
  let deviceId: string | null = null;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (deviceId) {
    await deleteDoc(doc(db, "report_push_tokens", deviceId)).catch(() => {});
  }
  if (messaging) {
    await deleteToken(messaging).catch(() => {});
  }
  try {
    localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
