import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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
export const db = getFirestore(app);

let messagingPromise: Promise<Messaging | null> | null = null;

export function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = import("firebase/messaging")
      .then(async ({ getMessaging, isSupported }) => {
        if (!(await isSupported().catch(() => false))) return null;
        return getMessaging(app);
      })
      .catch(() => null);
  }
  return messagingPromise;
}
