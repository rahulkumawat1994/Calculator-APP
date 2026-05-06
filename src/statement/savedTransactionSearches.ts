const LS_KEY = "statement-saved-txn-searches-v1";
const MAX_SAVED = 25;

export type SavedTransactionSearch = {
  id: string;
  label: string;
  raw: string;
};

export function defaultLabelFromTransactionSearchRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Saved search";
  const line = trimmed.split(/\r?\n/)[0] ?? trimmed;
  const first = line.split(/[,;]/)[0]?.trim() ?? line;
  const t = first.length > 40 ? `${first.slice(0, 37)}…` : first;
  return t || "Saved search";
}

function newSavedSearchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ss-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadSavedTransactionSearches(): SavedTransactionSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: SavedTransactionSearch[] = [];
    for (const x of data) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (
        typeof o.id === "string" &&
        typeof o.label === "string" &&
        typeof o.raw === "string" &&
        o.id.length > 0 &&
        o.raw.length > 0
      ) {
        out.push({ id: o.id, label: o.label || defaultLabelFromTransactionSearchRaw(o.raw), raw: o.raw });
      }
    }
    return out.slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

export function persistSavedTransactionSearches(items: SavedTransactionSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, MAX_SAVED)));
  } catch {
    /* quota / private mode */
  }
}

export type AddSavedTransactionSearchResult =
  | { ok: true; items: SavedTransactionSearch[] }
  | { ok: false; reason: "empty" | "duplicate" };

export function addSavedTransactionSearch(
  items: SavedTransactionSearch[],
  raw: string,
  label: string,
): AddSavedTransactionSearchResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (items.some((s) => s.raw.trim() === trimmed)) return { ok: false, reason: "duplicate" };
  const next: SavedTransactionSearch[] = [
    { id: newSavedSearchId(), label: label.trim() || defaultLabelFromTransactionSearchRaw(trimmed), raw: trimmed },
    ...items.filter((s) => s.raw.trim() !== trimmed),
  ];
  return { ok: true, items: next.slice(0, MAX_SAVED) };
}
