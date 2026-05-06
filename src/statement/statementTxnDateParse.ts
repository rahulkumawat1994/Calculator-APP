/**
 * Parse "Txn date" strings from bank PDF text (often DD/MM/YYYY for India).
 * Returns a local calendar date at 00:00:00, or null if unknown.
 */
export function parseStatementTxnDate(raw: string): Date | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;

  const ymd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const mo = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    if (![y, mo, d].every((n) => Number.isFinite(n))) return null;
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]) - 1;
    let y = Number(dmy[3]);
    if (![d, mo, y].every((n) => Number.isFinite(n))) return null;
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    if (Number.isNaN(dt.getTime())) return null;
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  return null;
}
