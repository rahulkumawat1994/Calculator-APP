// ─── Pasted text cleanup (typos, WhatsApp) — used by `processLine` and `calculateTotal` ─

export function preprocessText(text: string): string {
  return text.replace(/\[[^\]]*\]\s*[^:]+:\s*/g, "\n").trim();
}

/**
 * Best-effort cleanup for common typos / alternate keyboards before parsing.
 * Does not guess missing numbers; only normalizes separators and invisible chars.
 */
export function normalizeTypoTolerantInput(s: string): string {
  let t = s.normalize("NFKC");
  // Multiplication sign from WhatsApp/keyboards -> ASCII x for rate parsing.
  t = t.replace(/×/g, "x");
  // "Rs" / "rs" (rupees) as rate, common in market lines: "55 rs10", "20.02.rs5"
  t = t.replace(/(?<![A-Za-z])rs\s*(\d{1,5})/gi, "x$1");
  // Fancy spaces → ASCII space
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  // Zero-width / BOM
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Fullwidth ASCII digits → ASCII
  t = t.replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  // "NN/rate" with a slash (WhatsApp pastes: 43/10, 07/20) — must run *before* slash→space below
  // so the rate is not split into a loose "NN DD" line. Whitelist the denominator to typical stakes
  // and avoid mistaking calendar fragments like 12/04 (→ would match rate 4 if we only used \d+).
  t = t.replace(
    /\b(\d{2})\/(5|10|15|20|25|30|40|50|100)\b/g,
    "$1x$2",
  );
  // Between digits: `;` `|` `/` `\` or tabs often used instead of space (keep `,` for comma-rate lines)
  t = t.replace(/(?<=\d)[\t]*[;|/\\]+[\t]*(?=\d)/g, " ");
  // Same-digit run (3+ identical digits) then AB / A / B then rate, with no x/=/*
  // (common paste: "000B100", "000A100", "000AB100"). Rewrites so SEP_RATE_RE applies;
  // suffix letter is preserved for solidRunAbMultiplier (A/B = 1×, AB = 2×).
  t = t.replace(/\b((\d)\2{2,})\s*(AB|A|B)\s*(\d+)\b/gi, (_, run, _d, mark, rate) => `${run}x${rate}${mark}`);
  // Some users type A/B marker letters directly before rate marker:
  //   222bbb=50  /  999abx10
  // Insert a separator so rate parsing still recognizes =/x/* markers.
  t = t.replace(/(?<=\d)\s*([ab]+)\s*(?=(?:x|=+|\*)\s*\d)/gi, " $1 ");
  // Middle dot · between digits
  t = t.replace(/(?<=\d)\s*\u00B7\s*(?=\d)/g, " ");
  // Collapse runs of spaces
  t = t.replace(/ +/g, " ").trim();
  return t;
}

/** `20 37 28 39 - 28` → `20 37 28 39 x28` (space + dash + space + rate at end only). */
export function normalizeTrailingDashRate(s: string): string {
  return s.replace(/\s+[-–—]\s+(\d+)\s*$/g, " x$1");
}

/** Levenshtein distance — small strings only (typo detection for "into"). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Letter run before trailing rate digits is meant as "into" (×rate) but mis-typed
 * (e.g. ilto, olto, iltu, nlto). Covers many combinations via edit distance, not a fixed list.
 */
function looksLikeIntoTypo(letters: string): boolean {
  const t = letters.toLowerCase();
  // "into" is 4 chars; shorter runs (e.g. "int") are too ambiguous vs real words
  if (t.length < 4 || t.length > 9) return false;
  // Do not treat known bet flags as "into"
  if (/^(wp|ab|palat|palatel)$/i.test(t)) return false;
  const targets = ["into", "intu"];
  return targets.some((target) => levenshtein(t, target) <= 2);
}

/**
 * Hindi-style "into" (often written "in to") means ×rate. Tolerate common phone typos
 * ("intu", "ijto", "ilto", "olto", …) via explicit patterns + fuzzy end-of-line match.
 * Require a digit immediately before the letter run so we don't rewrite e.g. "in town 10".
 */
export function normalizeIntoRateMarker(s: string): string {
  let out = s
    .replace(/\s*ij\s*to(?=\s*\d)/gi, "x")
    .replace(/\s*in\s*t[ou](?=\s*\d)/gi, "x");
  // After a digit: [letters typo "into"] [rate] at end of string → xrate
  out = out.replace(
    /(?<=\d)([a-zA-Z]{2,})\s*(\d{1,5})\s*$/gi,
    (full, letters: string, rate: string) => (looksLikeIntoTypo(letters) ? `x${rate}` : full),
  );
  return out;
}
