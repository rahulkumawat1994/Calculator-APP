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

/** Printed footer total from the source bank PDF (Page Total / Grand Total). */
export type StatementPdfPageTotal = {
  page: number;
  kind: "page" | "grand";
  withdrawals: string;
  deposits: string;
  label: string;
};

export type StatementWdDpExtractResult = {
  rows: StatementWdDpRow[];
  pdfPageTotals: StatementPdfPageTotal[];
};

/** Row with no date, narration, or amounts — safe to drop from lists and exports. */
export function isStatementRowEmpty(row: StatementWdDpRow): boolean {
  return (
    !row.txnDate.trim() &&
    !row.transaction.trim() &&
    !row.withdrawals.trim() &&
    !row.deposits.trim()
  );
}

export function dropEmptyStatementRows(rows: StatementWdDpRow[]): StatementWdDpRow[] {
  return rows.filter((r) => !isStatementRowEmpty(r));
}

type TextPiece = { str: string; x: number; y: number; w: number };

type HeaderLayout = {
  txnDateX: number;
  /** TRANSACTION or NARRATION column anchor. */
  narrativeX: number;
  withdrawalX: number;
  depositX: number;
  balanceX?: number;
  alphaX?: number;
  chqX?: number;
  additionalX?: number;
  /** Date | Withdrawal | Deposit | … | Narration (vs classic Date | Transaction | Withdrawal | Deposit). */
  isWithdrawalBeforeNarration: boolean;
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

/** Per-page / statement footer totals — not transaction rows. */
export function lineLooksLikePageTotalLine(text: string): boolean {
  const u = text.replace(/\s+/g, " ").trim();
  if (!u) return false;
  if (/^page\s+totals?\b/i.test(u)) return true;
  if (/^\d{2}-\d{2}-\d{4}\s+page\s+totals?\b/i.test(u)) return true;
  if (/^grand(?:\s+total)?\b/i.test(u)) return true;
  if (/^page\s+totals?\s+[\d,.\s]+$/i.test(u)) return true;
  if (/^grand(?:\s+total)?\s+[\d,.\s]+$/i.test(u)) return true;
  return false;
}

function pdfPageTotalKind(text: string): "page" | "grand" {
  const u = text.replace(/\s+/g, " ").trim();
  if (/^grand(?:\s+total)?\b/i.test(u)) return "grand";
  return "page";
}

function capturePdfPageTotal(
  pageNum: number,
  full: string,
  transaction: string,
  withdrawals: string,
  deposits: string,
  pdfPageTotals: StatementPdfPageTotal[],
): void {
  const label = (transaction.trim() || full).replace(/\s+/g, " ").trim();
  let wd = withdrawals.trim();
  let dep = deposits.trim();
  if (!wd && !dep) {
    const amounts = label.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b|\b\d+\.\d{2}\b/g) ?? [];
    if (amounts.length >= 2) {
      wd = amounts[amounts.length - 2]!;
      dep = amounts[amounts.length - 1]!;
    }
  }
  if (!wd && !dep) return;
  pdfPageTotals.push({
    page: pageNum,
    kind: pdfPageTotalKind(label),
    withdrawals: wd,
    deposits: dep,
    label,
  });
}

const TXN_DATE_TOKEN_RE = /\b\d{2}-\d{2}-\d{4}\b/;
const AMOUNT_TOKEN_RE = /\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b|\b\d+\.\d{2}\b/;

/** Row carries its own date or amount (column slice or anywhere on the line). */
export function clusterLineHasDateOrAmounts(
  fullLine: string,
  txnDate: string,
  withdrawals: string,
  deposits: string,
): boolean {
  if (txnDate.trim() || withdrawals.trim() || deposits.trim()) return true;
  const full = fullLine.replace(/\s+/g, " ").trim();
  if (!full) return false;
  if (TXN_DATE_TOKEN_RE.test(full)) return true;
  return AMOUNT_TOKEN_RE.test(full);
}

/** Narration that begins a new payment row (not a wrapped continuation phrase). */
export function narrationStartsNewTransaction(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/^UPI\//i.test(t)) return true;
  if (TXN_DATE_TOKEN_RE.test(t)) return true;
  if (/^(NEFT|IMPS|RTGS|INFT|ACH|ECS|CMS|REV|ATM)\b/i.test(t)) return true;
  return false;
}

