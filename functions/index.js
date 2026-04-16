const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

/**
 * Sends web push to every registered FCM token when a pattern issue is logged.
 * Deploy: `cd functions && npm i && cd .. && firebase deploy --only functions`
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
    const body = raw.slice(0, 140) || "(no input preview)";

    const tokenSnap = await db.collection("report_push_tokens").get();
    const tokens = [];
    tokenSnap.forEach((d) => {
      const t = d.get("token");
      if (typeof t === "string" && t.length > 30) tokens.push(t);
    });
    if (tokens.length === 0) return;

    const title = "New pattern issue report";
    const logId = String(event.params.logId);
    const inputPreview = raw.slice(0, 200);

    const appPublicUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
    const clickLink = appPublicUrl.startsWith("https://") ? `${appPublicUrl}/admin` : null;
    if (!clickLink) {
      console.log(
        "[onReportIssueCreatedPush] APP_PUBLIC_URL unset in functions/.env — push sends without click URL (set to your site’s https origin + redeploy).",
      );
    }

    console.log(
      `[onReportIssueCreatedPush] logId=${logId} sending to ${tokens.length} FCM token(s)`,
    );

    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const message = {
        tokens: chunk,
        notification: { title, body },
        data: {
          logId,
          type: "report_issue",
          inputPreview,
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          ...(clickLink ? { fcmOptions: { link: clickLink } } : {}),
        },
      };

      const resp = await messaging.sendEachForMulticast(message);
      console.log(
        `[onReportIssueCreatedPush] batch success=${resp.successCount} failure=${resp.failureCount}`,
      );

      for (let j = 0; j < resp.responses.length; j++) {
        const r = resp.responses[j];
        if (r.success) continue;
        console.warn(
          `[onReportIssueCreatedPush] token ${j} failed:`,
          r.error?.code,
          r.error?.message,
        );
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
