import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ALL_LOAN_COLUMNS, LOAN_COLUMN_HEADER_PATTERNS, type LoanColumnId } from "./loanColumns";
import {
  clampBoundaries,
  columnRangeFromBoundaries,
  detectBoundariesFromDataClusters,
  equalColumnBoundaries,
  type LoanColumnBoundaries,
} from "./loanColumnBoundaries";
import { ensureLoanPdfWorker } from "./pdfWorker";

export type LoanScheduleRow = {
  page: number;
  installmentNo: string;
  dueDate: string;
  installmentAmount: string;
  interest: string;
  principal: string;
  balancePrincipal: string;
  /** Extra principal paid after the EMI (not part of regular EMI). */
  partPayment?: string;
};

type TextPiece = { str: string; x: number; y: number; w: number };

export type LoanColumnParseOptions = {
  columnOrder: LoanColumnId[];
  columnBoundaries?: LoanColumnBoundaries;
};

export type LoanScheduleExtractResult = {
  rows: LoanScheduleRow[];
  boundaries?: LoanColumnBoundaries;
};

export type LoanOverlayBandRect = { x: number; y: number; w: number; h: number };

export type LoanPdfOverlayPage = {
  page: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
  bands: Record<LoanColumnId, LoanOverlayBandRect>;
};

export type LoanPageGuideCache = {
  page: number;
  pdfW: number;
  pdfH: number;
  viewportWidth: number;
  viewportHeight: number;
  tableTopPdfY: number;
  convertPdfRectToViewport: (pdfRect: number[]) => number[];
};

export type LoanGuideCachesResult = {
  caches: LoanPageGuideCache[];
  detectedBoundaries: LoanColumnBoundaries;
};

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