/** Bank reference line wrapped under the previous narration (e.g. SERVICE: after NEFT IN). */
export function narrationLooksLikeWrappedContinuation(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (/^SERVICE:/i.test(t)) return true;
  // PDF column split truncates "SERVICE" to "S:UTIB…" on the next line.
  if (/^S:[A-Z0-9]/i.test(t)) return true;
  return false;
}

/** Footer / legal lines — not transactions. */
export function lineLooksLikeDisclaimerLine(text: string): boolean {
  const u = text.replace(/\s+/g, " ").trim();
  return /\bdisclaimer\b/i.test(u) || /\belectronically generated statement\b/i.test(u);
}

function rowHasTxnMetadata(
  fullLine: string,
  txnDate: string,
  withdrawals: string,
  deposits: string,
): boolean {
  return (
    clusterLineHasDateOrAmounts(fullLine, txnDate, withdrawals, deposits) ||
    extractTxnDateFromLineText(fullLine).length > 0
  );
}

/** Split one narration cell that accidentally contains multiple UPI rows. */
export function splitMergedUpiNarrations(
  page: number,
  txnDate: string,
  transaction: string,
  withdrawals: string,
  deposits: string,
): StatementWdDpRow[] {
  const base = { page, txnDate, transaction, withdrawals, deposits };
  if (!transaction.trim()) return [base];
  const parts = transaction
    .split(/\s+(?=UPI\/|NEFT\b|IMPS\b|RTGS\b)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [base];
  return parts.map((part, i) => ({
    page,
    txnDate,
    transaction: part,
    withdrawals: i === 0 ? withdrawals : "",
    deposits: i === 0 ? deposits : "",
  }));
}

function extractTxnDateFromLineText(text: string): string {
  const m = text.replace(/\s+/g, " ").trim().match(TXN_DATE_TOKEN_RE);
  return m ? m[0] : "";
}

function pushOrphanNarration(
  rows: StatementWdDpRow[],
  page: number,
  narration: string,
): void {
  rows.push({ page, txnDate: "", transaction: narration, withdrawals: "", deposits: "" });
}

type PendingMeta = {
  page: number;
  txnDate: string;
  withdrawals: string;
  deposits: string;
  y: number;
};

/** Broken narration fragments from PDF column splits (e.g. "S:" after NEFT lines). */
export function isNoiseTransaction(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/^S:\s*$/i.test(t)) return true;
  if (/^DIGITAL\s+S:\s*$/i.test(t)) return true;
  return false;
}

function datesMatch(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  return x.length > 0 && y === x;
}

function rowHasAmounts(row: StatementWdDpRow): boolean {
  return Boolean(row.withdrawals.trim() || row.deposits.trim());
}

function rowHasNarration(row: StatementWdDpRow): boolean {
  const t = row.transaction.trim();
  return t.length > 0 && !isNoiseTransaction(t);
}

/** Pair narration on one PDF line with amounts on the next. */
function pairAdjacentNarrationAndAmountRows(rows: StatementWdDpRow[]): StatementWdDpRow[] {
  const out: StatementWdDpRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (
      rowHasNarration(row) &&
      !rowHasAmounts(row) &&
      i + 1 < rows.length &&
      !rowHasNarration(rows[i + 1]!) &&
      rowHasAmounts(rows[i + 1]!)
    ) {
      const next = rows[i + 1]!;
      out.push({
        page: row.page,
        txnDate: row.txnDate.trim() || next.txnDate,
        transaction: row.transaction,
        withdrawals: next.withdrawals,
        deposits: next.deposits,
      });
      i++;
      continue;
    }
    out.push(row);
  }
  return out;
}

/**
 * After raw PDF column slicing:
 * - narration-only rows merge into the row above
 * - amounts on continuation lines (SERVICE / S:) merge narr up and uplift amounts to the next row
 * - bare amount rows uplift to the next narration row
 */
function narrationShouldMergeIntoPrevious(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (narrationLooksLikeWrappedContinuation(t)) return true;
  return !narrationStartsNewTransaction(t);
}

