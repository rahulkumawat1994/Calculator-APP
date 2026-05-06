import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import {
  deleteStatementExtract,
  loadRecentStatementExtracts,
  saveStatementExtractIfNew,
  type StatementExtractListItem,
} from "./data/firestoreDb";
import { StatementPdfColumnGuideModal } from "./StatementPdfColumnGuideModal";
import {
  DEFAULT_COLUMN_BAND_DELTAS,
  extractStatementWdDpRowsFromPdfData,
  type StatementColumnBandDeltas,
  type StatementWdDpRow,
} from "./statement/extractStatementColumnsFromPdf";
import {
  sortStatementPdfsByPeriod,
  type StatementPdfSortMode,
} from "./statement/sortStatementPdfsByPeriod";
import { sumStatementWdDpRows } from "./statement/statementMoneyParse";
import {
  addSavedTransactionSearch,
  loadSavedTransactionSearches,
  persistSavedTransactionSearches,
  type SavedTransactionSearch,
} from "./statement/savedTransactionSearches";
import { isStatementDateRangeInverted } from "./statement/statementDateRangeFilter";
import {
  filterStatementVisibleRows,
  type StatementVisibleRowParams,
} from "./statement/statementRowFilters";
import { parseTransactionSearchTerms } from "./statement/transactionSearchFilter";
import { downloadStatementExtractPdf, type StatementPdfExportSection } from "./statement/exportStatementPdf";
import { DangerActionDialog } from "./ui";

function formatInrMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function profitLossBoxClass(net: number): string {
  if (net > 0) return "border-emerald-200/80 bg-emerald-50/60";
  if (net < 0) return "border-red-200/90 bg-red-50/70";
  return "border-gray-200/90 bg-gray-50/80";
}

function profitLossTextClass(net: number): string {
  if (net > 0) return "text-emerald-800";
  if (net < 0) return "text-red-800";
  return "text-gray-700";
}

function profitLossLabel(net: number): string {
  if (net > 0) return "Profit";
  if (net < 0) return "Loss";
  return "Even";
}

type LoadedStatementPdf = {
  id: string;
  name: string;
  data: ArrayBuffer;
  bandDeltas: StatementColumnBandDeltas;
  rows: StatementWdDpRow[];
  loading: boolean;
  error: string | null;
};

const NO_ROWS_MESSAGE =
  "No statement column text found. The PDF needs a text layer and a row like “Txn Date … Transaction … Withdrawals … Deposits …”. Try column edges in “Show PDF with column guides”.";

type StatementExtractUploadUi = "idle" | "uploading" | "uploaded" | "duplicate" | "error";

type StatementDeleteConfirm =
  | { type: "cloud-single"; item: StatementExtractListItem }
  | { type: "cloud-batch"; items: StatementExtractListItem[] }
  | { type: "pdf-single"; docId: string; name: string }
  | { type: "pdf-batch"; docIds: string[] };

function statementDeleteConfirmCopy(p: StatementDeleteConfirm): {
  title: string;
  message: ReactNode;
  confirmLabel: string;
} {
  switch (p.type) {
    case "cloud-single":
      return {
        title: "Remove from cloud?",
        message: (
          <p className="text-[13px] leading-snug text-gray-600">
            <span className="font-semibold text-[#1a1a1a]">{p.item.fileName}</span> will be permanently deleted.
            You cannot undo this.
          </p>
        ),
        confirmLabel: "Yes, remove",
      };
    case "cloud-batch": {
      const n = p.items.length;
      return {
        title: `Delete ${n} saved extract${n === 1 ? "" : "s"}?`,
        message: (
          <p className="text-[13px] leading-snug text-gray-600">
            This permanently removes the selected saves from Firebase. You cannot undo this.
          </p>
        ),
        confirmLabel: "Yes, delete",
      };
    }
    case "pdf-single":
      return {
        title: "Remove this PDF?",
        message: (
          <p className="text-[13px] leading-snug text-gray-600">
            <span className="font-semibold text-[#1a1a1a]">{p.name}</span> will leave this page. Unsaved
            extracted rows will be lost. Nothing is removed from the cloud unless you delete it there.
          </p>
        ),
        confirmLabel: "Yes, remove",
      };
    case "pdf-batch": {
      const n = p.docIds.length;
      return {
        title: `Remove ${n} PDF file${n === 1 ? "" : "s"}?`,
        message: (
          <p className="text-[13px] leading-snug text-gray-600">
            They will leave this page. Unsaved extracted rows will be lost. Nothing is removed from the cloud
            unless you delete it there.
          </p>
        ),
        confirmLabel: "Yes, remove",
      };
    }
  }
}

