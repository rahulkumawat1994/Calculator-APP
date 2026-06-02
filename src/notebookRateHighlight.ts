/** Pick the one rate digit span to highlight in a pasted message line. */
export function findRateHighlightStart(text: string, rate: number): number | null {
  const rateStr = String(rate);
  const rateLen = rateStr.length;

  const eqRe = new RegExp(`=+\\s*${rateStr}(?!\\d)`, "g");
  let eqStart: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(text)) !== null) {
    eqStart = m.index + m[0].length - rateLen;
  }
  if (eqStart != null) return eqStart;

  const parenRe = new RegExp(`\\(${rateStr}(?!\\d)`, "g");
  while ((m = parenRe.exec(text)) !== null) {
    eqStart = m.index + 1;
  }
  if (eqStart != null) return eqStart;

  const xRe = new RegExp(`[xX×]\\s*${rateStr}(?!\\d)`, "g");
  while ((m = xRe.exec(text)) !== null) {
    eqStart = m.index + m[0].length - rateLen;
  }
  if (eqStart != null) return eqStart;

  const intoRe = new RegExp(
    `(?:into|intu|ijto)\\.?\\s*${rateStr}(?!\\d)`,
    "gi"
  );
  while ((m = intoRe.exec(text)) !== null) {
    eqStart = m.index + m[0].length - rateLen;
  }
  if (eqStart != null) return eqStart;

  // Single dot-rate form: `77.30` (optionally with trailing market label).
  // Do not match long dot chains like `80.08.30.03`.
  const dotRateRe = new RegExp(`(?<!\\d)\\d{2}\\.(${rateStr})(?!\\d)`, "g");
  while ((m = dotRateRe.exec(text)) !== null) {
    eqStart = m.index + m[0].length - rateLen;
  }
  if (eqStart != null) return eqStart;

  const standRe = new RegExp(`(?<!\\d)${rateStr}(?!\\d)`, "g");
  const candidates: number[] = [];
  while ((m = standRe.exec(text)) !== null) {
    candidates.push(m.index);
  }
  const valid = candidates.filter((i) => {
    const prev = text[i - 1];
    const next = text[i + rateLen];
    if (prev === "." || next === ".") return false;
    return true;
  });
  if (valid.length > 0) return valid[valid.length - 1]!;
  return null;
}

/**
 * Whether the message column should bold/underline the rate on this pasted line.
 * Handles multi-line bets where the rate is alone on the last row (`FB` / `28` / `10`).
 */
export function shouldBoldRateOnLine(
  line: string,
  rate: number,
  opts?: { isLastSourceLineOfSegment?: boolean },
): boolean {
  if (findRateHighlightStart(line, rate) != null) return true;
  if (!opts?.isLastSourceLineOfSegment) return false;
  const t = line.trim();
  if (!t) return false;
  if (t === String(rate)) return true;
  const m = /^(\d{1,5})$/.exec(t);
  return m != null && parseInt(m[1]!, 10) === rate;
}
