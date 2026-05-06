import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** One PDF table row: Txn Date, Transaction, Withdrawals, Deposits slices. */
export type StatementWdDpRow = {
  page: number;
  txnDate: string;
  transaction: string;
  withdrawals: string;
  deposits: string;
};

type TextPiece = { str: string; x: number; y: number; w: number };

type HeaderLayout = {
  txnDateX: number;
  transactionX: number;
  withdrawalX: number;
  depositX: number;
  balanceX?: number;
};

const PAGE_MARKER_RE = /^--\s*\d+\s+of\s+\d+\s*--$/i;

/** Per-edge tweaks (PDF points) on top of header-based layout. */
export type StatementColumnBandDeltas = {
  txnDateDeltaLeft: number;
  txnDateDeltaRight: number;
  transactionDeltaLeft: number;
  transactionDeltaRight: number;
  withdrawalDeltaLeft: number;
  withdrawalDeltaRight: number;
  depositDeltaLeft: number;
  depositDeltaRight: number;
};

/** Default per-edge tuning applied when a statement is first loaded. */
export const DEFAULT_COLUMN_BAND_DELTAS: StatementColumnBandDeltas = {
  txnDateDeltaLeft: 5,
  txnDateDeltaRight: -17,
  transactionDeltaLeft: -13,
  transactionDeltaRight: 48,
  withdrawalDeltaLeft: 67,
  withdrawalDeltaRight: -1,
  depositDeltaLeft: 3,
  depositDeltaRight: 16,
};

export type StatementColumnParseOptions = {
  columnBandDeltas?: Partial<StatementColumnBandDeltas>;
};

function clampEdgeDelta(n: number): number {
  return Math.max(-120, Math.min(120, n));
}

function numOrDefault(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

export function resolveStatementColumnBandDeltas(
  options?: StatementColumnParseOptions,
): StatementColumnBandDeltas {
  const p = options?.columnBandDeltas ?? {};
  return {
    txnDateDeltaLeft: clampEdgeDelta(
      numOrDefault(p.txnDateDeltaLeft, DEFAULT_COLUMN_BAND_DELTAS.txnDateDeltaLeft),
    ),
    txnDateDeltaRight: clampEdgeDelta(
      numOrDefault(p.txnDateDeltaRight, DEFAULT_COLUMN_BAND_DELTAS.txnDateDeltaRight),
    ),
    transactionDeltaLeft: clampEdgeDelta(
      numOrDefault(p.transactionDeltaLeft, DEFAULT_COLUMN_BAND_DELTAS.transactionDeltaLeft),
    ),
    transactionDeltaRight: clampEdgeDelta(
      numOrDefault(p.transactionDeltaRight, DEFAULT_COLUMN_BAND_DELTAS.transactionDeltaRight),
    ),
    withdrawalDeltaLeft: clampEdgeDelta(
      numOrDefault(p.withdrawalDeltaLeft, DEFAULT_COLUMN_BAND_DELTAS.withdrawalDeltaLeft),
    ),
    withdrawalDeltaRight: clampEdgeDelta(
      numOrDefault(p.withdrawalDeltaRight, DEFAULT_COLUMN_BAND_DELTAS.withdrawalDeltaRight),
    ),
    depositDeltaLeft: clampEdgeDelta(
      numOrDefault(p.depositDeltaLeft, DEFAULT_COLUMN_BAND_DELTAS.depositDeltaLeft),
    ),
    depositDeltaRight: clampEdgeDelta(
      numOrDefault(p.depositDeltaRight, DEFAULT_COLUMN_BAND_DELTAS.depositDeltaRight),
    ),
  };
}

function ensureOrderedBand(left: number, right: number): { left: number; right: number } {
  if (right > left) return { left, right };
  return { left, right: left + 0.5 };
}

/** End of the amount grid — ignore this row and everything after it in the PDF. */
export function lineLooksLikeClosingBalanceLine(text: string): boolean {
  const u = text.replace(/\s+/g, " ").trim();
  return (
    /^closing\s+balance\b/i.test(u) ||
    /^\d{2}-\d{2}-\d{4}\s+closing\s+balance\b/i.test(u)
  );
}

/** Opening balance is metadata, not a transaction row. */
export function lineLooksLikeOpeningBalanceLine(text: string): boolean {
  const u = text.replace(/\s+/g, " ").trim();
  return /^opening\s+balance\b/i.test(u) || /^\d{2}-\d{2}-\d{4}\s+opening\s+balance\b/i.test(u);
}

let workerReady = false;

function ensurePdfWorker(): void {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  workerReady = true;
}

function clusterByY(items: TextPiece[], tol: number): TextPiece[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows: TextPiece[][] = [];
  let cur: TextPiece[] = [sorted[0]!];
  let baseY = sorted[0]!.y;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]!;
    if (Math.abs(it.y - baseY) <= tol) cur.push(it);
    else {
      rows.push(cur);
      cur = [it];
      baseY = it.y;
    }
  }
  rows.push(cur);
  return rows;
}

