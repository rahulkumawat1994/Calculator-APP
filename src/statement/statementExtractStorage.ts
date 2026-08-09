import { gzip, ungzip } from "pako";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";

export const STATEMENT_ROWS_ENCODING_GZIP = "gzip-base64-v1";
export const STATEMENT_ROWS_ENCODING_GZIP_CHUNKED = "gzip-base64-chunked-v1";

/** Stay under Firestore's 1 MiB document limit (metadata + padding). */
export const MAX_SINGLE_COMPRESSED_DOC_CHARS = 900_000;
export const STATEMENT_ROWS_PER_CHUNK = 400;

export type StatementRowWire = {
  page: number;
  txnDate: string;
  transaction: string;
  withdrawals: string;
  deposits: string;
};

export function rowsToWire(rows: StatementWdDpRow[]): StatementRowWire[] {
  return rows.map((r) => ({
    page: r.page,
    txnDate: r.txnDate,
    transaction: r.transaction,
    withdrawals: r.withdrawals,
    deposits: r.deposits,
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

function gzipJson(wire: StatementRowWire[]): string {
  const json = JSON.stringify(wire);
  return bytesToBase64(gzip(new TextEncoder().encode(json)));
}

function ungzipJson(base64: string): StatementRowWire[] {
  const bytes = ungzip(base64ToBytes(base64));
  const raw = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as StatementRowWire[];
}

export type EncodedStatementRows = {
  encoding: string;
  rowCount: number;
  compressed?: string;
  chunks?: string[];
};

/** Compress rows for Firestore; chunk when a single gzip blob would exceed doc size. */
export function encodeStatementRowsForFirestore(rows: StatementWdDpRow[]): EncodedStatementRows {
  const wire = rowsToWire(rows);
  const compressed = gzipJson(wire);
  if (compressed.length <= MAX_SINGLE_COMPRESSED_DOC_CHARS) {
    return {
      encoding: STATEMENT_ROWS_ENCODING_GZIP,
      rowCount: rows.length,
      compressed,
    };
  }

  const chunks: string[] = [];
  for (let i = 0; i < wire.length; i += STATEMENT_ROWS_PER_CHUNK) {
    chunks.push(gzipJson(wire.slice(i, i + STATEMENT_ROWS_PER_CHUNK)));
  }
  return {
    encoding: STATEMENT_ROWS_ENCODING_GZIP_CHUNKED,
    rowCount: rows.length,
    chunks,
  };
}

export function wireToRows(wire: StatementRowWire[]): StatementWdDpRow[] {
  return wire.map((r) => ({
    page: r.page,
    txnDate: r.txnDate,
    transaction: r.transaction,
    withdrawals: r.withdrawals,
    deposits: r.deposits,
  }));
}

export function coerceStatementRowFromWire(raw: unknown): StatementWdDpRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const page = typeof o.page === "number" ? o.page : Number(o.page);
  return {
    page: Number.isFinite(page) ? page : 0,
    txnDate: typeof o.txnDate === "string" ? o.txnDate : "",
    transaction: typeof o.transaction === "string" ? o.transaction : "",
    withdrawals: typeof o.withdrawals === "string" ? o.withdrawals : "",
    deposits: typeof o.deposits === "string" ? o.deposits : "",
  };
}

/** Decode rows from Firestore fields (compressed, chunked, or legacy plain array). */
export function decodeStatementRowsFromFirestore(
  encoding: string | undefined,
  rowsCompressed: string | undefined,
  chunkPayloads: string[] | undefined,
  legacyRows: unknown[] | undefined,
): StatementWdDpRow[] {
  if (encoding === STATEMENT_ROWS_ENCODING_GZIP && rowsCompressed) {
    return wireToRows(ungzipJson(rowsCompressed));
  }
  if (encoding === STATEMENT_ROWS_ENCODING_GZIP_CHUNKED && chunkPayloads?.length) {
    const wire: StatementRowWire[] = [];
    for (const chunk of chunkPayloads) {
      wire.push(...ungzipJson(chunk));
    }
    return wireToRows(wire);
  }
  if (legacyRows?.length) {
    return legacyRows
      .map(coerceStatementRowFromWire)
      .filter((r): r is StatementWdDpRow => r != null);
  }
  return [];
}
