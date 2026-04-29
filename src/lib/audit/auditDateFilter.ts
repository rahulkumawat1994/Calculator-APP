/**
 * `YYYY-MM-DD` in the browser’s local calendar (for date filters on `createdAt`).
 * Duplicated in Admin/Audit only where needed for display; this module owns range filtering.
 */
function localDateKeyFromTimestamp(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive local-date range. Empty `from` and `to` = no filter (keeps all rows). */
export function filterRowsByLocalDateRange<T extends { createdAt: number }>(
  rows: T[],
  from: string,
  to: string
): T[] {
  const f = from.trim();
  const t = to.trim();
  if (!f && !t) return rows;

  let lo: string;
  let hi: string;
  if (f && t) {
    lo = f <= t ? f : t;
    hi = f <= t ? t : f;
  } else if (f) {
    lo = f;
    hi = "9999-12-31";
  } else {
    lo = "0000-01-01";
    hi = t!; // t set
  }

  return rows.filter((r) => {
    const k = localDateKeyFromTimestamp(r.createdAt);
    if (!k) return false;
    return k >= lo && k <= hi;
  });
}

export function totalLabelForDateRange(
  from: string,
  to: string
): "Total (loaded)" | "Day total" | "Period total" {
  const f = from.trim();
  const t = to.trim();
  if (!f && !t) return "Total (loaded)";
  if (f && t && f === t) return "Day total";
  return "Period total";
}

/** Label for one combined `calculateTotal` on filtered audit inputs (same scope as saved total). */
export function freshParsedTotalLabelForDateRange(
  from: string,
  to: string
): "Freshly parsed (loaded)" | "Freshly parsed (day)" | "Freshly parsed (period)" {
  const f = from.trim();
  const t = to.trim();
  if (!f && !t) return "Freshly parsed (loaded)";
  if (f && t && f === t) return "Freshly parsed (day)";
  return "Freshly parsed (period)";
}
