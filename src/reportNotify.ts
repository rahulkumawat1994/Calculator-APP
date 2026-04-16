/**
 * Calls the Vercel `/api/notify-report-issue` route after a report is saved.
 * Set VITE_REPORT_NOTIFY_SECRET (and on Vercel: REPORT_NOTIFY_SECRET) to the same value.
 * For local `vite dev`, set VITE_REPORT_NOTIFY_URL to your deployed site origin so the request hits Vercel.
 */

function notifyUrl(): string {
  const base = (import.meta.env.VITE_REPORT_NOTIFY_URL as string | undefined)?.trim().replace(/\/$/, "");
  if (base) return `${base}/api/notify-report-issue`;
  return "/api/notify-report-issue";
}

export async function notifyReportListenersAfterSubmit(logId: string): Promise<void> {
  const secret = (import.meta.env.VITE_REPORT_NOTIFY_SECRET as string | undefined)?.trim();
  if (!secret) return;

  try {
    const res = await fetch(notifyUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ logId }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[report notify] API", res.status, t);
    }
  } catch (e) {
    console.warn("[report notify] fetch failed:", e);
  }
}