function pushMisplacedAmountRow(
  out: StatementWdDpRow[],
  page: number,
  txnDate: string,
  amounts: { withdrawals: string; deposits: string },
): void {
  if (!amounts.withdrawals.trim() && !amounts.deposits.trim()) return;
  out.push({
    page,
    txnDate,
    transaction: "",
    withdrawals: amounts.withdrawals,
    deposits: amounts.deposits,
  });
}

function mergeOrphanNarrationsUpward(rows: StatementWdDpRow[]): StatementWdDpRow[] {
  const out: StatementWdDpRow[] = [];
  let upliftAmounts: { withdrawals: string; deposits: string } | null = null;

  for (const row of rows) {
    let r: StatementWdDpRow = { ...row };
    const hasNarr = rowHasNarration(r);

    if (upliftAmounts && hasNarr && !rowHasAmounts(r)) {
      r = {
        ...r,
        withdrawals: upliftAmounts.withdrawals,
        deposits: upliftAmounts.deposits,
      };
      upliftAmounts = null;
    }

    const hasAmt = rowHasAmounts(r);

    if (upliftAmounts && hasNarr && hasAmt) {
      pushMisplacedAmountRow(out, r.page, r.txnDate, upliftAmounts);
      upliftAmounts = null;
    }

    if (hasNarr && !hasAmt) {
      if (narrationShouldMergeIntoPrevious(r.transaction) && out.length > 0) {
        out[out.length - 1]!.transaction =
          `${out[out.length - 1]!.transaction} ${r.transaction}`.trim();
      } else {
        out.push(r);
      }
      continue;
    }

    if (
      hasNarr &&
      hasAmt &&
      narrationLooksLikeWrappedContinuation(r.transaction.trim())
    ) {
      if (out.length > 0) {
        out[out.length - 1]!.transaction =
          `${out[out.length - 1]!.transaction} ${r.transaction}`.trim();
      } else {
        out.push({ ...r, withdrawals: "", deposits: "" });
      }
      upliftAmounts = {
        withdrawals: r.withdrawals,
        deposits: r.deposits,
      };
      continue;
    }

    if (!hasNarr && hasAmt) {
      upliftAmounts = {
        withdrawals: r.withdrawals,
        deposits: r.deposits,
      };
      continue;
    }

    if (upliftAmounts && !hasAmt) {
      r = {
        ...r,
        withdrawals: upliftAmounts.withdrawals,
        deposits: upliftAmounts.deposits,
      };
      upliftAmounts = null;
    }

    out.push(r);
  }

  if (upliftAmounts) {
    const page =
      out.length > 0
        ? out[out.length - 1]!.page
        : rows.length > 0
          ? rows[rows.length - 1]!.page
          : 1;
    pushMisplacedAmountRow(out, page, "", upliftAmounts);
  }

  return out;
}

export function simplifyMisfitStatementRows(rows: StatementWdDpRow[]): StatementWdDpRow[] {
  return dropEmptyStatementRows(
    mergeOrphanNarrationsUpward(pairAdjacentNarrationAndAmountRows(rows)),
  );
}

function pushExpandedRows(
  rows: StatementWdDpRow[],
  page: number,
  txnDate: string,
  transaction: string,
  withdrawals: string,
  deposits: string,
): void {
  for (const row of splitMergedUpiNarrations(page, txnDate, transaction, withdrawals, deposits)) {
    if (isStatementRowEmpty(row)) continue;
    rows.push(row);
  }
}

function flushPendingIncomplete(
  rows: StatementWdDpRow[],
  pending: StatementWdDpRow | null,
): StatementWdDpRow | null {
  if (pending && !isStatementRowEmpty(pending)) rows.push(pending);
  return null;
}

