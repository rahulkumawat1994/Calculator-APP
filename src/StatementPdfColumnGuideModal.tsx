import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { RenderingCancelledException } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "./lib/debounce";
import {
  computeStatementPdfOverlayPagesFromDocument,
  DEFAULT_COLUMN_BAND_DELTAS,
  resolveStatementColumnBandDeltas,
  type StatementColumnBandDeltas,
  type StatementPdfOverlayPage,
} from "./statement/extractStatementColumnsFromPdf";

const PREVIEW_SCALE = 1.12;
const SLIDER_MIN = -120;
const SLIDER_MAX = 120;
const PARENT_DEBOUNCE_MS = 280;

const BAND_LABELS: Record<keyof StatementColumnBandDeltas, string> = {
  txnDateDeltaLeft: "Txn Date — left Δ",
  txnDateDeltaRight: "Txn Date — right Δ",
  transactionDeltaLeft: "Transaction — left Δ",
  transactionDeltaRight: "Transaction — right Δ",
  withdrawalDeltaLeft: "Withdrawals — left Δ",
  withdrawalDeltaRight: "Withdrawals — right Δ",
  depositDeltaLeft: "Deposits — left Δ",
  depositDeltaRight: "Deposits — right Δ",
};

function ensurePdfWorker(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

function strokeBandOutline(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
): void {
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
}

function drawColumnGuides(ctx: CanvasRenderingContext2D, o: StatementPdfOverlayPage): void {
  ctx.save();
  ctx.fillStyle = "rgba(234, 88, 12, 0.10)";
  ctx.fillRect(o.txnDate.x, o.txnDate.y, o.txnDate.w, o.txnDate.h);
  ctx.strokeStyle = "rgba(234, 88, 12, 0.95)";
  ctx.lineWidth = 2;
  strokeBandOutline(ctx, o.txnDate);

  ctx.fillStyle = "rgba(124, 58, 237, 0.10)";
  ctx.fillRect(o.transaction.x, o.transaction.y, o.transaction.w, o.transaction.h);
  ctx.strokeStyle = "rgba(124, 58, 237, 0.95)";
  strokeBandOutline(ctx, o.transaction);

  ctx.fillStyle = "rgba(29, 111, 184, 0.12)";
  ctx.fillRect(o.withdrawal.x, o.withdrawal.y, o.withdrawal.w, o.withdrawal.h);
  ctx.strokeStyle = "rgba(29, 111, 184, 0.95)";
  ctx.lineWidth = 2;
  strokeBandOutline(ctx, o.withdrawal);

  ctx.fillStyle = "rgba(22, 163, 74, 0.14)";
  ctx.fillRect(o.deposits.x, o.deposits.y, o.deposits.w, o.deposits.h);
  ctx.strokeStyle = "rgba(22, 163, 74, 0.95)";
  strokeBandOutline(ctx, o.deposits);
  ctx.restore();
}

function GuidePageCanvas({
  pdf,
  pageNum,
  scale,
  overlay,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  overlay: StatementPdfOverlayPage | undefined;
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
        if (!alive) return;

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
    if (!guide || !base || base.width === 0 || base.height === 0) return;
    if (guide.width !== base.width) {
      guide.width = base.width;
      guide.height = base.height;
    }
    const gctx = guide.getContext("2d");
    if (!gctx) return;
    gctx.clearRect(0, 0, guide.width, guide.height);
    if (overlay) drawColumnGuides(gctx, overlay);
  }, [overlay, basePainted]);

  return (
    <div className="mb-5 flex flex-col items-center">
      <p className="text-xs text-gray-500 mb-1.5">Page {pageNum}</p>
      {err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : (
        <div className="relative inline-block leading-none">
          <canvas ref={baseRef} className="block max-w-full border border-gray-200 bg-white shadow-sm rounded-md" />
          <canvas
            ref={guideRef}
            className="pointer-events-none absolute left-0 top-0 max-w-full rounded-md"
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

export function StatementPdfColumnGuideModal({
  data,
  fileName,
  fileIndex,
  totalFiles,
  onNavigatePrev,
  onNavigateNext,
  columnBandDeltas,
  onColumnBandDeltasChange,
  onClose,
}: {
  data: ArrayBuffer;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  columnBandDeltas: StatementColumnBandDeltas;
  onColumnBandDeltasChange: (d: StatementColumnBandDeltas) => void;
  onClose: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [overlays, setOverlays] = useState<StatementPdfOverlayPage[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draftDeltas, setDraftDeltas] = useState<StatementColumnBandDeltas>(() =>
    resolveStatementColumnBandDeltas({ columnBandDeltas }),
  );

  const onColumnBandDeltasChangeRef = useRef(onColumnBandDeltasChange);
  onColumnBandDeltasChangeRef.current = onColumnBandDeltasChange;

  const debouncedToParent = useMemo(
    () =>
      debounce((d: StatementColumnBandDeltas) => {
        onColumnBandDeltasChangeRef.current(d);
      }, PARENT_DEBOUNCE_MS),
    [],
  );

  const draftRef = useRef(draftDeltas);
  draftRef.current = draftDeltas;

  const suppressNextDebouncedEmitRef = useRef(true);

  useEffect(() => {
    debouncedToParent.cancel();
    suppressNextDebouncedEmitRef.current = true;
    setDraftDeltas(resolveStatementColumnBandDeltas({ columnBandDeltas }));
  }, [
    data,
    columnBandDeltas.txnDateDeltaLeft,
    columnBandDeltas.txnDateDeltaRight,
    columnBandDeltas.transactionDeltaLeft,
    columnBandDeltas.transactionDeltaRight,
    columnBandDeltas.withdrawalDeltaLeft,
    columnBandDeltas.withdrawalDeltaRight,
    columnBandDeltas.depositDeltaLeft,
    columnBandDeltas.depositDeltaRight,
    debouncedToParent,
  ]);

  useEffect(() => {
    if (suppressNextDebouncedEmitRef.current) {
      suppressNextDebouncedEmitRef.current = false;
      return;
    }
    debouncedToParent(draftDeltas);
  }, [draftDeltas, debouncedToParent]);

  useEffect(() => {
    return () => {
      debouncedToParent.cancel();
      onColumnBandDeltasChangeRef.current(draftRef.current);
    };
  }, [debouncedToParent]);

  useEffect(() => {
    ensurePdfWorker();
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    (async () => {
      try {
        setLoadErr(null);
        setOverlays([]);
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
      setOverlays([]);
      if (loaded && typeof loaded.destroy === "function") void loaded.destroy();
      loaded = null;
    };
  }, [data]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void computeStatementPdfOverlayPagesFromDocument(pdf, PREVIEW_SCALE, {
      columnBandDeltas: draftDeltas,
    })
      .then((ov) => {
        if (!cancelled) setOverlays(ov);
      })
      .catch((e) => {
        if (!cancelled)
          setLoadErr(e instanceof Error ? e.message : "Could not build column guides");
      });
    return () => {
      cancelled = true;
    };
  }, [
    pdf,
    draftDeltas.txnDateDeltaLeft,
    draftDeltas.txnDateDeltaRight,
    draftDeltas.transactionDeltaLeft,
    draftDeltas.transactionDeltaRight,
    draftDeltas.withdrawalDeltaLeft,
    draftDeltas.withdrawalDeltaRight,
    draftDeltas.depositDeltaLeft,
    draftDeltas.depositDeltaRight,
  ]);

  const overlayByPage = new Map(overlays.map((o) => [o.page, o]));

  const setSliderDelta = (key: keyof StatementColumnBandDeltas, value: number) => {
    setDraftDeltas((prev) =>
      resolveStatementColumnBandDeltas({
        columnBandDeltas: { ...prev, [key]: value },
      }),
    );
  };

  const isDefault =
    draftDeltas.txnDateDeltaLeft === DEFAULT_COLUMN_BAND_DELTAS.txnDateDeltaLeft &&
    draftDeltas.txnDateDeltaRight === DEFAULT_COLUMN_BAND_DELTAS.txnDateDeltaRight &&
    draftDeltas.transactionDeltaLeft === DEFAULT_COLUMN_BAND_DELTAS.transactionDeltaLeft &&
    draftDeltas.transactionDeltaRight === DEFAULT_COLUMN_BAND_DELTAS.transactionDeltaRight &&
    draftDeltas.withdrawalDeltaLeft === DEFAULT_COLUMN_BAND_DELTAS.withdrawalDeltaLeft &&
    draftDeltas.withdrawalDeltaRight === DEFAULT_COLUMN_BAND_DELTAS.withdrawalDeltaRight &&
    draftDeltas.depositDeltaLeft === DEFAULT_COLUMN_BAND_DELTAS.depositDeltaLeft &&
    draftDeltas.depositDeltaRight === DEFAULT_COLUMN_BAND_DELTAS.depositDeltaRight;

  const resetToDefault = () => {
    debouncedToParent.cancel();
    const next = resolveStatementColumnBandDeltas({
      columnBandDeltas: DEFAULT_COLUMN_BAND_DELTAS,
    });
    setDraftDeltas(next);
    onColumnBandDeltasChangeRef.current(next);
  };

  const flushAndNavigate = useCallback(
    (navigate?: () => void) => {
      if (!navigate) return;
      debouncedToParent.cancel();
      onColumnBandDeltasChangeRef.current(draftRef.current);
      navigate();
    },
    [debouncedToParent],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") flushAndNavigate(onNavigatePrev);
      if (e.key === "ArrowRight") flushAndNavigate(onNavigateNext);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushAndNavigate, onClose, onNavigateNext, onNavigatePrev]);

  return (
    <div
      className="fixed inset-0 z-100 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-10 pb-16"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stmt-guide-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl rounded-2xl border border-gray-200 bg-[#f4f7fb] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 rounded-t-2xl">
          <div>
            <h2 id="stmt-guide-title" className="text-base font-semibold text-[#1a3a5c]">
              Column guide overlay
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Drag the sliders for a live overlay; the table behind this window catches up shortly after
              you stop.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF {fileIndex + 1} / {totalFiles}: <span className="font-medium text-gray-700">{fileName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => flushAndNavigate(onNavigatePrev)}
              disabled={!onNavigatePrev}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              ← Prev PDF
            </button>
            <button
              type="button"
              onClick={() => flushAndNavigate(onNavigateNext)}
              disabled={!onNavigateNext}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Next PDF →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="border-b border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500 mb-3">
            Δ in PDF points (±120). Orange = Txn Date, purple = Transaction, blue = Withdrawals,
            green = Deposits. Larger <strong>left</strong> Δ moves that edge right; larger{" "}
            <strong>right</strong> Δ moves that edge right.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(BAND_LABELS) as (keyof StatementColumnBandDeltas)[]).map((key) => (
              <div key={key}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <label className="text-xs font-medium text-gray-600" htmlFor={`guide-${key}`}>
                    {BAND_LABELS[key]}
                  </label>
                  <span className="text-xs tabular-nums text-gray-500" aria-live="polite">
                    {draftDeltas[key]} pt
                  </span>
                </div>
                <input
                  id={`guide-${key}`}
                  type="range"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={1}
                  value={draftDeltas[key]}
                  onChange={(e) => setSliderDelta(key, Number(e.target.value))}
                  className="w-full h-2 accent-[#1d6fb8] cursor-pointer"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={isDefault}
            onClick={resetToDefault}
            className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset to default
          </button>
        </div>

        <div className="p-4 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {loadErr && <p className="text-sm text-red-600 mb-3">{loadErr}</p>}
          {!loadErr && pdf && overlays.length === 0 && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              No column bands found (missing statement header on any page). Pages are still shown
              without highlights.
            </p>
          )}
          {pdf &&
            Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((pageNum) => (
              <GuidePageCanvas
                key={pageNum}
                pdf={pdf}
                pageNum={pageNum}
                scale={PREVIEW_SCALE}
                overlay={overlayByPage.get(pageNum)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
