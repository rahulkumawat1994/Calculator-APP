import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { RenderingCancelledException } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "./lib/debounce";
import {
  boundaryLimits,
  clampBoundaries,
  equalColumnBoundaries,
  rescaleBoundaries,
  setBoundaryAt,
  type LoanColumnBoundaries,
} from "./loans/loanColumnBoundaries";
import { LOAN_COLUMN_LABELS, type LoanColumnId } from "./loans/loanColumns";
import {
  buildLoanPageGuideCaches,
  computeOverlayPagesFromBoundaries,
  LOAN_COLUMN_FILL,
  type LoanPdfOverlayPage,
  type LoanPageGuideCache,
} from "./loans/extractLoanScheduleFromPdf";
import { ensureLoanPdfWorker } from "./loans/pdfWorker";

const PREVIEW_SCALE = 1.12;
const PARENT_DEBOUNCE_MS = 200;

function dividerLabel(index: number, columnOrder: LoanColumnId[], boundaryCount: number): string {
  if (index === 0) return "Left edge";
  if (index === boundaryCount - 1) return "Right edge";
  const left = columnOrder[index - 1]!;
  const right = columnOrder[index]!;
  return `${LOAN_COLUMN_LABELS[left]} | ${LOAN_COLUMN_LABELS[right]}`;
}

function dividerMeta(
  columnOrder: LoanColumnId[],
  boundaryCount: number,
): { index: number; label: string; edge: boolean }[] {
  const out: { index: number; label: string; edge: boolean }[] = [
    { index: 0, label: dividerLabel(0, columnOrder, boundaryCount), edge: true },
  ];
  for (let i = 0; i < columnOrder.length - 1; i++) {
    out.push({
      index: i + 1,
      label: dividerLabel(i + 1, columnOrder, boundaryCount),
      edge: false,
    });
  }
  out.push({
    index: boundaryCount - 1,
    label: dividerLabel(boundaryCount - 1, columnOrder, boundaryCount),
    edge: true,
  });
  return out;
}

function drawColumnGuides(
  ctx: CanvasRenderingContext2D,
  overlay: LoanPdfOverlayPage,
  columnOrder: LoanColumnId[],
): void {
  for (const id of columnOrder) {
    const band = overlay.bands[id];
    if (!band || band.w <= 0) continue;
    ctx.fillStyle = LOAN_COLUMN_FILL[id];
    ctx.fillRect(band.x, band.y, band.w, band.h);
  }
}

