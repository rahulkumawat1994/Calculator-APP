export function todayStr(): string {
  const n = new Date();
  return `${String(n.getDate()).padStart(2, "0")}/${String(
    n.getMonth() + 1,
  ).padStart(2, "0")}/${n.getFullYear()}`;
}

export function parseDate(str: string): Date {
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDate(str: string, delta: number): string {
  const d = parseDate(str);
  d.setDate(d.getDate() + delta);
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

export function displayDate(str: string): string {
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  if (str === today) return "Today";
  if (str === yesterday) return "Yesterday";
  return parseDate(str).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function compareDates(a: string, b: string): number {
  return parseDate(a).getTime() - parseDate(b).getTime();
}

export function makeDateStr(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(
    2,
    "0",
  )}/${year}`;
}

export function buildCalendarCells(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const cells: (number | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