export default function StatementPage() {
  const [documents, setDocuments] = useState<LoadedStatementPdf[]>([]);
  const [filePickerError, setFilePickerError] = useState<string | null>(null);
  const [showColumnGuide, setShowColumnGuide] = useState(false);
  const [activeGuidePdfId, setActiveGuidePdfId] = useState<string | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => new Set());
  const [selectedCloudExtractIds, setSelectedCloudExtractIds] = useState<Set<string>>(() => new Set());
  /** When a PDF id is in this set, its extracted table body is collapsed (accordion closed). */
  const [collapsedDocIds, setCollapsedDocIds] = useState<Set<string>>(() => new Set());
  /** Collapsed accordions for Firebase-saved extracts (fingerprint doc ids). */
  const [collapsedCloudExtractIds, setCollapsedCloudExtractIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pdfSortMode, setPdfSortMode] = useState<StatementPdfSortMode>("period-desc");
  const [transactionSearchRaw, setTransactionSearchRaw] = useState("");
  /** `<input type="date">` values (`YYYY-MM-DD`) for Txn date column filtering. */
  const [txnDateFrom, setTxnDateFrom] = useState("");
  const [txnDateTo, setTxnDateTo] = useState("");
  const [savedTxnSearches, setSavedTxnSearches] = useState<SavedTransactionSearch[]>(() =>
    typeof window !== "undefined" ? loadSavedTransactionSearches() : [],
  );
  /** Per-PDF UI state for “Upload” of extracted rows to Firestore (not the PDF file). */
  const [extractUploadByDocId, setExtractUploadByDocId] = useState<
    Record<string, StatementExtractUploadUi>
  >({});
  /** Rows previously uploaded to Firestore (`statementExtracts`), newest first. */
  const [cloudExtracts, setCloudExtracts] = useState<StatementExtractListItem[]>([]);
  const [cloudExtractsLoading, setCloudExtractsLoading] = useState(false);
  const [cloudExtractsError, setCloudExtractsError] = useState<string | null>(null);
  const [cloudExtractDeletingId, setCloudExtractDeletingId] = useState<string | null>(null);
  const [cloudBatchDeleting, setCloudBatchDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<StatementDeleteConfirm | null>(null);
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false);
  const deleteConfirmInFlight = useRef(false);
  const parseVersionByPdfRef = useRef<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseDocument = useCallback(async (docId: string, data: ArrayBuffer, deltas: StatementColumnBandDeltas) => {
    const nextVersion = (parseVersionByPdfRef.current[docId] ?? 0) + 1;
    parseVersionByPdfRef.current[docId] = nextVersion;
    setExtractUploadByDocId((prev) => {
      if (!(docId in prev)) return prev;
      const next = { ...prev };
      delete next[docId];
      return next;
    });
    setDocuments((prev) => {
      if (!prev.some((d) => d.id === docId)) return prev;
      return prev.map((doc) => (doc.id === docId ? { ...doc, loading: true, error: null } : doc));
    });

    try {
      const out = await extractStatementWdDpRowsFromPdfData(data, { columnBandDeltas: deltas });
      if (parseVersionByPdfRef.current[docId] !== nextVersion) return;
      setDocuments((prev) => {
        if (!prev.some((d) => d.id === docId)) return prev;
        return prev.map((doc) =>
          doc.id === docId
            ? { ...doc, rows: out, loading: false, error: out.length === 0 ? NO_ROWS_MESSAGE : null }
            : doc,
        );
      });
    } catch (e) {
      if (parseVersionByPdfRef.current[docId] !== nextVersion) return;
      setDocuments((prev) => {
        if (!prev.some((d) => d.id === docId)) return prev;
        return prev.map((doc) =>
          doc.id === docId
            ? {
                ...doc,
                rows: [],
                loading: false,
                error: e instanceof Error ? e.message : "Could not read this PDF.",
              }
            : doc,
        );
      });
    }
  }, []);

  const onFile = useCallback(async (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    if (picked.length === 0) return;

    const pdfFiles = picked.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const skippedCount = picked.length - pdfFiles.length;
    if (pdfFiles.length === 0) {
      setFilePickerError("Please choose at least one PDF file.");
      return;
    }

    setFilePickerError(
      skippedCount > 0 ? `${skippedCount} non-PDF file(s) were skipped. Showing PDF files only.` : null,
    );
    setShowColumnGuide(false);
    setSelectedDocIds(new Set());
    setCollapsedDocIds(new Set());
    setPdfSortMode("period-desc");
    setTransactionSearchRaw("");
    setTxnDateFrom("");
    setTxnDateTo("");
    parseVersionByPdfRef.current = {};
    setExtractUploadByDocId({});

    const docs: LoadedStatementPdf[] = [];
    for (let i = 0; i < pdfFiles.length; i += 1) {
      const file = pdfFiles[i];
      try {
        const data = await file.arrayBuffer();
        docs.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          data,
          bandDeltas: { ...DEFAULT_COLUMN_BAND_DELTAS },
          rows: [],
          loading: true,
          error: null,
        });
      } catch {
        docs.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          data: new ArrayBuffer(0),
          bandDeltas: { ...DEFAULT_COLUMN_BAND_DELTAS },
          rows: [],
          loading: false,
          error: "Could not read this PDF.",
        });
      }
    }

    setDocuments(docs);
    setActiveGuidePdfId(docs[0]?.id ?? null);
    docs.forEach((doc) => {
      if (doc.data.byteLength > 0) void parseDocument(doc.id, doc.data, doc.bandDeltas);
    });
  }, [parseDocument]);

  const removeDocumentsByIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    for (const id of idSet) delete parseVersionByPdfRef.current[id];

    setDocuments((prev) => prev.filter((d) => !idSet.has(d.id)));
    setExtractUploadByDocId((prev) => {
      const next = { ...prev };
      for (const id of idSet) delete next[id];
      return next;
    });
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (documents.length === 0) {
      setActiveGuidePdfId(null);
      setShowColumnGuide(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (activeGuidePdfId != null && !documents.some((d) => d.id === activeGuidePdfId)) {
      setActiveGuidePdfId(documents[0]!.id);
    }
  }, [documents, activeGuidePdfId]);

  useEffect(() => {
    setCollapsedDocIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (documents.some((d) => d.id === id)) next.add(id);
      }
      return next;
    });
  }, [documents]);

  const toggleDocAccordion = useCallback((docId: string) => {
    setCollapsedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const toggleCloudExtractAccordion = useCallback((extractId: string) => {
    setCollapsedCloudExtractIds((prev) => {
      const next = new Set(prev);
      if (next.has(extractId)) next.delete(extractId);
      else next.add(extractId);
      return next;
    });
  }, []);

  const toggleDocSelected = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const toggleSelectAllDocs = useCallback(() => {
    setSelectedDocIds((prev) => {
      if (documents.length === 0) return new Set();
      const allSelected = documents.every((d) => prev.has(d.id));
      if (allSelected) return new Set();
      return new Set(documents.map((d) => d.id));
    });
  }, [documents]);

  const requestDeleteSelectedDocuments = useCallback(() => {
    const ids = documents.filter((d) => selectedDocIds.has(d.id)).map((d) => d.id);
    if (ids.length === 0) return;
    setDeleteConfirm({ type: "pdf-batch", docIds: ids });
  }, [documents, selectedDocIds]);

  const cloudDeleteLocked = cloudExtractDeletingId != null || cloudBatchDeleting;

  const toggleCloudExtractSelected = useCallback((extractId: string) => {
    setSelectedCloudExtractIds((prev) => {
      const next = new Set(prev);
      if (next.has(extractId)) next.delete(extractId);
      else next.add(extractId);
      return next;
    });
  }, []);

  const toggleSelectAllCloudExtracts = useCallback(() => {
    setSelectedCloudExtractIds((prev) => {
      if (cloudExtracts.length === 0) return new Set();
      const allSelected = cloudExtracts.every((c) => prev.has(c.id));
      if (allSelected) return new Set();
      return new Set(cloudExtracts.map((c) => c.id));
    });
  }, [cloudExtracts]);

  const refreshCloudExtracts = useCallback(async () => {
    setCloudExtractsLoading(true);
    setCloudExtractsError(null);
    try {
      const list = await loadRecentStatementExtracts(50);
      setCloudExtracts(list);
    } catch (e) {
      setCloudExtracts([]);
      setCloudExtractsError(
        e instanceof Error ? e.message : "Could not load saved extracts from Firebase.",
      );
    } finally {
      setCloudExtractsLoading(false);
    }
  }, []);

  const performDeleteCloudExtract = useCallback(
    async (item: StatementExtractListItem) => {
      if (cloudDeleteLocked) return;
      setCloudExtractDeletingId(item.id);
      try {
        await deleteStatementExtract(item.id);
        toast.success(`Removed from cloud: ${item.fileName}`, { toastId: `stmt-del-${item.id}` });
        setCloudExtracts((prev) => prev.filter((x) => x.id !== item.id));
        setSelectedCloudExtractIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setCollapsedCloudExtractIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not delete this saved extract.";
        toast.error(msg, { toastId: `stmt-del-err-${item.id}` });
        void refreshCloudExtracts();
      } finally {
        setCloudExtractDeletingId(null);
      }
    },
    [cloudDeleteLocked, refreshCloudExtracts],
  );

  const requestDeleteCloudExtract = useCallback(
    (item: StatementExtractListItem) => {
      if (cloudDeleteLocked) return;
      setDeleteConfirm({ type: "cloud-single", item });
    },
    [cloudDeleteLocked],
  );

  const performCloudBatchDelete = useCallback(
    async (toRemove: StatementExtractListItem[]) => {
      if (toRemove.length === 0 || cloudDeleteLocked) return;
      setCloudBatchDeleting(true);
      try {
        const results = await Promise.allSettled(
          toRemove.map((item) => deleteStatementExtract(item.id)),
        );
        const deletedIds: string[] = [];
        const failedNames: string[] = [];
        results.forEach((r, i) => {
          const item = toRemove[i]!;
          if (r.status === "fulfilled") deletedIds.push(item.id);
          else failedNames.push(item.fileName);
        });
        if (deletedIds.length > 0) {
          const idSet = new Set(deletedIds);
          setCloudExtracts((prev) => prev.filter((x) => !idSet.has(x.id)));
          setSelectedCloudExtractIds((prev) => {
            const next = new Set(prev);
            for (const id of deletedIds) next.delete(id);
            return next;
          });
          setCollapsedCloudExtractIds((prev) => {
            const next = new Set(prev);
            for (const id of deletedIds) next.delete(id);
            return next;
          });
          toast.success(
            `Removed ${deletedIds.length} saved extract${deletedIds.length === 1 ? "" : "s"} from cloud.`,
            { toastId: "stmt-cloud-batch-ok" },
          );
        }
        if (failedNames.length > 0) {
          toast.error(
            `Could not delete ${failedNames.length} item(s). First: ${failedNames[0] ?? ""}`,
            { toastId: "stmt-del-batch-err" },
          );
          void refreshCloudExtracts();
        }
      } catch (e) {
      const msg = e instanceof Error ? e.message : "Batch delete failed.";
      toast.error(msg, { toastId: "stmt-del-batch-err" });
      void refreshCloudExtracts();
    } finally {
      setCloudBatchDeleting(false);
    }
  }, [cloudDeleteLocked, refreshCloudExtracts]);

  const requestDeleteSelectedCloudExtracts = useCallback(() => {
    const items = cloudExtracts.filter((c) => selectedCloudExtractIds.has(c.id));
    if (items.length === 0 || cloudDeleteLocked) return;
    setDeleteConfirm({ type: "cloud-batch", items });
  }, [cloudDeleteLocked, cloudExtracts, selectedCloudExtractIds]);

  const deleteConfirmPresentation = useMemo(
    () => (deleteConfirm ? statementDeleteConfirmCopy(deleteConfirm) : null),
    [deleteConfirm],
  );

  const executeDeleteConfirm = useCallback(async () => {
    const p = deleteConfirm;
    if (!p || deleteConfirmInFlight.current) return;
    deleteConfirmInFlight.current = true;
    setDeleteConfirmLoading(true);
    try {
      if (p.type === "cloud-single") {
        await performDeleteCloudExtract(p.item);
      } else if (p.type === "cloud-batch") {
        await performCloudBatchDelete(p.items);
      } else if (p.type === "pdf-single") {
        removeDocumentsByIds([p.docId]);
      } else {
        removeDocumentsByIds(p.docIds);
      }
      setDeleteConfirm(null);
    } finally {
      deleteConfirmInFlight.current = false;
      setDeleteConfirmLoading(false);
    }
  }, [
    deleteConfirm,
    performDeleteCloudExtract,
    performCloudBatchDelete,
    removeDocumentsByIds,
  ]);

  useEffect(() => {
    void refreshCloudExtracts();
  }, [refreshCloudExtracts]);

  useEffect(() => {
    const valid = new Set(cloudExtracts.map((c) => c.id));
    setSelectedCloudExtractIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [cloudExtracts]);

  const handleUploadStatementExtract = useCallback(
    async (doc: LoadedStatementPdf) => {
      if (doc.loading || doc.error || doc.rows.length === 0) return;
      setExtractUploadByDocId((prev) => ({ ...prev, [doc.id]: "uploading" }));
      // Firestore: extracted table rows only — never pass doc.data (PDF bytes).
      const result = await saveStatementExtractIfNew({ fileName: doc.name, rows: doc.rows });
      if (result.status === "uploaded") {
        toast.success(`Saved extract: ${doc.name} (${doc.rows.length} rows).`, { toastId: `stmt-up-${doc.id}` });
        setExtractUploadByDocId((prev) => ({ ...prev, [doc.id]: "uploaded" }));
        void refreshCloudExtracts();
        return;
      }
      if (result.status === "duplicate") {
        toast.info("This file’s extract is already in the cloud (same name + same rows).", {
          toastId: `stmt-dup-${doc.id}`,
        });
        setExtractUploadByDocId((prev) => ({ ...prev, [doc.id]: "duplicate" }));
        void refreshCloudExtracts();
        return;
      }
      toast.error(result.message, { toastId: `stmt-err-${doc.id}` });
      setExtractUploadByDocId((prev) => ({ ...prev, [doc.id]: "error" }));
    },
    [refreshCloudExtracts],
  );

  const setDocBandDeltas = useCallback(
    (docId: string, next: StatementColumnBandDeltas) => {
      let parseTarget: ArrayBuffer | null = null;
      setDocuments((prev) => {
        if (!prev.some((d) => d.id === docId)) return prev;
        return prev.map((doc) => {
          if (doc.id !== docId) return doc;
          parseTarget = doc.data;
          return { ...doc, bandDeltas: next };
        });
      });
      if (parseTarget) void parseDocument(docId, parseTarget, next);
    },
    [parseDocument],
  );

  const anyLoading = documents.some((d) => d.loading);

  const sortedDocuments = useMemo(
    () => sortStatementPdfsByPeriod(documents, pdfSortMode),
    [documents, pdfSortMode],
  );

  const sortedCloudExtracts = useMemo(
    () => sortStatementPdfsByPeriod(cloudExtracts, pdfSortMode),
    [cloudExtracts, pdfSortMode],
  );

  const transactionSearchTerms = useMemo(
    () => parseTransactionSearchTerms(transactionSearchRaw),
    [transactionSearchRaw],
  );

  const visibleRowParams = useMemo<StatementVisibleRowParams>(
    () => ({
      transactionTermsLower: transactionSearchTerms,
      dateFrom: txnDateFrom,
      dateTo: txnDateTo,
    }),
    [transactionSearchTerms, txnDateFrom, txnDateTo],
  );

  const statementFiltersActive = useMemo(
    () =>
      transactionSearchTerms.length > 0 ||
      txnDateFrom.trim().length > 0 ||
      txnDateTo.trim().length > 0,
    [transactionSearchTerms.length, txnDateFrom, txnDateTo],
  );

  const dateRangeInverted = useMemo(
    () => isStatementDateRangeInverted(txnDateFrom, txnDateTo),
    [txnDateFrom, txnDateTo],
  );

  const dateRangeSummaryForExport = useMemo(() => {
    const f = txnDateFrom.trim();
    const t = txnDateTo.trim();
    if (!f && !t) return null;
    const inv = dateRangeInverted ? " (From was after To — range normalized)" : "";
    if (f && !t) return `Txn date from ${f}${inv}`;
    if (!f && t) return `Txn date through ${t}`;
    return `Txn date ${f} to ${t}${inv}`;
  }, [txnDateFrom, txnDateTo, dateRangeInverted]);

  const handleSaveQuickSearch = useCallback(() => {
    const result = addSavedTransactionSearch(savedTxnSearches, transactionSearchRaw, "");
    if (!result.ok) {
      if (result.reason === "duplicate") {
        toast.info("This exact search is already in your quick saves.", { toastId: "stmt-qsave-dup" });
      }
      return;
    }
    setSavedTxnSearches(result.items);
    persistSavedTransactionSearches(result.items);
    const first = result.items[0];
    toast.success(`Saved quick search “${first?.label ?? "search"}”.`, { toastId: "stmt-qsave-ok" });
  }, [savedTxnSearches, transactionSearchRaw]);

  const removeSavedTxnSearch = useCallback((id: string) => {
    setSavedTxnSearches((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSavedTransactionSearches(next);
      return next;
    });
  }, []);

  const applySavedTxnSearch = useCallback((s: SavedTransactionSearch) => {
    setTransactionSearchRaw(s.raw);
  }, []);

  const wdDpTotals = useMemo(() => {
    const byDocId = new Map<string, { withdrawals: number; deposits: number }>();
    let grandWithdrawals = 0;
    let grandDeposits = 0;
    let anyReadyWithRows = false;
    for (const doc of sortedDocuments) {
      if (doc.loading || doc.error || doc.rows.length === 0) continue;
      anyReadyWithRows = true;
      const rows = filterStatementVisibleRows(doc.rows, visibleRowParams);
      const sums = sumStatementWdDpRows(rows);
      byDocId.set(doc.id, sums);
      grandWithdrawals += sums.withdrawals;
      grandDeposits += sums.deposits;
    }
    for (const item of cloudExtracts) {
      if (item.rows.length === 0) continue;
      anyReadyWithRows = true;
      const rows = filterStatementVisibleRows(item.rows, visibleRowParams);
      const sums = sumStatementWdDpRows(rows);
      byDocId.set(item.id, sums);
      grandWithdrawals += sums.withdrawals;
      grandDeposits += sums.deposits;
    }
    const grandNet = grandDeposits - grandWithdrawals;
    return { byDocId, grandWithdrawals, grandDeposits, grandNet, anyReadyWithRows };
  }, [sortedDocuments, cloudExtracts, visibleRowParams]);

  const grandTotalsScopeLabel = useMemo(() => {
    const hasLocal = sortedDocuments.some((d) => !d.loading && !d.error && d.rows.length > 0);
    const hasCloud = cloudExtracts.some((c) => c.rows.length > 0);
    if (hasLocal && hasCloud) return "All PDFs & saved extracts";
    if (hasCloud) return "Saved extracts";
    return "All PDFs";
  }, [sortedDocuments, cloudExtracts]);

  const listStats = useMemo(() => {
    let totalRowsAllPdfs = 0;
    let visibleRowsAllPdfs = 0;
    for (const doc of sortedDocuments) {
      if (doc.loading || doc.error) continue;
      totalRowsAllPdfs += doc.rows.length;
      visibleRowsAllPdfs += filterStatementVisibleRows(doc.rows, visibleRowParams).length;
    }
    return {
      pdfCount: sortedDocuments.length,
      totalRowsAllPdfs,
      visibleRowsAllPdfs,
    };
  }, [sortedDocuments, visibleRowParams]);

  const cloudListStats = useMemo(() => {
    let totalRows = 0;
    let visibleRows = 0;
    for (const item of cloudExtracts) {
      totalRows += item.rows.length;
      visibleRows += filterStatementVisibleRows(item.rows, visibleRowParams).length;
    }
    return {
      extractCount: cloudExtracts.length,
      totalRows,
      visibleRows,
    };
  }, [cloudExtracts, visibleRowParams]);

  const canExportStatementPdf =
    listStats.visibleRowsAllPdfs > 0 || cloudListStats.visibleRows > 0;

  const handleExportStatementPdf = useCallback(() => {
    const sections: StatementPdfExportSection[] = [];
    for (const item of sortedCloudExtracts) {
      const rows = filterStatementVisibleRows(item.rows, visibleRowParams);
      if (rows.length === 0) continue;
      const sums = wdDpTotals.byDocId.get(item.id);
      if (!sums) continue;
      sections.push({
        source: "firebase",
        fileName: item.fileName,
        rows,
        deposits: sums.deposits,
        withdrawals: sums.withdrawals,
      });
    }
    for (const doc of sortedDocuments) {
      if (doc.loading || doc.error) continue;
      const rows = filterStatementVisibleRows(doc.rows, visibleRowParams);
      if (rows.length === 0) continue;
      const sums = wdDpTotals.byDocId.get(doc.id);
      if (!sums) continue;
      sections.push({
        source: "local",
        fileName: doc.name,
        rows,
        deposits: sums.deposits,
        withdrawals: sums.withdrawals,
      });
    }
    if (sections.length === 0) {
      toast.error(
        "Nothing to export. Load PDFs with extracted rows, or widen your filters (search / dates).",
        { toastId: "stmt-pdf-empty" },
      );
      return;
    }
    try {
      downloadStatementExtractPdf({
        generatedAt: new Date(),
        transactionFilterRaw: transactionSearchRaw.trim() ? transactionSearchRaw : null,
        dateRangeSummary: dateRangeSummaryForExport,
        grandTotals: wdDpTotals.anyReadyWithRows
          ? {
              deposits: wdDpTotals.grandDeposits,
              withdrawals: wdDpTotals.grandWithdrawals,
              net: wdDpTotals.grandNet,
              scopeLabel: grandTotalsScopeLabel,
            }
          : null,
        sections,
      });
      toast.success(`Exported ${sections.length} section${sections.length === 1 ? "" : "s"} to PDF.`, {
        toastId: "stmt-pdf-ok",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create PDF.";
      toast.error(msg, { toastId: "stmt-pdf-err" });
    }
  }, [
    dateRangeSummaryForExport,
    grandTotalsScopeLabel,
    sortedCloudExtracts,
    sortedDocuments,
    transactionSearchRaw,
    visibleRowParams,
    wdDpTotals,
  ]);

  const activeGuideIndex = useMemo(
    () => Math.max(0, sortedDocuments.findIndex((d) => d.id === activeGuidePdfId)),
    [activeGuidePdfId, sortedDocuments],
  );
  const activeGuideDoc = sortedDocuments[activeGuideIndex] ?? null;

  const allDocsSelected =
    documents.length > 0 && documents.every((d) => selectedDocIds.has(d.id));
  const someDocsSelected = documents.some((d) => selectedDocIds.has(d.id));

  const allCloudExtractsSelected =
    cloudExtracts.length > 0 && cloudExtracts.every((c) => selectedCloudExtractIds.has(c.id));
  const someCloudExtractsSelected = cloudExtracts.some((c) => selectedCloudExtractIds.has(c.id));

  const allAccordionsCollapsed = useMemo(
    () => documents.length > 0 && documents.every((d) => collapsedDocIds.has(d.id)),
    [documents, collapsedDocIds],
  );

  const allCloudAccordionsCollapsed = useMemo(
    () => cloudExtracts.length > 0 && cloudExtracts.every((c) => collapsedCloudExtractIds.has(c.id)),
    [cloudExtracts, collapsedCloudExtractIds],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-[#eef2f7] to-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#1d6fb8]">
              Bank statements
            </p>
            <h1 className="text-lg font-bold tracking-tight text-[#1a3a5c] sm:text-xl">
              Parse &amp; review transactions
            </h1>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
              Upload PDFs, tune column guides per file, search the Transaction column, and see totals and
              per-row flow at a glance.
            </p>
          </div>
          <a
            href="/admin"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#1d6fb8]/40 hover:bg-slate-50 hover:text-[#1d6fb8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6fb8] focus-visible:ring-offset-2"
          >
            ← Back to admin
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-md shadow-slate-200/50 ring-1 ring-slate-100">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
            <h2 className="text-sm font-bold text-slate-800">Upload PDFs</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              One or more files · text-based statements · columns: Txn date, Transaction, Withdrawals,
              Deposits
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 px-4 py-10 transition hover:border-[#1d6fb8]/50 hover:bg-blue-50/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                disabled={anyLoading}
                className="sr-only"
                onChange={(e) => void onFile(e.target.files)}
              />
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1d6fb8] text-xl font-bold text-white shadow-lg shadow-[#1d6fb8]/25">
                PDF
              </span>
              <div className="text-center">
                <span className="text-sm font-semibold text-slate-800 group-hover:text-[#1a3a5c]">
                  Drop files here or click to browse
                </span>
                <p className="mt-1 text-xs text-slate-500">Multiple PDFs supported</p>
              </div>
              <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-[#1d6fb8] ring-1 ring-slate-200 group-hover:ring-[#1d6fb8]/30">
                Choose files
              </span>
            </label>
            {anyLoading && (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#1d6fb8]" />
                Reading PDF files…
              </p>
            )}
            {filePickerError && (
              <p className="mt-4 rounded-xl border border-red-100 bg-red-50/90 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
                {filePickerError}
              </p>
            )}
            {documents.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveGuidePdfId((prev) => prev ?? sortedDocuments[0]?.id ?? null);
                    setShowColumnGuide(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#1d6fb8]/30 bg-[#1d6fb8] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#1d6fb8]/20 transition hover:bg-[#17659d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6fb8] focus-visible:ring-offset-2"
                >
                  Show PDF with column guides
                </button>
              </div>
            )}
          </div>
        </section>

        {(documents.length > 0 ||
          cloudExtracts.length > 0 ||
          cloudExtractsLoading ||
          !!cloudExtractsError) && (
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-md shadow-slate-200/50 ring-1 ring-slate-100">
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Extracted rows</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {documents.length > 0 ? (
                      <>
                        {listStats.pdfCount} local PDF{listStats.pdfCount === 1 ? "" : "s"} ·{" "}
                        {listStats.visibleRowsAllPdfs} visible row
                        {listStats.visibleRowsAllPdfs === 1 ? "" : "s"}
                        {statementFiltersActive &&
                        listStats.totalRowsAllPdfs !== listStats.visibleRowsAllPdfs
                          ? ` (${listStats.totalRowsAllPdfs} total before filter)`
                          : null}
                      </>
                    ) : null}
                    {cloudExtractsLoading && cloudExtracts.length === 0 ? (
                      <span className="text-slate-500">
                        {documents.length > 0 ? <span className="mx-1">·</span> : null}
                        Loading saved extracts…
                      </span>
                    ) : null}
                    {cloudExtracts.length > 0 ? (
                      <span>
                        {documents.length > 0 || (cloudExtractsLoading && cloudExtracts.length === 0) ? (
                          <span className="mx-1">·</span>
                        ) : null}
                        {cloudListStats.extractCount} from Firebase · {cloudListStats.visibleRows} visible row
                        {cloudListStats.visibleRows === 1 ? "" : "s"}
                        {statementFiltersActive &&
                        cloudListStats.totalRows !== cloudListStats.visibleRows
                          ? ` (${cloudListStats.totalRows} in cloud before filter)`
                          : null}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canExportStatementPdf}
                    onClick={handleExportStatementPdf}
                    title={
                      canExportStatementPdf
                        ? "Download visible rows (current search and date filters) as a PDF file"
                        : "Add PDFs with rows or adjust your filters to enable export"
                    }
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <span aria-hidden>⤓</span>
                    Export PDF
                  </button>
                  <button
                    type="button"
                    disabled={cloudExtractsLoading}
                    onClick={() => void refreshCloudExtracts()}
                    className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {cloudExtractsLoading ? "Refreshing…" : "Refresh cloud"}
                  </button>
                  {documents.length > 0 || cloudExtracts.length > 0 ? (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <span className="hidden sm:inline">Sort</span>
                      <select
                        value={pdfSortMode}
                        onChange={(e) => setPdfSortMode(e.target.value as StatementPdfSortMode)}
                        className="cursor-pointer rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs font-semibold text-slate-800 shadow-sm transition focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/25"
                        aria-label="Sort PDFs and Firebase extracts by period in file name"
                      >
                        <option value="upload">
                          {documents.length > 0 && cloudExtracts.length > 0
                            ? "List order (upload / cloud)"
                            : documents.length > 0
                              ? "Upload order"
                              : "Cloud list order"}
                        </option>
                        <option value="period-asc">Old → new (name)</option>
                        <option value="period-desc">New → old (name)</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>
              {documents.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]"
                      checked={allDocsSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someDocsSelected && !allDocsSelected;
                      }}
                      onChange={toggleSelectAllDocs}
                      aria-label="Select all PDFs"
                    />
                    Select all
                  </label>
                  <button
                    type="button"
                    disabled={!someDocsSelected}
                    onClick={requestDeleteSelectedDocuments}
                    className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Delete selected
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (allAccordionsCollapsed) setCollapsedDocIds(new Set());
                      else setCollapsedDocIds(new Set(documents.map((d) => d.id)));
                    }}
                    aria-expanded={!allAccordionsCollapsed}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    {allAccordionsCollapsed ? "Expand all" : "Collapse all"}
                  </button>
                </div>
              ) : null}
              {cloudExtracts.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]"
                      checked={allCloudExtractsSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someCloudExtractsSelected && !allCloudExtractsSelected;
                      }}
                      onChange={toggleSelectAllCloudExtracts}
                      disabled={cloudDeleteLocked}
                      aria-label="Select all Firebase extracts"
                    />
                    Select all (cloud)
                  </label>
                  <button
                    type="button"
                    disabled={!someCloudExtractsSelected || cloudDeleteLocked}
                    onClick={requestDeleteSelectedCloudExtracts}
                    className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {cloudBatchDeleting ? "Deleting…" : "Delete selected from cloud"}
                  </button>
                  <button
                    type="button"
                    disabled={cloudDeleteLocked}
                    onClick={() => {
                      if (allCloudAccordionsCollapsed) setCollapsedCloudExtractIds(new Set());
                      else setCollapsedCloudExtractIds(new Set(cloudExtracts.map((c) => c.id)));
                    }}
                    aria-expanded={!allCloudAccordionsCollapsed}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {allCloudAccordionsCollapsed ? "Expand all (cloud)" : "Collapse all (cloud)"}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
              <label htmlFor="stmt-txn-search" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Search transactions
              </label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                  ⌕
                </span>
                <input
                  id="stmt-txn-search"
                  type="text"
                  value={transactionSearchRaw}
                  onChange={(e) => setTransactionSearchRaw(e.target.value)}
                  placeholder="e.g. Groww"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-[4.75rem] text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
                  aria-describedby="stmt-txn-search-hint"
                />
                <button
                  type="button"
                  disabled={!transactionSearchRaw.trim()}
                  onClick={handleSaveQuickSearch}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1d6fb8] shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Save current search text as a quick save"
                >
                  Save
                </button>
              </div>
              <p id="stmt-txn-search-hint" className="mt-2 text-xs leading-relaxed text-slate-500">
                Separate names with comma, semicolon, or newline. A row is kept when its{" "}
                <strong className="font-semibold text-slate-700">Transaction</strong> text contains{" "}
                <strong className="font-semibold text-slate-700">any</strong> term (case-insensitive). Use{" "}
                <strong className="font-semibold text-slate-700">Save</strong> to store this browser&apos;s search for
                later (localStorage).
              </p>

              <div className="mt-4 rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Txn date range</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Optional. Parsed from the <strong className="font-semibold text-slate-700">Txn date</strong> column
                  (DD/MM/YYYY and YYYY-MM-DD). Rows with a missing or unparseable date stay visible.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="stmt-date-from"
                      className="block text-xs font-semibold text-slate-600"
                    >
                      From
                    </label>
                    <input
                      id="stmt-date-from"
                      type="date"
                      value={txnDateFrom}
                      onChange={(e) => setTxnDateFrom(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="stmt-date-to" className="block text-xs font-semibold text-slate-600">
                      Through
                    </label>
                    <input
                      id="stmt-date-to"
                      type="date"
                      value={txnDateTo}
                      onChange={(e) => setTxnDateTo(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
                    />
                  </div>
                </div>
                {(txnDateFrom.trim() || txnDateTo.trim()) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTxnDateFrom("");
                        setTxnDateTo("");
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Clear dates
                    </button>
                  </div>
                )}
                {dateRangeInverted ? (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    From is after Through — the range is read as between those two calendar days (earlier to later).
                  </p>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Quick saves</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Chip labels are shortened from the saved search text. Tap a chip to apply the full filter.
                </p>
                {savedTxnSearches.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label="Saved quick searches">
                    {savedTxnSearches.map((s) => (
                      <li key={s.id}>
                        <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-0.5 text-xs shadow-sm">
                          <button
                            type="button"
                            title={s.raw}
                            onClick={() => applySavedTxnSearch(s)}
                            className="min-w-0 max-w-[200px] truncate text-left font-semibold text-slate-800 underline-offset-2 hover:underline"
                          >
                            {s.label}
                          </button>
                          <button
                            type="button"
                            title="Remove from quick saves"
                            onClick={() => removeSavedTxnSearch(s.id)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-700"
                            aria-label={`Remove quick save ${s.label}`}
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No quick saves yet — type a search above, then save.</p>
                )}
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {cloudExtractsError && (
                <p className="mb-4 rounded-xl border border-red-100 bg-red-50/90 px-3 py-2 text-sm text-red-800">
                  {cloudExtractsError}
                </p>
              )}
              {wdDpTotals.anyReadyWithRows && (
                <div
                  className={`mb-6 overflow-hidden rounded-2xl shadow-sm ${profitLossBoxClass(wdDpTotals.grandNet)}`}
                >
                  <p
                    className={`border-b border-slate-900/[0.06] px-4 py-2.5 text-xs font-bold uppercase tracking-wide ${
                      wdDpTotals.grandNet > 0
                        ? "text-emerald-900/90"
                        : wdDpTotals.grandNet < 0
                          ? "text-red-900/90"
                          : "text-slate-600"
                    }`}
                  >
                    {grandTotalsScopeLabel} · visible rows
                    {statementFiltersActive ? " (filters on)" : ""}
                  </p>
                  <div className="grid gap-3 p-4 sm:grid-cols-3 sm:gap-4">
                    <div className="rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-slate-900/[0.05]">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Deposits</p>
                      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-slate-900">
                        {formatInrMoney(wdDpTotals.grandDeposits)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-slate-900/[0.05]">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Withdrawals
                      </p>
                      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-slate-900">
                        {formatInrMoney(wdDpTotals.grandWithdrawals)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-slate-900/[0.05]">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Net</p>
                      <p
                        className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${profitLossTextClass(wdDpTotals.grandNet)}`}
                      >
                        {formatInrMoney(wdDpTotals.grandNet)}
                      </p>
                      <p className={`text-[11px] font-semibold ${profitLossTextClass(wdDpTotals.grandNet)}`}>
                        {profitLossLabel(wdDpTotals.grandNet)} · Deposits − Withdrawals
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {sortedCloudExtracts.map((item) => {
                  const accordionOpen = !collapsedCloudExtractIds.has(item.id);
                  const rowsToShow = filterStatementVisibleRows(item.rows, visibleRowParams);
                  const extractSums = wdDpTotals.byDocId.get(item.id);
                  const extractNet =
                    extractSums != null ? extractSums.deposits - extractSums.withdrawals : 0;
                  const filteredCount = rowsToShow.length;
                  const uploadedLabel =
                    item.uploadedAtMs != null
                      ? new Date(item.uploadedAtMs).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : null;
                  return (
                    <div
                      key={`cloud-${item.id}`}
                      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100"
                    >
                      <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-3 py-3 sm:px-4">
                        <input
                          type="checkbox"
                          className="mt-2 h-4 w-4 shrink-0 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]"
                          checked={selectedCloudExtractIds.has(item.id)}
                          disabled={cloudDeleteLocked}
                          onChange={() => toggleCloudExtractSelected(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${item.fileName} in cloud`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleCloudExtractAccordion(item.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-0.5 text-left transition hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6fb8] focus-visible:ring-offset-1"
                          aria-expanded={accordionOpen}
                        >
                          <span
                            className="mt-0.5 shrink-0 text-slate-400 tabular-nums w-4 text-center text-xs"
                            aria-hidden
                          >
                            {accordionOpen ? "▼" : "▶"}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="break-all text-sm font-bold text-slate-900">{item.fileName}</span>
                              <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900">
                                Firebase
                              </span>
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                {item.rows.length} row{item.rows.length === 1 ? "" : "s"}
                                {statementFiltersActive && filteredCount !== item.rows.length ? (
                                  <span className="text-slate-500">
                                    {" "}
                                    · {filteredCount} match{filteredCount === 1 ? "" : "es"}
                                  </span>
                                ) : null}
                              </span>
                              {uploadedLabel ? (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                  Saved {uploadedLabel}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={cloudDeleteLocked}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteCloudExtract(item);
                            }}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                          >
                            {cloudExtractDeletingId === item.id ? "Deleting…" : "Delete from cloud"}
                          </button>
                        </div>
                        {item.rows.length > 0 && extractSums != null && (
                          <div className="w-full border-t border-slate-200/90 pt-3 text-xs leading-relaxed text-slate-600">
                            <span className="font-bold text-slate-800">This extract</span>
                            {" · "}
                            Deposits{" "}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatInrMoney(extractSums.deposits)}
                            </strong>
                            {" − "}
                            Withdrawals{" "}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatInrMoney(extractSums.withdrawals)}
                            </strong>
                            {" = "}
                            <strong className={`font-mono tabular-nums ${profitLossTextClass(extractNet)}`}>
                              {formatInrMoney(extractNet)}
                            </strong>
                            <span className={`font-bold ${profitLossTextClass(extractNet)}`}>
                              {" "}
                              ({profitLossLabel(extractNet)})
                            </span>
                            {statementFiltersActive ? (
                              <span className="font-normal text-slate-500"> · visible rows only</span>
                            ) : null}
                          </div>
                        )}
                        {item.rows.length === 0 && (
                          <div className="w-full border-t border-slate-200/90 pt-3 text-xs text-slate-500">
                            No rows are stored for this saved extract.
                          </div>
                        )}
                      </div>
                      {accordionOpen && (
                        <div className="bg-slate-50/40 px-3 py-4 sm:px-4">
                          {item.rows.length > 0 && rowsToShow.length === 0 && (
                            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                              No rows match this filter ({item.rows.length} row
                              {item.rows.length === 1 ? "" : "s"} hidden).
                            </p>
                          )}
                          {rowsToShow.length > 0 && (
                            <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-inner ring-1 ring-slate-100">
                              <table className="w-full min-w-0 table-fixed border-collapse text-left text-[13px]">
                                <colgroup>
                                  <col className="w-10" />
                                  <col className="w-11" />
                                  <col className="w-[7rem]" />
                                  <col className="w-[min(18rem,42vw)]" />
                                  <col className="w-[5.75rem] sm:w-24" />
                                  <col className="w-[5.75rem] sm:w-24" />
                                </colgroup>
                                <thead>
                                  <tr className="border-b border-slate-200 bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                                    <th className="whitespace-nowrap px-2 py-3 pl-3 text-right">#</th>
                                    <th className="whitespace-nowrap px-2 py-3">Pg</th>
                                    <th className="whitespace-nowrap px-2 py-3">Txn date</th>
                                    <th className="px-2 py-3 text-left">Transaction</th>
                                    <th className="whitespace-nowrap px-2 py-3 text-right">Withdrawals</th>
                                    <th className="whitespace-nowrap px-2 py-3 pr-3 text-right">Deposits</th>
                                  </tr>
                                </thead>
                                <tbody className="font-mono text-slate-800">
                                  {rowsToShow.map((r, i) => (
                                    <tr
                                      key={`${item.id}-r${i}-${r.page}`}
                                      className="border-b border-slate-100 align-top transition even:bg-slate-50/50 hover:bg-blue-50/40"
                                    >
                                      <td className="px-2 py-2.5 pl-3 text-right text-xs tabular-nums text-slate-400">
                                        {i + 1}
                                      </td>
                                      <td className="px-2 py-2.5 text-xs tabular-nums text-slate-500">{r.page}</td>
                                      <td className="px-2 py-2.5 font-sans text-xs text-slate-700 whitespace-pre-wrap wrap-break-word">
                                        {r.txnDate ? r.txnDate : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="min-w-0 px-2 py-2.5 font-sans text-xs leading-snug text-slate-800 whitespace-pre-wrap wrap-break-word">
                                        {r.transaction ? r.transaction : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-xs tabular-nums wrap-break-word">
                                        {r.withdrawals ? r.withdrawals : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="px-2 py-2.5 pr-3 text-right text-xs tabular-nums wrap-break-word">
                                        {r.deposits ? r.deposits : <span className="text-slate-300">—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sortedDocuments.map((doc) => {
                  const accordionOpen = !collapsedDocIds.has(doc.id);
                  const rowsToShow = filterStatementVisibleRows(doc.rows, visibleRowParams);
                  const docSums = wdDpTotals.byDocId.get(doc.id);
                  const pdfNet = docSums != null ? docSums.deposits - docSums.withdrawals : 0;
                  const filteredCount = rowsToShow.length;
                  const extractUpload = extractUploadByDocId[doc.id] ?? "idle";
                  const extractUploadDisabled =
                    doc.loading ||
                    !!doc.error ||
                    doc.rows.length === 0 ||
                    extractUpload === "uploading" ||
                    extractUpload === "uploaded" ||
                    extractUpload === "duplicate";
                  const extractUploadLabel =
                    extractUpload === "uploading"
                      ? "Uploading…"
                      : extractUpload === "uploaded"
                        ? "Uploaded"
                        : extractUpload === "duplicate"
                          ? "In cloud"
                          : extractUpload === "error"
                            ? "Retry upload"
                            : "Upload";
                  return (
                    <div
                      key={doc.id}
                      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100"
                    >
                      <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-3 py-3 sm:px-4">
                        <input
                          type="checkbox"
                          className="mt-2 h-4 w-4 shrink-0 rounded border-slate-300 text-[#1d6fb8] focus:ring-[#1d6fb8]"
                          checked={selectedDocIds.has(doc.id)}
                          onChange={() => toggleDocSelected(doc.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${doc.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleDocAccordion(doc.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-0.5 text-left transition hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6fb8] focus-visible:ring-offset-1"
                          aria-expanded={accordionOpen}
                        >
                          <span
                            className="mt-0.5 shrink-0 text-slate-400 tabular-nums w-4 text-center text-xs"
                            aria-hidden
                          >
                            {accordionOpen ? "▼" : "▶"}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="break-all text-sm font-bold text-slate-900">{doc.name}</span>
                              {doc.loading ? (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                                  Loading
                                </span>
                              ) : doc.error ? (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                                  Error
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                  {doc.rows.length} row{doc.rows.length === 1 ? "" : "s"}
                                  {statementFiltersActive && filteredCount !== doc.rows.length ? (
                                    <span className="text-slate-500">
                                      {" "}
                                      · {filteredCount} match{filteredCount === 1 ? "" : "es"}
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm({ type: "pdf-single", docId: doc.id, name: doc.name });
                            }}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            disabled={extractUploadDisabled}
                            title="Upload extracted rows to Firestore (PDF file is not stored). Same file name + same rows cannot be uploaded twice."
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleUploadStatementExtract(doc);
                            }}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition disabled:pointer-events-none disabled:opacity-50 ${
                              extractUpload === "uploaded"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                : extractUpload === "duplicate"
                                  ? "border-slate-300 bg-slate-100 text-slate-600"
                                  : extractUpload === "error"
                                    ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                    : "border-emerald-600/40 bg-white text-emerald-800 hover:bg-emerald-50"
                            }`}
                          >
                            {extractUploadLabel}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveGuidePdfId(doc.id);
                              setShowColumnGuide(true);
                            }}
                            className="rounded-xl border border-[#1d6fb8]/35 bg-[#1d6fb8] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#17659d]"
                          >
                            Guides
                          </button>
                        </div>
                        {!doc.loading && !doc.error && doc.rows.length > 0 && docSums != null && (
                          <div className="w-full border-t border-slate-200/90 pt-3 text-xs leading-relaxed text-slate-600">
                            <span className="font-bold text-slate-800">This PDF</span>
                            {" · "}
                            Deposits{" "}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatInrMoney(docSums.deposits)}
                            </strong>
                            {" − "}
                            Withdrawals{" "}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatInrMoney(docSums.withdrawals)}
                            </strong>
                            {" = "}
                            <strong className={`font-mono tabular-nums ${profitLossTextClass(pdfNet)}`}>
                              {formatInrMoney(pdfNet)}
                            </strong>
                            <span className={`font-bold ${profitLossTextClass(pdfNet)}`}>
                              {" "}
                              ({profitLossLabel(pdfNet)})
                            </span>
                            {statementFiltersActive ? (
                              <span className="text-slate-500 font-normal"> · visible rows only</span>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {accordionOpen && (
                        <div className="bg-slate-50/40 px-3 py-4 sm:px-4">
                          {doc.loading && (
                            <p className="flex items-center gap-2 text-sm text-slate-600">
                              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#1d6fb8]" />
                              Extracting rows…
                            </p>
                          )}
                          {!doc.loading && doc.error && (
                            <p className="rounded-xl border border-red-100 bg-red-50/90 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
                              {doc.error}
                            </p>
                          )}
                          {!doc.loading && !doc.error && doc.rows.length > 0 && rowsToShow.length === 0 && (
                            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                              No rows match this filter ({doc.rows.length} row
                              {doc.rows.length === 1 ? "" : "s"} hidden).
                            </p>
                          )}
                          {!doc.loading && !doc.error && rowsToShow.length > 0 && (
                            <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-inner ring-1 ring-slate-100">
                              <table className="w-full min-w-0 table-fixed border-collapse text-left text-[13px]">
                                <colgroup>
                                  <col className="w-10" />
                                  <col className="w-11" />
                                  <col className="w-[7rem]" />
                                  <col className="w-[min(18rem,42vw)]" />
                                  <col className="w-[5.75rem] sm:w-24" />
                                  <col className="w-[5.75rem] sm:w-24" />
                                </colgroup>
                                <thead>
                                  <tr className="border-b border-slate-200 bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                                    <th className="whitespace-nowrap px-2 py-3 pl-3 text-right">#</th>
                                    <th className="whitespace-nowrap px-2 py-3">Pg</th>
                                    <th className="whitespace-nowrap px-2 py-3">Txn date</th>
                                    <th className="px-2 py-3 text-left">Transaction</th>
                                    <th className="whitespace-nowrap px-2 py-3 text-right">Withdrawals</th>
                                    <th className="whitespace-nowrap px-2 py-3 pr-3 text-right">Deposits</th>
                                  </tr>
                                </thead>
                                <tbody className="font-mono text-slate-800">
                                  {rowsToShow.map((r, i) => (
                                    <tr
                                      key={`${doc.id}-r${i}-${r.page}`}
                                      className="border-b border-slate-100 align-top transition even:bg-slate-50/50 hover:bg-blue-50/40"
                                    >
                                      <td className="px-2 py-2.5 pl-3 text-right text-xs tabular-nums text-slate-400">
                                        {i + 1}
                                      </td>
                                      <td className="px-2 py-2.5 text-xs tabular-nums text-slate-500">{r.page}</td>
                                      <td className="px-2 py-2.5 font-sans text-xs text-slate-700 whitespace-pre-wrap wrap-break-word">
                                        {r.txnDate ? r.txnDate : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="min-w-0 px-2 py-2.5 font-sans text-xs leading-snug text-slate-800 whitespace-pre-wrap wrap-break-word">
                                        {r.transaction ? r.transaction : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-xs tabular-nums wrap-break-word">
                                        {r.withdrawals ? r.withdrawals : <span className="text-slate-300">—</span>}
                                      </td>
                                      <td className="px-2 py-2.5 pr-3 text-right text-xs tabular-nums wrap-break-word">
                                        {r.deposits ? r.deposits : <span className="text-slate-300">—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      <DangerActionDialog
        open={deleteConfirm !== null}
        onClose={() => {
          if (deleteConfirmLoading) return;
          setDeleteConfirm(null);
        }}
        onConfirm={() => void executeDeleteConfirm()}
        titleId="stmt-delete-confirm-title"
        title={deleteConfirmPresentation?.title ?? ""}
        message={deleteConfirmPresentation?.message ?? null}
        confirmLabel={deleteConfirmPresentation?.confirmLabel ?? "Confirm"}
        confirmLoading={deleteConfirmLoading}
        loadingLabel="Deleting…"
      />

      {showColumnGuide && activeGuideDoc && (
        <StatementPdfColumnGuideModal
          data={activeGuideDoc.data}
          fileName={activeGuideDoc.name}
          fileIndex={activeGuideIndex}
          totalFiles={documents.length}
          onNavigatePrev={
            activeGuideIndex > 0
              ? () => setActiveGuidePdfId(sortedDocuments[activeGuideIndex - 1]!.id)
              : undefined
          }
          onNavigateNext={
            activeGuideIndex < sortedDocuments.length - 1
              ? () => setActiveGuidePdfId(sortedDocuments[activeGuideIndex + 1]!.id)
              : undefined
          }
          columnBandDeltas={activeGuideDoc.bandDeltas}
          onColumnBandDeltasChange={(next) => setDocBandDeltas(activeGuideDoc.id, next)}
          onClose={() => setShowColumnGuide(false)}
        />
      )}
    </div>
  );
}
