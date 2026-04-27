const LOCALE = "en-IN" as const;
/** Prevents the year or am/pm wrapping to their own line in narrow cells. */
const NBSP = "\u00A0";

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** e.g. `27 Apr 2026` (day, short month, year) — non-breaking spaces between parts. */
function formatStackedDateLine(d: Date): string {
  return `${d.getDate()}${NBSP}${SHORT_MONTHS[d.getMonth()]}${NBSP}${d.getFullYear()}`;
}

/** e.g. `06:17:26 pm` — `am`/`pm` glued to the clock with a non-breaking space. */
function formatStackedTimeLine(d: Date): string {
  let h24 = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const hh = String(h12).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}${NBSP}${ampm}`;
}

/**
 * Date/time string used in audit and admin UIs (India locale, 12h clock).
 */
export function formatAuditTimestamp(ts?: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString(LOCALE, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return String(ts);
  }
}

export type AuditDateTimeParts = { date: string; time: string };

/**
 * Stacked admin display, e.g.:
 *   27 Apr 2026
 *   06:17:26 pm
 */
export function formatAuditDateTimeParts(ts?: number): AuditDateTimeParts {
  if (!ts) return { date: "-", time: "" };
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: "-", time: "" };
    return {
      date: formatStackedDateLine(d),
      time: formatStackedTimeLine(d),
    };
  } catch {
    return { date: String(ts), time: "" };
  }
}
