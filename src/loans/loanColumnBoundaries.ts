import type { LoanColumnId } from "./loanColumns";
import {
  LOAN_SCHEDULE_AMOUNT_RE,
  LOAN_SCHEDULE_DATE_RE,
  LOAN_SCHEDULE_INST_NO_RE,
  loanScheduleRowLooksLikeData,
} from "./loanScheduleTextPatterns";

export type LoanColumnBoundaries = number[];

export function equalColumnBoundaries(columnCount: number, pdfWidth: number): LoanColumnBoundaries {
  const n = Math.max(2, columnCount);
  const inner = pdfWidth - 32;
  const out: number[] = [16];
  for (let i = 1; i < n; i++) out.push(16 + (inner * i) / n);
  out.push(pdfWidth - 16);
  return out;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function partitionCenters(xs: number[], k: number): number[] {
  if (xs.length === 0 || k <= 0) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  if (k === 1) return [median(sorted)];
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const start = Math.floor((i * sorted.length) / k);
    const end = Math.max(start + 1, Math.floor(((i + 1) * sorted.length) / k));
    const slice = sorted.slice(start, end);
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : sorted[start]!);
  }
  return out.sort((a, b) => a - b);
}

function inferMissingCenters(
  columnOrder: LoanColumnId[],
  centers: Partial<Record<LoanColumnId, number>>,
  pdfPageWidth: number,
): number[] {
  const positions = columnOrder.map((id) => centers[id] ?? NaN);

  for (let i = 0; i < columnOrder.length; i++) {
    if (Number.isFinite(positions[i])) continue;
    let prevI = -1;
    let nextI = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (Number.isFinite(positions[j])) {
        prevI = j;
        break;
      }
    }
    for (let j = i + 1; j < columnOrder.length; j++) {
      if (Number.isFinite(positions[j])) {
        nextI = j;
        break;
      }
    }
    if (prevI >= 0 && nextI >= 0) {
      const t = (i - prevI) / (nextI - prevI);
      positions[i] = positions[prevI]! + t * (positions[nextI]! - positions[prevI]!);
    } else if (prevI >= 0) {
      const step = (pdfPageWidth - positions[prevI]! - 24) / (columnOrder.length - prevI);
      positions[i] = positions[prevI]! + step * (i - prevI);
    } else if (nextI >= 0) {
      const step = positions[nextI]! / (nextI + 1);
      positions[i] = step * (i + 1);
    } else {
      positions[i] = 20 + ((pdfPageWidth - 40) / columnOrder.length) * (i + 0.5);
    }
  }
  return positions;
}

function centersToBoundaries(
  columnOrder: LoanColumnId[],
  centers: Partial<Record<LoanColumnId, number>>,
  pdfPageWidth: number,
): LoanColumnBoundaries {
  const positions = inferMissingCenters(columnOrder, centers, pdfPageWidth);
  const bounds: number[] = [];
  bounds.push(Math.max(8, positions[0]! - 24));
  for (let i = 0; i < columnOrder.length - 1; i++) {
    bounds.push((positions[i]! + positions[i + 1]!) / 2);
  }
  bounds.push(pdfPageWidth - 8);
  return clampBoundaries(bounds, pdfPageWidth);
}

export function rescaleBoundaries(bounds: LoanColumnBoundaries, pdfWidth: number): LoanColumnBoundaries {
  if (bounds.length < 2) return equalColumnBoundaries(2, pdfWidth);
  const srcW = bounds[bounds.length - 1]!;
  if (!Number.isFinite(srcW) || srcW <= 0) return clampBoundaries(bounds, pdfWidth);
  if (Math.abs(srcW - pdfWidth) < 1.5) return clampBoundaries(bounds, pdfWidth);
  const scale = pdfWidth / srcW;
  return clampBoundaries(bounds.map((b) => b * scale), pdfWidth);
}

export function boundaryMinGap(bounds: LoanColumnBoundaries, pdfWidth: number): number {
  return Math.max(4, pdfWidth / (bounds.length * 12));
}