function BoundaryDragLayer({
  boundariesPdf,
  pdfW,
  columnOrder,
  activeIndex,
  onActiveChange,
  onChange,
}: {
  boundariesPdf: LoanColumnBoundaries;
  pdfW: number;
  columnOrder: LoanColumnId[];
  activeIndex: number | null;
  onActiveChange: (index: number | null) => void;
  onChange: (next: LoanColumnBoundaries) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = dragIndexRef.current;
    if (idx == null) return;
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 1) return;
    const pdfX = ((e.clientX - rect.left) / rect.width) * pdfW;
    onChange(setBoundaryAt(boundariesPdf, idx, pdfX, pdfW));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragIndexRef.current != null && layerRef.current?.hasPointerCapture(e.pointerId)) {
      layerRef.current.releasePointerCapture(e.pointerId);
    }
    dragIndexRef.current = null;
    setDragIndex(null);
  };

  const dividers = dividerMeta(columnOrder, boundariesPdf.length);
  const highlightedIndex = dragIndex ?? activeIndex ?? hoverIndex;

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 touch-none z-20"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {dividers.map(({ index, label, edge }) => {
        const pct = (boundariesPdf[index]! / pdfW) * 100;
        const isActive = highlightedIndex === index;
        return (
          <div
            key={`boundary-${index}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-selected={isActive}
            className={`absolute top-0 bottom-0 -translate-x-1/2 cursor-col-resize ${
              edge ? "w-6" : "w-8"
            } ${isActive ? "z-30" : "z-10"}`}
            style={{ left: `${pct}%` }}
            onPointerEnter={() => setHoverIndex(index)}
            onPointerLeave={() => {
              if (dragIndexRef.current !== index) setHoverIndex(null);
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragIndexRef.current = index;
              setDragIndex(index);
              onActiveChange(index);
              layerRef.current?.setPointerCapture(e.pointerId);
            }}
          >
            <div
              className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 min-h-full ${
                edge
                  ? isActive
                    ? "w-px bg-amber-500 shadow-[0_0_0_1px_white,0_0_4px_rgba(245,158,11,0.7)]"
                    : "w-px bg-amber-500/70"
                  : isActive
                    ? "w-px bg-indigo-600 shadow-[0_0_0_1px_white,0_0_4px_rgba(79,70,229,0.65)]"
                    : "w-px bg-indigo-500/65"
              }`}
            />
            {(isActive || hoverIndex === index) && (
              <div
                className={`absolute top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-semibold shadow-md pointer-events-none ${
                  edge ? "bg-amber-600 text-white" : "bg-indigo-600 text-white"
                } ${isActive ? "" : "opacity-90"}`}
              >
                {label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GuidePageCanvas({
  pdf,
  pageNum,
  scale,
  overlay,
  columnOrder,
  boundariesPdf,
  pdfW,
  activeDividerIndex,
  onActiveDividerChange,
  onBoundariesChange,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  overlay: LoanPdfOverlayPage | undefined;
  columnOrder: LoanColumnId[];
  boundariesPdf: LoanColumnBoundaries;
  pdfW: number;
  activeDividerIndex: number | null;
  onActiveDividerChange: (index: number | null) => void;
  onBoundariesChange: (next: LoanColumnBoundaries) => void;
}) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [basePainted, setBasePainted] = useState(0);

  useEffect(() => {
    let alive = true;
    const holder: { task: RenderTask | null } = { task: null };
    const base = baseRef.current;
    const guide = guideRef.current;
    if (!base || !guide) return;

    void (async () => {
      setErr(null);
      try {
        const page = await pdf.getPage(pageNum);
        if (!alive) return;
        const viewport = page.getViewport({ scale });
        base.width = viewport.width;
        base.height = viewport.height;
        guide.width = viewport.width;
        guide.height = viewport.height;
        const ctx = base.getContext("2d");
        if (!ctx) return;
        const task = page.render({ canvasContext: ctx, viewport });
        holder.task = task;
        await task.promise;
        holder.task = null;
        if (!alive) return;
        setBasePainted((n) => n + 1);
      } catch (e) {
        if (!alive) return;
        if (e instanceof RenderingCancelledException) return;
        setErr(e instanceof Error ? e.message : "Render failed");
      }
    })();

    return () => {
      alive = false;
      holder.task?.cancel();
      holder.task = null;
    };
  }, [pdf, pageNum, scale]);

  useEffect(() => {
    const guide = guideRef.current;
    const base = baseRef.current;
    if (!guide || !base || base.width === 0) return;
    if (guide.width !== base.width) {
      guide.width = base.width;
      guide.height = base.height;
    }
    const gctx = guide.getContext("2d");
    if (!gctx) return;
    gctx.clearRect(0, 0, guide.width, guide.height);
    if (overlay) drawColumnGuides(gctx, overlay, columnOrder);
  }, [overlay, basePainted, columnOrder]);

  return (
    <div className="mb-5 flex flex-col items-center">
      <p className="text-xs text-gray-500 mb-1.5">Page {pageNum}</p>
      {err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : (
        <div className="relative inline-block leading-none max-w-full">
          <canvas
            ref={baseRef}
            className="block w-full h-auto border border-gray-200 bg-white shadow-sm rounded-md"
          />
          <canvas
            ref={guideRef}
            className="pointer-events-none absolute inset-0 w-full h-full rounded-md"
            aria-hidden
          />
          {overlay && (
            <BoundaryDragLayer
              boundariesPdf={boundariesPdf}
              pdfW={pdfW}
              columnOrder={columnOrder}
              activeIndex={activeDividerIndex}
              onActiveChange={onActiveDividerChange}
              onChange={onBoundariesChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function LoansPdfColumnGuideModal({
  data,
  fileName,
  columnOrder,
  columnBoundaries,
  onColumnBoundariesChange,
  onClose,
}: {
  data: ArrayBuffer;
  fileName: string;
  columnOrder: LoanColumnId[];
  columnBoundaries: LoanColumnBoundaries;
  onColumnBoundariesChange: (b: LoanColumnBoundaries) => void;
  onClose: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [guideCaches, setGuideCaches] = useState<LoanPageGuideCache[]>([]);
  const detectedRef = useRef<LoanColumnBoundaries | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draftBoundaries, setDraftBoundaries] = useState<LoanColumnBoundaries>(() => [...columnBoundaries]);
  const [activeDividerIndex, setActiveDividerIndex] = useState<number | null>(null);

  const boundaryCount = columnOrder.length + 1;
  const dividerItems = useMemo(
    () => dividerMeta(columnOrder, boundaryCount),
    [columnOrder, boundaryCount],
  );

  const overlays = useMemo(
    () =>
      guideCaches.length === 0
        ? []
        : computeOverlayPagesFromBoundaries(guideCaches, draftBoundaries, columnOrder),
    [guideCaches, draftBoundaries, columnOrder],
  );

  const onChangeRef = useRef(onColumnBoundariesChange);
  onChangeRef.current = onColumnBoundariesChange;

  const overlayByPage = useMemo(() => new Map(overlays.map((o) => [o.page, o])), [overlays]);

  const emitToParent = useCallback((b: LoanColumnBoundaries) => {
    onChangeRef.current(b);
  }, []);

  const debouncedToParent = useMemo(
    () => debounce((b: LoanColumnBoundaries) => emitToParent(b), PARENT_DEBOUNCE_MS),
    [emitToParent],
  );

  const draftRef = useRef(draftBoundaries);
  draftRef.current = draftBoundaries;

  const skipEmit = useRef(true);

  useEffect(() => {
    debouncedToParent.cancel();
    skipEmit.current = true;
    if (columnBoundaries.length === columnOrder.length + 1) {
      setDraftBoundaries([...columnBoundaries]);
    }
  }, [data, columnBoundaries, columnOrder, debouncedToParent]);

  useEffect(() => {
    if (skipEmit.current) {
      skipEmit.current = false;
      return;
    }
    debouncedToParent(draftBoundaries);
  }, [draftBoundaries, debouncedToParent]);

  useEffect(() => {
    return () => {
      debouncedToParent.cancel();
      onChangeRef.current(draftRef.current);
    };
  }, [debouncedToParent]);

  useEffect(() => {
    ensureLoanPdfWorker();
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    void (async () => {
      try {
        setLoadErr(null);
        const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) {
          if (typeof doc.destroy === "function") await doc.destroy();
          return;
        }
        loaded = doc;
        setPdf(doc);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : "Could not open PDF");
      }
    })();
    return () => {
      cancelled = true;
      setPdf(null);
      if (loaded && typeof loaded.destroy === "function") void loaded.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void buildLoanPageGuideCaches(pdf, PREVIEW_SCALE, columnOrder)
      .then(({ caches, detectedBoundaries: detected }) => {
        if (cancelled) return;
        setGuideCaches(caches);
        detectedRef.current = detected;
        const pageW = caches[0]?.pdfW ?? 600;
        const hasUserBounds = draftRef.current.length === columnOrder.length + 1;
        const next = hasUserBounds
          ? rescaleBoundaries(draftRef.current, pageW)
          : clampBoundaries(detected, pageW);
        setDraftBoundaries(next);
        draftRef.current = next;
        skipEmit.current = true;
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : "Could not build guides");
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, columnOrder]);

  const primaryCache = guideCaches[0];
  const pdfW = primaryCache?.pdfW ?? 600;

  const activeDividerLimits =
    activeDividerIndex != null
      ? boundaryLimits(draftBoundaries, activeDividerIndex, pdfW)
      : null;
  const sliderDisabled =
    activeDividerLimits != null && activeDividerLimits.max < activeDividerLimits.min;

  const handleClose = useCallback(() => {
    debouncedToParent.cancel();
    emitToParent(draftRef.current);
    onClose();
  }, [debouncedToParent, emitToParent, onClose]);

  const resetEqual = () => {
    debouncedToParent.cancel();
    const next = equalColumnBoundaries(columnOrder.length, pdfW);
    setDraftBoundaries(next);
    emitToParent(next);
  };

  const resetAuto = () => {
    const detected = detectedRef.current;
    if (!detected) return;
    debouncedToParent.cancel();
    const next = clampBoundaries(detected, pdfW);
    setDraftBoundaries(next);
    emitToParent(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="flex h-[92vh] sm:h-auto sm:max-h-[90vh] w-full max-w-4xl flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-column-guide-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
          <div>
            <h2 id="loan-column-guide-title" className="text-base font-semibold text-gray-900">
              Column guide
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[280px] sm:max-w-md">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 bg-gray-50/80">
            {loadErr ? (
              <p className="text-sm text-red-600">{loadErr}</p>
            ) : !pdf ? (
              <p className="text-sm text-gray-500">Loading PDF…</p>
            ) : guideCaches.length === 0 ? (
              <p className="text-sm text-gray-500">No table found in PDF.</p>
            ) : (
              guideCaches.map((c) => (
                <GuidePageCanvas
                  key={c.page}
                  pdf={pdf}
                  pageNum={c.page}
                  scale={PREVIEW_SCALE}
                  overlay={overlayByPage.get(c.page)}
                  columnOrder={columnOrder}
                  boundariesPdf={clampBoundaries(draftBoundaries, c.pdfW)}
                  pdfW={c.pdfW}
                  activeDividerIndex={activeDividerIndex}
                  onActiveDividerChange={setActiveDividerIndex}
                  onBoundariesChange={(next) => setDraftBoundaries(next)}
                />
              ))
            )}
          </div>

          <div className="w-full sm:w-64 border-t sm:border-t-0 sm:border-l border-gray-100 overflow-y-auto p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Adjust columns</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Tap or drag a divider on the PDF. The selected line glows and shows its name.
            </p>

            {activeDividerIndex != null && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs space-y-2 ${
                  activeDividerIndex === 0 || activeDividerIndex === boundaryCount - 1
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-indigo-200 bg-indigo-50 text-indigo-900"
                }`}
              >
                <div>
                  <span className="font-medium">Selected divider</span>
                  <p className="mt-0.5 font-semibold leading-snug">
                    {dividerLabel(activeDividerIndex, columnOrder, boundaryCount)}
                  </p>
                </div>
                {activeDividerLimits && (
                  <div className="pt-1" onPointerDown={(e) => e.stopPropagation()}>
                    <input
                      type="range"
                      disabled={sliderDisabled}
                      min={Math.round(activeDividerLimits.min)}
                      max={Math.round(activeDividerLimits.max)}
                      step={1}
                      value={Math.round(draftBoundaries[activeDividerIndex] ?? 0)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setDraftBoundaries(
                          setBoundaryAt(draftBoundaries, activeDividerIndex, v, pdfW),
                        );
                      }}
                      className="w-full h-3 cursor-pointer accent-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={`Position for ${dividerLabel(
                        activeDividerIndex,
                        columnOrder,
                        boundaryCount,
                      )}`}
                    />
                    <p className="mt-1 text-[10px] tabular-nums opacity-80 text-center">
                      {sliderDisabled
                        ? "No room — move neighboring dividers first"
                        : `${Math.round(draftBoundaries[activeDividerIndex] ?? 0)} / ${Math.round(
                            pdfW,
                          )} px`}
                    </p>
                  </div>
                )}
              </div>
            )}

            <ul className="space-y-1">
              {dividerItems.map(({ index, label, edge }) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => setActiveDividerIndex(index)}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                      activeDividerIndex === index
                        ? edge
                          ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300"
                          : "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-300"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`h-3 w-1 shrink-0 rounded-full ${
                        edge ? "bg-amber-500" : "bg-indigo-500"
                      }`}
                    />
                    <span className="leading-snug">{label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={resetAuto}
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-sm text-indigo-800 hover:bg-indigo-100"
            >
              Re-detect from PDF
            </button>
            <button
              type="button"
              onClick={resetEqual}
              className="w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Equal width columns
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