function flushPendingMeta(rows: StatementWdDpRow[], pending: PendingMeta | null): PendingMeta | null {
  if (pending) {
    pushExpandedRows(
      rows,
      pending.page,
      pending.txnDate,
      "",
      pending.withdrawals,
      pending.deposits,
    );
  }
  return null;
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

function clusterY(cl: TextPiece[]): number {
  if (cl.length === 0) return 0;
  let sum = 0;
  for (const p of cl) sum += p.y;
  return sum / cl.length;
}

/** True when a drawn horizontal rule sits between two text rows (PDF user-space Y). */
export function hasHorizontalRuleBetween(
  yUpper: number,
  yLower: number,
  ruleYs: number[],
): boolean {
  if (ruleYs.length === 0) return false;
  const top = Math.max(yUpper, yLower);
  const bottom = Math.min(yUpper, yLower);
  return ruleYs.some((ry) => ry >= bottom - 2 && ry <= top + 2);
}

async function extractHorizontalRuleYs(
  page: pdfjs.PDFPageProxy,
  pageWidth: number,
): Promise<number[]> {
  try {
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray;
    const argsArray = opList.argsArray;
    const ys: number[] = [];
    const minWidth = pageWidth * 0.25;
    const rectangleOp = pdfjs.OPS.rectangle;
    for (let i = 0; i < fnArray.length; i++) {
      if (fnArray[i] !== rectangleOp) continue;
      const args = argsArray[i];
      if (!args || args.length < 4) continue;
      const w = Number(args[2]);
      const h = Number(args[3]);
      const y = Number(args[1]);
      if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(y)) continue;
      if (w >= minWidth && Math.abs(h) <= 4) ys.push(y + h / 2);
    }
    return ys;
  } catch {
    return [];
  }
}

export function lineLooksLikeStatementColumnHeader(text: string): boolean {
  const u = text.toUpperCase().replace(/\s+/g, " ").trim();
  const hasDateCol = /\b(?:TXN|TRAN)\s+DATE\b/.test(u);
  const hasNarrativeCol = /\bTRANSACTION\b/.test(u) || /\bNARRATION\b/.test(u);
  const hasWithdrawal = /\bWITHDRAWALS?\b/.test(u);
  const hasDeposit = /\bDEPOSITS?\b/.test(u);
  return hasDateCol && hasNarrativeCol && hasWithdrawal && hasDeposit;
}

