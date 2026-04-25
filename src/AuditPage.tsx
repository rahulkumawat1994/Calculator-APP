import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { toastApiError } from "./apiToast";
import ConfirmDialog from "./ConfirmDialog";
import {
  clearCalculationAuditLogs,
  deleteCalculationAuditLog,
  deleteCalculationAuditLogsByIds,
  loadCalculationAuditLogs,
  pruneDuplicateCalculationAuditLogs,
  type CalculationAuditLog,
} from "./firestoreDb";

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

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void;
}

export default function AuditPage() {
  const [rows, setRows] = useState<CalculationAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [pruningDupes, setPruningDupes] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [failedSort, setFailedSort] = useState<"off" | "asc" | "desc">("off");

  const displayRows = useMemo(() => {
    if (failedSort === "off") return rows;
    const fc = (r: CalculationAuditLog) => r.failedCount ?? 0;
    return [...rows].sort((a, b) => {
      const na = fc(a);
      const nb = fc(b);
      if (na !== nb) return failedSort === "asc" ? na - nb : nb - na;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  }, [rows, failedSort]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadCalculationAuditLogs(400);
      setRows(data);
      setSelectedIds(prev => new Set([...prev].filter(id => data.some(r => r.id === id))));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteBulk = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkDeleting(true);
    setError(null);
    try {
      await deleteCalculationAuditLogsByIds(ids);
      const idSet = new Set(ids);
      setRows(prev => prev.filter(r => !idSet.has(r.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setConfirmBulkIds(null);
      toast.success(`Deleted ${ids.length} audit log(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete selected rows.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDeleteOne = async (id: string, skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete this audit log?",
        message: "This row will be permanently removed.",
        confirmLabel: "Yes, Delete",
        danger: true,
        run: () => {
          void handleDeleteOne(id, true);
        },
      });
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await deleteCalculationAuditLog(id);
      setRows(prev => prev.filter(r => r.id !== id));
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete row.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setBusyId(null);
    }
  };

  const handlePruneDuplicates = async (skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete duplicate inputs?",
        message:
          "For identical pasted inputs (newest 2000 logs), only the newest row is kept and older copies are removed.\n\nThis cannot be undone.",
        confirmLabel: "Yes, Delete Duplicates",
        danger: true,
        run: () => {
          void handlePruneDuplicates(true);
        },
      });
      return;
    }
    setPruningDupes(true);
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
      setPruningDupes(false);
    }
  };

  const handleClearAll = async (skipConfirm = false) => {
    if (!skipConfirm) {
      setConfirmState({
        title: "Delete all audit logs?",
        message: "This cannot be undone.",
        confirmLabel: "Yes, Delete All",
        danger: true,
        run: () => {
          void handleClearAll(true);
        },
      });
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const deleted =       await clearCalculationAuditLogs(5000);
      setRows([]);
      setSelectedIds(new Set());
      if (deleted === 0) setError("No logs found to delete.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to clear logs.";
      setError(msg);
      toastApiError(e, msg);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef2f7] font-sans">
      <div className="max-w-[1200px] mx-auto px-4 py-5">
        <div className="bg-white border-2 border-[#dde8f0] rounded-[16px] p-4 shadow-sm mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-black text-[#1a1a1a]">Calculation Audit</h1>
            <p className="text-[13px] text-gray-500 mt-1">
              Internal only: logs from collection <code>calc_audit_logs</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setConfirmBulkIds([...selectedIds])}
                disabled={loading || clearing || pruningDupes || bulkDeleting}
                className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-red-700 text-white shadow-sm active:opacity-90 disabled:opacity-50"
              >
                Delete {selectedIds.size} selected
              </button>
            )}
            <button
              type="button"
              onClick={() => void handlePruneDuplicates()}
              disabled={loading || clearing || pruningDupes || bulkDeleting}
              className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-amber-600 text-white active:opacity-90 disabled:opacity-50"
            >
              {pruningDupes ? "Deleting…" : "Delete duplicate inputs"}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={loading || clearing || pruningDupes || rows.length === 0 || bulkDeleting}
              className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-red-600 text-white active:opacity-90 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear logs"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || clearing || pruningDupes || bulkDeleting}
              className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-[#1d6fb8] text-white active:opacity-90 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border-2 border-[#dde8f0] rounded-[16px] p-6 text-gray-500">Loading logs…</div>
        ) : error ? (
          <div className="bg-red-50 border-2 border-red-200 rounded-[16px] p-4 text-red-700">{error}</div>
        ) : rows.length === 0 ? (
          <div className="bg-white border-2 border-[#dde8f0] rounded-[16px] p-6 text-gray-500">No audit logs found.</div>
        ) : (
          <div className="bg-white border-2 border-[#dde8f0] rounded-[16px] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[#f6f9fd] border-b border-[#e3edf7]">
                  <tr>
                    <th className="w-12 px-2 py-2 font-bold text-center">#</th>
                    <th className="px-3 py-2 font-bold">Time</th>
                    <th className="px-3 py-2 font-bold">Mode</th>
                    <th className="px-3 py-2 font-bold">Slot</th>
                    <th className="px-3 py-2 font-bold">Total</th>
                    <th className="px-3 py-2 font-bold">Results</th>
                    <th className="px-3 py-2 font-bold">
                      <button
                        type="button"
                        onClick={() =>
                          setFailedSort((s) =>
                            s === "off" ? "desc" : s === "desc" ? "asc" : "off"
                          )
                        }
                        className="inline-flex items-center gap-1 font-bold text-[#1a1a1a] hover:text-[#1d6fb8]"
                        title="Sort: highest failed count → lowest → default order"
                        aria-sort={
                          failedSort === "off"
                            ? "none"
                            : failedSort === "asc"
                              ? "ascending"
                              : "descending"
                        }
                      >
                        Failed
                        {failedSort === "asc" && (
                          <span className="text-[#1d6fb8]" aria-hidden>
                            ▲
                          </span>
                        )}
                        {failedSort === "desc" && (
                          <span className="text-[#1d6fb8]" aria-hidden>
                            ▼
                          </span>
                        )}
                        {failedSort === "off" && (
                          <span
                            className="text-gray-300 font-normal"
                            aria-hidden
                          >
                            ↕
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-bold">WA Msg</th>
                    <th className="px-3 py-2 font-bold min-w-[340px]">Input</th>
                    <th className="px-3 py-2 font-bold">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r, rowIdx) => (
                    <tr key={r.id} className="border-b border-[#eef2f7] align-top">
                      <td className="px-2 py-2 align-middle text-center">
                        <button
                          type="button"
                          title="Tap to select for bulk delete"
                          aria-pressed={selectedIds.has(r.id)}
                          onClick={() => toggleSelect(r.id)}
                          disabled={loading || clearing || pruningDupes || bulkDeleting || busyId === r.id}
                          className={`mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors disabled:opacity-40 ${
                            selectedIds.has(r.id)
                              ? "bg-red-600 text-white ring-2 ring-red-800 shadow-sm"
                              : "bg-[#1d6fb8] text-white hover:bg-[#165fa3]"
                          }`}
                        >
                          {rowIdx + 1}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtTs(r.createdAt)}</td>
                      <td className="px-3 py-2 font-semibold">{r.mode}</td>
                      <td className="px-3 py-2">
                        {r.mode === "wa" && r.waSlotsSummary
                          ? r.waSlotsSummary
                          : (r.selectedSlotName ?? r.selectedSlotId ?? "-")}
                      </td>
                      <td className="px-3 py-2 font-bold">₹{r.total}</td>
                      <td className="px-3 py-2">{r.resultCount}</td>
                      <td className="px-3 py-2">{r.failedCount}</td>
                      <td className="px-3 py-2">{r.waMessageCount ?? "-"}</td>
                      <td className="px-3 py-2">
                        <pre className="whitespace-pre-wrap wrap-break-word bg-[#f8fbff] border border-[#e4edf8] rounded-[10px] p-2 max-h-[120px] overflow-auto font-mono text-[11px]">
                          {r.input}
                        </pre>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void handleDeleteOne(r.id)}
                          disabled={busyId === r.id || clearing || bulkDeleting}
                          className="px-2.5 py-1.5 rounded-[10px] text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
                        >
                          {busyId === r.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

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

      {typeof document !== "undefined" && confirmBulkIds && confirmBulkIds.length > 0
        ? createPortal(
            <div
              className="fixed inset-0 z-20000 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.45)" }}
              onClick={e => { if (e.target === e.currentTarget) setConfirmBulkIds(null); }}
            >
              <div
                className="w-full max-w-[400px] overflow-hidden rounded-[20px] border-2 border-[#dde8f0] bg-white shadow-2xl"
                role="dialog"
                aria-labelledby="audit-bulk-title"
                aria-modal="true"
              >
                <div className="border-b border-[#e7eef7] px-5 py-4">
                  <h2 id="audit-bulk-title" className="text-[18px] font-extrabold text-red-700">
                    Delete {confirmBulkIds.length} audit log
                    {confirmBulkIds.length === 1 ? "" : "s"}?
                  </h2>
                  <p className="mt-2 text-[13px] leading-snug text-gray-600">
                    This permanently removes the selected rows from Firestore. This cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => void handleDeleteBulk(confirmBulkIds)}
                    disabled={bulkDeleting}
                    className="flex-1 rounded-[12px] bg-red-600 py-3 text-[15px] font-bold text-white active:opacity-90 disabled:opacity-50"
                  >
                    {bulkDeleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkIds(null)}
                    disabled={bulkDeleting}
                    className="flex-1 rounded-[12px] bg-gray-100 py-3 text-[15px] font-semibold text-gray-700 active:opacity-90 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
