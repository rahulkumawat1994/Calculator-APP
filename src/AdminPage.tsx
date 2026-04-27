import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  CALCULATE_ALL_SKIP_AUDIT_KEY,
  CALC_LOCAL_ONLY_CHANGED_EVENT,
  calculateTotal,
  filterRowsByLocalDateRange,
  formatAuditDateTimeParts,
  getSkipAuditOnCalculateAll,
  setSkipAuditOnCalculateAll,
  toastApiError,
  totalLabelForDateRange,
} from "@/lib";
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
} from "@/data/firestoreDb";
import { registerReportPush, unregisterReportPush } from "@/services/reportPush";
import type { CalculationResult } from "@/types";
import {
  REPORT_PUSH_CHANGED_EVENT,
  REPORT_PUSH_ENABLED_KEY,
} from "@/hooks/useReportIssuePush";
import ConfirmDialog from "./ConfirmDialog";
import { DangerActionDialog, Modal } from "./ui";

const REPORT_PUSH_TOOLTIP =
  "Notify this browser when someone submits a pattern issue from the calculator.";

function AdminDateTimeStack({
  createdAt,
  size = "table",
}: {
  createdAt?: number;
  size?: "table" | "panel";
}) {
  const { date, time } = formatAuditDateTimeParts(createdAt);
  if (date === "-") {
    return <span className="text-slate-500">-</span>;
  }
  const textSize =
    size === "panel" ? "text-[12px] tabular-nums" : "text-[11px] tabular-nums";
  const timeColor = size === "panel" ? "text-slate-600" : "text-slate-500";
  const dCls = `whitespace-nowrap font-medium text-slate-800 ${textSize}`;
  const tCls = `whitespace-nowrap font-medium ${timeColor} ${textSize}`;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
      <span className={dCls}>{date}</span>
      {time ? <span className={tCls}>{time}</span> : null}
    </div>
  );
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void;
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
  const [allAuditInputsOpen, setAllAuditInputsOpen] = useState(false);
  const [reportPushOn, setReportPushOn] = useState(() => {
    try {
      return localStorage.getItem(REPORT_PUSH_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pushError, setPushError] = useState<string | null>(null);
  const [localOnlyCalculate, setLocalOnlyCalculate] = useState(
    getSkipAuditOnCalculateAll
  );
  const toggleLocalOnlyCalculate = () => {
    const n = !getSkipAuditOnCalculateAll();
    setSkipAuditOnCalculateAll(n);
    setLocalOnlyCalculate(n);
  };
  useEffect(() => {
    const sync = () => setLocalOnlyCalculate(getSkipAuditOnCalculateAll());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CALCULATE_ALL_SKIP_AUDIT_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      CALC_LOCAL_ONLY_CHANGED_EVENT,
      sync as EventListener
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        CALC_LOCAL_ONLY_CHANGED_EVENT,
        sync as EventListener
      );
    };
  }, []);
  /** off = Firestore order (newest first); desc = most failed lines first; asc = fewest/OK first */
  const [auditStatusSort, setAuditStatusSort] = useState<
    "off" | "asc" | "desc"
  >("off");
  /** Inclusive local date range on `createdAt` (`YYYY-MM-DD`); both empty = no filter. */
  const [auditDateFrom, setAuditDateFrom] = useState("");
  const [auditDateTo, setAuditDateTo] = useState("");

  const hasDateRangeFilter = Boolean(
    auditDateFrom.trim() || auditDateTo.trim()
  );

  const dateFilteredAuditRows = useMemo(
    () => filterRowsByLocalDateRange(auditRows, auditDateFrom, auditDateTo),
    [auditRows, auditDateFrom, auditDateTo]
  );

  const displayAuditRows = useMemo(() => {
    if (auditStatusSort === "off") return dateFilteredAuditRows;
    const fc = (r: CalculationAuditLog) => r.failedCount ?? 0;
    return [...dateFilteredAuditRows].sort((a, b) => {
      const na = fc(a);
      const nb = fc(b);
      if (na !== nb) return auditStatusSort === "asc" ? na - nb : nb - na;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  }, [dateFilteredAuditRows, auditStatusSort]);

  /** Sum of stored `total` (calculator grand total) for the current date filter. */
  const dateFilteredTotalSum = useMemo(
    () =>
      dateFilteredAuditRows.reduce(
        (s, r) => s + (Number.isFinite(r.total) ? r.total : 0),
        0
      ),
    [dateFilteredAuditRows]
  );
  const dateFilteredProfit5Pct = useMemo(
    () => Math.round(dateFilteredTotalSum * 0.05),
    [dateFilteredTotalSum]
  );

  const combinedAllAuditInputText = useMemo(
    () => displayAuditRows.map((r) => r.input ?? "").join("\n\n"),
    [displayAuditRows]
  );

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
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 font-sans text-slate-900 antialiased">
      <div className="mx-auto w-full max-w-[1300px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05),0_20px_25px_-5px_rgba(15,23,42,0.04)] sm:mb-8">
          <div className="h-1 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600" aria-hidden />
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Internal
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px]">
                Admin
              </h1>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
                <span className="hidden sm:inline">Calculation audits and </span>
                user pattern reports in one place
              </p>
              <div
                className="mt-4 inline-flex w-full max-w-sm rounded-xl bg-slate-100/90 p-1 sm:w-auto sm:max-w-none"
                role="tablist"
                aria-label="Admin section"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "audit"}
                  onClick={() => setActiveTab("audit")}
                  className={`min-h-[44px] flex-1 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-all sm:min-h-0 sm:flex-none sm:py-2 ${
                    activeTab === "audit"
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Audits
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "report"}
                  onClick={() => setActiveTab("report")}
                  className={`min-h-[44px] flex-1 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-all sm:min-h-0 sm:flex-none sm:py-2 ${
                    activeTab === "report"
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Reports
                </button>
              </div>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-3 sm:w-[min(100%,20rem)] sm:shrink-0 sm:items-stretch">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200/60 bg-gradient-to-r from-amber-50/90 to-amber-50/30 px-3.5 py-2.5 shadow-sm">
                <p className="min-w-0 text-[12px] font-medium leading-snug text-amber-950/90 sm:text-[13px]">
                  Local calculate only
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={localOnlyCalculate}
                  aria-label="Local calculate only, skip audit API"
                  onClick={toggleLocalOnlyCalculate}
                  className={`relative h-7 w-[52px] shrink-0 cursor-pointer rounded-full border-2 transition-colors ${
                    localOnlyCalculate
                      ? "border-amber-500 bg-amber-400"
                      : "border-slate-200 bg-slate-200/80"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      localOnlyCalculate
                        ? "translate-x-[1.4rem]"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <button
                  type="button"
                  onClick={() => void toggleReportPush()}
                  title={REPORT_PUSH_TOOLTIP}
                  className={`min-h-[44px] w-full rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold transition-colors sm:min-h-0 sm:w-auto ${
                    reportPushOn
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100"
                      : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
                  }`}
                >
                  {reportPushOn
                    ? "Report alerts on"
                    : "Enable report alerts"}
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
                  className="min-h-[44px] w-full rounded-xl bg-blue-600 px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm ring-1 ring-blue-500/20 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 sm:min-h-0 sm:w-auto"
                >
                  Refresh
                </button>
              </div>
            {pushError && (
              <p className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-left text-[12px] text-red-700">
                {pushError}
              </p>
            )}
            </div>
          </div>
        </div>

        {error && (
          <div
            className="mb-6 flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50/90 px-4 py-3 text-sm text-red-800 shadow-sm sm:px-5"
            role="alert"
          >
            <span className="mt-0.5 shrink-0 text-red-500" aria-hidden>
              ●
            </span>
            <span className="min-w-0">{error}</span>
          </div>
        )}

        <div className="space-y-5 sm:space-y-6">
          {activeTab === "audit" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-200/40">
              <div className="border-b border-slate-100 bg-slate-50/50">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch sm:justify-between sm:gap-6 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                      Calculation audits
                    </h2>
                    <p className="mt-1 text-[12px] text-slate-500 sm:text-[13px]">
                      {displayAuditRows.length} in view
                      {hasDateRangeFilter
                        ? ` · ${auditRows.length} loaded from server`
                        : ` · ${auditRows.length} loaded`}
                    </p>
                    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200/60 bg-white p-3 sm:p-3.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Date range
                      </p>
                      <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:items-end min-[420px]:gap-3">
                        <label className="flex min-h-[40px] flex-1 flex-col gap-1 sm:min-h-0 sm:min-w-[8rem] sm:max-w-[10rem]">
                          <span className="shrink-0 text-[12px] font-medium text-slate-600">
                            From
                          </span>
                          <input
                            type="date"
                            value={auditDateFrom}
                            onChange={(e) => setAuditDateFrom(e.target.value)}
                            max={auditDateTo || undefined}
                            className="min-h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-[13px] text-slate-900 shadow-inner outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            aria-label="Filter from local date (inclusive)"
                          />
                        </label>
                        <label className="flex min-h-[40px] flex-1 flex-col gap-1 sm:min-h-0 sm:min-w-[8rem] sm:max-w-[10rem]">
                          <span className="shrink-0 text-[12px] font-medium text-slate-600">
                            To
                          </span>
                          <input
                            type="date"
                            value={auditDateTo}
                            onChange={(e) => setAuditDateTo(e.target.value)}
                            min={auditDateFrom || undefined}
                            className="min-h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-[13px] text-slate-900 shadow-inner outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            aria-label="Filter to local date (inclusive)"
                          />
                        </label>
                        {hasDateRangeFilter ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAuditDateFrom("");
                              setAuditDateTo("");
                            }}
                            className="h-10 self-end rounded-lg border border-slate-200 bg-white px-3.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                          >
                            Clear range
                          </button>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3 sm:gap-3">
                        <div className="rounded-lg bg-slate-100/80 px-2.5 py-1.5 sm:px-3">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            {totalLabelForDateRange(auditDateFrom, auditDateTo)}
                          </p>
                          <p className="whitespace-nowrap text-[15px] font-bold tabular-nums text-blue-600">
                            ₹
                            {dateFilteredTotalSum.toLocaleString("en-IN", {
                              maximumFractionDigits: 0,
                            })}
                          </p>
                        </div>
                        <div className="h-8 w-px bg-slate-200" aria-hidden />
                        <div className="rounded-lg border border-emerald-100/80 bg-emerald-50/50 px-2.5 py-1.5 sm:px-3">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700/80">
                            Profit (5%)
                          </p>
                          <p className="whitespace-nowrap text-[15px] font-bold tabular-nums text-emerald-800">
                            ₹
                            {dateFilteredProfit5Pct.toLocaleString("en-IN", {
                              maximumFractionDigits: 0,
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-col justify-start gap-2 sm:w-[min(100%,11rem)] sm:shrink-0">
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
                        className="h-10 w-full rounded-lg bg-red-700 text-[12px] font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-50"
                      >
                        Delete ({selectedAuditIds.size})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAllAuditInputsOpen(true)}
                      disabled={
                        loading ||
                        clearingAudit ||
                        pruningAuditDupes ||
                        bulkAuditDeleting ||
                        displayAuditRows.length === 0
                      }
                      title="Open every stored input in one text area (current table order)"
                      className="h-10 w-full rounded-lg border border-blue-200 bg-white text-[12px] font-semibold text-blue-700 shadow-sm transition hover:bg-sky-50/80 disabled:opacity-50"
                    >
                      All inputs
                    </button>
                    <button
                      type="button"
                      onClick={() => void pruneAuditDupes()}
                      disabled={
                        loading ||
                        clearingAudit ||
                        pruningAuditDupes ||
                        bulkAuditDeleting
                      }
                      className="h-10 w-full rounded-lg border border-amber-200/80 bg-amber-50 text-[12px] font-semibold text-amber-900/90 transition hover:bg-amber-100/80 disabled:opacity-50"
                    >
                      {pruningAuditDupes
                        ? "Pruning…"
                        : "Dedupe inputs"}
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
                      className="h-10 w-full rounded-lg border border-red-200/80 bg-red-50/90 text-[12px] font-semibold text-red-800 transition hover:bg-red-100/60 disabled:opacity-50"
                    >
                      {clearingAudit ? "Clearing…" : "Clear all logs"}
                    </button>
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="flex min-h-[120px] items-center justify-center p-6 text-slate-500 sm:p-8">
                  <div className="text-center text-[14px]">
                    <div className="mb-2 inline-block h-6 w-6 animate-pulse rounded-full border-2 border-slate-200 border-t-blue-500" />
                    <p>Loading audit logs…</p>
                  </div>
                </div>
              ) : auditRows.length === 0 ? (
                <div className="p-8 text-center text-[14px] text-slate-500 sm:p-10">
                  <p className="text-slate-400">No audit logs yet</p>
                </div>
              ) : displayAuditRows.length === 0 ? (
                <div className="p-6 text-center text-sm sm:p-8">
                  <p className="font-semibold text-slate-800">No rows in this range</p>
                  <p className="mt-1.5 max-w-sm mx-auto text-[12px] text-slate-500 leading-relaxed">
                    Try a different range or clear the date filter. Only a recent
                    batch is loaded — older days may be missing.
                  </p>
                  {hasDateRangeFilter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAuditDateFrom("");
                        setAuditDateTo("");
                      }}
                      className="mt-4 rounded-lg border border-blue-200 bg-white px-4 py-2 text-[12px] font-semibold text-blue-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Clear range
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[720px] text-left text-[11px] sm:text-[12px]">
                    <thead className="bg-slate-100/80 text-slate-600">
                      <tr>
                        <th
                          scope="col"
                          className="w-12 py-2.5 pl-3 pr-1 text-center text-[10px] font-semibold uppercase tracking-wider"
                        >
                          #
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Date & time
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Mode
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Total
                        </th>
                        <th
                          scope="col"
                          className="w-[100px] px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setAuditStatusSort((s) =>
                                s === "off"
                                  ? "desc"
                                  : s === "desc"
                                  ? "asc"
                                  : "off"
                              )
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-slate-600 hover:text-blue-600"
                            title="Sort: failed first → OK first → default order"
                            aria-sort={
                              auditStatusSort === "off"
                                ? "none"
                                : auditStatusSort === "asc"
                                ? "ascending"
                                : "descending"
                            }
                          >
                            Status
                            {auditStatusSort === "asc" && (
                              <span className="text-blue-600" aria-hidden>
                                ▲
                              </span>
                            )}
                            {auditStatusSort === "desc" && (
                              <span className="text-blue-600" aria-hidden>
                                ▼
                              </span>
                            )}
                            {auditStatusSort === "off" && (
                              <span
                                className="text-slate-300 font-normal"
                                aria-hidden
                              >
                                ↕
                              </span>
                            )}
                          </button>
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Slot
                        </th>
                        <th
                          scope="col"
                          className="min-w-[300px] px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Input
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 pr-1 text-center text-[10px] font-semibold uppercase tracking-wider"
                        >
                          View
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 pl-1 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Delete
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayAuditRows.map((r, rowIdx) => (
                        <tr
                          key={r.id}
                          className="border-b border-slate-100 align-top even:bg-slate-50/40 transition-[background-color] hover:bg-sky-50/40"
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
                                  ? "bg-red-600 text-white ring-2 ring-red-700 shadow-sm"
                                  : "bg-blue-600 text-white shadow-sm ring-1 ring-blue-500/20 hover:bg-blue-700"
                              }`}
                            >
                              {rowIdx + 1}
                            </button>
                          </td>
                          <td className="px-2 py-2.5 text-slate-600 sm:px-3">
                            <AdminDateTimeStack createdAt={r.createdAt} />
                          </td>
                          <td className="px-2 py-2.5 font-medium text-slate-800 sm:px-3">
                            {r.mode}
                          </td>
                          <td className="px-2 py-2.5 font-bold tabular-nums text-slate-900 sm:px-3">
                            ₹{r.total}
                          </td>
                          <td className="px-2 py-2.5 sm:px-3">
                            {(() => {
                              const n = r.failedCount ?? 0;
                              return n > 0 ? (
                                <span
                                  className="inline-block rounded-md bg-amber-100/90 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                                  title="Lines the parser could not match"
                                >
                                  Failed ({n})
                                </span>
                              ) : (
                                <span className="text-[12px] font-semibold text-emerald-600">
                                  OK
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2.5 text-slate-600 sm:px-3">
                            {r.mode === "wa" && r.waSlotsSummary
                              ? r.waSlotsSummary
                              : r.selectedSlotName ?? r.selectedSlotId ?? "—"}
                          </td>
                          <td className="px-2 py-2.5 sm:px-3">
                            <pre className="max-h-[120px] overflow-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-800 wrap-break-word">
                              {r.input}
                            </pre>
                          </td>
                          <td className="px-1 py-2 text-center sm:px-2">
                            <button
                              type="button"
                              onClick={() => openAuditPreview(r)}
                              className="h-8 min-w-[4.5rem] rounded-md border border-blue-200/80 bg-white px-2.5 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-sky-50/80 sm:h-7"
                            >
                              View
                            </button>
                          </td>
                          <td className="px-1 py-2 pl-0 text-right sm:px-2 sm:pl-0">
                            <button
                              type="button"
                              onClick={() => void deleteAudit(r.id)}
                              disabled={
                                busyAuditId === r.id ||
                                clearingAudit ||
                                bulkAuditDeleting
                              }
                              className="h-8 min-w-[4.5rem] rounded-md border border-red-200/80 bg-red-50/50 px-2.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100/60 disabled:opacity-50 sm:h-7"
                            >
                              {busyAuditId === r.id ? "…" : "Delete"}
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
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-200/40">
              <div className="border-b border-slate-100 bg-slate-50/50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                    User reports
                  </h2>
                  <p className="mt-0.5 text-[12px] text-slate-500 sm:text-[13px]">
                    {reportRows.length} in list
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
                      className="h-10 w-full rounded-lg bg-red-700 text-[12px] font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-50 sm:min-w-[10rem] sm:px-3"
                    >
                      Delete ({selectedReportIds.size})
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
                    className="h-10 w-full rounded-lg border border-red-200/80 bg-red-50/90 text-[12px] font-semibold text-red-800 transition hover:bg-red-100/60 disabled:opacity-50 sm:min-w-[7rem] sm:px-3"
                  >
                    {clearingReport ? "Clearing…" : "Clear all"}
                  </button>
                </div>
                </div>
              </div>
              {loading ? (
                <div className="flex min-h-[100px] items-center justify-center p-6 text-slate-500">
                  <p className="text-[14px]">Loading reports…</p>
                </div>
              ) : reportRows.length === 0 ? (
                <div className="p-8 text-center text-slate-500 sm:p-10">
                  <p className="text-slate-400">No user reports</p>
                </div>
              ) : (
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[720px] text-left text-[11px] sm:text-[12px]">
                    <thead className="bg-slate-100/80 text-slate-600">
                      <tr>
                        <th
                          scope="col"
                          className="w-12 py-2.5 pl-3 pr-1 text-center text-[10px] font-semibold uppercase tracking-wider"
                        >
                          #
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Date & time
                        </th>
                        <th
                          scope="col"
                          className="w-[88px] px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Fixed
                        </th>
                        <th
                          scope="col"
                          className="min-w-[230px] px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Input
                        </th>
                        <th
                          scope="col"
                          className="min-w-[170px] px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Expected
                        </th>
                        <th
                          scope="col"
                          className="min-w-[170px] px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Note
                        </th>
                        <th
                          scope="col"
                          className="pr-3 pl-1 text-right text-[10px] font-semibold uppercase tracking-wider"
                        >
                          Del
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((r, rowIdx) => (
                        <tr
                          key={r.id}
                          className={`border-b border-slate-100 align-top even:bg-slate-50/40 transition-[background-color] hover:bg-sky-50/40 ${
                            r.fixed ? "bg-emerald-50/50" : ""
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
                          <td className="px-2 py-2.5 text-slate-600 sm:px-3">
                            <AdminDateTimeStack createdAt={r.createdAt} />
                          </td>
                          <td className="px-2 py-2.5 text-center align-middle sm:px-3">
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
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                                title="Mark as fixed"
                              />
                              <span className="text-[9px] font-medium uppercase text-slate-500">
                                Fixed
                              </span>
                            </label>
                          </td>
                          <td className="px-2 py-2.5 sm:px-3">
                            <pre className="max-h-[120px] overflow-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-800 wrap-break-word">
                              {r.input}
                            </pre>
                          </td>
                          <td className="px-2 py-2.5 sm:px-3">
                            <pre className="max-h-[120px] overflow-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-800 wrap-break-word">
                              {r.expected || "—"}
                            </pre>
                          </td>
                          <td className="px-2 py-2.5 sm:px-3">
                            <pre className="max-h-[120px] overflow-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-800 wrap-break-word">
                              {r.note || "—"}
                            </pre>
                          </td>
                          <td className="px-1 py-2 pl-0 text-right sm:px-2 sm:pl-0">
                            <button
                              type="button"
                              onClick={() => void deleteReport(r.id)}
                              disabled={
                                busyReportId === r.id ||
                                clearingReport ||
                                bulkReportDeleting
                              }
                              className="h-8 min-w-[3.5rem] rounded-md border border-red-200/80 bg-red-50/50 px-2 text-[11px] font-semibold text-red-700 transition hover:bg-red-100/60 disabled:opacity-50"
                            >
                              {busyReportId === r.id ? "…" : "Del"}
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
        <Modal
          open
          onBackdropClick={closeAuditPreview}
          backdrop="blurred"
          overlayClassName="p-3 sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-preview-title"
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5 sm:px-5">
              <div>
                <h3
                  id="audit-preview-title"
                  className="text-[18px] font-bold tracking-tight text-slate-900"
                >
                  Calculation preview
                </h3>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Same engine as the home calculator
                </p>
              </div>
              <button
                type="button"
                onClick={closeAuditPreview}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-[12px] sm:grid-cols-2">
                <div>
                  <span className="font-semibold text-gray-500">Recorded</span>
                  <div
                    className="mt-0.5"
                    role="group"
                    aria-label="Date and time"
                  >
                    <AdminDateTimeStack
                      size="panel"
                      createdAt={previewAudit.createdAt}
                    />
                  </div>
                </div>
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
        </Modal>
      )}

      {allAuditInputsOpen && (
        <Modal
          open
          onBackdropClick={() => setAllAuditInputsOpen(false)}
          backdrop="blurred"
          overlayClassName="p-3 sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-all-inputs-title"
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5 sm:px-5">
              <div>
                <h3
                  id="audit-all-inputs-title"
                  className="text-[18px] font-bold tracking-tight text-slate-900"
                >
                  All audit inputs
                </h3>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {displayAuditRows.length} pastes, blank line between
                  (table order{auditStatusSort !== "off" ? ", status sort" : ""}
                  ).
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        combinedAllAuditInputText
                      );
                      toast.success("Copied to clipboard");
                    } catch {
                      toast.error("Could not copy");
                    }
                  }}
                  className="rounded-lg border border-blue-200 bg-blue-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setAllAuditInputsOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 p-4 sm:p-5">
              <textarea
                readOnly
                value={combinedAllAuditInputText}
                spellCheck={false}
                className="h-[min(70vh,720px)] w-full resize-y rounded-xl border border-slate-200/90 bg-slate-50/50 p-3.5 font-mono text-[12px] text-slate-800 leading-relaxed ring-0 outline-none focus:ring-2 focus:ring-blue-500/20 sm:p-4"
                aria-label="All calculation audit inputs concatenated"
              />
            </div>
          </div>
        </Modal>
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

      <DangerActionDialog
        open={Boolean(confirmBulkAuditIds && confirmBulkAuditIds.length > 0)}
        onClose={() => {
          if (!bulkAuditDeleting) setConfirmBulkAuditIds(null);
        }}
        onConfirm={() => {
          if (confirmBulkAuditIds?.length)
            void deleteAuditsBulk(confirmBulkAuditIds);
        }}
        titleId="admin-bulk-audit-title"
        title={
          confirmBulkAuditIds?.length
            ? `Delete ${confirmBulkAuditIds.length} audit log${
                confirmBulkAuditIds.length === 1 ? "" : "s"
              }?`
            : ""
        }
        message={
          <p className="text-[13px] leading-snug text-gray-600">
            This permanently removes the selected rows from Firestore. This
            cannot be undone.
          </p>
        }
        confirmLabel="Yes, Delete"
        confirmLoading={bulkAuditDeleting}
        loadingLabel="Deleting…"
      />

      <DangerActionDialog
        open={Boolean(confirmBulkReportIds && confirmBulkReportIds.length > 0)}
        onClose={() => {
          if (!bulkReportDeleting) setConfirmBulkReportIds(null);
        }}
        onConfirm={() => {
          if (confirmBulkReportIds?.length)
            void deleteReportsBulk(confirmBulkReportIds);
        }}
        titleId="admin-bulk-report-title"
        title={
          confirmBulkReportIds?.length
            ? `Delete ${confirmBulkReportIds.length} report${
                confirmBulkReportIds.length === 1 ? "" : "s"
              }?`
            : ""
        }
        message={
          <p className="text-[13px] leading-snug text-gray-600">
            This permanently removes the selected user reports from Firestore.
            This cannot be undone.
          </p>
        }
        confirmLabel="Yes, Delete"
        confirmLoading={bulkReportDeleting}
        loadingLabel="Deleting…"
      />
    </div>
  );
}