function clusterTextLine(cl: TextPiece[]): string {
  return [...cl]
    .sort((a, b) => a.x - b.x)
    .map((p) => p.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lineLooksLikeStatementColumnHeader(text: string): boolean {
  const u = text.toUpperCase().replace(/\s+/g, " ").trim();
  return (
    /\bTXN\s+DATE\b/.test(u) &&
    /\bTRANSACTION\b/.test(u) &&
    /\bWITHDRAWALS?\b/.test(u) &&
    /\bDEPOSITS?\b/.test(u)
  );
}

function findStatementTableHeaderBand(
  clusters: TextPiece[][],
): { start: number; end: number } | null {
  for (let i = 0; i < clusters.length; i++) {
    const one = clusterTextLine(clusters[i]!);
    if (lineLooksLikeStatementColumnHeader(one)) return { start: i, end: i };
    if (i + 1 < clusters.length) {
      const two = `${one} ${clusterTextLine(clusters[i + 1]!)}`;
      if (lineLooksLikeStatementColumnHeader(two)) return { start: i, end: i + 1 };
    }
  }
  return null;
}

/** Leftmost x among text runs that match (stable column edge for split headers). */
function findHeaderMinX(pieces: TextPiece[], matcher: RegExp): number | undefined {
  let min: number | undefined;
  for (const p of pieces) {
    if (!matcher.test(p.str.toUpperCase())) continue;
    if (min == null || p.x < min) min = p.x;
  }
  return min;
}

function deriveHeaderLayout(band: TextPiece[][]): HeaderLayout | null {
  const pieces = band.flatMap((r) => r);
  const txnDateX = findHeaderMinX(pieces, /\bTXN\b|\bDATE\b/);
  const transactionX = findHeaderMinX(pieces, /\bTRANSACTION\b/);
  const withdrawalX = findHeaderMinX(pieces, /\bWITHDRAWALS?\b/);
  const depositX = findHeaderMinX(pieces, /\bDEPOSITS?\b/);
  const balanceX = findHeaderMinX(pieces, /\bBALANCE\b/);
  if (txnDateX == null || transactionX == null || withdrawalX == null || depositX == null) return null;
  return { txnDateX, transactionX, withdrawalX, depositX, balanceX };
}

/** Txn Date: left-most date column before Transaction. */
function txnDateColumnXRange(layout: HeaderLayout, d: StatementColumnBandDeltas): { left: number; right: number } {
  const baseL = layout.txnDateX - 16;
  const baseR = (layout.txnDateX + layout.transactionX) / 2;
  return ensureOrderedBand(baseL + d.txnDateDeltaLeft, baseR + d.txnDateDeltaRight);
}

/** Transaction body: between Txn Date and Withdrawals. */
function transactionColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): { left: number; right: number } {
  const baseL = (layout.txnDateX + layout.transactionX) / 2;
  const baseR = (layout.transactionX + layout.withdrawalX) / 2;
  return ensureOrderedBand(baseL + d.transactionDeltaLeft, baseR + d.transactionDeltaRight);
}

/** Deposits: under Deposits header, left of Balance. */
function depositColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): { left: number; right: number } {
  const baseL = layout.depositX - 16;
  const baseR =
    layout.balanceX != null ? (layout.depositX + layout.balanceX) / 2 : pdfPageWidth;
  return ensureOrderedBand(baseL + d.depositDeltaLeft, baseR + d.depositDeltaRight);
}

/**
 * Withdrawals: after Transaction / txn body gutter, strictly before Deposits column.
 */
function withdrawalColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): { left: number; right: number } {
  const baseL = (layout.transactionX + layout.withdrawalX) / 2;
  const baseR = layout.depositX - 16;
  return ensureOrderedBand(baseL + d.withdrawalDeltaLeft, baseR + d.withdrawalDeltaRight);
}

function pieceCenterInBand(p: TextPiece, left: number, right: number): boolean {
  const mid = p.x + p.w / 2;
  return mid >= left && mid < right;
}

