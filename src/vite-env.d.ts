/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_VAPID_KEY?: string;
  /** Same value as Vercel REPORT_NOTIFY_SECRET (enables POST /api/notify-report-issue after submit). */
  readonly VITE_REPORT_NOTIFY_SECRET?: string;
  /** e.g. https://your-app.vercel.app — use during local dev so notify hits deployed API */
  readonly VITE_REPORT_NOTIFY_URL?: string;
}
