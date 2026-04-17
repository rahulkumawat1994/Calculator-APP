/**
 * Vercel serverless: send FCM to all tokens in `report_push_tokens` for a new report.
 *
 * Vercel project env (Settings → Environment Variables):
 *   FIREBASE_SERVICE_ACCOUNT_JSON — full JSON of a Firebase service account (single line or paste).
 *   REPORT_NOTIFY_SECRET — long random string; same value as VITE_REPORT_NOTIFY_SECRET in the app build.
 *   APP_PUBLIC_URL — optional https origin for notification click (e.g. https://your-app.vercel.app).
 */

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== "string") {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  const cred = JSON.parse(raw);
  return initializeApp({ credential: cert(cred) });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = (process.env.REPORT_NOTIFY_SECRET || "").trim();
  const authRaw =
    typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  const bearerPrefix = /^bearer\s+/i;
  const token = bearerPrefix.test(authRaw) ? authRaw.replace(bearerPrefix, "").trim() : "";

  if (!expected) {
    return res.status(503).json({
      error: "server_not_configured",
      message: "Set REPORT_NOTIFY_SECRET in the Vercel project environment and redeploy.",
    });
  }
  if (token !== expected) {
    return res.status(401).json({
      error: "unauthorized",
      message:
        "Authorization does not match REPORT_NOTIFY_SECRET. Use the same value as VITE_REPORT_NOTIFY_SECRET in your frontend build.",
    });
  }

  const logId = req.body && typeof req.body.logId === "string" ? req.body.logId : null;
  if (!logId) {
    return res.status(400).json({ error: "logId required" });
  }

  try {
    const app = getAdminApp();
    const db = getFirestore(app);
    const logRef = db.collection("report_issue_logs").doc(logId);
    const logSnap = await logRef.get();
    if (!logSnap.exists) {
      return res.status(404).json({ error: "report log not found" });
    }

    const raw = (logSnap.get("input") ?? "").toString().replace(/\s+/g, " ").trim();
    const preview = raw.slice(0, 140) || "(no input preview)";
    const title = "New pattern issue report";
    const inputPreview = raw.slice(0, 200);

    const tokenSnap = await db.collection("report_push_tokens").get();
    const tokens = [];
    tokenSnap.forEach((d) => {
      const t = d.get("token");
      if (typeof t === "string" && t.length > 30) tokens.push(t);
    });

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0, message: "no FCM tokens registered" });
    }

    const appPublicUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
    const clickLink =
      appPublicUrl.startsWith("https://") || appPublicUrl.startsWith("http://localhost")
        ? `${appPublicUrl}/admin`
        : null;

    const messaging = getMessaging(app);
    const chunkSize = 500;
    let success = 0;
    let failure = 0;

    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const message = {
        tokens: chunk,
        data: {
          title: String(title),
          body: String(preview),
          logId: String(logId),
          type: "report_issue",
          inputPreview: String(inputPreview),
          // SW notificationclick opens this (absolute URL preferred for multi-host).
          clickUrl: clickLink ? String(clickLink) : "",
        },
        webpush: {
          headers: { Urgency: "high" },
          ...(clickLink && clickLink.startsWith("https://")
            ? { fcmOptions: { link: clickLink } }
            : {}),
        },
      };

      const resp = await messaging.sendEachForMulticast(message);
      success += resp.successCount;
      failure += resp.failureCount;

      for (let j = 0; j < resp.responses.length; j++) {
        const r = resp.responses[j];
        if (r.success) continue;
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

    return res.status(200).json({
      sent: success,
      failed: failure,
      tokens: tokens.length,
    });
  } catch (e) {
    console.error("[notify-report-issue]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
};
