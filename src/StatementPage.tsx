import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import {
  deleteStatementExtract,
  deleteStatementExtractsForProfile,
  loadRecentStatementExtracts,
  loadStatementProfilesDB,
  saveStatementExtractIfNew,
  saveStatementProfilesDB,
  type StatementExtractListItem,
} from "./data/firestoreDb";
import { StatementPdfColumnGuideModal } from "./StatementPdfColumnGuideModal";
import {
  DEFAULT_COLUMN_BAND_DELTAS,
  extractStatementWdDpRowsFromPdfData,
  resolveStatementColumnBandDeltas,
  type StatementColumnBandDeltas,
  type StatementPdfPageTotal,
  type StatementWdDpRow,
} from "./statement/extractStatementColumnsFromPdf";
import {
  sortStatementPdfsByPeriod,
  type StatementPdfSortMode,
} from "./statement/sortStatementPdfsByPeriod";
import { sumStatementWdDpRows, formatStatementInrMoney } from "./statement/statementMoneyParse";
import { StatementWdDpRowsTable } from "./statement/StatementWdDpRowsTable";
import { StatementGrandTotals } from "./statement/StatementGrandTotals";
import { StatementFiltersPanel } from "./statement/StatementFiltersPanel";
import {
  addSavedTransactionSearch,
  loadSavedTransactionSearches,
  persistSavedTransactionSearches,
  type SavedTransactionSearch,
} from "./statement/savedTransactionSearches";
import {
  addStatementProfile,
  loadActiveStatementProfileId,
  loadStatementProfileColumnBandDeltas,
  loadStatementProfileFilters,
  loadStatementProfiles,
  persistActiveStatementProfileId,
  persistStatementProfileColumnBandDeltas,
  persistStatementProfileFilters,
  persistStatementProfiles,
  profileHasSavedColumnBandDeltas,
  removeStatementProfile,
  renameStatementProfile,
  resolveActiveStatementProfileId,
  type StatementProfile,
} from "./statement/statementProfiles";
import { isStatementDateRangeInverted } from "./statement/statementDateRangeFilter";
import {
  filterStatementVisibleRows,
  type StatementVisibleRowParams,
} from "./statement/statementRowFilters";
import { parseTransactionSearchTerms } from "./statement/transactionSearchFilter";
import { downloadStatementExtractPdf, type StatementPdfExportSection } from "./statement/exportStatementPdf";
import { StatementFileMoneySummary } from "./statement/statementFormat";
import { StatementListControls } from "./statement/StatementListControls";
import { StatementResultsToolbar } from "./statement/StatementResultsToolbar";
import "./statement/statement-page.css";
import { DangerActionDialog } from "./ui";


type LoadedStatementPdf = {
  id: string;
  name: string;
  data: ArrayBuffer;
  bandDeltas: StatementColumnBandDeltas;
  rows: StatementWdDpRow[];
  pdfPageTotals: StatementPdfPageTotal[];
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
  | { type: "pdf-batch"; docIds: string[] }
  | { type: "profile"; profileId: string; profileName: string };

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
    case "profile":
      return {
        title: `Delete profile “${p.profileName}”?`,
        message: (
          <p className="text-[13px] leading-snug text-gray-600">
            This removes the profile, its saved filters, quick searches, and any cloud extracts tagged for this
            person. PDFs loaded only in this browser tab are discarded. You cannot undo this.
          </p>
        ),
        confirmLabel: "Yes, delete profile",
      };
  }
}

