/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Simple login for `/statement` and `/admin` (client-visible at build time). */
  readonly VITE_APP_LOGIN_USERNAME?: string;
  readonly VITE_APP_LOGIN_PASSWORD?: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
  /** Same value as Vercel REPORT_NOTIFY_SECRET (enables POST /api/notify-report-issue after submit). */
  readonly VITE_REPORT_NOTIFY_SECRET?: string;
  /** e.g. https://your-app.vercel.app — use during local dev so notify hits deployed API */
  readonly VITE_REPORT_NOTIFY_URL?: string;
}
