import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { app } from "./firebase";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from "firebase/messaging";

const SW_URL = "/firebase-messaging-sw.js";

function useFcmDemoLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((...args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    const stamp = new Date().toISOString().slice(11, 19);
    const line = `${stamp} ${text}`;
    console.log("[FCM demo]", ...args);
    setLines((prev) => [...prev, line].slice(-200));
  }, []);
  return { lines, log };
}

export default function FcmDemo() {
  const { lines, log } = useFcmDemoLogs();
  const [status, setStatus] = useState("Starting…");
  const [token, setToken] = useState("");
  const messagingRef = useRef<Messaging | null>(null);
  const logBoxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logBoxRef.current?.scrollTo(0, logBoxRef.current.scrollHeight);
  }, [lines]);

  const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() ?? "";

  const refreshToken = useCallback(async () => {
    const messaging = messagingRef.current;
    if (!messaging) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      log("No service worker registration");
      return;
    }
    try {
      log("Calling getToken()…");
      const t = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!t) throw new Error("Empty token from getToken()");
      setToken(t);
      setStatus("Token OK — use Firebase Console → Messaging → Send test message.");
      log("getToken OK (length=", t.length, ")");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[FCM demo] getToken error:", e);
      log("getToken ERROR:", msg);
      setStatus("Error — see log.");
      if (msg.includes("API key not valid") || msg.includes("INVALID_ARGUMENT")) {
        log(
          "Hint: Use real VITE_FIREBASE_* in .env, run npm run dev again, and ensure the Google Cloud API key allows “Firebase Installations API”.",
        );
      }
      if (!vapidKey) {
        log("Hint: Set VITE_FIREBASE_VAPID_KEY in .env (Cloud Messaging → Web Push certificates).");
      }
    }
  }, [log, vapidKey]);

  useEffect(() => {
    let cancelled = false;
    let unsubOnMessage: (() => void) | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const onVis = () => {
      if (document.visibilityState === "visible") void refreshToken();
    };

    void (async () => {
      log("--- FCM demo start ---");
      try {
        const ok = await isSupported().catch(() => false);
        if (!ok) {
          setStatus("FCM not supported here (try Chrome, or HTTPS / localhost).");
          log("isSupported() === false");
          return;
        }
        log("isSupported() === true");

        if (!("serviceWorker" in navigator)) throw new Error("No service worker support");
        log("Registering service worker:", SW_URL);
        const registration = await navigator.serviceWorker.register(SW_URL, {
          type: "classic",
          scope: "/",
        });
        log("SW state=", registration.active?.state ?? registration.installing?.state);
        await navigator.serviceWorker.ready;
        log("Service worker ready.");

        if (!("Notification" in window)) throw new Error("Notifications API missing");
        log("Notification.permission =", Notification.permission);
        if (Notification.permission === "denied") {
          setStatus("Notifications blocked for this site.");
          return;
        }
        if (Notification.permission !== "granted") {
          const r = await Notification.requestPermission();
          log("requestPermission →", r);
          if (r !== "granted") {
            setStatus("Permission not granted.");
            return;
          }
        }

        if (!vapidKey) {
          setStatus("Add VITE_FIREBASE_VAPID_KEY to .env");
          log("Missing VITE_FIREBASE_VAPID_KEY");
          return;
        }

        const messaging = getMessaging(app);
        if (cancelled) return;
        messagingRef.current = messaging;
        log("getMessaging(app) OK");

        unsubOnMessage = onMessage(messaging, (payload) => {
          log("onMessage (foreground) raw:", JSON.stringify(payload));
          const title =
            String(
              payload.notification?.title ||
                (payload.data?.title as string | undefined) ||
                "FCM (foreground)",
            ).trim() || "FCM (foreground)";
          const body =
            String(
              payload.notification?.body ||
                (payload.data?.body as string | undefined) ||
                "",
            ).trim() ||
            (payload.data && Object.keys(payload.data).length
              ? JSON.stringify(payload.data)
              : "(no body — add Notification title & text in the Console)");

          toast.info(`${title}: ${body.slice(0, 120)}${body.length > 120 ? "…" : ""}`, {
            toastId: "fcm-foreground",
          });

          const showOs = async () => {
            if (Notification.permission !== "granted") {
              log("Skip OS notification: permission=", Notification.permission);
              return;
            }
            try {
              const reg = await navigator.serviceWorker.ready;
              await reg.showNotification(title, {
                body,
                tag: `fcm-fg-${Date.now()}`,
                data: payload.data,
                requireInteraction: false,
              });
              log("foreground: registration.showNotification OK");
            } catch (err) {
              console.error("[FCM demo] showNotification (SW) failed:", err);
              log("foreground: showNotification (SW) failed:", err);
              try {
                new Notification(title, { body });
                log("foreground: new Notification() fallback OK");
              } catch (err2) {
                console.error("[FCM demo] new Notification failed:", err2);
                log("foreground: new Notification() failed:", err2);
              }
            }
          };
          void showOs();
        });
        log("onMessage listener attached.");

        await refreshToken();

        document.addEventListener("visibilitychange", onVis);
        intervalId = window.setInterval(() => {
          if (document.visibilityState === "visible") void refreshToken();
        }, 60 * 60 * 1000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[FCM demo]", e);
        log("FATAL:", msg);
        setStatus("Error — see log.");
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      if (intervalId != null) window.clearInterval(intervalId);
      unsubOnMessage?.();
    };
  }, [log, refreshToken, vapidKey]);

  return (
    <div className="min-h-screen bg-[#eef2f7] p-4 font-sans text-[#1a1a1a]">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-black text-[#1d6fb8]">FCM push test</h1>
          <a
            href="/"
            className="rounded-lg border-2 border-[#dde8f0] bg-white px-3 py-2 text-sm font-bold text-[#4a6685] hover:bg-[#f5f9ff]"
          >
            ← Home
          </a>
        </div>
        <p className="text-sm text-gray-600">{status}</p>
        <p className="text-xs text-gray-500">
          Uses <code className="rounded bg-white px-1">VITE_FIREBASE_*</code> from{" "}
          <code className="rounded bg-white px-1">.env</code>. Service worker is generated by{" "}
          <code className="rounded bg-white px-1">npm run dev</code> /{" "}
          <code className="rounded bg-white px-1">npm run build</code> (<code>fcm:sw</code>).
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
          <p className="font-bold">If “Send test message” shows no OS notification:</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>
              <strong>Foreground:</strong> keep this tab focused — you should get a{" "}
              <strong>toast at the top</strong> and a log line <code>onMessage (foreground)</code>.
            </li>
            <li>
              <strong>Background:</strong> switch to another tab or minimize Chrome, then send again (same
              token).
            </li>
            <li>
              Paste the <strong>entire</strong> token from the box above (Firebase → Messaging → Send test
              message → FCM registration token).
            </li>
            <li>
              After the <strong>first</strong> visit, do one <strong>hard refresh</strong> (Cmd+Shift+R) so
              the updated service worker controls the page.
            </li>
            <li>
              Check macOS <strong>Focus / Do Not Disturb</strong> and Chrome → Site settings → Notifications
              for this origin.
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => void refreshToken()}
          className="rounded-xl border-2 border-[#dde8f0] bg-white px-4 py-2 text-sm font-bold text-[#1d6fb8] shadow-sm hover:bg-[#f0f6fc]"
        >
          Refresh FCM token
        </button>
        <div>
          <h2 className="mb-1 text-sm font-bold">Token</h2>
          <textarea
            readOnly
            value={token}
            placeholder="Token appears after permission + VAPID are OK…"
            className="h-24 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-[11px]"
          />
        </div>
        <div>
          <h2 className="mb-1 text-sm font-bold">Log</h2>
          <pre
            ref={logBoxRef}
            className="max-h-[min(50vh,24rem)] overflow-auto rounded-lg bg-[#111] p-3 font-mono text-[11px] text-[#cfc] whitespace-pre-wrap"
          >
            {lines.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}