export default function StatementPage() {
  const initialProfileId =
    typeof window !== "undefined" ? loadActiveStatementProfileId() : "me";
  const initialFilters =
    typeof window !== "undefined"
      ? loadStatementProfileFilters(initialProfileId)
      : { transactionSearchRaw: "", txnDateFrom: "", txnDateTo: "", showOnlyPageTotals: false, showPdfPrintedTotals: false };

  const [profiles, setProfiles] = useState<StatementProfile[]>(() =>
    typeof window !== "undefined" ? loadStatementProfiles() : [{ id: "me", name: "Me" }],
  );
  const [activeProfileId, setActiveProfileId] = useState(initialProfileId);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileEditNameValue, setProfileEditNameValue] = useState("");
  const documentsByProfileRef = useRef<Record<string, LoadedStatementPdf[]>>({});
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
  const [transactionSearchRaw, setTransactionSearchRaw] = useState(
    initialFilters.transactionSearchRaw,
  );
  /** `<input type="date">` values (`YYYY-MM-DD`) for Txn date column filtering. */
  const [txnDateFrom, setTxnDateFrom] = useState(initialFilters.txnDateFrom);
  const [txnDateTo, setTxnDateTo] = useState(initialFilters.txnDateTo);
  const [showOnlyPageTotals, setShowOnlyPageTotals] = useState(initialFilters.showOnlyPageTotals);
  const [showPdfPrintedTotals, setShowPdfPrintedTotals] = useState(initialFilters.showPdfPrintedTotals);
  const [savedTxnSearches, setSavedTxnSearches] = useState<SavedTransactionSearch[]>(() =>
    typeof window !== "undefined" ? loadSavedTransactionSearches(initialProfileId) : [],
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
  const profilesCloudHydratedRef = useRef(false);

  const pushProfilesToCloud = useCallback((nextProfiles: StatementProfile[], activeId: string) => {
    void saveStatementProfilesDB({
      profiles: nextProfiles,
      activeProfileId: activeId,
    }).catch(() => {
      toast.warn("Profile list could not sync to cloud. Other browsers may not see your profiles.", {
        toastId: "stmt-profile-cloud-sync",
      });
    });
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0]!,
    [profiles, activeProfileId],
  );

  const profileHasSavedColumns = useMemo(
    () => profileHasSavedColumnBandDeltas(activeProfileId),
    [activeProfileId],
  );

  const persistCurrentProfileFilters = useCallback(() => {
    persistStatementProfileFilters(activeProfileId, {
      transactionSearchRaw,
      txnDateFrom,
      txnDateTo,
      showOnlyPageTotals,
      showPdfPrintedTotals,
    });
  }, [activeProfileId, transactionSearchRaw, txnDateFrom, txnDateTo, showOnlyPageTotals, showPdfPrintedTotals]);

  useEffect(() => {
    persistCurrentProfileFilters();
  }, [persistCurrentProfileFilters]);

  const activateProfileWithoutSavingFrom = useCallback((nextProfileId: string) => {
    const nextDocs = documentsByProfileRef.current[nextProfileId] ?? [];
    const filters = loadStatementProfileFilters(nextProfileId);
    setActiveProfileId(nextProfileId);
    persistActiveStatementProfileId(nextProfileId);
    setDocuments(nextDocs);
    setSelectedDocIds(new Set());
    setCollapsedDocIds(new Set());
    setExtractUploadByDocId({});
    setActiveGuidePdfId(nextDocs[0]?.id ?? null);
    setShowColumnGuide(false);
    setTransactionSearchRaw(filters.transactionSearchRaw);
    setTxnDateFrom(filters.txnDateFrom);
    setTxnDateTo(filters.txnDateTo);
    setShowOnlyPageTotals(filters.showOnlyPageTotals);
    setShowPdfPrintedTotals(filters.showPdfPrintedTotals);
    setSavedTxnSearches(loadSavedTransactionSearches(nextProfileId));
    setSelectedCloudExtractIds(new Set());
    setCollapsedCloudExtractIds(new Set());
    setProfileEditing(false);
  }, []);

  useEffect(() => {
    if (profilesCloudHydratedRef.current) return;
    profilesCloudHydratedRef.current = true;
    void (async () => {
      try {
        const cloud = await loadStatementProfilesDB();
        const local = loadStatementProfiles();
        if (cloud) {
          persistStatementProfiles(cloud.profiles);
          setProfiles(cloud.profiles);
          const active = resolveActiveStatementProfileId(cloud.profiles, cloud.activeProfileId);
          persistActiveStatementProfileId(active);
          activateProfileWithoutSavingFrom(active);
          return;
        }
        const hasCustomLocal =
          local.length > 1 || local.some((p) => p.id !== "me" && p.name !== "Me");
        if (hasCustomLocal) {
          const active = resolveActiveStatementProfileId(local, loadActiveStatementProfileId());
          await saveStatementProfilesDB({ profiles: local, activeProfileId: active });
        }
      } catch {
        /* offline / firebase */
      }
    })();
  }, [activateProfileWithoutSavingFrom]);

  const switchStatementProfile = useCallback(
    (nextProfileId: string) => {
      if (nextProfileId === activeProfileId) return;
      documentsByProfileRef.current[activeProfileId] = documents;
      persistStatementProfileFilters(activeProfileId, {
        transactionSearchRaw,
        txnDateFrom,
        txnDateTo,
        showOnlyPageTotals,
        showPdfPrintedTotals,
      });
      const nextDocs = documentsByProfileRef.current[nextProfileId] ?? [];
      const filters = loadStatementProfileFilters(nextProfileId);
      setActiveProfileId(nextProfileId);
      persistActiveStatementProfileId(nextProfileId);
      setDocuments(nextDocs);
      setSelectedDocIds(new Set());
      setCollapsedDocIds(new Set());
      setExtractUploadByDocId({});
      setActiveGuidePdfId(nextDocs[0]?.id ?? null);
      setShowColumnGuide(false);
      setTransactionSearchRaw(filters.transactionSearchRaw);
      setTxnDateFrom(filters.txnDateFrom);
      setTxnDateTo(filters.txnDateTo);
      setShowOnlyPageTotals(filters.showOnlyPageTotals);
      setShowPdfPrintedTotals(filters.showPdfPrintedTotals);
      setSavedTxnSearches(loadSavedTransactionSearches(nextProfileId));
      setSelectedCloudExtractIds(new Set());
      setCollapsedCloudExtractIds(new Set());
      setProfileEditing(false);
      pushProfilesToCloud(profiles, nextProfileId);
    },
    [activeProfileId, documents, transactionSearchRaw, txnDateFrom, txnDateTo, showOnlyPageTotals, showPdfPrintedTotals, profiles, pushProfilesToCloud],
  );

  const handleAddProfile = useCallback(() => {
    const result = addStatementProfile(profiles, newProfileName);
    if ("error" in result) {
      toast.error(result.error, { toastId: "stmt-profile-err" });
      return;
    }
    setProfiles(result.profiles);
    setNewProfileName("");
    pushProfilesToCloud(result.profiles, result.newId);
    switchStatementProfile(result.newId);
    toast.success(`Profile “${result.profiles.find((p) => p.id === result.newId)?.name}” added.`, {
      toastId: "stmt-profile-add",
    });
  }, [profiles, newProfileName, switchStatementProfile, pushProfilesToCloud]);

  const startProfileRename = useCallback(() => {
    setProfileEditNameValue(activeProfile.name);
    setProfileEditing(true);
  }, [activeProfile.name]);

  const cancelProfileRename = useCallback(() => {
    setProfileEditing(false);
    setProfileEditNameValue("");
  }, []);

  const handleSaveProfileRename = useCallback(() => {
    const result = renameStatementProfile(profiles, activeProfileId, profileEditNameValue);
    if ("error" in result) {
      toast.error(result.error, { toastId: "stmt-profile-rename-err" });
      return;
    }
    setProfiles(result.profiles);
    setProfileEditing(false);
    setProfileEditNameValue("");
    pushProfilesToCloud(result.profiles, activeProfileId);
    toast.success("Profile name updated.", { toastId: "stmt-profile-rename-ok" });
  }, [activeProfileId, profileEditNameValue, profiles, pushProfilesToCloud]);

  const requestDeleteActiveProfile = useCallback(() => {
    if (profiles.length <= 1) return;
    setDeleteConfirm({
      type: "profile",
      profileId: activeProfileId,
      profileName: activeProfile.name,
    });
  }, [activeProfileId, activeProfile.name, profiles.length]);

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
            ? {
                ...doc,
                rows: out.rows,
                pdfPageTotals: out.pdfPageTotals,
                loading: false,
                error: out.rows.length === 0 ? NO_ROWS_MESSAGE : null,
              }
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
                pdfPageTotals: [],
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

    const uploadBandDeltas = resolveStatementColumnBandDeltas({
      columnBandDeltas:
        loadStatementProfileColumnBandDeltas(activeProfileId) ?? DEFAULT_COLUMN_BAND_DELTAS,
    });

    const docs: LoadedStatementPdf[] = [];
    for (let i = 0; i < pdfFiles.length; i += 1) {
      const file = pdfFiles[i];
      try {
        const data = await file.arrayBuffer();
        docs.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          data,
          bandDeltas: { ...uploadBandDeltas },
          rows: [],
          pdfPageTotals: [],
          loading: true,
          error: null,
        });
      } catch {
        docs.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          data: new ArrayBuffer(0),
          bandDeltas: { ...uploadBandDeltas },
          rows: [],
          pdfPageTotals: [],
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
  }, [activeProfileId, parseDocument]);

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

  const refreshCloudExtracts = useCallback(async (profileId?: string) => {
    const pid = profileId ?? activeProfileId;
    setCloudExtractsLoading(true);
    setCloudExtractsError(null);
    try {
      const list = await loadRecentStatementExtracts(pid, 50);
      setCloudExtracts(list);
    } catch (e) {
      setCloudExtracts([]);
      setCloudExtractsError(
        e instanceof Error ? e.message : "Could not load saved extracts from Firebase.",
      );
    } finally {
      setCloudExtractsLoading(false);
    }
  }, [activeProfileId]);

  const performDeleteProfile = useCallback(
    async (profileId: string, profileName: string) => {
      const removedCount = await deleteStatementExtractsForProfile(profileId);
      delete documentsByProfileRef.current[profileId];
      const result = removeStatementProfile(profiles, profileId);
      if ("error" in result) throw new Error(result.error);
      setProfiles(result.profiles);
      const nextActive =
        profileId === activeProfileId ? result.fallbackId : activeProfileId;
      pushProfilesToCloud(result.profiles, nextActive);
      if (profileId === activeProfileId) {
        activateProfileWithoutSavingFrom(result.fallbackId);
        setCloudExtracts([]);
        void refreshCloudExtracts(result.fallbackId);
      }
      toast.success(
        `Profile “${profileName}” deleted${removedCount > 0 ? ` (${removedCount} cloud save${removedCount === 1 ? "" : "s"} removed)` : ""}.`,
        { toastId: "stmt-profile-del-ok" },
      );
    },
    [activeProfileId, activateProfileWithoutSavingFrom, profiles, refreshCloudExtracts, pushProfilesToCloud],
  );

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
      } else if (p.type === "profile") {
        await performDeleteProfile(p.profileId, p.profileName);
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
    performDeleteProfile,
    removeDocumentsByIds,
  ]);

  useEffect(() => {
    void refreshCloudExtracts(activeProfileId);
  }, [activeProfileId, refreshCloudExtracts]);

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
      const result = await saveStatementExtractIfNew({
        profileId: activeProfileId,
        fileName: doc.name,
        rows: doc.rows,
      });
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
    [activeProfileId, refreshCloudExtracts],
  );

  const setDocBandDeltas = useCallback(
    (docId: string, next: StatementColumnBandDeltas) => {
      const resolved = resolveStatementColumnBandDeltas({ columnBandDeltas: next });
      persistStatementProfileColumnBandDeltas(activeProfileId, resolved);
      let parseTarget: ArrayBuffer | null = null;
      setDocuments((prev) => {
        if (!prev.some((d) => d.id === docId)) return prev;
        return prev.map((doc) => {
          if (doc.id !== docId) return doc;
          parseTarget = doc.data;
          return { ...doc, bandDeltas: resolved };
        });
      });
      if (parseTarget) void parseDocument(docId, parseTarget, resolved);
    },
    [activeProfileId, parseDocument],
  );

  const anyLoading = documents.some((d) => d.loading);

  const sortedDocuments = useMemo(
    () => sortStatementPdfsByPeriod(documents, pdfSortMode),
    [documents, pdfSortMode],
  );

  const pdfPrintedTotalsAvailable = useMemo(
    () => documents.some((d) => d.pdfPageTotals.length > 0),
    [documents],
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
    persistSavedTransactionSearches(activeProfileId, result.items);
    const first = result.items[0];
    toast.success(`Saved quick search “${first?.label ?? "search"}”.`, { toastId: "stmt-qsave-ok" });
  }, [activeProfileId, savedTxnSearches, transactionSearchRaw]);

  const removeSavedTxnSearch = useCallback((id: string) => {
    setSavedTxnSearches((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSavedTransactionSearches(activeProfileId, next);
      return next;
    });
  }, [activeProfileId]);

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
      sections.push({
        source: "firebase",
        fileName: item.fileName,
        rows,
      });
    }
    for (const doc of sortedDocuments) {
      if (doc.loading || doc.error) continue;
      const rows = filterStatementVisibleRows(doc.rows, visibleRowParams);
      if (rows.length === 0) continue;
      sections.push({
        source: "local",
        fileName: doc.name,
        rows,
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
    sortedCloudExtracts,
    sortedDocuments,
    transactionSearchRaw,
    visibleRowParams,
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
    <div className="min-h-screen bg-[#f4f6f9] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Statements</h1>
            <p className="mt-1 text-sm text-slate-500">
              Upload bank PDFs, filter rows, and review deposits &amp; withdrawals per profile.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div
                className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
                role="tablist"
                aria-label="Statement profile"
              >
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={activeProfileId === p.id}
                    onClick={() => switchStatementProfile(p.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeProfileId === p.id
                        ? "bg-white text-[#1a3a5c] shadow-sm ring-1 ring-slate-200/80"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddProfile();
                }}
              >
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Add another person…"
                  className="min-w-[10rem] rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
                  aria-label="New profile name"
                />
                <button
                  type="submit"
                  disabled={!newProfileName.trim()}
                  className="rounded-xl border border-[#1d6fb8]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#1d6fb8] shadow-sm transition hover:bg-sky-50 disabled:opacity-40"
                >
                  Add profile
                </button>
              </form>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Profile tabs sync to cloud — sign in on another browser or incognito to load the same people.
              Statement rows must be saved with <span className="font-medium">Save to cloud</span> to appear there.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {profileEditing ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveProfileRename();
                  }}
                >
                  <label className="text-[11px] font-medium text-slate-600" htmlFor="stmt-profile-rename">
                    Profile name
                  </label>
                  <input
                    id="stmt-profile-rename"
                    type="text"
                    value={profileEditNameValue}
                    onChange={(e) => setProfileEditNameValue(e.target.value)}
                    className="min-w-[10rem] rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 shadow-sm focus:border-[#1d6fb8] focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/20"
                    aria-label="Profile name"
                  />
                  <button
                    type="submit"
                    disabled={!profileEditNameValue.trim()}
                    className="rounded-xl border border-[#1d6fb8]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#1d6fb8] shadow-sm transition hover:bg-sky-50 disabled:opacity-40"
                  >
                    Save name
                  </button>
                  <button
                    type="button"
                    onClick={cancelProfileRename}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startProfileRename}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-[#1d6fb8]/40 hover:text-[#1d6fb8]"
                  >
                    Edit profile name
                  </button>
                  {profiles.length > 1 && (
                    <button
                      type="button"
                      onClick={requestDeleteActiveProfile}
                      className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
                    >
                      Delete profile
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <a
            href="/admin"
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-[#1d6fb8]"
          >
            ← Admin
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">Upload statement PDF</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Profile: {activeProfile.name}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 transition hover:border-[#1d6fb8]/40 hover:bg-sky-50/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
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
              <div className="mt-5 flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
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
                <p className="text-[11px] text-slate-500">
                  Column guide adjustments are saved for{" "}
                  <span className="font-semibold text-slate-700">{activeProfile.name}</span>
                  {profileHasSavedColumns ? (
                    <span className="text-emerald-700"> · saved settings will apply to new uploads</span>
                  ) : (
                    <span> · tune once and future PDFs for this profile reuse the same columns</span>
                  )}
                </p>
              </div>
            )}
          </div>
        </section>

        {(documents.length > 0 ||
          cloudExtracts.length > 0 ||
          cloudExtractsLoading ||
          !!cloudExtractsError) && (
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Your statements</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {activeProfile.name}
                    {documents.length > 0 && ` · ${listStats.pdfCount} on device`}
                    {cloudExtracts.length > 0 && ` · ${cloudListStats.extractCount} saved`}
                  </p>
                </div>
                <StatementResultsToolbar
                  canExport={canExportStatementPdf}
                  onExport={handleExportStatementPdf}
                  cloudLoading={cloudExtractsLoading}
                  onRefreshCloud={() => void refreshCloudExtracts()}
                  sortMode={pdfSortMode}
                  onSortModeChange={setPdfSortMode}
                  hasLocalPdfs={documents.length > 0}
                  hasCloudSaves={cloudExtracts.length > 0}
                />
              </div>
              {(documents.length > 0 || cloudExtracts.length > 0) && (
                <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
                  {documents.length > 0 ? (
                    <StatementListControls
                      label="On device"
                      allSelected={allDocsSelected}
                      someSelected={someDocsSelected}
                      allCollapsed={allAccordionsCollapsed}
                      deleteIdleLabel="Remove selected"
                      onToggleSelectAll={toggleSelectAllDocs}
                      onDeleteSelected={requestDeleteSelectedDocuments}
                      onToggleCollapseAll={() => {
                        if (allAccordionsCollapsed) setCollapsedDocIds(new Set());
                        else setCollapsedDocIds(new Set(documents.map((d) => d.id)));
                      }}
                    />
                  ) : null}
                  {cloudExtracts.length > 0 ? (
                    <StatementListControls
                      label="Saved"
                      allSelected={allCloudExtractsSelected}
                      someSelected={someCloudExtractsSelected}
                      allCollapsed={allCloudAccordionsCollapsed}
                      deleteDisabled={cloudDeleteLocked}
                      deleteBusyLabel="Removing…"
                      deleteIdleLabel="Remove selected"
                      onToggleSelectAll={toggleSelectAllCloudExtracts}
                      onDeleteSelected={requestDeleteSelectedCloudExtracts}
                      onToggleCollapseAll={() => {
                        if (allCloudAccordionsCollapsed) setCollapsedCloudExtractIds(new Set());
                        else setCollapsedCloudExtractIds(new Set(cloudExtracts.map((c) => c.id)));
                      }}
                    />
                  ) : null}
                </div>
              )}
            </div>

            <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-5 sm:px-6">
              {wdDpTotals.anyReadyWithRows && (
                <StatementGrandTotals
                  deposits={wdDpTotals.grandDeposits}
                  withdrawals={wdDpTotals.grandWithdrawals}
                  net={wdDpTotals.grandNet}
                  scopeLabel={grandTotalsScopeLabel}
                  filtersActive={statementFiltersActive}
                  pageTotalsOnly={showOnlyPageTotals}
                />
              )}
              <div className={wdDpTotals.anyReadyWithRows ? "mt-4" : ""}>
                <StatementFiltersPanel
                  transactionSearchRaw={transactionSearchRaw}
                  onTransactionSearchChange={setTransactionSearchRaw}
                  onSaveSearch={handleSaveQuickSearch}
                  txnDateFrom={txnDateFrom}
                  txnDateTo={txnDateTo}
                  onTxnDateFromChange={setTxnDateFrom}
                  onTxnDateToChange={setTxnDateTo}
                  onClearDates={() => {
                    setTxnDateFrom("");
                    setTxnDateTo("");
                  }}
                  dateRangeInverted={dateRangeInverted}
                  showOnlyPageTotals={showOnlyPageTotals}
                  onShowOnlyPageTotalsChange={setShowOnlyPageTotals}
                  showPdfPrintedTotals={showPdfPrintedTotals}
                  onShowPdfPrintedTotalsChange={setShowPdfPrintedTotals}
                  pdfPrintedTotalsAvailable={pdfPrintedTotalsAvailable}
                  savedTxnSearches={savedTxnSearches}
                  onApplySavedSearch={applySavedTxnSearch}
                  onRemoveSavedSearch={removeSavedTxnSearch}
                />
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {cloudExtractsError && (
                <p className="mb-4 rounded-xl border border-red-100 bg-red-50/90 px-3 py-2 text-sm text-red-800">
                  {cloudExtractsError}
                </p>
              )}

              <div className="space-y-4">
                {sortedCloudExtracts.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <h3 className="text-sm font-semibold text-slate-900">Saved to cloud</h3>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900">
                      {sortedCloudExtracts.length}
                    </span>
                  </div>
                )}
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
                      className="stmt-file-card overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/80"
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
                                Cloud
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
                            {cloudExtractDeletingId === item.id ? "Removing…" : "Remove"}
                          </button>
                        </div>
                        {item.rows.length > 0 && extractSums != null && (
                          <StatementFileMoneySummary
                            label="This save"
                            deposits={extractSums.deposits}
                            withdrawals={extractSums.withdrawals}
                            net={extractNet}
                            filtersActive={statementFiltersActive}
                          />
                        )}
                        {item.rows.length === 0 && (
                          <div className="w-full border-t border-slate-200/90 pt-3 text-xs text-slate-500">
                            No rows are stored for this saved extract.
                          </div>
                        )}
                      </div>
                      {accordionOpen && (
                        <div className="stmt-accordion-panel bg-slate-50/40 px-3 py-4 sm:px-4">
                          {item.rows.length > 0 && rowsToShow.length === 0 && (
                            <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                              No rows match this filter ({item.rows.length} row
                              {item.rows.length === 1 ? "" : "s"} hidden).
                            </p>
                          )}
                          {rowsToShow.length > 0 && (
                            <StatementWdDpRowsTable
                              rows={rowsToShow}
                              rowKeyPrefix={item.id}
                              onlyPageTotals={showOnlyPageTotals}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sortedDocuments.length > 0 && (
                  <div className="flex items-center gap-2 pt-2">
                    <h3 className="text-sm font-semibold text-slate-900">On this device</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      {sortedDocuments.length}
                    </span>
                  </div>
                )}
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
                      ? "Saving…"
                      : extractUpload === "uploaded"
                        ? "Saved"
                        : extractUpload === "duplicate"
                          ? "Already saved"
                          : extractUpload === "error"
                            ? "Retry save"
                            : "Save to cloud";
                  return (
                    <div
                      key={doc.id}
                      className="stmt-file-card overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/80"
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
                            title="Save extracted rows to the cloud (PDF file is not stored)."
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
                          <StatementFileMoneySummary
                            label="This PDF"
                            deposits={docSums.deposits}
                            withdrawals={docSums.withdrawals}
                            net={pdfNet}
                            filtersActive={statementFiltersActive}
                          />
                        )}
                      </div>
                      {accordionOpen && (
                        <div className="stmt-accordion-panel bg-slate-50/40 px-3 py-4 sm:px-4">
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
                            <StatementWdDpRowsTable
                              rows={rowsToShow}
                              rowKeyPrefix={doc.id}
                              onlyPageTotals={showOnlyPageTotals}
                              pdfPageTotals={doc.pdfPageTotals}
                              showPdfPrintedTotals={showPdfPrintedTotals}
                            />
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
          profileName={activeProfile.name}
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
