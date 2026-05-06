import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";

export function canonicalRowsForFingerprint(rows: StatementWdDpRow[]): StatementWdDpRow[] {
  return rows.map((r) => ({
    page: r.page,
    txnDate: r.txnDate,
    transaction: r.transaction,
    withdrawals: r.withdrawals,
    deposits: r.deposits,
  }));
}

function normalizeFileNameForFingerprint(fileName: string): string {
  const trimmed = fileName.trim().replace(/\\/g, "/");
  const base = trimmed.split("/").pop() ?? trimmed;
  return base.toLowerCase();
}

async function sha256HexUtf8(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== "function") {
    throw new Error("SHA-256 is not available (needs Web Crypto in this environment).");
  }
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable id for deduplicating uploads: same logical file name (case-insensitive basename) + same
 * extracted rows (in order) → same fingerprint.
 */
export async function fingerprintStatementExtract(
  fileName: string,
  rows: StatementWdDpRow[],
): Promise<string> {
  const payload = JSON.stringify({
    name: normalizeFileNameForFingerprint(fileName),
    rows: canonicalRowsForFingerprint(rows),
  });
  return sha256HexUtf8(payload);
}