function pieceOverlapsWithdrawalColumn(
  p: TextPiece,
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): boolean {
  const { left, right } = withdrawalColumnXRange(layout, d);
  return pieceCenterInBand(p, left, right);
}

function pieceOverlapsTxnDateColumn(
  p: TextPiece,
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): boolean {
  const { left, right } = txnDateColumnXRange(layout, d);
  return pieceCenterInBand(p, left, right);
}

function pieceOverlapsTransactionColumn(
  p: TextPiece,
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): boolean {
  const { left, right } = transactionColumnXRange(layout, d);
  return pieceCenterInBand(p, left, right);
}

function pieceOverlapsDepositColumn(
  p: TextPiece,
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): boolean {
  const { left, right } = depositColumnXRange(layout, d, pdfPageWidth);
  return pieceCenterInBand(p, left, right);
}

function joinColumnPieces(slice: TextPiece[]): string {
  if (slice.length === 0) return "";
  slice.sort((a, b) => a.x - b.x);
  return slice
    .map((p) => p.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function withdrawalColumnTextFromCluster(
  cl: TextPiece[],
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): string {
  return joinColumnPieces(cl.filter((p) => pieceOverlapsWithdrawalColumn(p, layout, d)));
}

function txnDateColumnTextFromCluster(
  cl: TextPiece[],
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): string {
  return joinColumnPieces(cl.filter((p) => pieceOverlapsTxnDateColumn(p, layout, d)));
}

function transactionColumnTextFromCluster(
  cl: TextPiece[],
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): string {
  return joinColumnPieces(cl.filter((p) => pieceOverlapsTransactionColumn(p, layout, d)));
}

function depositColumnTextFromCluster(
  cl: TextPiece[],
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): string {
  return joinColumnPieces(
    cl.filter((p) => pieceOverlapsDepositColumn(p, layout, d, pdfPageWidth)),
  );
}

function textPiecesFromPageContent(content: { items: unknown[] }): TextPiece[] {
  const out: TextPiece[] = [];
  for (const raw of content.items) {
    const item = raw as { str?: string; transform?: number[]; width?: number };
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const tr = item.transform;
    if (!tr || tr.length < 6) continue;
    const x = tr[4]!;
    const y = tr[5]!;
    const w =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : Math.max(4, item.str.length * 4.5);
    out.push({ str: item.str, x, y, w });
  }
  return out;
}

export async function extractStatementWdDpRowsFromPdfData(
  data: ArrayBuffer,
  options?: StatementColumnParseOptions,
): Promise<StatementWdDpRow[]> {
  ensurePdfWorker();
  const deltas = resolveStatementColumnBandDeltas(options);
  // pdf.js may transfer/detach the ArrayBuffer passed here — always pass a copy.
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const rows: StatementWdDpRow[] = [];
  let layout: HeaderLayout | null = null;
  let stoppedAfterClosingBalance = false;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (stoppedAfterClosingBalance) break;

    const page = await pdf.getPage(pageNum);
    const pdfW = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const pieces = textPiecesFromPageContent(content);
    const clusters = clusterByY(pieces, 3.5);
    const band = findStatementTableHeaderBand(clusters);
    if (band) {
      const derived = deriveHeaderLayout(clusters.slice(band.start, band.end + 1));
      if (derived) layout = derived;
    }

    if (!layout) continue;

    const dataClusters = band ? clusters.slice(band.end + 1) : clusters;

    for (let i = 0; i < dataClusters.length; i++) {
      if (stoppedAfterClosingBalance) break;

      const cl = dataClusters[i]!;
      const full = clusterTextLine(cl);
      if (!full || PAGE_MARKER_RE.test(full)) continue;
      if (lineLooksLikeStatementColumnHeader(full)) continue;

      const nextLine =
        i + 1 < dataClusters.length
          ? `${full} ${clusterTextLine(dataClusters[i + 1]!)}`.replace(/\s+/g, " ").trim()
          : full;
      if (
        lineLooksLikeClosingBalanceLine(full) ||
        lineLooksLikeClosingBalanceLine(nextLine)
      ) {
        stoppedAfterClosingBalance = true;
        break;
      }

      const txnDate = txnDateColumnTextFromCluster(cl, layout, deltas);
      const transaction = transactionColumnTextFromCluster(cl, layout, deltas);
      const withdrawals = withdrawalColumnTextFromCluster(cl, layout, deltas);
      const deposits = depositColumnTextFromCluster(cl, layout, deltas, pdfW);

      if (lineLooksLikeOpeningBalanceLine(full) || lineLooksLikeOpeningBalanceLine(transaction)) {
        continue;
      }

      const isTransactionContinuation = !txnDate && !!transaction && !withdrawals && !deposits;
      if (isTransactionContinuation && rows.length > 0) {
        const prev = rows[rows.length - 1]!;
        if (prev.page === pageNum) {
          prev.transaction = prev.transaction ? `${prev.transaction} ${transaction}` : transaction;
          continue;
        }
      }

      if (!txnDate && !transaction && !withdrawals && !deposits) continue;

      rows.push({ page: pageNum, txnDate, transaction, withdrawals, deposits });
    }
  }

  return rows;
}

export async function extractStatementWdDpRowsFromPdf(
  file: File,
  options?: StatementColumnParseOptions,
): Promise<StatementWdDpRow[]> {
  const data = await file.arrayBuffer();
  return extractStatementWdDpRowsFromPdfData(data, options);
}

/** CSS pixel rect on the rendered canvas for one column band. */
export type StatementOverlayBandRect = { x: number; y: number; w: number; h: number };

export type StatementPdfOverlayPage = {
  page: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
  txnDate: StatementOverlayBandRect;
  transaction: StatementOverlayBandRect;
  withdrawal: StatementOverlayBandRect;
  deposits: StatementOverlayBandRect;
};

function normalizeViewportRect(q: number[]): StatementOverlayBandRect {
  const x0 = q[0]!;
  const y0 = q[1]!;
  const x1 = q[2]!;
  const y1 = q[3]!;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return { x, y, w, h };
}

/**
 * Builds canvas-space rectangles for all visible statement column bands
 * (same geometry as extraction). Use the same `scale` as `page.getViewport({ scale })` when rendering.
 */
export async function computeStatementPdfOverlayPagesFromDocument(
  pdf: PDFDocumentProxy,
  scale: number,
  options?: StatementColumnParseOptions,
): Promise<StatementPdfOverlayPage[]> {
  ensurePdfWorker();
  const deltas = resolveStatementColumnBandDeltas(options);
  const out: StatementPdfOverlayPage[] = [];
  let layout: HeaderLayout | null = null;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pieces = textPiecesFromPageContent(content);
    const clusters = clusterByY(pieces, 3.5);
    const band = findStatementTableHeaderBand(clusters);
    if (band) {
      const derived = deriveHeaderLayout(clusters.slice(band.start, band.end + 1));
      if (derived) layout = derived;
    }

    if (!layout) continue;

    const viewport = page.getViewport({ scale });
    const base = page.getViewport({ scale: 1 });
    const pdfH = base.height;
    const pdfW = base.width;

    const txn = txnDateColumnXRange(layout, deltas);
    const txb = transactionColumnXRange(layout, deltas);
    const wd = withdrawalColumnXRange(layout, deltas);
    const dep = depositColumnXRange(layout, deltas, pdfW);
    const depRight = dep.right;

    const vp = viewport as unknown as {
      convertToViewportRectangle: (pdfRect: number[]) => number[];
    };
    if (typeof vp.convertToViewportRectangle !== "function") {
      continue;
    }

    const txnRect = normalizeViewportRect(
      vp.convertToViewportRectangle([txn.left, 0, txn.right, pdfH]),
    );
    const txbRect = normalizeViewportRect(
      vp.convertToViewportRectangle([txb.left, 0, txb.right, pdfH]),
    );
    const wdRect = normalizeViewportRect(
      vp.convertToViewportRectangle([wd.left, 0, wd.right, pdfH]),
    );
    const dpRect = normalizeViewportRect(
      vp.convertToViewportRectangle([dep.left, 0, depRight, pdfH]),
    );

    out.push({
      page: pageNum,
      canvasCssWidth: viewport.width,
      canvasCssHeight: viewport.height,
      txnDate: txnRect,
      transaction: txbRect,
      withdrawal: wdRect,
      deposits: dpRect,
    });
  }

  return out;
}

export async function computeStatementPdfOverlayPages(
  data: ArrayBuffer,
  scale: number,
  options?: StatementColumnParseOptions,
): Promise<StatementPdfOverlayPage[]> {
  ensurePdfWorker();
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  try {
    return await computeStatementPdfOverlayPagesFromDocument(pdf, scale, options);
  } finally {
    if (typeof pdf.destroy === "function") await pdf.destroy();
  }
}