function findStatementTableHeaderBand(
  clusters: TextPiece[][],
): { start: number; end: number } | null {
  for (let i = 0; i < clusters.length; i++) {
    let combined = clusterTextLine(clusters[i]!);
    if (lineLooksLikeStatementColumnHeader(combined)) return { start: i, end: i };
    for (let j = i + 1; j < clusters.length && j <= i + 2; j++) {
      combined = `${combined} ${clusterTextLine(clusters[j]!)}`;
      if (lineLooksLikeStatementColumnHeader(combined)) return { start: i, end: j };
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
  const txnDateX = findHeaderMinX(pieces, /\b(?:TXN|TRAN)\b|\bDATE\b/);
  const narrativeX = findHeaderMinX(pieces, /\bTRANSACTION\b|\bNARRATION\b/);
  const withdrawalX = findHeaderMinX(pieces, /\bWITHDRAWALS?\b/);
  const depositX = findHeaderMinX(pieces, /\bDEPOSITS?\b/);
  const balanceX = findHeaderMinX(pieces, /\bBALANCE\b/);
  const alphaX = findHeaderMinX(pieces, /\bALPHA\b/);
  const chqX = findHeaderMinX(pieces, /\bCHQ\b/);
  const additionalX = findHeaderMinX(pieces, /\bADDITIONAL\b/);
  if (txnDateX == null || narrativeX == null || withdrawalX == null || depositX == null) return null;
  const isWithdrawalBeforeNarration = withdrawalX < narrativeX;
  return {
    txnDateX,
    narrativeX,
    withdrawalX,
    depositX,
    balanceX,
    alphaX,
    chqX,
    additionalX,
    isWithdrawalBeforeNarration,
  };
}

/** Right edge of Balance / Alpha / CHQ block before Narration (withdrawal-first statements). */
function middleColumnsRightEdge(layout: HeaderLayout): number | undefined {
  const xs = [layout.balanceX, layout.alphaX, layout.chqX].filter(
    (x): x is number => x != null && x < layout.narrativeX,
  );
  if (xs.length === 0) return undefined;
  return Math.max(...xs);
}

/** Txn Date: left-most date column before Withdrawal or Transaction/Narration. */
function txnDateColumnXRange(layout: HeaderLayout, d: StatementColumnBandDeltas): { left: number; right: number } {
  const baseL = layout.txnDateX - 16;
  const baseR = layout.isWithdrawalBeforeNarration
    ? (layout.txnDateX + layout.withdrawalX) / 2
    : (layout.txnDateX + layout.narrativeX) / 2;
  return ensureOrderedBand(baseL + d.txnDateDeltaLeft, baseR + d.txnDateDeltaRight);
}

/** Transaction / Narration body column. */
function transactionColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): { left: number; right: number } {
  if (layout.isWithdrawalBeforeNarration) {
    const midRight = middleColumnsRightEdge(layout);
    const baseL =
      midRight != null
        ? Math.max(layout.narrativeX - 40, midRight + 8)
        : layout.narrativeX - 40;
    const baseR =
      layout.additionalX != null && layout.additionalX > layout.narrativeX
        ? layout.additionalX - 6
        : pdfPageWidth;
    return ensureOrderedBand(baseL + d.transactionDeltaLeft, baseR + d.transactionDeltaRight);
  }
  const baseL = (layout.txnDateX + layout.narrativeX) / 2;
  const baseR = (layout.narrativeX + layout.withdrawalX) / 2;
  return ensureOrderedBand(baseL + d.transactionDeltaLeft, baseR + d.transactionDeltaRight);
}

/** Deposits: under Deposits header, left of Balance or Narration. */
function depositColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): { left: number; right: number } {
  const baseL = layout.depositX - 16;
  let baseR: number;
  if (layout.balanceX != null && layout.balanceX > layout.depositX) {
    baseR = (layout.depositX + layout.balanceX) / 2;
  } else if (layout.isWithdrawalBeforeNarration) {
    const midRight = middleColumnsRightEdge(layout);
    if (midRight != null) {
      baseR = (layout.depositX + midRight) / 2;
    } else if (layout.narrativeX > layout.depositX) {
      baseR = (layout.depositX + layout.narrativeX) / 2;
    } else {
      baseR = pdfPageWidth;
    }
  } else {
    baseR = pdfPageWidth;
  }
  return ensureOrderedBand(baseL + d.depositDeltaLeft, baseR + d.depositDeltaRight);
}

/**
 * Withdrawals: after date gutter, strictly before Deposits column (classic or withdrawal-first).
 */
