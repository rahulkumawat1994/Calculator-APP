import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { toastApiError } from "./apiToast";
import ConfirmDialog from "./ConfirmDialog";
import { calculateTotal } from "./calcUtils";
import {
  clearCalculationAuditLogs,
  clearReportIssueLogs,
  deleteCalculationAuditLog,
  deleteCalculationAuditLogsByIds,
  deleteReportIssueLog,
  deleteReportIssueLogsByIds,
  loadCalculationAuditLogs,
  loadReportIssueLogs,
  pruneDuplicateCalculationAuditLogs,
  updateReportIssueFixed,
  type CalculationAuditLog,
  type ReportIssueLog,
} from "./firestoreDb";
import { registerReportPush, unregisterReportPush } from "./reportPush";
import type { CalculationResult } from "./types";
import {
  REPORT_PUSH_CHANGED_EVENT,
  REPORT_PUSH_ENABLED_KEY,
} from "./useReportIssuePush";

const REPORT_PUSH_TOOLTIP =
  "Notify this browser when someone submits a pattern issue from the calculator.";

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void;
}

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
  const [busyFixedReportId, setBusyFixedReportId] = useState<string | null>(
    null
  );
  const [clearingAudit, setClearingAudit] = useState(false);
  const [clearingReport, setClearingReport] = useState(false);
  const [pruningAuditDupes, setPruningAuditDupes] = useState(false);
  const [selectedAuditIds, setSelectedAuditIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(
    () => new Set()
  );
  const [confirmBulkAuditIds, setConfirmBulkAuditIds] = useState<
    string[] | null
  >(null);
  const [confirmBulkReportIds, setConfirmBulkReportIds] = useState<
    string[] | null
  >(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [bulkAuditDeleting, setBulkAuditDeleting] = useState(false);
  const [bulkReportDeleting, setBulkReportDeleting] = useState(false);
  const [previewAudit, setPreviewAudit] = useState<CalculationAuditLog | null>(
    null
  );
  const [previewResult, setPreviewResult] = useState<CalculationResult | null>(
    null
  );
  const [reportPushOn, setReportPushOn] = useState(() => {
    try {
      return localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pushError, setPushError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [audits, reports] = await Promise.all([
        loadCalculationAuditLogs(400),
        loadReportIssueLogs(400),
      ]);
      setAuditRows(audits);
      setReportRows(reports);
      setSelectedAuditIds(
        (prev) =>
          new Set([...prev].filter((id) => audits.some((r) => r.id === id)))
      );
      setSelectedReportIds(
        (prev) =>
          new Set([...prev].filter((id) => reports.some((r) => r.id === id)))
      );
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
    setSelectedAuditIds(new Set());
    setSelectedReportIds(new Set());
    setConfirmBulkAuditIds(null);
    setConfirmBulkReportIds(null);
  }, [activeTab]);

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
    if (!previewAudit) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [previewAudit]);

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
      return;
    }
    if (typeof Notification === "undefined") {
      setPushError("This browser does not support notifications.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setPushError(
        "Notifications blocked. Allow them in site settings, then try again."
      );
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
        setPushError(
          "Add VITE_FIREBASE_VAPID_KEY to .env, restart dev, then enable again."
        );
      } else if (res.reason === "invalid_vapid") {
        setPushError(res.detail ?? "Invalid VAPID key.");
      } else {
        setPushError(res.detail ?? "Could not register push for this browser.");
      }
    }
  };

  const toggleAuditSelect = (id: string) => {
    setSelectedAuditIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReportSelect = (id: string) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteAuditsBulk = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkAuditDeleting(true);
    setError(null);
    try {
      await deleteCalculationAuditLogsByIds(ids);
      const idSet = new Set(ids);
      setAuditRows((prev) => prev.filter((r) => !idSet.has(r.id)));
      setSelectedAuditIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setConfirmBulkAuditIds(null);
      toast.success(`Deleted ${ids.length} audit log(s).`);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Failed to delete selected audit logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBulkAuditDeleting(false);
    }
  };

  const deleteReportsBulk = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkReportDeleting(true);
    setError(null);
    try {
      await deleteReportIssueLogsByIds(ids);
      const idSet = new Set(ids);
      setReportRows((prev) => prev.filter((r) => !idSet.has(r.id)));
      setSelectedReportIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setConfirmBulkReportIds(null);
      toast.success(`Deleted ${ids.length} report(s).`);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to delete selected reports.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBulkReportDeleting(false);
    }
  };

  const deleteAudit = async (id: string, skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete this audit log?",
        message: "This row will be permanently removed.",
        confirmLabel: "Yes, Delete",
        danger: true,
        run: () => {
          void deleteAudit(id, true);
        },
      });
      return;
    }
    setBusyAuditId(id);
    setError(null);
    try {
      await deleteCalculationAuditLog(id);
      setAuditRows((prev) => prev.filter((r) => r.id !== id));
      setSelectedAuditIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to delete audit row.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyAuditId(null);
    }
  };

  const clearAudits = async (skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete all audit logs?",
        message: "This cannot be undone.",
        confirmLabel: "Yes, Delete All",
        danger: true,
        run: () => {
          void clearAudits(true);
        },
      });
      return;
    }
    setClearingAudit(true);
    setError(null);
    try {
      await clearCalculationAuditLogs(5000);
      setAuditRows([]);
      setSelectedAuditIds(new Set());
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to clear audit logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setClearingAudit(false);
    }
  };

  const pruneAuditDupes = async (skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete duplicate inputs?",
        message:
          "For identical pasted inputs (newest 2000 logs), only the newest row is kept and older copies are removed.\n\nThis cannot be undone.",
        confirmLabel: "Yes, Delete Duplicates",
        danger: true,
        run: () => {
          void pruneAuditDupes(true);
        },
      });
      return;
    }
    setPruningAuditDupes(true);
    setError(null);
    try {
      const deleted = await pruneDuplicateCalculationAuditLogs(2000);
      toast.success(
        deleted > 0
          ? `Deleted ${deleted} duplicate input row(s) from the database.`
          : "No duplicate inputs found in the scanned range."
      );
      await load();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to delete duplicate inputs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setPruningAuditDupes(false);
    }
  };

  const deleteReport = async (id: string, skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete this report issue?",
        message: "This row will be permanently removed.",
        confirmLabel: "Yes, Delete",
        danger: true,
        run: () => {
          void deleteReport(id, true);
        },
      });
      return;
    }
    setBusyReportId(id);
    setError(null);
    try {
      await deleteReportIssueLog(id);
      setReportRows((prev) => prev.filter((r) => r.id !== id));
      setSelectedReportIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to delete report row.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyReportId(null);
    }
  };

  const clearReports = async (skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete all report issues?",
        message: "This cannot be undone.",
        confirmLabel: "Yes, Delete All",
        danger: true,
        run: () => {
          void clearReports(true);
        },
      });
      return;
    }
    setClearingReport(true);
    setError(null);
    try {
      await clearReportIssueLogs(5000);
      setReportRows([]);
      setSelectedReportIds(new Set());
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to clear report logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setClearingReport(false);
    }
  };

  const setReportFixed = async (id: string, fixed: boolean) => {
    const previousFixed = reportRows.find((r) => r.id === id)?.fixed === true;
    setBusyFixedReportId(id);
    setError(null);
    setReportRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, fixed } : r))
    );
    try {
      await updateReportIssueFixed(id, fixed);
    } catch (e) {
      setReportRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, fixed: previousFixed } : r))
      );
      const msg =
        e instanceof Error ? e.message : "Failed to update fixed status.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyFixedReportId(null);
    }
  };

  const openAuditPreview = (row: CalculationAuditLog) => {
    setPreviewAudit(row);
    setPreviewResult(calculateTotal(row.input));
  };

  const closeAuditPreview = () => {
    setPreviewAudit(null);
    setPreviewResult(null);
  };

  return (
    <div className="min-h-screen bg-[#eef2f7] font-sans">
      <div className="mx-auto w-full max-w-[1300px] px-3 py-4 sm:px-4 sm:py-5">
        <div className="mb-4 flex flex-col gap-4 rounded-[16px] border-2 border-[#dde8f0] bg-white p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black text-[#1a1a1a] sm:text-[22px]">
              Admin Panel
            </h1>
            <p className="mt-1 text-xs text-gray-500 sm:text-[13px]">
              <span className="hidden sm:inline">Combined view: </span>
              Audits and user pattern reports
            </p>
            <div className="mt-3 inline-flex w-full max-w-[280px] rounded-[10px] border border-[#d9e6f5] bg-[#f3f7fc] p-1 sm:w-auto sm:max-w-none">
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`min-h-[44px] flex-1 rounded-[8px] px-3 py-2 text-[12px] font-bold transition-colors sm:min-h-0 sm:flex-none sm:py-1.5 ${
                  activeTab === "audit"
                    ? "bg-[#1d6fb8] text-white"
                    : "text-[#4a6685]"
                }`}
              >
                Audit
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("report")}
                className={`min-h-[44px] flex-1 rounded-[8px] px-3 py-2 text-[12px] font-bold transition-colors sm:min-h-0 sm:flex-none sm:py-1.5 ${
                  activeTab === "report"
                    ? "bg-[#1d6fb8] text-white"
                    : "text-[#4a6685]"
                }`}
              >
                Report
              </button>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:shrink-0 sm:items-end">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => void toggleReportPush()}
                title={REPORT_PUSH_TOOLTIP}
                className={`min-h-[44px] w-full rounded-[12px] border-2 px-3 py-2.5 text-[13px] font-bold transition-colors sm:min-h-0 sm:w-auto ${
                  reportPushOn
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-[#dde8f0] bg-white text-[#4a6685] hover:bg-[#f5f9ff]"
                }`}
              >
                {reportPushOn
                  ? "🔔 Report alerts: on"
                  : "🔕 Enable report alerts"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={
                  loading ||
                  clearingAudit ||
                  clearingReport ||
                  pruningAuditDupes ||
                  busyFixedReportId != null ||
                  bulkAuditDeleting ||
                  bulkReportDeleting
                }
                className="min-h-[44px] w-full rounded-[12px] bg-[#1d6fb8] px-4 py-2.5 text-[14px] font-bold text-white active:opacity-90 disabled:opacity-50 sm:min-h-0 sm:w-auto"
              >
                Refresh
              </button>
            </div>
            {pushError && (
              <p className="text-left text-[12px] text-red-600 sm:text-right">
                {pushError}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[16px] border-2 border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:p-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {activeTab === "audit" && (
            <section className="overflow-hidden rounded-[16px] border-2 border-[#dde8f0] bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-[#e7eef7] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold text-[#1a1a1a] sm:text-[18px]">
                    Calculation Audits
                  </h2>
                  <p className="mt-0.5 text-[12px] text-gray-500">
                    {auditRows.length} rows
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  {selectedAuditIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmBulkAuditIds([...selectedAuditIds])
                      }
                      disabled={
                        loading ||
                        clearingAudit ||
                        pruningAuditDupes ||
                        bulkAuditDeleting
                      }
                      className="min-h-[44px] rounded-[10px] bg-red-700 px-3 py-2 text-left text-[12px] font-bold text-white shadow-sm disabled:opacity-50 sm:min-h-0 sm:text-center"
                    >
                      Delete {selectedAuditIds.size} selected
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void pruneAuditDupes()}
                    disabled={
                      loading ||
                      clearingAudit ||
                      pruningAuditDupes ||
                      bulkAuditDeleting
                    }
                    className="min-h-[44px] rounded-[10px] bg-amber-600 px-3 py-2 text-left text-[12px] font-bold text-white disabled:opacity-50 sm:min-h-0 sm:text-center"
                  >
                    {pruningAuditDupes
                      ? "Deleting…"
                      : "Delete duplicate inputs"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearAudits()}
                    disabled={
                      loading ||
                      clearingAudit ||
                      pruningAuditDupes ||
                      auditRows.length === 0 ||
                      bulkAuditDeleting
                    }
                    className="min-h-[44px] rounded-[10px] bg-red-600 px-3 py-2 text-left text-[12px] font-bold text-white disabled:opacity-50 sm:min-h-0 sm:text-center"
                  >
                    {clearingAudit ? "Clearing…" : "Clear logs"}
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="p-3 text-gray-500 sm:p-4">Loading…</div>
              ) : auditRows.length === 0 ? (
                <div className="p-3 text-gray-500 sm:p-4">
                  No audit logs found.
                </div>
              ) : (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[640px] text-left text-[11px] sm:text-[12px]">
                    <thead className="bg-[#f6f9fd] border-b border-[#e3edf7]">
                      <tr>
                        <th className="w-12 px-2 py-2 font-bold text-center">
                          #
                        </th>
                        <th className="px-3 py-2 font-bold">Time</th>
                        <th className="px-3 py-2 font-bold">Mode</th>
                        <th className="px-3 py-2 font-bold">Total</th>
                        <th className="px-3 py-2 font-bold">Slot</th>
                        <th className="px-3 py-2 font-bold min-w-[300px]">
                          Input
                        </th>
                        <th className="px-3 py-2 font-bold">View</th>
                        <th className="px-3 py-2 font-bold">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map((r, rowIdx) => (
                        <tr
                          key={r.id}
                          className="border-b border-[#eef2f7] align-top"
                        >
                          <td className="px-2 py-2 align-middle text-center">
                            <button
                              type="button"
                              title="Tap to select for bulk delete"
                              aria-pressed={selectedAuditIds.has(r.id)}
                              onClick={() => toggleAuditSelect(r.id)}
                              disabled={
                                loading ||
                                clearingAudit ||
                                pruningAuditDupes ||
                                bulkAuditDeleting ||
                                busyAuditId === r.id
                              }
                              className={`mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors disabled:opacity-40 ${
                                selectedAuditIds.has(r.id)
                                  ? "bg-red-600 text-white ring-2 ring-red-800 shadow-sm"
                                  : "bg-[#1d6fb8] text-white hover:bg-[#165fa3]"
                              }`}
                            >
                              {rowIdx + 1}
                            </button>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                            {fmtTs(r.createdAt)}
                          </td>
                          <td className="px-3 py-2 font-semibold">{r.mode}</td>
                          <td className="px-3 py-2 font-bold">₹{r.total}</td>
                          <td className="px-3 py-2">
                            {r.mode === "wa" && r.waSlotsSummary
                              ? r.waSlotsSummary
                              : r.selectedSlotName ?? r.selectedSlotId ?? "-"}
                          </td>
                          <td className="px-3 py-2">
                            <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">
                              {r.input}
                            </pre>
                          </td>
                          <td className="px-2 py-2 sm:px-3">
                            <button
                              type="button"
                              onClick={() => openAuditPreview(r)}
                              className="min-h-[40px] min-w-[72px] rounded-[10px] border border-[#c8dbef] bg-[#eef6ff] px-2.5 py-2 text-[11px] font-bold text-[#1d6fb8] sm:min-h-0 sm:min-w-0 sm:py-1.5"
                            >
                              View calc
                            </button>
                          </td>
                          <td className="px-2 py-2 sm:px-3">
                            <button
                              type="button"
                              onClick={() => void deleteAudit(r.id)}
                              disabled={
                                busyAuditId === r.id ||
                                clearingAudit ||
                                bulkAuditDeleting
                              }
                              className="min-h-[40px] min-w-[72px] rounded-[10px] border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-bold text-red-700 disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:py-1.5"
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
            <section className="overflow-hidden rounded-[16px] border-2 border-[#dde8f0] bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-[#e7eef7] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold text-[#1a1a1a] sm:text-[18px]">
                    User Reports
                  </h2>
                  <p className="mt-0.5 text-[12px] text-gray-500">
                    {reportRows.length} rows
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                  {selectedReportIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmBulkReportIds([...selectedReportIds])
                      }
                      disabled={loading || clearingReport || bulkReportDeleting}
                      className="min-h-[44px] rounded-[10px] bg-red-700 px-3 py-2 text-[12px] font-bold text-white shadow-sm disabled:opacity-50 sm:min-h-0"
                    >
                      Delete {selectedReportIds.size} selected
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void clearReports()}
                    disabled={
                      loading ||
                      clearingReport ||
                      reportRows.length === 0 ||
                      bulkReportDeleting
                    }
                    className="min-h-[44px] w-full rounded-[10px] bg-red-600 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50 sm:min-h-0 sm:w-auto"
                  >
                    {clearingReport ? "Clearing…" : "Clear logs"}
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="p-3 text-gray-500 sm:p-4">Loading…</div>
              ) : reportRows.length === 0 ? (
                <div className="p-3 text-gray-500 sm:p-4">
                  No report issues found.
                </div>
              ) : (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[720px] text-left text-[11px] sm:text-[12px]">
                    <thead className="bg-[#f6f9fd] border-b border-[#e3edf7]">
                      <tr>
                        <th className="w-12 px-2 py-2 font-bold text-center">
                          #
                        </th>
                        <th className="px-3 py-2 font-bold">Time</th>
                        <th className="px-3 py-2 font-bold text-center w-[88px]">
                          Fixed
                        </th>
                        <th className="px-3 py-2 font-bold min-w-[230px]">
                          Input
                        </th>
                        <th className="px-3 py-2 font-bold min-w-[170px]">
                          Expected
                        </th>
                        <th className="px-3 py-2 font-bold min-w-[170px]">
                          Note
                        </th>
                        <th className="px-3 py-2 font-bold">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((r, rowIdx) => (
                        <tr
                          key={r.id}
                          className={`border-b border-[#eef2f7] align-top ${
                            r.fixed ? "bg-[#f0fdf4]" : ""
                          }`}
                        >
                          <td className="px-2 py-2 align-middle text-center">
                            <button
                              type="button"
                              title="Tap to select for bulk delete"
                              aria-pressed={selectedReportIds.has(r.id)}
                              onClick={() => toggleReportSelect(r.id)}
                              disabled={
                                loading ||
                                clearingReport ||
                                bulkReportDeleting ||
                                busyReportId === r.id
                              }
                              className={`mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors disabled:opacity-40 ${
                                selectedReportIds.has(r.id)
                                  ? "bg-red-600 text-white ring-2 ring-red-800 shadow-sm"
                                  : "bg-[#1d6fb8] text-white hover:bg-[#165fa3]"
                              }`}
                            >
                              {rowIdx + 1}
                            </button>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                            {fmtTs(r.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={r.fixed === true}
                                disabled={
                                  busyFixedReportId === r.id ||
                                  busyReportId === r.id ||
                                  clearingReport ||
                                  bulkReportDeleting
                                }
                                onChange={(e) =>
                                  void setReportFixed(r.id, e.target.checked)
                                }
                                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                                title="Mark as fixed"
                              />
                              <span className="text-[10px] font-semibold text-gray-500">
                                Fixed
                              </span>
                            </label>
                          </td>
                          <td className="px-3 py-2">
                            <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">
                              {r.input}
                            </pre>
                          </td>
                          <td className="px-3 py-2">
                            <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">
                              {r.expected || "-"}
                            </pre>
                          </td>
                          <td className="px-3 py-2">
                            <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">
                              {r.note || "-"}
                            </pre>
                          </td>
                          <td className="px-2 py-2 sm:px-3">
                            <button
                              type="button"
                              onClick={() => void deleteReport(r.id)}
                              disabled={
                                busyReportId === r.id ||
                                clearingReport ||
                                bulkReportDeleting
                              }
                              className="min-h-[40px] min-w-[72px] rounded-[10px] border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-bold text-red-700 disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:py-1.5"
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

      {previewAudit && previewResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 overscroll-contain sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAuditPreview();
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-preview-title"
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[16px] border-2 border-[#dbe8f3] bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#e7eef7] bg-[#f6f9fd] px-4 py-3 sm:px-5">
              <div>
                <h3
                  id="audit-preview-title"
                  className="text-[17px] font-extrabold text-[#1a1a1a]"
                >
                  Calculation Preview
                </h3>
                <p className="mt-1 text-[12px] text-gray-600">
                  Parsed with the same calculator logic users use
                </p>
              </div>
              <button
                type="button"
                onClick={closeAuditPreview}
                className="rounded-[10px] border border-[#d5e4f5] bg-white px-3 py-1.5 text-[12px] font-bold text-[#4a6685]"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-2 rounded-[12px] border border-[#e4edf8] bg-[#f8fbff] p-3 text-[12px] sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-gray-500">Time:</span>{" "}
                  {fmtTs(previewAudit.createdAt)}
                </p>
                <p>
                  <span className="font-semibold text-gray-500">Mode:</span>{" "}
                  {previewAudit.mode}
                </p>
                <p>
                  <span className="font-semibold text-gray-500">
                    Saved total:
                  </span>{" "}
                  ₹{previewAudit.total}
                </p>
                <p>
                  <span className="font-semibold text-gray-500">
                    Parsed total:
                  </span>{" "}
                  ₹{previewResult.total}
                  {previewResult.total !== previewAudit.total && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      differs
                    </span>
                  )}
                </p>
                <p>
                  <span className="font-semibold text-gray-500">
                    Parsed lines:
                  </span>{" "}
                  {previewResult.results.length}
                </p>
                <p>
                  <span className="font-semibold text-gray-500">
                    Failed lines:
                  </span>{" "}
                  {previewResult.failedLines?.length ?? 0}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[12px] border border-[#e4edf8] bg-[#f8fbff] p-3">
                  <p className="mb-2 text-[12px] font-semibold text-gray-600">
                    Original input
                  </p>
                  <pre className="max-h-[52vh] overflow-y-auto overscroll-contain rounded-[10px] border border-[#e4edf8] bg-white p-3 font-mono text-[11px] whitespace-pre-wrap wrap-break-word">
                    {previewAudit.input}
                  </pre>
                </div>

                <div className="rounded-[12px] border border-[#e4edf8] bg-[#f8fbff] p-3">
                  <p className="mb-2 text-[12px] font-semibold text-gray-600">
                    Line-by-line result
                  </p>
                  <div className="max-h-[52vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
                    {previewResult.results.length === 0 ? (
                      <div className="rounded-[10px] border border-[#e4edf8] bg-white p-3 text-[12px] text-gray-500">
                        No parsed line items for this input.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {previewResult.results.map((seg, idx) => (
                          <div
                            key={`${idx}-${seg.line}-${seg.rate}`}
                            className="rounded-[10px] border border-[#e4edf8] bg-white p-3"
                          >
                            <div className="mb-1 flex items-center gap-2 text-[12px] font-bold text-[#1d6fb8]">
                              <span>#{idx + 1}</span>
                              {seg.isWP && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                                  WP
                                </span>
                              )}
                              {seg.isDouble && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                                  AB
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-[12px] text-[#222] whitespace-pre-wrap wrap-break-word">
                              {seg.line}
                            </p>
                            <p className="mt-1 text-[12px] text-gray-600">
                              {seg.count} × {seg.rate} ={" "}
                              <span className="font-extrabold text-[#1d6fb8]">
                                {seg.lineTotal}
                              </span>
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {(previewResult.failedLines?.length ?? 0) > 0 && (
                      <div>
                        <p className="mb-2 text-[12px] font-semibold text-red-700">
                          Failed lines
                        </p>
                        <div className="space-y-1.5">
                          {(previewResult.failedLines ?? []).map(
                            (line, idx) => (
                              <pre
                                key={`${idx}-${line}`}
                                className="rounded-[8px] border border-red-200 bg-red-50 p-2 font-mono text-[11px] text-red-700 whitespace-pre-wrap wrap-break-word"
                              >
                                {line}
                              </pre>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        danger={confirmState?.danger ?? false}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          const cfg = confirmState;
          if (!cfg) return;
          setConfirmState(null);
          cfg.run();
        }}
      />

      {typeof document !== "undefined" &&
      confirmBulkAuditIds &&
      confirmBulkAuditIds.length > 0
        ? createPortal(
            <div
              className="fixed inset-0 z-20000 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.45)" }}
              onClick={(e) => {
                if (e.target === e.currentTarget) setConfirmBulkAuditIds(null);
              }}
            >
              <div
                className="w-full max-w-[400px] overflow-hidden rounded-[20px] border-2 border-[#dde8f0] bg-white shadow-2xl"
                role="dialog"
                aria-labelledby="admin-bulk-audit-title"
                aria-modal="true"
              >
                <div className="border-b border-[#e7eef7] px-5 py-4">
                  <h2
                    id="admin-bulk-audit-title"
                    className="text-[18px] font-extrabold text-red-700"
                  >
                    Delete {confirmBulkAuditIds.length} audit log
                    {confirmBulkAuditIds.length === 1 ? "" : "s"}?
                  </h2>
                  <p className="mt-2 text-[13px] leading-snug text-gray-600">
                    This permanently removes the selected rows from Firestore.
                    This cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => void deleteAuditsBulk(confirmBulkAuditIds)}
                    disabled={bulkAuditDeleting}
                    className="flex-1 rounded-[12px] bg-red-600 py-3 text-[15px] font-bold text-white active:opacity-90 disabled:opacity-50"
                  >
                    {bulkAuditDeleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkAuditIds(null)}
                    disabled={bulkAuditDeleting}
                    className="flex-1 rounded-[12px] bg-gray-100 py-3 text-[15px] font-semibold text-gray-700 active:opacity-90 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {typeof document !== "undefined" &&
      confirmBulkReportIds &&
      confirmBulkReportIds.length > 0
        ? createPortal(
            <div
              className="fixed inset-0 z-20000 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.45)" }}
              onClick={(e) => {
                if (e.target === e.currentTarget) setConfirmBulkReportIds(null);
              }}
            >
              <div
                className="w-full max-w-[400px] overflow-hidden rounded-[20px] border-2 border-[#dde8f0] bg-white shadow-2xl"
                role="dialog"
                aria-labelledby="admin-bulk-report-title"
                aria-modal="true"
              >
                <div className="border-b border-[#e7eef7] px-5 py-4">
                  <h2
                    id="admin-bulk-report-title"
                    className="text-[18px] font-extrabold text-red-700"
                  >
                    Delete {confirmBulkReportIds.length} report
                    {confirmBulkReportIds.length === 1 ? "" : "s"}?
                  </h2>
                  <p className="mt-2 text-[13px] leading-snug text-gray-600">
                    This permanently removes the selected user reports from
                    Firestore. This cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => void deleteReportsBulk(confirmBulkReportIds)}
                    disabled={bulkReportDeleting}
                    className="flex-1 rounded-[12px] bg-red-600 py-3 text-[15px] font-bold text-white active:opacity-90 disabled:opacity-50"
                  >
                    {bulkReportDeleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkReportIds(null)}
                    disabled={bulkReportDeleting}
                    className="flex-1 rounded-[12px] bg-gray-100 py-3 text-[15px] font-semibold text-gray-700 active:opacity-90 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
