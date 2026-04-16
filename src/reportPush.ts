import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { deleteToken, getToken } from "firebase/messaging";
import { db, getFirebaseMessaging } from "./firebase";

/** One Firestore row per browser profile (avoids count growing on every refresh / FCM token rotation). */
const DEVICE_ID_STORAGE_KEY = "report_push_device_id";

function getOrCreatePushDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id?.trim()) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `d_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `d_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

export type RegisterPushResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_vapid" | "invalid_vapid" | "unsupported" | "no_sw" | "permission" | "error";
      detail?: string;
    };

function vapidKey(): string | undefined {
  const v = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  const t = v?.trim();
  return t || undefined;
}

/**
 * Firebase Installations (used by FCM getToken) rejects bad/missing web `appId` with 400 INVALID_ARGUMENT.
 */
function validateFirebaseWebConfigForMessaging(): string | null {
  const appId = (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined)?.trim();
  const sender = (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined)?.trim();
  if (!appId) {
    return "Missing VITE_FIREBASE_APP_ID — copy the full “App ID” from Firebase → Project settings → Your apps (web).";
  }
  if (!/^1:\d+:web:[a-zA-Z0-9]+$/.test(appId)) {
    return "VITE_FIREBASE_APP_ID must look like 1:123456789:web:abc123 — fix .env (no line breaks in the value).";
  }
  if (!sender || !/^\d+$/.test(sender)) {
    return "Missing or invalid VITE_FIREBASE_MESSAGING_SENDER_ID — use the numeric “messaging sender id” from the same Firebase web config.";
  }
  return null;
}

/** P-256 public key: 65 bytes uncompressed (0x04||X||Y) or 33 compressed. */
function vapidPublicKeyLooksValid(base64Url: string): boolean {
  const s = base64Url.trim().replace(/\s/g, "");
  if (!s) return false;
  try {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const raw = atob(base64);
    const len = raw.length;
    if (len === 65 && raw.charCodeAt(0) === 0x04) return true;
    if (len === 33) {
      const b0 = raw.charCodeAt(0);
      return b0 === 0x02 || b0 === 0x03;
    }
    return false;
  } catch {
    return false;
  }
}

async function saveTokenRow(token: string): Promise<void> {
  const deviceId = getOrCreatePushDeviceId();
  const ref = doc(db, "report_push_tokens", deviceId);
  const now = Date.now();
  const base = {
    deviceId,
    token,
    updatedAt: now,
    ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : "",
    origin: typeof location !== "undefined" ? location.origin.slice(0, 200) : "",
  };
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    existing.exists() ? base : { ...base, createdAt: now },
    { merge: true },
  );
}

export async function registerReportPush(): Promise<RegisterPushResult> {
  const vk = vapidKey();
  if (!vk) return { ok: false, reason: "no_vapid" };
  const cfgErr = validateFirebaseWebConfigForMessaging();
  if (cfgErr) return { ok: false, reason: "error", detail: cfgErr };
  if (!vapidPublicKeyLooksValid(vk)) {
    return {
      ok: false,
      reason: "invalid_vapid",
      detail: "Copy the full Web Push public key from Firebase → Cloud Messaging (~87 characters).",
    };
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) return { ok: false, reason: "unsupported" };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "no_sw" };
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return { ok: false, reason: "permission" };
  }

  try {
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/",
    });
    await registration.update().catch(() => {});

    const token = await getToken(messaging, {
      vapidKey: vk,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: "error", detail: "empty FCM token" };

    await saveTokenRow(token);
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[report push] register failed:", e);
    return { ok: false, reason: "error", detail };
  }
}

export async function unregisterReportPush(): Promise<void> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return;

  try {
    const deviceId = getOrCreatePushDeviceId();
    await deleteDoc(doc(db, "report_push_tokens", deviceId)).catch(() => {});
    await deleteToken(messaging);
  } catch (e) {
    console.warn("[report push] unregister failed:", e);
  }
}
