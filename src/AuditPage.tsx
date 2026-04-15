import { useEffect, useState } from "react";
import {
  clearCalculationAuditLogs,
  deleteCalculationAuditLog,
  loadCalculationAuditLogs,
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

export default function AuditPage() {
  const [rows, setRows] = useState<CalculationAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadCalculationAuditLogs(400);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDeleteOne = async (id: string) => {
    const ok = window.confirm("Delete this audit log?");
    if (!ok) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteCalculationAuditLog(id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete row.");
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAll = async () => {
    const ok = window.confirm("Delete all audit logs? This cannot be undone.");
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      const deleted = await clearCalculationAuditLogs(5000);
      setRows([]);
      if (deleted === 0) setError("No logs found to delete.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear logs.");
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearAll}
              disabled={loading || clearing || rows.length === 0}
              className="px-4 py-2.5 rounded-[12px] text-[14px] font-bold bg-red-600 text-white active:opacity-90 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear logs"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || clearing}
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
                    <th className="px-3 py-2 font-bold">Time</th>
                    <th className="px-3 py-2 font-bold">Mode</th>
                    <th className="px-3 py-2 font-bold">Slot</th>
                    <th className="px-3 py-2 font-bold">Total</th>
                    <th className="px-3 py-2 font-bold">Results</th>
                    <th className="px-3 py-2 font-bold">Failed</th>
                    <th className="px-3 py-2 font-bold">WA Msg</th>
                    <th className="px-3 py-2 font-bold min-w-[340px]">Input</th>
                    <th className="px-3 py-2 font-bold">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-[#eef2f7] align-top">
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtTs(r.createdAt)}</td>
                      <td className="px-3 py-2 font-semibold">{r.mode}</td>
                      <td className="px-3 py-2">{r.selectedSlotName ?? r.selectedSlotId ?? "-"}</td>
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
                          disabled={busyId === r.id || clearing}
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
    </div>
  );
}