function textPiecesFromPageContent(content: pdfjs.TextContent): TextPiece[] {
  const out: TextPiece[] = [];
  for (const item of content.items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
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

function headerColumnHits(line: string, columnOrder: LoanColumnId[]): number {
  const u = line.toUpperCase();
  let hits = 0;
  for (const id of columnOrder) {
    if (LOAN_COLUMN_HEADER_PATTERNS[id].test(u)) hits += 1;
  }
  return hits;
}

/** Summary blocks above the schedule often mention loan fields but are not the table header. */
function looksLikeSummaryBlock(line: string): boolean {
  return /\b(?:LOAN\s*AMOUNT|SANCTION|DISBURSE|DISBURSEMENT|BORROWER|CUSTOMER|MORTGAGE|FACILITY|ACCOUNT\s*NO)\b/i.test(
    line,
  );
}

function clusterBottomPdfY(cl: TextPiece[]): number {
  if (cl.length === 0) return 0;
  return Math.min(...cl.map((p) => p.y));
}

function findFirstScheduleRowIndex(clusters: TextPiece[][], columnOrder: LoanColumnId[]): number {
  const minHits = Math.min(3, columnOrder.length);
  for (let i = 0; i < clusters.length; i++) {
    const line = clusterTextLine(clusters[i]!);
    if (!line || headerColumnHits(line, columnOrder) >= minHits) continue;
    const firstToken = line.split(/\s+/)[0]?.trim() ?? "";
    if (!INST_NO_RE.test(firstToken)) continue;
    if (DATE_RE.test(line) || AMOUNT_RE.test(line)) return i;
  }
  return -1;
}

export type LoanTableRegion = {
  dataStart: number;
  tableTopPdfY: number | null;
};

export function resolveLoanTableRegion(
  clusters: TextPiece[][],
  columnOrder: LoanColumnId[],
): LoanTableRegion {
  const minHits = Math.min(3, columnOrder.length);
  let bestScore = 0;
  let bestIdx = -1;

  for (let i = 0; i < clusters.length; i++) {
    let line = clusterTextLine(clusters[i]!);
    let hits = headerColumnHits(line, columnOrder);
    let endIdx = i;

    if (hits < minHits && i + 1 < clusters.length) {
      const combined = `${line} ${clusterTextLine(clusters[i + 1]!)}`;
      const combinedHits = headerColumnHits(combined, columnOrder);
      if (combinedHits >= minHits) {
        hits = combinedHits;
        endIdx = i + 1;
        line = combined;
      }
    }

    if (hits < minHits) continue;
    if (looksLikeSummaryBlock(line) && hits < 4) continue;

    if (hits >= bestScore) {
      bestScore = hits;
      bestIdx = endIdx;
    }
  }

  if (bestIdx >= 0) {
    return {
      dataStart: bestIdx + 1,
      tableTopPdfY: clusterBottomPdfY(clusters[bestIdx]!) - 6,
    };
  }

  const firstRow = findFirstScheduleRowIndex(clusters, columnOrder);
  if (firstRow >= 0) {
    return {
      dataStart: firstRow,
      tableTopPdfY: clusterBottomPdfY(clusters[firstRow]!) + 8,
    };
  }

  return { dataStart: 0, tableTopPdfY: null };
}

function pieceCenterInBand(p: TextPiece, left: number, right: number): boolean {
  const mid = p.x + p.w / 2;
  return mid >= left && mid < right;
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

function rowFromCluster(
  cl: TextPiece[],
  columnOrder: LoanColumnId[],
  boundaries: LoanColumnBoundaries,
): LoanScheduleRow {
  const ranges = {} as Record<LoanColumnId, { left: number; right: number }>;
  for (const id of ALL_LOAN_COLUMNS) {
    ranges[id] = columnRangeFromBoundaries(id, columnOrder, boundaries);
  }
  const assigned = new Set<TextPiece>();
  const cells = {} as Record<LoanColumnId, string>;
  for (const id of ALL_LOAN_COLUMNS) {
    const slice: TextPiece[] = [];
    for (const p of cl) {
      if (assigned.has(p)) continue;
      const { left, right } = ranges[id];
      if (pieceCenterInBand(p, left, right)) {
        slice.push(p);
        assigned.add(p);
      }
    }
    cells[id] = joinColumnPieces(slice);
  }
  for (const p of cl) {
    if (assigned.has(p)) continue;
    let best: LoanColumnId | null = null;
    let bestDist = Infinity;
    const mid = p.x + p.w / 2;
    for (const id of columnOrder) {
      const { left, right } = ranges[id];
      const center = (left + right) / 2;
      const dist = Math.abs(mid - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = id;
      }
    }
    if (best) cells[best] = `${cells[best]} ${p.str}`.trim();
  }
  return {
    page: 0,
    installmentNo: cells.installmentNo,
    dueDate: cells.dueDate,
    installmentAmount: cells.installmentAmount,
    interest: cells.interest,
    principal: cells.principal,
    balancePrincipal: cells.balancePrincipal,
  };
}

const DATE_RE = /\b\d{2}[-/]\d{2}[-/]\d{4}\b|\b\d{4}[-/]\d{2}[-/]\d{2}\b/;
const AMOUNT_RE = /\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b|\b\d+\.\d{2}\b/;
const INST_NO_RE = /^\d{1,4}$/;

function rowHasDueDate(row: LoanScheduleRow): boolean {
  if (DATE_RE.test(row.dueDate.trim())) return true;
  const full = [
    row.installmentNo,
    row.dueDate,
    row.installmentAmount,
    row.interest,
    row.principal,
    row.balancePrincipal,
  ].join(" ");
  return DATE_RE.test(full);
}

function rowLooksLikeData(row: LoanScheduleRow): boolean {
  if (!rowHasDueDate(row)) return false;
  if (DATE_RE.test(row.dueDate)) return true;
  if (AMOUNT_RE.test(row.installmentAmount)) return true;
  if (AMOUNT_RE.test(row.interest)) return true;
  if (AMOUNT_RE.test(row.principal)) return true;
  if (AMOUNT_RE.test(row.balancePrincipal)) return true;
  if (INST_NO_RE.test(row.installmentNo.trim())) return true;
  const full = [
    row.installmentNo,
    row.dueDate,
    row.installmentAmount,
    row.interest,
    row.principal,
    row.balancePrincipal,
  ].join(" ");
  return DATE_RE.test(full) || AMOUNT_RE.test(full);
}

function lineLooksLikeHeaderRepeat(text: string, columnOrder: LoanColumnId[]): boolean {
  return headerColumnHits(text, columnOrder) >= Math.min(3, columnOrder.length);
}

export async function extractLoanScheduleFromPdfData(
  data: ArrayBuffer,
  options: LoanColumnParseOptions,
): Promise<LoanScheduleExtractResult> {
  ensureLoanPdfWorker();
  const columnOrder =
    options.columnOrder.length > 0 ? options.columnOrder : [...ALL_LOAN_COLUMNS];
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const rows: LoanScheduleRow[] = [];
  let boundaries: LoanColumnBoundaries | null = options.columnBoundaries
    ? [...options.columnBoundaries]
    : null;
  let boundariesPdfW = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const pdfW = page.getViewport({ scale: 1 }).width;
    boundariesPdfW = pdfW;
    const content = await page.getTextContent();
    const pieces = textPiecesFromPageContent(content);
    const clusters = clusterByY(pieces, 3.5);
    const { dataStart, tableTopPdfY } = resolveLoanTableRegion(clusters, columnOrder);
    const dataClusters = clusters.slice(dataStart);

    if (!boundaries) {
      boundaries = detectBoundariesFromDataClusters(dataClusters, columnOrder, pdfW);
      boundaries = clampBoundaries(boundaries, pdfW);
    } else {
      boundaries = clampBoundaries(boundaries, pdfW);
    }

    for (const cl of dataClusters) {
      const full = clusterTextLine(cl);
      if (!full) continue;
      if (lineLooksLikeHeaderRepeat(full, columnOrder)) continue;
      const row = rowFromCluster(cl, columnOrder, boundaries);
      row.page = pageNum;
      if (!rowLooksLikeData(row)) continue;
      rows.push(row);
    }
  }

  if (boundaries && boundariesPdfW > 0) {
    boundaries = clampBoundaries(boundaries, boundariesPdfW);
  }

  return { rows, boundaries: boundaries ?? undefined };
}

function normalizeViewportRect(q: number[]): LoanOverlayBandRect {
  const x0 = q[0]!;
  const y0 = q[1]!;
  const x1 = q[2]!;
  const y1 = q[3]!;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function computeOverlayPagesFromBoundaries(
  caches: LoanPageGuideCache[],
  boundaries: LoanColumnBoundaries,
  columnOrder: LoanColumnId[],
): LoanPdfOverlayPage[] {
  return caches.map((c) => {
    const bounds = clampBoundaries(boundaries, c.pdfW);
    const bands = {} as Record<LoanColumnId, LoanOverlayBandRect>;
    for (const id of columnOrder) {
      const range = columnRangeFromBoundaries(id, columnOrder, bounds);
      const topY = c.tableTopPdfY;
      bands[id] = normalizeViewportRect(
        c.convertPdfRectToViewport([range.left, topY, range.right, c.pdfH]),
      );
    }
    return {
      page: c.page,
      canvasCssWidth: c.viewportWidth,
      canvasCssHeight: c.viewportHeight,
      bands,
    };
  });
}

export async function buildLoanPageGuideCaches(
  pdf: PDFDocumentProxy,
  scale: number,
  columnOrder: LoanColumnId[],
): Promise<LoanGuideCachesResult> {
  ensureLoanPdfWorker();
  const caches: LoanPageGuideCache[] = [];
  let detectedBoundaries = equalColumnBoundaries(columnOrder.length, 600);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const pdfW = page.getViewport({ scale: 1 }).width;
    const pdfH = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    const pieces = textPiecesFromPageContent(content);
    const clusters = clusterByY(pieces, 3.5);
    const { dataStart, tableTopPdfY } = resolveLoanTableRegion(clusters, columnOrder);
    const dataClusters = clusters.slice(dataStart);
    const topY = tableTopPdfY ?? 0;

    if (pageNum === 1) {
      detectedBoundaries = clampBoundaries(
        detectBoundariesFromDataClusters(dataClusters, columnOrder, pdfW),
        pdfW,
      );
    }

    caches.push({
      page: pageNum,
      pdfW,
      pdfH,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      tableTopPdfY: topY,
      convertPdfRectToViewport: (rect) => viewport.convertToViewportRectangle(rect),
    });
  }

  if (caches.length > 0) {
    detectedBoundaries = clampBoundaries(detectedBoundaries, caches[0]!.pdfW);
  }

  return { caches, detectedBoundaries };
}

export const LOAN_COLUMN_FILL: Record<LoanColumnId, string> = {
  installmentNo: "rgba(234, 88, 12, 0.10)",
  dueDate: "rgba(124, 58, 237, 0.10)",
  installmentAmount: "rgba(29, 111, 184, 0.12)",
  interest: "rgba(220, 38, 38, 0.10)",
  principal: "rgba(22, 163, 74, 0.14)",
  balancePrincipal: "rgba(180, 83, 9, 0.12)",
};