function withdrawalColumnXRange(
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
): { left: number; right: number } {
  if (layout.isWithdrawalBeforeNarration) {
    const baseL = (layout.txnDateX + layout.withdrawalX) / 2;
    const baseR = (layout.withdrawalX + layout.depositX) / 2;
    return ensureOrderedBand(baseL + d.withdrawalDeltaLeft, baseR + d.withdrawalDeltaRight);
  }
  const baseL = (layout.narrativeX + layout.withdrawalX) / 2;
  const baseR = layout.depositX - 16;
  return ensureOrderedBand(baseL + d.withdrawalDeltaLeft, baseR + d.withdrawalDeltaRight);
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

type StatementColumnKey = "txnDate" | "withdrawal" | "deposit" | "transaction";

/** Assign each text piece to one column (numeric columns first) to avoid cross-column bleed. */
function columnTextsFromCluster(
  cl: TextPiece[],
  layout: HeaderLayout,
  d: StatementColumnBandDeltas,
  pdfPageWidth: number,
): { txnDate: string; transaction: string; withdrawals: string; deposits: string } {
  const ranges: Record<StatementColumnKey, { left: number; right: number }> = {
    txnDate: txnDateColumnXRange(layout, d),
    withdrawal: withdrawalColumnXRange(layout, d),
    deposit: depositColumnXRange(layout, d, pdfPageWidth),
    transaction: transactionColumnXRange(layout, d, pdfPageWidth),
  };
  const buckets: Record<StatementColumnKey, TextPiece[]> = {
    txnDate: [],
    withdrawal: [],
    deposit: [],
    transaction: [],
  };
  const claimed = new Set<TextPiece>();
  const order: StatementColumnKey[] = ["txnDate", "withdrawal", "deposit", "transaction"];

  for (const key of order) {
    const { left, right } = ranges[key];
    for (const p of cl) {
      if (claimed.has(p)) continue;
      if (pieceCenterInBand(p, left, right)) {
        buckets[key].push(p);
        claimed.add(p);
      }
    }
  }

  const unclaimed = cl.filter((p) => !claimed.has(p));
  if (unclaimed.length > 0 && buckets.transaction.length === 0) {
    const extra = joinColumnPieces(unclaimed);
    if (extra && /[A-Za-z]/.test(extra)) {
      buckets.transaction.push(...unclaimed);
    }
  }

  return {
    txnDate: joinColumnPieces(buckets.txnDate),
    transaction: joinColumnPieces(buckets.transaction),
    withdrawals: joinColumnPieces(buckets.withdrawal),
    deposits: joinColumnPieces(buckets.deposit),
  };
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
): Promise<StatementWdDpExtractResult> {
  ensurePdfWorker();
  const deltas = resolveStatementColumnBandDeltas(options);
  // pdf.js may transfer/detach the ArrayBuffer passed here — always pass a copy.
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const rows: StatementWdDpRow[] = [];
  const pdfPageTotals: StatementPdfPageTotal[] = [];
  let layout: HeaderLayout | null = null;
  let stoppedAfterClosingBalance = false;
  let pendingNarration: string | null = null;
  let pendingNarrationPage = 0;
  let pendingNarrationY = 0;
  let pendingIncompleteY = 0;
  let pendingMeta: PendingMeta | null = null;
  let pendingIncomplete: StatementWdDpRow | null = null;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (stoppedAfterClosingBalance) break;

    if (pendingNarration !== null && pendingNarrationPage !== pageNum) {
      pushOrphanNarration(rows, pendingNarrationPage, pendingNarration);
      pendingNarration = null;
    }
    if (pendingMeta !== null && pendingMeta.page !== pageNum) {
      pendingMeta = flushPendingMeta(rows, pendingMeta);
    }
    if (pendingIncomplete !== null && pendingIncomplete.page !== pageNum) {
      pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
    }

    const page = await pdf.getPage(pageNum);
    const pdfW = page.getViewport({ scale: 1 }).width;
    const ruleYs = await extractHorizontalRuleYs(page, pdfW);
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
      const clusterYVal = clusterY(cl);
      const priorClusterY = i > 0 ? clusterY(dataClusters[i - 1]!) : null;

      if (
        priorClusterY !== null &&
        hasHorizontalRuleBetween(priorClusterY, clusterYVal, ruleYs)
      ) {
        if (pendingNarration !== null) {
          pushOrphanNarration(rows, pendingNarrationPage, pendingNarration);
          pendingNarration = null;
        }
        pendingMeta = flushPendingMeta(rows, pendingMeta);
        pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
      }

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

      const { txnDate, transaction, withdrawals, deposits } = columnTextsFromCluster(
        cl,
        layout,
        deltas,
        pdfW,
      );

      if (lineLooksLikeOpeningBalanceLine(full) || lineLooksLikeOpeningBalanceLine(transaction)) {
        continue;
      }

      if (lineLooksLikePageTotalLine(full) || lineLooksLikePageTotalLine(transaction)) {
        capturePdfPageTotal(pageNum, full, transaction, withdrawals, deposits, pdfPageTotals);
        continue;
      }

      if (lineLooksLikeDisclaimerLine(full) || lineLooksLikeDisclaimerLine(transaction)) {
        continue;
      }

      const hasMeta = rowHasTxnMetadata(full, txnDate, withdrawals, deposits);
      const resolvedTxnDate = txnDate || extractTxnDateFromLineText(full);
      const realTransaction = isNoiseTransaction(transaction) ? "" : transaction.trim();

      // Narration only — pair with pending amounts or hold for next line
      if (transaction && !hasMeta && !isNoiseTransaction(transaction)) {
        if (
          pendingMeta &&
          pendingMeta.page === pageNum &&
          !hasHorizontalRuleBetween(pendingMeta.y, clusterYVal, ruleYs)
        ) {
          pushExpandedRows(
            rows,
            pageNum,
            pendingMeta.txnDate,
            transaction,
            pendingMeta.withdrawals,
            pendingMeta.deposits,
          );
          pendingMeta = null;
          continue;
        }
        if (rows.length > 0 && priorClusterY !== null) {
          const prev = rows[rows.length - 1]!;
          if (
            prev.page === pageNum &&
            (prev.txnDate || prev.withdrawals || prev.deposits) &&
            !prev.transaction.trim() &&
            !hasHorizontalRuleBetween(priorClusterY, clusterYVal, ruleYs)
          ) {
            prev.transaction = transaction;
            continue;
          }
        }
        if (pendingNarration !== null) {
          pendingNarration = `${pendingNarration} ${transaction}`.trim();
          pendingNarrationY = clusterYVal;
          continue;
        }
        pendingNarration = transaction;
        pendingNarrationPage = pageNum;
        pendingNarrationY = clusterYVal;
        continue;
      }

      // Date/amounts only — narration on previous or next line
      if (hasMeta && !realTransaction) {
        if (
          pendingNarration !== null &&
          pendingNarrationPage === pageNum &&
          !hasHorizontalRuleBetween(pendingNarrationY, clusterYVal, ruleYs)
        ) {
          pushExpandedRows(
            rows,
            pageNum,
            resolvedTxnDate,
            pendingNarration,
            withdrawals,
            deposits,
          );
          pendingNarration = null;
          pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
          continue;
        }
        if (
          pendingIncomplete &&
          pendingIncomplete.page === pageNum &&
          datesMatch(pendingIncomplete.txnDate, resolvedTxnDate) &&
          !hasHorizontalRuleBetween(pendingIncompleteY, clusterYVal, ruleYs)
        ) {
          pendingIncomplete.withdrawals = withdrawals || pendingIncomplete.withdrawals;
          pendingIncomplete.deposits = deposits || pendingIncomplete.deposits;
          if (!isStatementRowEmpty(pendingIncomplete)) rows.push(pendingIncomplete);
          pendingIncomplete = null;
          continue;
        }
        if (pendingMeta) pendingMeta = flushPendingMeta(rows, pendingMeta);
        pendingMeta = {
          page: pageNum,
          txnDate: resolvedTxnDate,
          withdrawals,
          deposits,
          y: clusterYVal,
        };
        continue;
      }

      if (!txnDate && !transaction && !withdrawals && !deposits) continue;

      let finalTransaction = realTransaction;
      if (
        pendingNarration !== null &&
        pendingNarrationPage === pageNum &&
        !hasHorizontalRuleBetween(pendingNarrationY, clusterYVal, ruleYs)
      ) {
        finalTransaction = finalTransaction
          ? `${pendingNarration} ${finalTransaction}`
          : pendingNarration;
        pendingNarration = null;
      }

      if (pendingMeta) pendingMeta = flushPendingMeta(rows, pendingMeta);

      if (finalTransaction && resolvedTxnDate && !withdrawals && !deposits) {
        pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
        pendingIncomplete = {
          page: pageNum,
          txnDate: resolvedTxnDate,
          transaction: finalTransaction,
          withdrawals: "",
          deposits: "",
        };
        pendingIncompleteY = clusterYVal;
        continue;
      }

      pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
      pushExpandedRows(
        rows,
        pageNum,
        resolvedTxnDate,
        finalTransaction,
        withdrawals,
        deposits,
      );
    }

    if (pendingNarration !== null && pendingNarrationPage === pageNum) {
      pushOrphanNarration(rows, pendingNarrationPage, pendingNarration);
      pendingNarration = null;
    }
    pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
    pendingMeta = flushPendingMeta(rows, pendingMeta);
  }

  if (pendingNarration !== null) {
    pushOrphanNarration(rows, pendingNarrationPage, pendingNarration);
  }
  pendingIncomplete = flushPendingIncomplete(rows, pendingIncomplete);
  pendingMeta = flushPendingMeta(rows, pendingMeta);

  return {
    rows: simplifyMisfitStatementRows(dropEmptyStatementRows(rows)),
    pdfPageTotals,
  };
}

