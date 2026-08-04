/**
 * `YYYY-MM-DD` in the browser's local calendar (for date filters on `createdAt`).
 * Timestamps before 06:00 AM local time are attributed to the **previous** calendar date
 * (overnight game sessions — e.g. Disawar 3 AM — belong to the prior game day).
 * Duplicated in Admin/Audit only where needed for display; this module owns range filtering.
 */
export function localGameDayKeyFromTimestamp(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  // Treat anything before 06:00 AM as the previous game day.
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
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
    const k = localGameDayKeyFromTimestamp(r.createdAt);
    if (!k) return false;
    return k >= lo && k <= hi;
  });
}

/** Case-insensitive substring match on stored pasted `input`. Empty query = no filter. */
export function filterRowsByInputSearch<T extends { input?: string }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.input ?? "").toLowerCase().includes(q));
}

/** Optionally exclude manual or WhatsApp rows. Both false = no filter. */
export function filterRowsByAuditMode<T extends { mode: "manual" | "wa" }>(
  rows: T[],
  options: { hideManual?: boolean; hideWhatsApp?: boolean },
): T[] {
  const { hideManual = false, hideWhatsApp = false } = options;
  if (!hideManual && !hideWhatsApp) return rows;
  return rows.filter((r) => {
    if (hideManual && r.mode === "manual") return false;
    if (hideWhatsApp && r.mode === "wa") return false;
    return true;
  });
}

/** Filter by game-day month (`YYYY-MM`). Empty = no filter. */
export function filterRowsByGameMonth<T extends { createdAt: number }>(
  rows: T[],
  monthKey: string,
): T[] {
  const m = monthKey.trim();
  if (!m) return rows;
  return rows.filter((r) =>
    localGameDayKeyFromTimestamp(r.createdAt).startsWith(`${m}-`),
  );
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
