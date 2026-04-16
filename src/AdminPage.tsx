import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { toastApiError } from "./apiToast";
import {
  clearCalculationAuditLogs,
  clearReportIssueLogs,
  deleteCalculationAuditLog,
  deleteReportIssueLog,
  getReportPushTokenCount,
  loadCalculationAuditLogs,
  loadReportIssueLogs,
  pruneDuplicateCalculationAuditLogs,
  updateReportIssueFixed,
  type CalculationAuditLog,
  type ReportIssueLog,
} from "./firestoreDb";
import { registerReportPush, unregisterReportPush } from "./reportPush";
import {
  REPORT_PUSH_CHANGED_EVENT,
  REPORT_PUSH_ENABLED_KEY,
} from "./useReportIssuePush";

const REPORT_PUSH_TOOLTIP =
  "Browser push when someone submits a pattern issue (Calculator → Report). Requires VITE_FIREBASE_VAPID_KEY in .env, npm run dev (generates firebase-messaging-sw.js), and Cloud Function onReportIssueCreatedPush deployed with APP_PUBLIC_URL in functions/.env.";

function fmtTs(ts?: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return String(ts);
  }
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"audit" | "report">("audit");
  const [auditRows, setAuditRows] = useState<CalculationAuditLog[]>([]);
  const [reportRows, setReportRows] = useState<ReportIssueLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAuditId, setBusyAuditId] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyFixedReportId, setBusyFixedReportId] = useState<string | null>(null);
  const [clearingAudit, setClearingAudit] = useState(false);
  const [clearingReport, setClearingReport] = useState(false);
  const [pruningAuditDupes, setPruningAuditDupes] = useState(false);
  const [reportPushOn, setReportPushOn] = useState(() => {
    try {
      return localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushTokenCount, setPushTokenCount] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [audits, reports, pushCount] = await Promise.all([
        loadCalculationAuditLogs(400),
        loadReportIssueLogs(400),
        getReportPushTokenCount(),
      ]);
      setAuditRows(audits);
      setReportRows(reports);
      setPushTokenCount(pushCount);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load admin data.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const sync = () => {
      try {
        setReportPushOn(localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1");
      } catch {
        setReportPushOn(false);
      }
    };
    window.addEventListener(REPORT_PUSH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(REPORT_PUSH_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (reportPushOn && Notification.permission === "denied") {
      try {
        localStorage.removeItem(REPORT_PUSH_ENABLED_KEY);
      } catch {
        /* ignore */
      }
      setReportPushOn(false);
      window.dispatchEvent(new Event(REPORT_PUSH_CHANGED_EVENT));
    }
  }, [reportPushOn]);

  const toggleReportPush = async () => {
    setPushError(null);
    if (reportPushOn) {
      await unregisterReportPush();
      try {
        localStorage.removeItem(REPORT_PUSH_ENABLED_KEY);
      } catch {
        /* ignore */
      }
      setReportPushOn(false);
      window.dispatchEvent(new Event(REPORT_PUSH_CHANGED_EVENT));
      try {
        setPushTokenCount(await getReportPushTokenCount());
      } catch {
        /* ignore */
      }
      return;
    }
    if (typeof Notification === "undefined") {
      setPushError("This browser does not support notifications.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setPushError("Notifications blocked. Allow them in site settings, then try again.");
      return;
    }
    try {
      localStorage.setItem(REPORT_PUSH_ENABLED_KEY, "1");
    } catch {
      /* ignore */
    }
    setReportPushOn(true);
    window.dispatchEvent(new Event(REPORT_PUSH_CHANGED_EVENT));

    const res = await registerReportPush();
    if (!res.ok) {
      try {
        localStorage.removeItem(REPORT_PUSH_ENABLED_KEY);
      } catch {
        /* ignore */
      }
      setReportPushOn(false);
      window.dispatchEvent(new Event(REPORT_PUSH_CHANGED_EVENT));
      if (res.reason === "no_vapid") {
        setPushError("Add VITE_FIREBASE_VAPID_KEY to .env, restart dev, then enable again.");
      } else if (res.reason === "invalid_vapid") {
        setPushError(res.detail ?? "Invalid VAPID key.");
      } else {
        setPushError(res.detail ?? "Could not register push for this browser.");
      }
    }
    try {
      setPushTokenCount(await getReportPushTokenCount());
    } catch {
      /* ignore */
    }
  };

  const deleteAudit = async (id: string) => {
    const ok = window.confirm("Delete this audit log?");
    if (!ok) return;
    setBusyAuditId(id);
    setError(null);
    try {
      await deleteCalculationAuditLog(id);
      setAuditRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete audit row.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyAuditId(null);
    }
  };

  const clearAudits = async () => {
    const ok = window.confirm("Delete all audit logs? This cannot be undone.");
    if (!ok) return;
    setClearingAudit(true);
    setError(null);
    try {
      await clearCalculationAuditLogs(5000);
      setAuditRows([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to clear audit logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setClearingAudit(false);
    }
  };

  const pruneAuditDupes = async () => {
    const ok = window.confirm(
      "Delete duplicate inputs from Firestore? For each identical pasted input (newest 2000 logs), only the newest row is kept. This cannot be undone.",
    );
    if (!ok) return;
    setPruningAuditDupes(true);
    setError(null);
    try {
      const deleted = await pruneDuplicateCalculationAuditLogs(2000);
      toast.success(
        deleted > 0
          ? `Deleted ${deleted} duplicate input row(s) from the database.`
          : "No duplicate inputs found in the scanned range.",
      );
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete duplicate inputs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setPruningAuditDupes(false);
    }
  };

  const deleteReport = async (id: string) => {
    const ok = window.confirm("Delete this report issue?");
    if (!ok) return;
    setBusyReportId(id);
    setError(null);
    try {
      await deleteReportIssueLog(id);
      setReportRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete report row.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyReportId(null);
    }
  };

  const clearReports = async () => {
    const ok = window.confirm("Delete all report issues? This cannot be undone.");
    if (!ok) return;
    setClearingReport(true);
    setError(null);
    try {
      await clearReportIssueLogs(5000);
      setReportRows([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to clear report logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setClearingReport(false);
    }
  };

  const setReportFixed = async (id: string, fixed: boolean) => {
    const previousFixed = reportRows.find(r => r.id === id)?.fixed === true;
    setBusyFixedReportId(id);
    setError(null);
    setReportRows(prev => prev.map(r => (r.id === id ? { ...r, fixed } : r)));
    try {
      await updateReportIssueFixed(id, fixed);
    } catch (e) {
      setReportRows(prev =>
        prev.map(r => (r.id === id ? { ...r, fixed: previousFixed } : r)),
      );
      const msg = e instanceof Error ? e.message : "Failed to update fixed status.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyFixedReportId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef2f7] font-sans">
      <div className="max-w-[1300px] mx-auto px-4 py-5">
        <div className="bg-white border-2 border-[#dde8f0] rounded-[16px] p-4 shadow-sm mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-black text-[#1a1a1a]">Admin Panel</h1>
            <p className="text-[13px] text-gray-500 mt-1">
              Combined view: <code>calc_audit_logs</code> and <code>report_issue_logs</code>
            </p>
            <div className="mt-3 inline-flex bg-[#f3f7fc] rounded-[10px] p-1 border border-[#d9e6f5]">
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`px-3 py-1.5 text-[12px] font-bold rounded-[8px] transition-colors ${
                  activeTab === "audit" ? "bg-[#1d6fb8] text-white" : "text-[#4a6685]"
                }`}
              >
                Audit
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("report")}
                className={`px-3 py-1.5 text-[12px] font-bold rounded-[8px] transition-colors ${
                  activeTab === "report" ? "bg-[#1d6fb8] text-white" : "text-[#4a6685]"
                }`}
              >
                Report
              </button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void toggleReportPush()}
                title={REPORT_PUSH_TOOLTIP}
                className={`px-3 py-2.5 rounded-[12px] text-[13px] font-bold border-2 transition-colors ${
                  reportPushOn
                    ? "bg-green-50 text-green-800 border-green-300"
                    : "bg-white text-[#4a6685] border-[#dde8f0] hover:bg-[#f5f9ff]"
                }`}
              >
                {reportPushOn ? "🔔 Report push: on" : "🔕 Enable report push"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={
                  loading ||
                  clearingAudit ||
                  clearingReport ||
                  pruningAuditDupes ||
                  busyFixedReportId != null
                }
                className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-[#1d6fb8] text-white active:opacity-90 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
            {pushError && (
              <p className="text-[12px] text-red-600 max-w-[min(100%,420px)] text-right">{pushError}</p>
            )}
            {pushTokenCount != null && pushTokenCount >= 0 && (
              <p className="text-[11px] text-gray-600 max-w-[min(100%,440px)] text-right leading-snug">
                FCM devices in Firestore: <strong>{pushTokenCount}</strong>
                {pushTokenCount === 0 && reportPushOn
                  ? " — saving token after enable can take a second; refresh."
                  : ""}
              </p>
            )}
            <p className="text-[11px] text-gray-500 max-w-[min(100%,440px)] text-right leading-snug">
              Deploy <code className="text-[10px] bg-gray-100 px-1 rounded">firebase deploy --only functions</code>{" "}
              and set <code className="text-[10px] bg-gray-100 px-1 rounded">APP_PUBLIC_URL</code> in{" "}
              <code className="text-[10px] bg-gray-100 px-1 rounded">functions/.env</code> to your live https
              origin so submits notify registered browsers.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-[16px] p-4 text-red-700 mb-4">{error}</div>
        )}

        <div className="space-y-4">
          {activeTab === "audit" && (
          <section className="bg-white border-2 border-[#dde8f0] rounded-[16px] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[#e7eef7] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-extrabold text-[#1a1a1a]">Calculation Audits</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">{auditRows.length} rows</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void pruneAuditDupes()}
                  disabled={loading || clearingAudit || pruningAuditDupes}
                  className="px-3 py-2 rounded-[10px] text-[12px] font-bold bg-amber-600 text-white disabled:opacity-50"
                >
                  {pruningAuditDupes ? "Deleting…" : "Delete duplicate inputs"}
                </button>
                <button
                  type="button"
                  onClick={() => void clearAudits()}
                  disabled={loading || clearingAudit || pruningAuditDupes || auditRows.length === 0}
                  className="px-3 py-2 rounded-[10px] text-[12px] font-bold bg-red-600 text-white disabled:opacity-50"
                >
                  {clearingAudit ? "Clearing…" : "Clear logs"}
                </button>
              </div>
            </div>
            {loading ? (
              <div className="p-4 text-gray-500">Loading…</div>
            ) : auditRows.length === 0 ? (
              <div className="p-4 text-gray-500">No audit logs found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[#f6f9fd] border-b border-[#e3edf7]">
                    <tr>
                      <th className="px-3 py-2 font-bold">Time</th>
                      <th className="px-3 py-2 font-bold">Mode</th>
                      <th className="px-3 py-2 font-bold">Total</th>
                      <th className="px-3 py-2 font-bold">Slot</th>
                      <th className="px-3 py-2 font-bold min-w-[300px]">Input</th>
                      <th className="px-3 py-2 font-bold">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map(r => (
                      <tr key={r.id} className="border-b border-[#eef2f7] align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{fmtTs(r.createdAt)}</td>
                        <td className="px-3 py-2 font-semibold">{r.mode}</td>
                        <td className="px-3 py-2 font-bold">₹{r.total}</td>
                        <td className="px-3 py-2">
                          {r.mode === "wa" && r.waSlotsSummary
                            ? r.waSlotsSummary
                            : (r.selectedSlotName ?? r.selectedSlotId ?? "-")}
                        </td>
                        <td className="px-3 py-2">
                          <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">{r.input}</pre>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void deleteAudit(r.id)}
                            disabled={busyAuditId === r.id || clearingAudit}
                            className="px-2.5 py-1.5 rounded-[10px] text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
                          >
                            {busyAuditId === r.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}

          {activeTab === "report" && (
          <section className="bg-white border-2 border-[#dde8f0] rounded-[16px] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[#e7eef7] flex items-center justify-between">
              <div>
                <h2 className="text-[18px] font-extrabold text-[#1a1a1a]">User Reports</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">{reportRows.length} rows</p>
              </div>
              <button
                type="button"
                onClick={() => void clearReports()}
                disabled={loading || clearingReport || reportRows.length === 0}
                className="px-3 py-2 rounded-[10px] text-[12px] font-bold bg-red-600 text-white disabled:opacity-50"
              >
                {clearingReport ? "Clearing…" : "Clear logs"}
              </button>
            </div>
            {loading ? (
              <div className="p-4 text-gray-500">Loading…</div>
            ) : reportRows.length === 0 ? (
              <div className="p-4 text-gray-500">No report issues found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[#f6f9fd] border-b border-[#e3edf7]">
                    <tr>
                      <th className="px-3 py-2 font-bold">Time</th>
                      <th className="px-3 py-2 font-bold text-center w-[88px]">Fixed</th>
                      <th className="px-3 py-2 font-bold min-w-[230px]">Input</th>
                      <th className="px-3 py-2 font-bold min-w-[170px]">Expected</th>
                      <th className="px-3 py-2 font-bold min-w-[170px]">Note</th>
                      <th className="px-3 py-2 font-bold">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map(r => (
                      <tr
                        key={r.id}
                        className={`border-b border-[#eef2f7] align-top ${r.fixed ? "bg-[#f0fdf4]" : ""}`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{fmtTs(r.createdAt)}</td>
                        <td className="px-3 py-2 text-center align-middle">
                          <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={r.fixed === true}
                              disabled={
                                busyFixedReportId === r.id
                                || busyReportId === r.id
                                || clearingReport
                              }
                              onChange={e => void setReportFixed(r.id, e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                              title="Mark as fixed"
                            />
                            <span className="text-[10px] font-semibold text-gray-500">Fixed</span>
                          </label>
                        </td>
                        <td className="px-3 py-2">
                          <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">{r.input}</pre>
                        </td>
                        <td className="px-3 py-2">
                          <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">{r.expected || "-"}</pre>
                        </td>
                        <td className="px-3 py-2">
                          <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">{r.note || "-"}</pre>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void deleteReport(r.id)}
                            disabled={busyReportId === r.id || clearingReport}
                            className="px-2.5 py-1.5 rounded-[10px] text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
                          >
                            {busyReportId === r.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}
        </div>
      </div>
    </div>
  );
}
