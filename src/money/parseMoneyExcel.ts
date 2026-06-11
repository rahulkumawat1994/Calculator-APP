import * as XLSX from "xlsx";
import type { MoneyDataset, MoneyTransaction } from "./moneyTypes";

const HEADER_ALIASES: Record<keyof Omit<MoneyTransaction, "id" | "date">, string[]> = {
  account: ["account"],
  dateRaw: ["date"],
  num: ["num", "number", "check #", "check"],
  transaction: ["transaction", "payee", "description"],
  memo: ["memo", "notes"],
  category: ["category", "cat"],
  payment: ["debit", "debits", "payment", "pay", "withdrawal", "withdrawals"],
  deposit: ["credit", "credits", "deposit", "deposits"],
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

function findColumnIndex(
  headers: string[],
  aliases: string[],
): number {
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const partial = headers.findIndex((h) => h.includes(alias));
    if (partial >= 0) return partial;
  }
  return -1;
}

function parseMoneyCell(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const trimmed = String(raw).replace(/\u00a0/g, " ").trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return 0;
  const cleaned = trimmed
    .replace(/,/g, "")
    .replace(/[₹$\s]/g, "")
    .replace(/^rs\.?/i, "")
    .replace(/^\((.+)\)$/, "-$1")
    .trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseExcelDate(raw: unknown): { date: Date | null; dateRaw: string } {
  if (raw == null || raw === "") return { date: null, dateRaw: "" };

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { date: raw, dateRaw: raw.toISOString().slice(0, 10) };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d);
      if (!Number.isNaN(d.getTime())) {
        return { date: d, dateRaw: d.toISOString().slice(0, 10) };
      }
    }
  }

  const s = String(raw).trim();
  if (!s) return { date: null, dateRaw: "" };

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return { date: d, dateRaw: s };
  }

  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const d = new Date(y, Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(d.getTime())) return { date: d, dateRaw: s };
  }

  const mdy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (mdy) {
    let y = Number(mdy[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const d = new Date(y, Number(mdy[1]) - 1, Number(mdy[2]));
    if (!Number.isNaN(d.getTime())) return { date: d, dateRaw: s };
  }

  const fallback = new Date(s);
  if (!Number.isNaN(fallback.getTime())) {
    return { date: fallback, dateRaw: s };
  }

  return { date: null, dateRaw: s };
}

function cellStr(row: unknown[], idx: number): string {
  if (idx < 0) return "";
  const v = row[idx];
  if (v == null) return "";
  return String(v).trim();
}

export type ParseMoneyExcelResult =
  | { ok: true; dataset: MoneyDataset }
  | { ok: false; error: string };

export function parseMoneyExcelBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): ParseMoneyExcelResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    return { ok: false, error: "Could not read this Excel file. Try .xlsx or .xls format." };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { ok: false, error: "The workbook has no sheets." };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (rows.length < 2) {
    return { ok: false, error: "Need a header row plus at least one transaction row." };
  }

  const headerRowIdx = rows.findIndex((row) =>
    row.some((c) => normalizeHeader(c).includes("date") || normalizeHeader(c).includes("transaction")),
  );
  if (headerRowIdx < 0) {
    return { ok: false, error: "Could not find a header row with Date / Transaction columns." };
  }

  const headers = (rows[headerRowIdx] as unknown[]).map(normalizeHeader);
  const col = {
    account: findColumnIndex(headers, HEADER_ALIASES.account),
    date: findColumnIndex(headers, HEADER_ALIASES.dateRaw),
    num: findColumnIndex(headers, HEADER_ALIASES.num),
    transaction: findColumnIndex(headers, HEADER_ALIASES.transaction),
    memo: findColumnIndex(headers, HEADER_ALIASES.memo),
    category: findColumnIndex(headers, HEADER_ALIASES.category),
    payment: findColumnIndex(headers, HEADER_ALIASES.payment),
    deposit: findColumnIndex(headers, HEADER_ALIASES.deposit),
  };

  if (col.date < 0 && col.transaction < 0) {
    return {
      ok: false,
      error: "Missing required columns. Need at least Date or Transaction.",
    };
  }

  const transactions: MoneyTransaction[] = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

    const account = cellStr(row, col.account);
    const transaction = cellStr(row, col.transaction);
    const memo = cellStr(row, col.memo);
    const category = cellStr(row, col.category);
    const payment = parseMoneyCell(col.payment >= 0 ? row[col.payment] : 0);
    const deposit = parseMoneyCell(col.deposit >= 0 ? row[col.deposit] : 0);

    const hasContent =
      account ||
      transaction ||
      memo ||
      category ||
      payment > 0 ||
      deposit > 0;
    if (!hasContent) continue;

    const { date, dateRaw } = parseExcelDate(col.date >= 0 ? row[col.date] : null);

    transactions.push({
      id: `${r}-${dateRaw}-${transaction}-${payment}-${deposit}`,
      account,
      date,
      dateRaw,
      num: cellStr(row, col.num),
      transaction,
      memo,
      category: category || "Uncategorized",
      payment,
      deposit,
    });
  }

  if (transactions.length === 0) {
    return { ok: false, error: "No transaction rows found after the header." };
  }

  transactions.sort((a, b) => {
    const ta = a.date?.getTime() ?? 0;
    const tb = b.date?.getTime() ?? 0;
    return tb - ta;
  });

  return {
    ok: true,
    dataset: {
      meta: {
        fileName,
        uploadedAt: Date.now(),
        rowCount: transactions.length,
      },
      transactions,
    },
  };
}
