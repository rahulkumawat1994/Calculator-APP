import { gzip, ungzip } from "pako";
import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";

export const LOAN_ROWS_ENCODING_GZIP = "gzip-base64-v1";
export const LOAN_ROWS_ENCODING_GZIP_CHUNKED = "gzip-base64-chunked-v1";

export const MAX_SINGLE_COMPRESSED_DOC_CHARS = 900_000;
export const LOAN_ROWS_PER_CHUNK = 400;
/** Max rows to decode from Firestore — matches UI cap. */
export const MAX_SCHEDULE_ROWS_DECODE = 600;
/** Skip gzip decode above this (legacy huge extracts). */
export const MAX_COMPRESSED_SCHEDULE_CHARS = 120_000;

export type LoanScheduleRowWire = {
  page: number;
  installmentNo: string;
  dueDate: string;
  installmentAmount: string;
  interest: string;
  principal: string;
  balancePrincipal: string;
  partPayment?: string;
};

export function rowsToWire(rows: LoanScheduleRow[]): LoanScheduleRowWire[] {
  return rows.map((r) => ({
    page: r.page,
    installmentNo: r.installmentNo,
    dueDate: r.dueDate,
    installmentAmount: r.installmentAmount,
    interest: r.interest,
    principal: r.principal,
    balancePrincipal: r.balancePrincipal,
    partPayment: r.partPayment,
  }));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function gzipJson(wire: LoanScheduleRowWire[]): string {
  const json = JSON.stringify(wire);
  return bytesToBase64(gzip(new TextEncoder().encode(json)));
}

function ungzipJson(base64: string): LoanScheduleRowWire[] {
  if (base64.length > MAX_COMPRESSED_SCHEDULE_CHARS) {
    console.warn("[loans] compressed schedule too large, skipping decode");
    return [];
  }
  const bytes = ungzip(base64ToBytes(base64));
  if (bytes.length > 2_000_000) {
    console.warn("[loans] schedule JSON too large, skipping decode");
    return [];
  }
  const raw = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as LoanScheduleRowWire[];
}

export type EncodedLoanScheduleRows = {
  encoding: string;
  rowCount: number;
  compressed?: string;
  chunks?: string[];
};

export function encodeLoanScheduleRowsForFirestore(rows: LoanScheduleRow[]): EncodedLoanScheduleRows {
  const wire = rowsToWire(rows);
  const compressed = gzipJson(wire);
  if (compressed.length <= MAX_SINGLE_COMPRESSED_DOC_CHARS) {
    return {
      encoding: LOAN_ROWS_ENCODING_GZIP,
      rowCount: rows.length,
      compressed,
    };
  }
  const chunks: string[] = [];
  for (let i = 0; i < wire.length; i += LOAN_ROWS_PER_CHUNK) {
    chunks.push(gzipJson(wire.slice(i, i + LOAN_ROWS_PER_CHUNK)));
  }
  return {
    encoding: LOAN_ROWS_ENCODING_GZIP_CHUNKED,
    rowCount: rows.length,
    chunks,
  };
}

export function wireToRows(wire: LoanScheduleRowWire[]): LoanScheduleRow[] {
  return wire.map((r) => ({
    page: r.page,
    installmentNo: r.installmentNo,
    dueDate: r.dueDate,
    installmentAmount: r.installmentAmount,
    interest: r.interest,
    principal: r.principal,
    balancePrincipal: r.balancePrincipal,
    partPayment: r.partPayment,
  }));
}

export function decodeLoanScheduleRowsFromFirestore(
  encoding: string | undefined,
  compressed: string | undefined,
  chunkPayloads: string[] | undefined,
): LoanScheduleRow[] {
  const maxWire = MAX_SCHEDULE_ROWS_DECODE;
  if (encoding === LOAN_ROWS_ENCODING_GZIP && compressed) {
    if (compressed.length > MAX_COMPRESSED_SCHEDULE_CHARS) {
      console.warn("[loans] single compressed schedule too large, skipping");
      return [];
    }
    const wire = ungzipJson(compressed);
    return wireToRows(wire.length > maxWire ? wire.slice(0, maxWire) : wire);
  }
  if (encoding === LOAN_ROWS_ENCODING_GZIP_CHUNKED && chunkPayloads?.length) {
    const wire: LoanScheduleRowWire[] = [];
    for (const chunk of chunkPayloads) {
      const parsed = ungzipJson(chunk);
      for (const row of parsed) {
        wire.push(row);
        if (wire.length >= maxWire) break;
      }
      if (wire.length >= maxWire) break;
    }
    return wireToRows(wire);
  }
  return [];
}

/** Drop excess parsed rows before they reach React state. */
export function capDecodedScheduleRows(rows: LoanScheduleRow[]): LoanScheduleRow[] {
  return rows.length > MAX_SCHEDULE_ROWS_DECODE
    ? rows.slice(0, MAX_SCHEDULE_ROWS_DECODE)
    : rows;
}

/** Decode chunked schedules one chunk at a time so the main thread can breathe. */
export async function decodeLoanScheduleChunksAsync(
  chunkPayloads: string[],
): Promise<LoanScheduleRow[]> {
  const maxWire = MAX_SCHEDULE_ROWS_DECODE;
  const wire: LoanScheduleRowWire[] = [];
  for (const chunk of chunkPayloads) {
    if (wire.length >= maxWire) break;
    const parsed = ungzipJson(chunk);
    for (const row of parsed) {
      wire.push(row);
      if (wire.length >= maxWire) break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return wireToRows(wire);
}

