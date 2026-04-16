import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteToken, getToken } from "firebase/messaging";
import { db, getFirebaseMessaging } from "./firebase";

export type RegisterPushResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_vapid"
        | "invalid_vapid"
        | "unsupported"
        | "no_sw"
        | "permission"
        | "error";
      detail?: string;
    };

function vapidKey(): string | undefined {
  const v = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  const t = v?.trim();
  return t || undefined;
}

/** Web Push VAPID public key must decode to 65 bytes (0x04||X||Y) or 33 compressed. */
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
  const col = collection(db, "report_push_tokens");
  const q = query(col, where("token", "==", token), limit(1));
  const existing = await getDocs(q);
  const payload = {
    token,
    updatedAt: Date.now(),
    ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : "",
    origin: typeof location !== "undefined" ? location.origin.slice(0, 200) : "",
  };
  if (!existing.empty) {
    await updateDoc(existing.docs[0].ref, payload);
  } else {
    await addDoc(col, { ...payload, createdAt: Date.now() });
  }
}

async function deleteTokenRows(token: string): Promise<void> {
  const q = query(collection(db, "report_push_tokens"), where("token", "==", token), limit(20));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

/**
 * Registers the service worker, obtains an FCM token, and stores it in Firestore for Cloud Functions.
 * Requires Notification permission, VITE_FIREBASE_VAPID_KEY, and public/firebase-messaging-sw.js (npm run fcm:sw).
 */
export async function registerReportPush(): Promise<RegisterPushResult> {
  const vk = vapidKey();
  if (!vk) return { ok: false, reason: "no_vapid" };
  if (!vapidPublicKeyLooksValid(vk)) {
    return {
      ok: false,
      reason: "invalid_vapid",
      detail:
        "VAPID key looks truncated (~87 chars from Firebase). Re-copy from Cloud Messaging → Web Push certificates.",
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

/** Removes FCM token from this device and Firestore. */
export async function unregisterReportPush(): Promise<void> {
  const vk = vapidKey();
  const messaging = await getFirebaseMessaging();
  if (!messaging) return;

  try {
    if (vk && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => null);
      const token = await getToken(messaging, {
        vapidKey: vk,
        serviceWorkerRegistration: reg ?? undefined,
      }).catch(() => null);
      if (token) await deleteTokenRows(token);
    }
    await deleteToken(messaging);
  } catch (e) {
    console.warn("[report push] unregister failed:", e);
  }
}
