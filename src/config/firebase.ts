import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import type { Messaging } from "firebase/messaging";

const REQUIRED_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
] as const;

for (const key of REQUIRED_VARS) {
  if (!import.meta.env[key]) {
    console.warn(`[firebase] Missing env var ${key}. Database will not work.`);
  }
}

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID as string,
};

export const app: FirebaseApp = initializeApp(firebaseConfig);

/**
 * In the browser, force Firestore long-polling instead of the default WebChannel
 * `Listen/channel` stream. That stream often surfaces as a CORS error in DevTools
 * even when the project is configured correctly (see firebase-js-sdk issues around
 * WebChannel + firestore.googleapis.com).
 *
 * In Node (tests), use default `getFirestore` — `experimentalForceLongPolling` is browser-only.
 */
function createFirestore(): Firestore {
  if (typeof window === "undefined") {
    return getFirestore(app);
  }
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();

/**
 * Fresh messaging instance (no sticky null cache if the first init failed).
 * Firebase reuses one Messaging per `app` internally.
 */
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  try {
    const { getMessaging, isSupported } = await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return null;
    return getMessaging(app);
  } catch (e) {
    console.warn("[firebase] getFirebaseMessaging failed:", e);
    return null;
  }
}