/** @internal Test helper for column assignment without a PDF. */
export function splitStatementRowColumns(
  pieces: TextPiece[],
  layout: HeaderLayout,
  pdfPageWidth = 600,
  options?: StatementColumnParseOptions,
): { txnDate: string; transaction: string; withdrawals: string; deposits: string } {
  return columnTextsFromCluster(
    pieces,
    layout,
    resolveStatementColumnBandDeltas(options),
    pdfPageWidth,
  );
}

export async function extractStatementWdDpRowsFromPdf(
  file: File,
  options?: StatementColumnParseOptions,
): Promise<StatementWdDpRow[]> {
  const data = await file.arrayBuffer();
  const result = await extractStatementWdDpRowsFromPdfData(data, options);
  return result.rows;
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

function buildOverlayPageFromLayout(
  pageNum: number,
  layout: HeaderLayout,
  pdfW: number,
  pdfH: number,
  viewport: {
    width: number;
    height: number;
    convertToViewportRectangle: (pdfRect: number[]) => number[];
  },
  deltas: StatementColumnBandDeltas,
): StatementPdfOverlayPage {
  const txn = txnDateColumnXRange(layout, deltas);
  const txb = transactionColumnXRange(layout, deltas, pdfW);
  const wd = withdrawalColumnXRange(layout, deltas);
  const dep = depositColumnXRange(layout, deltas, pdfW);
  const depRight = dep.right;

  const txnRect = normalizeViewportRect(
    viewport.convertToViewportRectangle([txn.left, 0, txn.right, pdfH]),
  );
  const txbRect = normalizeViewportRect(
    viewport.convertToViewportRectangle([txb.left, 0, txb.right, pdfH]),
  );
  const wdRect = normalizeViewportRect(
    viewport.convertToViewportRectangle([wd.left, 0, wd.right, pdfH]),
  );
  const dpRect = normalizeViewportRect(
    viewport.convertToViewportRectangle([dep.left, 0, depRight, pdfH]),
  );

  return {
    page: pageNum,
    canvasCssWidth: viewport.width,
    canvasCssHeight: viewport.height,
    txnDate: txnRect,
    transaction: txbRect,
    withdrawal: wdRect,
    deposits: dpRect,
  };
}

/** Cached per-page layout for live column-guide overlay updates (no text re-parse). */
export type StatementPageGuideCache = {
  page: number;
  layout: HeaderLayout;
  pdfW: number;
  pdfH: number;
  viewportWidth: number;
  viewportHeight: number;
  convertPdfRectToViewport: (pdfRect: number[]) => number[];
};

export async function buildStatementPageGuideCaches(
  pdf: PDFDocumentProxy,
  scale: number,
): Promise<StatementPageGuideCache[]> {
  ensurePdfWorker();
  const caches: StatementPageGuideCache[] = [];
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

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });
    const vp = viewport as unknown as {
      convertToViewportRectangle: (pdfRect: number[]) => number[];
    };
    if (typeof vp.convertToViewportRectangle !== "function") continue;

    const convertPdfRectToViewport = vp.convertToViewportRectangle.bind(vp);
    caches.push({
      page: pageNum,
      layout: { ...layout },
      pdfW: base.width,
      pdfH: base.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      convertPdfRectToViewport,
    });
  }

  return caches;
}

export function computeOverlayPagesFromGuideCaches(
  caches: StatementPageGuideCache[],
  options?: StatementColumnParseOptions,
): StatementPdfOverlayPage[] {
  const deltas = resolveStatementColumnBandDeltas(options);
  return caches.map((c) =>
    buildOverlayPageFromLayout(
      c.page,
      c.layout,
      c.pdfW,
      c.pdfH,
      {
        width: c.viewportWidth,
        height: c.viewportHeight,
        convertToViewportRectangle: c.convertPdfRectToViewport,
      },
      deltas,
    ),
  );
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

    const vp = viewport as unknown as {
      width: number;
      height: number;
      convertToViewportRectangle: (pdfRect: number[]) => number[];
    };
    if (typeof vp.convertToViewportRectangle !== "function") {
      continue;
    }

    out.push(buildOverlayPageFromLayout(pageNum, layout, pdfW, pdfH, vp, deltas));
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
