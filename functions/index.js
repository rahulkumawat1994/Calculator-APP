const path = require("node:path");
try {
  // v2 deploy: load functions/.env so APP_PUBLIC_URL is set (do not commit .env).
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (_) {
  /* dotenv optional during minimal installs */
}

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

/**
 * When a user submits a pattern issue (report_issue_logs), notify all registered
 * web push tokens in `report_push_tokens`.
 *
 * functions/.env: APP_PUBLIC_URL=https://your-production-host (no trailing slash).
 */
exports.onReportIssueCreatedPush = onDocumentCreated(
  {
    document: "report_issue_logs/{logId}",
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const raw = (snap.get("input") ?? "").toString().replace(/\s+/g, " ").trim();
    const preview = raw.slice(0, 140) || "(no input preview)";
    const title = "New pattern issue report";
    const logId = String(event.params.logId);
    const inputPreview = raw.slice(0, 200);

    const tokenSnap = await db.collection("report_push_tokens").get();
    const tokens = [];
    tokenSnap.forEach((d) => {
      const t = d.get("token");
      if (typeof t === "string" && t.length > 30) tokens.push(t);
    });

    if (tokens.length === 0) {
      console.log("[onReportIssueCreatedPush] no tokens in report_push_tokens; skip");
      return;
    }

    const appPublicUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
    const clickLink = appPublicUrl.startsWith("https://") ? `${appPublicUrl}/admin` : null;
    if (!clickLink) {
      console.log(
        "[onReportIssueCreatedPush] set APP_PUBLIC_URL in functions/.env for notification click-through",
      );
    }

    console.log(`[onReportIssueCreatedPush] logId=${logId} tokens=${tokens.length}`);

    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      // Web: avoid webpush.notification + data (unreliable onBackgroundMessage / OS display).
      // Service worker shows from data.title / data.body only.
      const message = {
        tokens: chunk,
        data: {
          title: String(title),
          body: String(preview),
          logId: String(logId),
          type: "report_issue",
          inputPreview: String(inputPreview),
        },
        webpush: {
          headers: { Urgency: "high" },
          ...(clickLink ? { fcmOptions: { link: clickLink } } : {}),
        },
      };

      const resp = await messaging.sendEachForMulticast(message);
      console.log(`[onReportIssueCreatedPush] success=${resp.successCount} failure=${resp.failureCount}`);

      for (let j = 0; j < resp.responses.length; j++) {
        const r = resp.responses[j];
        if (r.success) continue;
        console.warn("[onReportIssueCreatedPush] send error:", r.error?.code, r.error?.message);
        const code = r.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          const bad = chunk[j];
          const qs = await db.collection("report_push_tokens").where("token", "==", bad).get();
          await Promise.all(qs.docs.map((doc) => doc.ref.delete()));
        }
      }
    }
  },
);
