import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatementPdfColumnGuideModal } from "./StatementPdfColumnGuideModal";
import {
  DEFAULT_COLUMN_BAND_DELTAS,
  extractStatementWdDpRowsFromPdfData,
  type StatementColumnBandDeltas,
  type StatementWdDpRow,
} from "./statement/extractStatementColumnsFromPdf";

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

export default function StatementPage() {
  const [documents, setDocuments] = useState<LoadedStatementPdf[]>([]);
  const [filePickerError, setFilePickerError] = useState<string | null>(null);
  const [showColumnGuide, setShowColumnGuide] = useState(false);
  const [activeGuidePdfId, setActiveGuidePdfId] = useState<string | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => new Set());
  const parseVersionByPdfRef = useRef<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseDocument = useCallback(async (docId: string, data: ArrayBuffer, deltas: StatementColumnBandDeltas) => {
    const nextVersion = (parseVersionByPdfRef.current[docId] ?? 0) + 1;
    parseVersionByPdfRef.current[docId] = nextVersion;
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
    parseVersionByPdfRef.current = {};

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

  const deleteSelectedDocuments = useCallback(() => {
    const ids = documents.filter((d) => selectedDocIds.has(d.id)).map((d) => d.id);
    removeDocumentsByIds(ids);
  }, [documents, removeDocumentsByIds, selectedDocIds]);

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
  const activeGuideIndex = useMemo(
    () => Math.max(0, documents.findIndex((d) => d.id === activeGuidePdfId)),
    [activeGuidePdfId, documents],
  );
  const activeGuideDoc = documents[activeGuideIndex] ?? null;

  const allDocsSelected =
    documents.length > 0 && documents.every((d) => selectedDocIds.has(d.id));
  const someDocsSelected = documents.some((d) => selectedDocIds.has(d.id));

  return (
    <div className="min-h-screen bg-[#eef2f7]">
      <header className="border-b border-[#d8e0ea] bg-white/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-[#1a3a5c]">
              Statement — Txn Date, Transaction, Withdrawals, Deposits
            </h1>
            <p className="text-xs text-gray-500">
              Add one or more PDFs. Column edges are adjusted per file in{" "}
              <strong className="font-medium text-gray-600">Show PDF with column guides</strong> (live
              preview + table updates).
            </p>
          </div>
          <a href="/" className="text-sm font-medium text-[#1d6fb8] hover:underline">
            ← Back
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 space-y-4">
        <section className="rounded-2xl border-2 border-[#e4edf8] bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">PDF files</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={anyLoading}
            className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-[#1d6fb8] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#17659d]"
            onChange={(e) => void onFile(e.target.files)}
          />
          {anyLoading && <p className="mt-2 text-sm text-gray-500">Reading PDF files…</p>}
          {filePickerError && (
            <p className="mt-2 text-sm text-red-600 whitespace-pre-wrap">{filePickerError}</p>
          )}
          {documents.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveGuidePdfId((prev) => prev ?? documents[0].id);
                  setShowColumnGuide(true);
                }}
                className="rounded-lg border border-[#1d6fb8] bg-white px-4 py-2 text-sm font-semibold text-[#1d6fb8] hover:bg-[#eef6fc]"
              >
                Show PDF with column guides
              </button>
            </div>
          )}
        </section>

        {documents.length > 0 && (
          <section className="rounded-2xl border-2 border-[#e4edf8] bg-white p-5 shadow-sm overflow-x-auto">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-800">Columns (row order)</h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
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
                  onClick={deleteSelectedDocuments}
                  className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Delete selected
                </button>
              </div>
            </div>
            <div className="space-y-6">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-gray-300 shrink-0"
                        checked={selectedDocIds.has(doc.id)}
                        onChange={() => toggleDocSelected(doc.id)}
                        aria-label={`Select ${doc.name}`}
                      />
                      <p className="text-sm font-semibold text-gray-800 break-all">{doc.name}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => removeDocumentsByIds([doc.id])}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveGuidePdfId(doc.id);
                          setShowColumnGuide(true);
                        }}
                        className="rounded-lg border border-[#1d6fb8] bg-white px-3 py-1.5 text-xs font-semibold text-[#1d6fb8] hover:bg-[#eef6fc]"
                      >
                        Adjust guides
                      </button>
                    </div>
                  </div>
                  {doc.loading && <p className="text-sm text-gray-500">Extracting rows…</p>}
                  {!doc.loading && doc.error && (
                    <p className="text-sm text-red-600 whitespace-pre-wrap">{doc.error}</p>
                  )}
                  {!doc.loading && !doc.error && doc.rows.length > 0 && (
                    <table className="w-full border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-600">
                          <th className="py-2 pr-3 font-semibold w-12">Pg</th>
                          <th className="py-2 pr-4 font-semibold min-w-[120px]">Txn Date</th>
                          <th className="py-2 pr-4 font-semibold min-w-[200px]">Transaction</th>
                          <th className="py-2 pr-4 font-semibold min-w-[140px]">Withdrawals</th>
                          <th className="py-2 font-semibold min-w-[140px]">Deposits</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-gray-900">
                        {doc.rows.map((r, i) => (
                          <tr key={`${doc.id}-${i}`} className="border-b border-gray-100 align-top">
                            <td className="py-1.5 pr-3 text-gray-400 tabular-nums">{r.page}</td>
                            <td className="py-1.5 pr-4 whitespace-pre-wrap break-all">
                              {r.txnDate ? r.txnDate : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-1.5 pr-4 whitespace-pre-wrap break-all">
                              {r.transaction ? r.transaction : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-1.5 pr-4 whitespace-pre-wrap break-all">
                              {r.withdrawals ? r.withdrawals : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-1.5 whitespace-pre-wrap break-all">
                              {r.deposits ? r.deposits : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {showColumnGuide && activeGuideDoc && (
        <StatementPdfColumnGuideModal
          data={activeGuideDoc.data}
          fileName={activeGuideDoc.name}
          fileIndex={activeGuideIndex}
          totalFiles={documents.length}
          onNavigatePrev={
            activeGuideIndex > 0
              ? () => setActiveGuidePdfId(documents[activeGuideIndex - 1].id)
              : undefined
          }
          onNavigateNext={
            activeGuideIndex < documents.length - 1
              ? () => setActiveGuidePdfId(documents[activeGuideIndex + 1].id)
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