export function boundaryLimits(
  bounds: LoanColumnBoundaries,
  index: number,
  pdfWidth: number,
): { min: number; max: number } {
  const gap = boundaryMinGap(bounds, pdfWidth);
  const last = bounds.length - 1;
  if (index <= 0) return { min: 0, max: Math.max(0, bounds[1]! - gap) };
  if (index >= last) {
    return { min: Math.min(pdfWidth, bounds[last - 1]! + gap), max: pdfWidth };
  }
  return { min: bounds[index - 1]! + gap, max: bounds[index + 1]! - gap };
}

/** Move one divider only — avoids full-array clamp collapsing other columns. */
export function setBoundaryAt(
  bounds: LoanColumnBoundaries,
  index: number,
  value: number,
  pdfWidth: number,
): LoanColumnBoundaries {
  if (bounds.length < 2) return bounds;
  const { min, max } = boundaryLimits(bounds, index, pdfWidth);
  if (max < min) return bounds;
  const out = [...bounds];
  out[index] = Math.max(min, Math.min(max, value));
  return out;
}

export function clampBoundaries(
  bounds: LoanColumnBoundaries,
  pdfWidth: number,
  minGap?: number,
): LoanColumnBoundaries {
  const gap = minGap ?? boundaryMinGap(bounds, pdfWidth);
  const out = [...bounds];
  out[0] = Math.max(0, Math.min(out[0]!, pdfWidth));
  out[out.length - 1] = Math.min(pdfWidth, Math.max(out[out.length - 1]!, 0));
  for (let i = 1; i < out.length - 1; i++) {
    const { min, max } = boundaryLimits(out, i, pdfWidth);
    if (max >= min) out[i] = Math.min(max, Math.max(min, out[i]!));
  }
  return out;
}

export function columnRangeFromBoundaries(
  colId: LoanColumnId,
  columnOrder: LoanColumnId[],
  boundaries: LoanColumnBoundaries,
): { left: number; right: number } {
  const idx = columnOrder.indexOf(colId);
  if (idx < 0) return { left: 0, right: boundaries[boundaries.length - 1] ?? 0 };
  return {
    left: boundaries[idx] ?? 0,
    right: boundaries[idx + 1] ?? boundaries[boundaries.length - 1] ?? 0,
  };
}

type TextPiece = { str: string; x: number; y: number; w: number };

export function detectBoundariesFromDataClusters(
  dataClusters: TextPiece[][],
  columnOrder: LoanColumnId[],
  pdfPageWidth: number,
): LoanColumnBoundaries {
  const instXs: number[] = [];
  const dateXs: number[] = [];
  const amountXs: number[] = [];

  for (const cl of dataClusters.slice(0, 24)) {
    for (const p of cl) {
      const mid = p.x + p.w / 2;
      const right = p.x + p.w;
      const t = p.str.trim();
      if (LOAN_SCHEDULE_DATE_RE.test(t)) dateXs.push(p.x);
      else if (LOAN_SCHEDULE_AMOUNT_RE.test(t)) amountXs.push(right);
      else if (LOAN_SCHEDULE_INST_NO_RE.test(t)) instXs.push(mid);
    }
  }

  const centers: Partial<Record<LoanColumnId, number>> = {};
  if (instXs.length) centers.installmentNo = median(instXs);
  if (dateXs.length) centers.dueDate = median(dateXs);

  const amountColIds = columnOrder.filter(
    (id) =>
      id === "installmentAmount" ||
      id === "interest" ||
      id === "principal" ||
      id === "balancePrincipal",
  );
  const peaks = partitionCenters(amountXs, amountColIds.length);
  amountColIds.forEach((id, i) => {
    if (peaks[i] != null) centers[id] = peaks[i];
  });

  const found = Object.keys(centers).length;
  if (found < 2) return equalColumnBoundaries(columnOrder.length, pdfPageWidth);

  return centersToBoundaries(columnOrder, centers, pdfPageWidth);
}
