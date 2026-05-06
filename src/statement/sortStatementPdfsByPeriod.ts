/** How to order statement PDFs and saved Firebase extracts in the list (by filename period vs list order). */
export type StatementPdfSortMode = "upload" | "period-asc" | "period-desc";

function displayNameForSort(d: { name?: string; fileName?: string }): string {
  const n = d.name ?? d.fileName;
  return typeof n === "string" ? n : "";
}

/** Parsed month/year (+ optional day) from text — used for PDF filename period detection. */
export type MonthYearKey = { y: number; m: number; d: number | null };

const MONTH_WORD: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function expandTwoDigitYear(yy: number): number {
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

function validYmd(y: number, mo: number, d: number): boolean {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Extract month/year (and optional day) from a short text fragment (e.g. filename slice).
 */
export function parseMonthYearFromText(text: string): MonthYearKey | null {
  const u = text.replace(/\s+/g, " ").trim();
  if (!u) return null;

  let m: RegExpExecArray | null;

  m = /\b(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})\b/i.exec(u);
  if (m) {
    const d = parseInt(m[1]!, 10);
    const mo = MONTH_WORD[m[2]!.toLowerCase()];
    const y = parseInt(m[3]!, 10);
    if (mo != null && y >= 1900 && y <= 2100 && d >= 1 && d <= 31) return { y, m: mo, d };
  }

  m = /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/.exec(u);
  if (m) {
    const y = parseInt(m[1]!, 10);
    const mo = parseInt(m[2]!, 10);
    const d = parseInt(m[3]!, 10);
    if (validYmd(y, mo, d)) return { y, m: mo, d };
  }

  m = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/.exec(u);
  if (m) {
    const d = parseInt(m[1]!, 10);
    const mo = parseInt(m[2]!, 10);
    const y = parseInt(m[3]!, 10);
    if (validYmd(y, mo, d)) return { y, m: mo, d };
  }

  m = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2})\b(?!\d)/.exec(u);
  if (m) {
    const d = parseInt(m[1]!, 10);
    const mo = parseInt(m[2]!, 10);
    const y = expandTwoDigitYear(parseInt(m[3]!, 10));
    if (validYmd(y, mo, d)) return { y, m: mo, d };
  }

  m = /\b(\d{1,2})[./-](\d{4})\s*$/i.exec(u);
  if (m) {
    const mo = parseInt(m[1]!, 10);
    const y = parseInt(m[2]!, 10);
    if (mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) return { y, m: mo, d: null };
  }

  m = /\b(\d{4})[./-](\d{1,2})\s*$/i.exec(u);
  if (m) {
    const y = parseInt(m[1]!, 10);
    const mo = parseInt(m[2]!, 10);
    if (mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) return { y, m: mo, d: null };
  }

  m = /\b([a-z]{3,9})\s*[,./-]?\s*(\d{4})\b/i.exec(u);
  if (m) {
    const mo = MONTH_WORD[m[1]!.toLowerCase()];
    const y = parseInt(m[2]!, 10);
    if (mo != null && y >= 1900 && y <= 2100) return { y, m: mo, d: null };
  }

  return null;
}

/**
 * Best-effort: first month/year found in the PDF file name (e.g. range start
 * `01-04-2025 to 30-04-2025.pdf`, `1 jan 2025`, `march 2026`).
 */
export function parseStatementPdfPeriodFromFileName(fileName: string): MonthYearKey | null {
  const base = fileName.replace(/\.pdf$/i, "").trim().replace(/_/g, " ");
  const segments = base.split(/\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
  const candidates = [base, ...segments];
  for (const c of candidates) {
    const k = parseMonthYearFromText(c);
    if (k) return k;
  }
  return null;
}

function comparePeriodKeys(a: MonthYearKey, b: MonthYearKey, mode: "period-asc" | "period-desc"): number {
  const dir = mode === "period-asc" ? 1 : -1;
  if (a.y !== b.y) return dir * (a.y - b.y);
  if (a.m !== b.m) return dir * (a.m - b.m);
  if (a.d != null && b.d != null && a.d !== b.d) return dir * (a.d - b.d);
  return 0;
}

/** Stable sort by period parsed from {@link parseStatementPdfPeriodFromFileName} using `name` or `fileName`; undated names last. */
export function sortStatementPdfsByPeriod<T extends { name?: string; fileName?: string }>(
  docs: T[],
  mode: StatementPdfSortMode,
): T[] {
  if (mode === "upload") return docs;
  const tagged = docs.map((d, i) => ({ d, i }));
  tagged.sort((a, b) => {
    const ka = parseStatementPdfPeriodFromFileName(displayNameForSort(a.d));
    const kb = parseStatementPdfPeriodFromFileName(displayNameForSort(b.d));
    if (ka == null && kb == null) return a.i - b.i;
    if (ka == null) return 1;
    if (kb == null) return -1;
    const c = comparePeriodKeys(ka, kb, mode);
    if (c !== 0) return c;
    return a.i - b.i;
  });
  return tagged.map((x) => x.d);
}
