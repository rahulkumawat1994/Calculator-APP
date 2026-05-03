import { useEffect, useMemo, useRef, useState } from "react";
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
  freshParsedTotalLabelForDateRange,
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
  updateCalculationAuditSavedFields,
  updateReportIssueFixed,
  type CalculationAuditLog,
  type ReportIssueLog,
} from "@/data/firestoreDb";
import {
  registerReportPush,
  unregisterReportPush,
} from "@/services/reportPush";
import type { CalculationResult } from "@/types";
import { parseWhatsAppMessages } from "@/calc/whatsapp";
import { calculateTotalWithSources } from "@/calc/pasteAndTotal";
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

async function copyAuditInputToClipboard(
  text: string,
  successMessage = "Input copied"
) {
  try {
    await navigator.clipboard.writeText(text ?? "");
    toast.success(successMessage);
  } catch {
    toast.error("Could not copy");
  }
}

function auditSavedFieldsFromParsed(parsed: CalculationResult): {
  total: number;
  resultCount: number;
  failedCount: number;
} {
  return {
    total: parsed.total,
    resultCount: parsed.results.length,
    failedCount: parsed.failedLines?.length ?? 0,
  };
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"audit" | "report">("audit");
  const [auditRows, setAuditRows] = useState<CalculationAuditLog[]>([]);
  const [reportRows, setReportRows] = useState<ReportIssueLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Distinct from empty DB: load failed (would wrongly show “No audit logs yet”). */
  const [auditListLoadError, setAuditListLoadError] = useState<string | null>(
    null
  );
  const [reportListLoadError, setReportListLoadError] = useState<string | null>(
    null
  );
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
  /** For each segment in previewResult, the raw input lines (pre-normalisation) that produced it. */
  const [segmentSourceIndices, setSegmentSourceIndices] = useState<
    number[][] | null
  >(null);
  /** The rawLines array that corresponds to segmentSourceIndices (flat, WA-offset-adjusted). */
  const [previewRawLines, setPreviewRawLines] = useState<string[] | null>(null);
  /** Which segment indices are currently highlighted (single or multi-select). */
  const [activeSegIdxs, setActiveSegIdxs] = useState<Set<number>>(new Set());
  /** When true, clicking multiple cards accumulates highlights instead of replacing. */
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  /** Ref to the original-input <pre> so we can scroll to the highlighted line. */
  const inputPreRef = useRef<HTMLPreElement>(null);
  /** The segment index most recently clicked — determines scroll target. */
  const lastClickedSegIdxRef = useRef<number | null>(null);
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
  /** off = no diff sort; desc = parser mismatch (Differs) first; asc = match saved total first */
  const [auditDiffSort, setAuditDiffSort] = useState<"off" | "asc" | "desc">(
    "off"
  );
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

  /** Re-run parser on stored input; flags rows where current engine total ≠ saved audit total. */
  const auditTotalRecalc = useMemo(() => {
    const m = new Map<string, { parsedTotal: number; differs: boolean }>();
    for (const r of auditRows) {
      const saved = Number.isFinite(r.total) ? r.total : NaN;
      // WhatsApp inputs must be parsed per-message (same as the calculator does) so that
      // lastInheritedRate never leaks across message boundaries — otherwise the totals diverge.
      const waMessages = parseWhatsAppMessages(r.input ?? "");
      const parsed = waMessages
        ? waMessages.reduce((s, msg) => s + msg.result.total, 0)
        : calculateTotal(r.input ?? "").total;
      m.set(r.id, {
        parsedTotal: parsed,
        differs: !Number.isFinite(saved) || saved !== parsed,
      });
    }
    return m;
  }, [auditRows]);

  const displayAuditRows = useMemo(() => {
    const rows = [...dateFilteredAuditRows];
    const diffKey = (r: CalculationAuditLog) =>
      auditTotalRecalc.get(r.id)?.differs === true ? 1 : 0;
    const fc = (r: CalculationAuditLog) => r.failedCount ?? 0;

    rows.sort((a, b) => {
      if (auditDiffSort !== "off") {
        const da = diffKey(a);
        const db = diffKey(b);
        if (da !== db) {
          return auditDiffSort === "desc" ? db - da : da - db;
        }
      }
      if (auditStatusSort !== "off") {
        const na = fc(a);
        const nb = fc(b);
        if (na !== nb) {
          return auditStatusSort === "asc" ? na - nb : nb - na;
        }
      }
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return rows;
  }, [dateFilteredAuditRows, auditStatusSort, auditDiffSort, auditTotalRecalc]);

  /** Sum of stored `total` (calculator grand total) for the current date filter. */
  const dateFilteredTotalSum = useMemo(
    () =>
      dateFilteredAuditRows.reduce(
        (s, r) => s + (Number.isFinite(r.total) ? r.total : 0),
        0
      ),
    [dateFilteredAuditRows]
  );
  /**
   * Sum of current-engine totals **per audit row** (same rows as Total loaded).
   * Matches Total (loaded) after each row’s saved total is updated to parsed.
   */
  const dateFilteredFreshParsedTotal = useMemo(
    () =>
      dateFilteredAuditRows.reduce((s, r) => {
        const p = auditTotalRecalc.get(r.id)?.parsedTotal;
        return s + (typeof p === "number" && Number.isFinite(p) ? p : 0);
      }, 0),
    [dateFilteredAuditRows, auditTotalRecalc]
  );
  const dateFilteredProfit5Pct = useMemo(
    () => Math.round(dateFilteredTotalSum * 0.05),
    [dateFilteredTotalSum]
  );

  /** Only surface “Freshly parsed” when it disagrees with saved sum (drift / logic change). */
  const auditSavedVersusParserDiffers = useMemo(
    () => dateFilteredTotalSum !== dateFilteredFreshParsedTotal,
    [dateFilteredTotalSum, dateFilteredFreshParsedTotal]
  );

  const combinedAllAuditInputText = useMemo(
    () => displayAuditRows.map((r) => r.input ?? "").join("\n\n"),
    [displayAuditRows]
  );

  /** Selected rows’ inputs in table order, then any selected id not in current table (e.g. filter). */
  const combinedSelectedAuditInput = useMemo(() => {
    const parts: string[] = [];
    const used = new Set<string>();
    for (const r of displayAuditRows) {
      if (!selectedAuditIds.has(r.id)) continue;
      used.add(r.id);
      parts.push(r.input ?? "");
    }
    for (const id of selectedAuditIds) {
      if (used.has(id)) continue;
      const r = auditRows.find((x) => x.id === id);
      if (r) parts.push(r.input ?? "");
    }
    return parts.join("\n\n");
  }, [displayAuditRows, auditRows, selectedAuditIds]);

  const load = async () => {
    setLoading(true);
    setError(null);
    setAuditListLoadError(null);
    setReportListLoadError(null);
    try {
      const [auditOutcome, reportOutcome] = await Promise.allSettled([
        loadCalculationAuditLogs(400),
        loadReportIssueLogs(400),
      ]);

      const bannerParts: string[] = [];

      if (auditOutcome.status === "fulfilled") {
        const audits = auditOutcome.value;
        setAuditRows(audits);
        setSelectedAuditIds(
          (prev) =>
            new Set([...prev].filter((id) => audits.some((r) => r.id === id)))
        );
      } else {
        console.warn("loadCalculationAuditLogs failed:", auditOutcome.reason);
        setAuditRows([]);
        setSelectedAuditIds(new Set());
        const msg =
          auditOutcome.reason instanceof Error
            ? auditOutcome.reason.message
            : "Could not load audit logs.";
        setAuditListLoadError(msg);
        bannerParts.push("Audit logs could not be loaded.");
        toastApiError(auditOutcome.reason, "Could not load audit logs.");
      }

      if (reportOutcome.status === "fulfilled") {
        const reports = reportOutcome.value;
        setReportRows(reports);
        setSelectedReportIds(
          (prev) =>
            new Set([...prev].filter((id) => reports.some((r) => r.id === id)))
        );
      } else {
        console.warn("loadReportIssueLogs failed:", reportOutcome.reason);
        setReportRows([]);
        setSelectedReportIds(new Set());
        const msg =
          reportOutcome.reason instanceof Error
            ? reportOutcome.reason.message
            : "Could not load report issues.";
        setReportListLoadError(msg);
        bannerParts.push("User reports could not be loaded.");
        toastApiError(reportOutcome.reason, "Could not load report issues.");
      }

      if (bannerParts.length > 0) {
        setError(bannerParts.join(" "));
      }
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

  // Auto-scroll the original-input panel to the clicked segment's source line.
  useEffect(() => {
    const segIdx = lastClickedSegIdxRef.current;
    if (
      activeSegIdxs.size === 0 ||
      segIdx === null ||
      !activeSegIdxs.has(segIdx) ||
      !inputPreRef.current ||
      !segmentSourceIndices ||
      !previewRawLines
    )
      return;

    const container = inputPreRef.current;
    const srcIdxs = segmentSourceIndices[segIdx];
    if (!srcIdxs || srcIdxs.length === 0) return;

    // Find the first input line index that belongs to this segment
    const firstRawIdx = srcIdxs.slice().sort((a, b) => a - b)[0]!;
    const hlSpan = container.querySelector<HTMLElement>(
      `[data-hl-line="${firstRawIdx}"]`
    );
    if (!hlSpan) return;

    const containerRect = container.getBoundingClientRect();
    const hlRect = hlSpan.getBoundingClientRect();
    container.scrollTop += hlRect.top - containerRect.top - 24;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegIdxs]);

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
    setActiveSegIdxs(new Set());
    setMultiSelectMode(false);
    setPreviewAudit(row);
    const waMessages = parseWhatsAppMessages(row.input ?? "");
    if (waMessages) {
      const allResults = waMessages.flatMap((m) => m.result.results);
      const allFailed = waMessages.flatMap((m) => m.result.failedLines ?? []);
      setPreviewResult({
        results: allResults,
        total: waMessages.reduce((s, m) => s + m.result.total, 0),
        ...(allFailed.length > 0 ? { failedLines: allFailed } : {}),
      });
      // Source tracking: per-message calculateTotalWithSources, then flatten with cumulative offsets
      const allRawLines: string[] = [];
      const allSourceIndices: number[][] = [];
      for (const m of waMessages) {
        const { segmentSourceIndices: msgIdxs, rawLines: msgRaw } =
          calculateTotalWithSources(m.text);
        const offset = allRawLines.length;
        allRawLines.push(...msgRaw);
        for (const idxs of msgIdxs)
          allSourceIndices.push(idxs.map((i) => i + offset));
      }
      setPreviewRawLines(allRawLines);
      setSegmentSourceIndices(allSourceIndices);
    } else {
      const {
        result,
        segmentSourceIndices: srcIdxs,
        rawLines,
      } = calculateTotalWithSources(row.input ?? "");
      setPreviewResult(result);
      setPreviewRawLines(rawLines);
      setSegmentSourceIndices(srcIdxs);
    }
  };

  const closeAuditPreview = () => {
    setPreviewAudit(null);
    setPreviewResult(null);
    setSegmentSourceIndices(null);
    setPreviewRawLines(null);
    setActiveSegIdxs(new Set());
    setMultiSelectMode(false);
  };

  const applyParsedToAuditRow = async (row: CalculationAuditLog) => {
    const waMessages = parseWhatsAppMessages(row.input ?? "");
    const parsed: CalculationResult = waMessages
      ? {
          results: waMessages.flatMap((m) => m.result.results),
          total: waMessages.reduce((s, m) => s + m.result.total, 0),
          ...(waMessages.flatMap((m) => m.result.failedLines ?? []).length > 0
            ? {
                failedLines: waMessages.flatMap(
                  (m) => m.result.failedLines ?? []
                ),
              }
            : {}),
        }
      : calculateTotal(row.input ?? "");
    const fields = auditSavedFieldsFromParsed(parsed);
    setBusyAuditId(row.id);
    try {
      await updateCalculationAuditSavedFields(row.id, fields);
      const merged: CalculationAuditLog = { ...row, ...fields };
      setAuditRows((prev) => prev.map((r) => (r.id === row.id ? merged : r)));
      setPreviewAudit((p) => (p?.id === row.id ? merged : p));
      toast.success("Saved totals updated to match current parser.");
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not update audit log.";
      toast.error(msg);
      toastApiError(e, msg);
    } finally {
      setBusyAuditId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 font-sans text-slate-900 antialiased">
      <div
        className={`mx-auto w-full max-w-[1300px] px-4 py-6 sm:px-6 sm:py-8 ${
          activeTab === "audit" && selectedAuditIds.size > 0
            ? "pb-28 sm:pb-24"
            : ""
        }`}
      >
        <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05),0_20px_25px_-5px_rgba(15,23,42,0.04)] sm:mb-8">
          <div
            className="h-1 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600"
            aria-hidden
          />
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Internal
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px]">
                Admin
              </h1>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
                <span className="hidden sm:inline">
                  Calculation audits and{" "}
                </span>
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
                  {reportPushOn ? "Report alerts on" : "Enable report alerts"}
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
                        <div
                          className="rounded-lg bg-slate-100/80 px-2.5 py-1.5 sm:px-3"
                          title="Sum of totals as they were stored when each calculation ran (historical snapshot)."
                        >
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
                        {auditSavedVersusParserDiffers ? (
                          <>
                            <div
                              className="h-8 w-px bg-slate-200"
                              aria-hidden
                            />
                            <div
                              className="rounded-lg border border-amber-100/80 bg-amber-50/50 px-2.5 py-1.5 sm:px-3"
                              title="Sum of what the current parser produces on each row’s stored input (today’s engine)."
                            >
                              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-800/80">
                                {freshParsedTotalLabelForDateRange(
                                  auditDateFrom,
                                  auditDateTo
                                )}
                              </p>
                              <p className="whitespace-nowrap text-[15px] font-bold tabular-nums text-amber-900">
                                ₹
                                {dateFilteredFreshParsedTotal.toLocaleString(
                                  "en-IN",
                                  {
                                    maximumFractionDigits: 0,
                                  }
                                )}
                              </p>
                            </div>
                          </>
                        ) : null}
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
                      {pruningAuditDupes ? "Pruning…" : "Dedupe inputs"}
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
              ) : auditListLoadError ? (
                <div className="p-8 text-center text-[14px] text-slate-700 sm:p-10">
                  <p className="font-semibold text-red-800">
                    Could not load audit logs
                  </p>
                  <p className="mx-auto mt-2 max-w-lg text-[12px] leading-relaxed text-slate-600">
                    {auditListLoadError}
                  </p>
                  <p className="mx-auto mt-2 max-w-lg text-[12px] text-slate-500">
                    This is usually a network blip or Firestore being busy. Try
                    again — a full page refresh also reconnects.
                  </p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    Retry load
                  </button>
                </div>
              ) : auditRows.length === 0 ? (
                <div className="p-8 text-center text-[14px] text-slate-500 sm:p-10">
                  <p className="text-slate-400">No audit logs yet</p>
                </div>
              ) : displayAuditRows.length === 0 ? (
                <div className="p-6 text-center text-sm sm:p-8">
                  <p className="font-semibold text-slate-800">
                    No rows in this range
                  </p>
                  <p className="mt-1.5 max-w-sm mx-auto text-[12px] text-slate-500 leading-relaxed">
                    Try a different range or clear the date filter. Only a
                    recent batch is loaded — older days may be missing.
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
                          className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setAuditDiffSort((s) =>
                                s === "off"
                                  ? "desc"
                                  : s === "desc"
                                  ? "asc"
                                  : "off"
                              )
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider text-slate-600 hover:text-orange-600"
                            title="Sort: Differs first → match first → default order"
                            aria-sort={
                              auditDiffSort === "off"
                                ? "none"
                                : auditDiffSort === "asc"
                                ? "ascending"
                                : "descending"
                            }
                          >
                            Total
                            {auditDiffSort === "asc" && (
                              <span className="text-orange-600" aria-hidden>
                                ▲
                              </span>
                            )}
                            {auditDiffSort === "desc" && (
                              <span className="text-orange-600" aria-hidden>
                                ▼
                              </span>
                            )}
                            {auditDiffSort === "off" && (
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
                          <td className="px-2 py-2.5 sm:px-3">
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="font-bold tabular-nums text-slate-900">
                                ₹{r.total}
                              </span>
                              {auditTotalRecalc.get(r.id)?.differs ? (
                                <span
                                  className="text-[10px] font-semibold text-orange-600"
                                  title={`Current parser: ₹${
                                    auditTotalRecalc.get(r.id)?.parsedTotal ??
                                    "—"
                                  }`}
                                >
                                  Differs
                                </span>
                              ) : null}
                            </div>
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
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyAuditInputToClipboard(
                                      r.input ?? ""
                                    )
                                  }
                                  className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-sky-50/80 hover:text-blue-700"
                                  title="Copy this input to clipboard"
                                >
                                  Copy
                                </button>
                              </div>
                              <pre className="max-h-[120px] overflow-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-800 wrap-break-word">
                                {r.input}
                              </pre>
                            </div>
                          </td>
                          <td className="px-1 py-2 text-center sm:px-2">
                            <button
                              type="button"
                              onClick={() => openAuditPreview(r)}
                              disabled={busyAuditId === r.id}
                              className="h-8 min-w-[4.5rem] rounded-md border border-blue-200/80 bg-white px-2.5 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-sky-50/80 disabled:opacity-50 sm:h-7"
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
                        disabled={
                          loading || clearingReport || bulkReportDeleting
                        }
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
              ) : reportListLoadError ? (
                <div className="p-8 text-center text-[14px] text-slate-700 sm:p-10">
                  <p className="font-semibold text-red-800">
                    Could not load user reports
                  </p>
                  <p className="mx-auto mt-2 max-w-lg text-[12px] leading-relaxed text-slate-600">
                    {reportListLoadError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    Retry load
                  </button>
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
                    <span className="ml-1.5 text-[10px] font-bold text-orange-600">
                      Differs
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

              {previewResult.total !== previewAudit.total ||
              previewResult.results.length !== previewAudit.resultCount ||
              (previewResult.failedLines?.length ?? 0) !==
                (previewAudit.failedCount ?? 0) ? (
                <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-3.5 py-3">
                  <p className="mb-2 text-[12px] leading-snug text-emerald-950/90">
                    Stored totals differ from the current parser. Update this
                    log after you verify the breakdown below.
                  </p>
                  <button
                    type="button"
                    onClick={() => void applyParsedToAuditRow(previewAudit)}
                    disabled={busyAuditId === previewAudit.id}
                    className="rounded-lg border border-emerald-600 bg-emerald-700 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {busyAuditId === previewAudit.id
                      ? "Updating…"
                      : "Update saved totals to match parsed"}
                  </button>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[12px] border border-[#e4edf8] bg-[#f8fbff] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-gray-600">
                      Original input
                      {activeSegIdxs.size > 0 && (
                        <span className="ml-2 text-[11px] font-normal text-gray-400">
                          —{" "}
                          {activeSegIdxs.size === 1
                            ? "matching lines highlighted"
                            : `${activeSegIdxs.size} segments highlighted`}
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void copyAuditInputToClipboard(previewAudit.input ?? "")
                      }
                      className="shrink-0 rounded-lg border border-blue-200 bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700"
                    >
                      Copy input
                    </button>
                  </div>
                  <pre
                    ref={inputPreRef}
                    className="max-h-[52vh] overflow-y-auto overscroll-contain rounded-[10px] border border-[#e4edf8] bg-white p-3 font-mono text-[11px] whitespace-pre-wrap wrap-break-word"
                  >
                    {(() => {
                      const PALETTE_HL = [
                        "#dbeafe",
                        "#d1fae5",
                        "#fef3c7",
                        "#ede9fe",
                        "#ffe4e6",
                        "#cffafe",
                        "#ffedd5",
                        "#fce7f3",
                      ];
                      const input = previewAudit.input ?? "";
                      const inputLines = input.split("\n");
                      if (
                        activeSegIdxs.size === 0 ||
                        !segmentSourceIndices ||
                        !previewRawLines
                      ) {
                        return input;
                      }
                      // Forward-scan: map each rawLine index → the input line it came from.
                      // Scanning in order ensures duplicate rawLine content maps to the
                      // correct positional occurrence, not always the first.
                      const rawLineToInputIdx = new Array<number>(
                        previewRawLines.length
                      ).fill(-1);
                      let scanPtr = 0;
                      for (let ri = 0; ri < previewRawLines.length; ri++) {
                        const target = previewRawLines[ri]!;
                        while (scanPtr < inputLines.length) {
                          const t = inputLines[scanPtr]!.trim();
                          if (
                            t === target ||
                            t.endsWith(target) ||
                            t.includes(target)
                          ) {
                            rawLineToInputIdx[ri] = scanPtr;
                            scanPtr++;
                            break;
                          }
                          scanPtr++;
                        }
                      }
                      // Build inputLine → { hlColor, rawLineIdx } map from all active segments
                      const lineHighlights = new Map<
                        number,
                        { color: string; ri: number }
                      >();
                      for (const segIdx of activeSegIdxs) {
                        const srcIdxs = segmentSourceIndices[segIdx];
                        if (!srcIdxs) continue;
                        const hlColor = PALETTE_HL[segIdx % PALETTE_HL.length]!;
                        for (const ri of srcIdxs) {
                          const li = rawLineToInputIdx[ri];
                          if (
                            li !== undefined &&
                            li >= 0 &&
                            !lineHighlights.has(li)
                          ) {
                            lineHighlights.set(li, { color: hlColor, ri });
                          }
                        }
                      }
                      return inputLines.map((rawLine, li) => {
                        const hl = lineHighlights.get(li);
                        return (
                          <span
                            key={li}
                            className="block"
                            {...(hl ? { "data-hl-line": String(hl.ri) } : {})}
                            style={
                              hl
                                ? {
                                    backgroundColor: hl.color,
                                    borderRadius: "3px",
                                  }
                                : undefined
                            }
                          >
                            {rawLine}
                          </span>
                        );
                      });
                    })()}
                  </pre>
                </div>

                <div className="rounded-[12px] border border-[#e4edf8] bg-[#f8fbff] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-gray-600">
                      Line-by-line result
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Single / Multi select toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          setMultiSelectMode((m) => !m);
                          if (multiSelectMode) {
                            // switching back to single: keep at most one selection
                            const first = activeSegIdxs.values().next().value;
                            setActiveSegIdxs(
                              first !== undefined ? new Set([first]) : new Set()
                            );
                          }
                        }}
                        className={[
                          "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition",
                          multiSelectMode
                            ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                        ].join(" ")}
                      >
                        {multiSelectMode ? "Multi-select ON" : "Multi-select"}
                      </button>
                      {activeSegIdxs.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveSegIdxs(new Set())}
                          className="text-[11px] text-gray-400 underline hover:text-gray-600"
                        >
                          Clear
                          {activeSegIdxs.size > 1
                            ? ` (${activeSegIdxs.size})`
                            : ""}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-[52vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
                    {previewResult.results.length === 0 ? (
                      <div className="rounded-[10px] border border-[#e4edf8] bg-white p-3 text-[12px] text-gray-500">
                        No parsed line items for this input.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(() => {
                          const PALETTE_BORDER = [
                            "border-l-blue-400",
                            "border-l-emerald-400",
                            "border-l-amber-400",
                            "border-l-violet-400",
                            "border-l-rose-400",
                            "border-l-cyan-400",
                            "border-l-orange-400",
                            "border-l-pink-400",
                          ];
                          const PALETTE_ACTIVE_BG = [
                            "bg-blue-50",
                            "bg-emerald-50",
                            "bg-amber-50",
                            "bg-violet-50",
                            "bg-rose-50",
                            "bg-cyan-50",
                            "bg-orange-50",
                            "bg-pink-50",
                          ];
                          const PALETTE_DOT = [
                            "bg-blue-400",
                            "bg-emerald-400",
                            "bg-amber-400",
                            "bg-violet-400",
                            "bg-rose-400",
                            "bg-cyan-400",
                            "bg-orange-400",
                            "bg-pink-400",
                          ];
                          return previewResult.results.map((seg, idx) => {
                            const isActive = activeSegIdxs.has(idx);
                            const colorBorder = PALETTE_BORDER[idx % 8]!;
                            const colorActiveBg = PALETTE_ACTIVE_BG[idx % 8]!;
                            const colorDot = PALETTE_DOT[idx % 8]!;
                            return (
                              <button
                                key={`${idx}-${seg.line}-${seg.rate}`}
                                type="button"
                                onClick={() => {
                                  lastClickedSegIdxRef.current = idx;
                                  setActiveSegIdxs((prev) => {
                                    const next = new Set(prev);
                                    if (multiSelectMode) {
                                      // toggle in set
                                      if (next.has(idx)) next.delete(idx);
                                      else next.add(idx);
                                    } else {
                                      // single select: replace
                                      if (next.has(idx) && next.size === 1)
                                        next.clear();
                                      else {
                                        next.clear();
                                        next.add(idx);
                                      }
                                    }
                                    return next;
                                  });
                                }}
                                className={[
                                  "w-full rounded-[10px] border-l-4 p-3 text-left transition",
                                  colorBorder,
                                  isActive
                                    ? `${colorActiveBg} shadow-sm ring-1 ring-inset ring-slate-200`
                                    : "border border-[#e4edf8] border-l-4 bg-white hover:bg-slate-50",
                                ].join(" ")}
                              >
                                <div className="mb-1 flex items-center gap-2 text-[12px] font-bold text-[#1d6fb8]">
                                  <span
                                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${colorDot}`}
                                  />
                                  <span>#{idx + 1}</span>
                                  {seg.isWP && (
                                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                                      WP
                                    </span>
                                  )}
                                  {seg.lane === "A" && (
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                                      A
                                    </span>
                                  )}
                                  {seg.lane === "B" && (
                                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-800">
                                      B
                                    </span>
                                  )}
                                  {(seg.lane === "AB" ||
                                    (!seg.lane && seg.isDouble)) && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                                      AB
                                    </span>
                                  )}
                                  <span className="ml-auto text-[10px] font-normal text-gray-400">
                                    {isActive
                                      ? "click to deselect"
                                      : multiSelectMode
                                      ? "click to add"
                                      : "click to highlight"}
                                  </span>
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
                              </button>
                            );
                          });
                        })()}
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
                  {displayAuditRows.length} pastes, blank line between (table
                  order
                  {auditDiffSort !== "off" ? ", Differs sort" : ""}
                  {auditStatusSort !== "off" ? ", status sort" : ""}
                  ).
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void copyAuditInputToClipboard(
                      combinedAllAuditInputText,
                      "Copied to clipboard"
                    )
                  }
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

      {activeTab === "audit" && selectedAuditIds.size > 0 ? (
        <div className="pointer-events-none fixed bottom-0 right-0 z-40 max-w-[min(100vw,1300px)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-6 sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pl-8">
          <div
            className="pointer-events-auto ml-auto w-[min(100%,17.5rem)] overflow-hidden rounded-2xl bg-white shadow-[0_12px_48px_-8px_rgba(15,23,42,0.22),0_0_0_1px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/4"
            role="toolbar"
            aria-label={`Bulk actions for ${selectedAuditIds.size} selected audit rows`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-linear-to-r from-slate-50 to-white px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Selected
              </span>
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white shadow-sm">
                {selectedAuditIds.size}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-100 p-px">
              <button
                type="button"
                onClick={() =>
                  void copyAuditInputToClipboard(
                    combinedSelectedAuditInput,
                    `Copied ${selectedAuditIds.size} input(s)`
                  )
                }
                disabled={
                  loading ||
                  clearingAudit ||
                  pruningAuditDupes ||
                  bulkAuditDeleting
                }
                title={`Copy ${selectedAuditIds.size} selected input(s) — joined with a blank line`}
                aria-label={`Copy ${selectedAuditIds.size} selected inputs`}
                className="group flex min-h-21 flex-col items-center justify-center gap-1 bg-white py-3 transition hover:bg-sky-50/90 active:bg-sky-100/80 disabled:opacity-45"
              >
                <span className="sr-only">
                  Copy {selectedAuditIds.size} selected inputs
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-7 w-7 text-sky-600 transition group-hover:scale-105 group-hover:text-sky-700"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 7.5V6.108c0-1.036.84-1.875 1.875-1.875h3.75c1.036 0 1.875.84 1.875 1.875V7.5m6 9V18a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 18v-1.5m15-10.5a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0118 21H6.75a2.25 2.25 0 01-2.25-2.25V10.5a2.25 2.25 0 012.25-2.25h7.5"
                  />
                </svg>
                <span className="text-[11px] font-semibold text-slate-600 group-hover:text-sky-800">
                  Copy
                </span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkAuditIds([...selectedAuditIds])}
                disabled={
                  loading ||
                  clearingAudit ||
                  pruningAuditDupes ||
                  bulkAuditDeleting
                }
                title={`Delete ${selectedAuditIds.size} selected audit log(s)`}
                aria-label={`Delete ${selectedAuditIds.size} selected audit logs`}
                className="group flex min-h-21 flex-col items-center justify-center gap-1 bg-white py-3 transition hover:bg-rose-50 active:bg-rose-100/80 disabled:opacity-45"
              >
                <span className="sr-only">
                  Delete {selectedAuditIds.size} selected audit logs
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-7 w-7 text-rose-500 transition group-hover:scale-105 group-hover:text-rose-600"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                <span className="text-[11px] font-semibold text-slate-600 group-hover:text-rose-800">
                  Delete
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
