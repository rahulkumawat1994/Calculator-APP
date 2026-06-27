// ─── Pasted text cleanup (typos, WhatsApp) — used by `processLine` and `calculateTotal` ─

/**
 * Trailing Hindi/English market tags on a bet line (`…=10 गली दिसावर`, `77.30 दिसावर`).
 * Not part of the stake; strip so digits can inherit the previous line's rate.
 */
const TRAILING_MARKET_SUFFIX_LABELS = [
  "गली दिसावर",
  "गली",
  "दिसावर",
  "गाजियाबाद",
  "फरीदाबाद",
  "दिल्ली बजार",
  "दिल्ली",
  "श्री गणेश",
  "disawar",
  "disawer",
  "desawr",
  "gali",
  "ghaziabad",
  "faridabad",
  "delhi bazaar",
  "delhi",
] as const;

export function stripTrailingMarketSuffix(s: string): string {
  let t = s.replace(/[\u200B-\u200D\uFEFF]/g, "").normalize("NFKC").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of TRAILING_MARKET_SUFFIX_LABELS) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:\\s+|(?<=\\d))${escaped}\\s*$`, "iu");
      if (re.test(t)) {
        t = t.replace(re, "").trim();
        changed = true;
        break;
      }
    }
  }
  return t;
}

export function preprocessText(text: string): string {
  let t = text.replace(/^\uFEFF/, "").normalize("NFKC");
  // WhatsApp / iOS sometimes inserts bidi marks around names or colons.
  t = t.replace(/[\u200E\u200F\u202A-\u202E]/g, "");
  // Bracketed header: allow ASCII `:` or fullwidth `：` after contact (mobile keyboards).
  t = t.replace(/\[[^\]]*\]\s*[^:\n\uFF1A]+\s*[\uFF1A:]\s*/g, "\n");
  return t.trim();
}

/** `(75(wp` / `(35(` / `(75) wp` / `(rate` at EOL → `(rate)flag` so merge logic sees an explicit rate. */
export function normalizeParenRateTypos(s: string): string {
  return s
    .replace(/\(\s*(\d+)\s*[\/\\|.]\s*([a-zA-Z]*)\s*\)?/g, "($1)$2")
    .replace(/\(\s*(\d+)\s+([a-zA-Z]+)\s*\)?/g, "($1)$2")
    .replace(/\(\s*(\d+)\s*\(\s*([a-zA-Z]+)/g, "($1)$2")
    // `(35(` — opening paren where closing `)` was meant (common WhatsApp typo)
    .replace(/\(\s*(\d+)\s*\(\s*$/g, "($1)")
    .replace(/\(\s*(\d+)([a-zA-Z]+)\s*\)?/g, "($1)$2")
    .replace(/\(\s*(\d+)\s*\)/g, "($1)")
    .replace(/\(\s*(\d+)\s*$/g, "($1)");
}

/** `45..54` — palat-style reverse pair; stays two jodis, not jodi×rate. */
export function isReverseJodiPairDigits(a: string, b: string): boolean {
  if (a.length !== 2 || b.length !== 2) return false;
  return b === a[1]! + a[0]!;
}

/** `46..45` / `20..20` — one jodi, then `..`, then rate. `45..54` stays two jodis (reverse pair). */
export function normalizeDoubleDotJodiRate(s: string): string {
  const t = s.trim();
  const m = /^(\d{1,3})\.\.(\d{1,4})$/.exec(t);
  if (!m) return s;
  const a = m[1]!;
  const b = m[2]!;
  if (isReverseJodiPairDigits(a, b)) return s;
  if (a === b) return `${a}x${b}`;
  return `${a}x${b}`;
}

/**
 * WhatsApp-style plus-chain rate: `75+57//5` means 2 entries at rate 5.
 * Must run before slash→space and `NN/stake` rewrites in
 * {@link normalizeTypoTolerantInput}, otherwise `//` and `/` are mangled.
 */
export function tryParseArithmeticSumDivide(
  s: string,
): { count: number; rate: number; lineTotal: number; displayLine: string } | null {
  const displayLine = s.replace(/\s+/g, " ").trim();
  const compact = displayLine.replace(/\s+/g, "");
  if (!/\+/.test(compact) || /[^0-9+/]/.test(compact)) return null;
  let expr: string;
  let rate: number;
  if (compact.includes("//")) {
    const i = compact.lastIndexOf("//");
    expr = compact.slice(0, i);
    rate = parseInt(compact.slice(i + 2), 10);
  } else {
    const i = compact.lastIndexOf("/");
    expr = compact.slice(0, i);
    rate = parseInt(compact.slice(i + 1), 10);
  }
  if (!(rate > 0) || !/^[\d+]+$/.test(expr)) return null;
  const parts = expr.split("+");
  if (parts.length < 2 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const count = parts.length;
  const lineTotal = count * rate;
  if (!Number.isFinite(lineTotal) || lineTotal < 0) return null;
  return { count, rate, lineTotal, displayLine };
}

/** Typical stakes after `*` — keep `78*20` as jodi×rate; do not treat `20` as a second jodi. */
const STAR_RATE_STAKES = new Set([5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 120]);

/**
 * WhatsApp bold/markup around jodis: `59*_54*`, `85*35(75)wp`, `78*73*`, `*09 04(50)`, `07*(50)`.
 * `*` before a digit is kept as a rate marker (`*20`) when the digits are a stake, not a jodi;
 * decorative `*` / `_` between two-digit tokens is collapsed.
 */
function normalizeWhatsAppBoldJodiMarkup(t: string): string {
  let s = t.replace(/^\s*\*+(?=\d)/, "");
  let prev = "";
  while (s !== prev) {
    prev = s;
    // `78*73*` / `43*93*(75)wp` — star is bold between jodis even when `*` is followed by a digit.
    s = s.replace(/(\d{2})\*+(\d{2})(?=[\s*_,.\-]|$|\(|\.\d|\d{2})/g, (full, a, b, offset, str) => {
      const tail = str.slice(offset + full.length);
      const stake = parseInt(b, 10);
      if (
        STAR_RATE_STAKES.has(stake) &&
        (/^\s*$/.test(tail) || /^\s*(?:wp|w\.?\s*p|w\s+p|ab|palat(?:e|el)?)\b/i.test(tail))
      ) {
        return full;
      }
      return `${a} ${b}`;
    });
    s = s.replace(/(\d{2})(?:\s*\*+(?!\d)\s*|\s*_+\s*)+(\d{2})(?!\d)/g, "$1 $2");
  }
  s = s.replace(/(?<=\d)\s*\*+(?=\s*\()/g, "");
  s = s.replace(/(?<=\d)\s*\*+\s*$/g, "");
  return s.replace(/ +/g, " ").trim();
}

/**
 * Best-effort cleanup for common typos / alternate keyboards before parsing.
 * Does not guess missing numbers; only normalizes separators and invisible chars.
 */
export function normalizeTypoTolerantInput(s: string): string {
  let t = s.normalize("NFKC");
  // User annotation: trailing "total NNN" or "totalNNN" (running cumulative note, not a bet field).
  t = t.replace(/\s*total\s*\d+\s*$/i, "");
  // Stray dot between rate marker and its digits (`x.30`→`x30`, `==.10`→`==10`, `*.5`→`*5`).
  t = t.replace(/([xX×]|={1,}|\*)\.+(\d)/g, "$1$2");
  // WhatsApp / OCR: stray colon after a dash in jodi runs (`32-:23` → `32-23`).
  t = t.replace(/-\s*:\s*(?=\d)/g, "-");
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
  t = normalizeWhatsAppBoldJodiMarkup(t);
  // Sum-then-divide lines: keep `+` and `/` intact for `processLine` (see tryParseArithmeticSumDivide).
  if (tryParseArithmeticSumDivide(t) != null) {
    return t.replace(/ +/g, " ").trim();
  }
  // "NN/rate" with a slash (WhatsApp pastes: 43/10, 07/20, 27/120) — must run *before* slash→space below
  // so the rate is not split into a loose "NN DD" line. Whitelist the denominator to typical stakes
  // and avoid mistaking calendar fragments like 12/04 (→ would match rate 4 if we only used \d+).
  t = t.replace(
    /\b(\d{2})\/(5|10|15|20|25|30|40|50|100|120)\b/g,
    "$1x$2",
  );
  // Same whitelist as NN/stake above — avoids rewriting second jodis like `75-57intu10` (57 is not a stake).
  // After {@link normalizeIntoRateMarker}, chains like `05-50into5` become `05-50 x5`; `\b` appears after `50`
  // before the space. Second pass through this function (from `processLine`) must not rewrite that to `05x50`.
  // `(?!\s+x\s*\d)` skips when the stake is immediately followed by the ×rate from an into-split.
  // `(?!-\d{2})` skips when another jodi follows (`01-10-28-…` is three pairs, not `01` at rate `10`).
  // `(?!-\s*$)` skips incomplete dash rows waiting for a continuation line (`05-50-`).
  // `(?!-\s)` skips when another jodi chunk follows after the hyphen (`05-50- 77-…`).
  t = t.replace(
    /\b(\d{2})-(5|10|15|20|25|30|40|50|100|120)\b(?!\s+x\s*\d)(?!-\d{2})(?!-\s*$)(?!-\s)/g,
    "$1x$2",
  );
  // Single-digit stake after "-" (e.g. `27-5` same as `27=5` / `27x5`); run after whitelist so `27-10` stays one token.
  t = t.replace(/\b(\d{2})-([1-9])\b(?!\s+x\s*\d)(?!-\s*$)(?!-\s)/g, "$1x$2");
  // 3+-digit number (solid run / triple) + dash + rate: `100-30` → `100x30`, `000-10` → `000x10`.
  // Prevents multi-line merge stealing the rate from the next line.
  t = t.replace(/\b(\d{3,})-(\d{1,3})\b(?!-\d)/g, "$1x$2");
  // Two-digit jodi + "." + single-digit rate (same meaning as 40x5 / 40=5; avoids breaking NN.MM dates with two-digit months)
  t = t.replace(/\b(\d{2})\.([1-9])\b/g, "$1x$2");
  // Between digits: `;` `|` `/` `\` or tabs often used instead of space (keep `,` for comma-rate lines)
  t = t.replace(/(?<=\d)[\t]*[;|/\\]+[\t]*(?=\d)/g, " ");
  // Matka / WhatsApp: `03=87=04=55=43=22=====5` — single `=` between jodis, multi-`=` before stake.
  // **Only** rewrite when the line has a multi-equals rate (`===`, `====`, …); otherwise
  // `60.06=10` or `41=30` must stay as NN×rate (do not treat `06=10` as two jodis).
  if (/={3,}\s*\d/.test(t)) {
    let prevJodiEq = "";
    while (t !== prevJodiEq) {
      prevJodiEq = t;
      t = t.replace(/\b(\d{2})\s*=\s*(\d{2})\b/g, "$1 $2");
    }
  }
  // `19=91=28into 5` → `19=91=28 x5` — single `=` jodi chain before into ×rate (not `41=30`).
  t = t.replace(/^((?:\d{2}=)+\d{2})\s+x\s*(\d+)\s*$/i, (_, chain, rate) =>
    `${chain.split("=").join(" ")} x${rate}`,
  );
  // Same-digit run (3+ identical digits) then AB / A / B then rate, with no x/=/*
  // (common paste: "000B100", "000A100", "000AB100"). Rewrites so SEP_RATE_RE applies;
  // suffix letter is preserved for solidRunAbMultiplier (A/B = 1×, AB = 2×).
  t = t.replace(/\b((\d)\2{2,})\s*(AB|A|B)\s*(\d+)\b/gi, (_, run, _d, mark, rate) => `${run}x${rate}${mark}`);
  // Same shape with "=" before the lane letter (WhatsApp: "111=A100", "999=B100")
  t = t.replace(/\b((\d)\2{2,})\s*=\s*(AB|A|B)\s*(\d+)\b/gi, (_, run, _d, mark, rate) => `${run}x${rate}${mark}`);
  // Some users type A/B marker letters directly before rate marker:
  //   222bbb=50  /  999abx10
  // Insert a separator so rate parsing still recognizes =/x/* markers.
  t = t.replace(/(?<=\d)\s*([ab]+)\s*(?=(?:x|=+|\*)\s*\d)/gi, " $1 ");
  // "AB/15" or "ab/ 15" — slash between betting flag and rate (e.g. "HRF 9999 ab/ 15") → remove slash
  t = t.replace(/\b(AB|A|B)\s*\/\s*(\d)/gi, '$1 $2');
  // "harufx20" / "harfx20" / "hrfx20" — x rate glued to the keyword → insert space so SEP_RATE_RE can see it
  t = t.replace(/\b(haruf|harf|hrf)(x)(\d)/gi, '$1 x$3');
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
  if (/^(wp|ab|palat|palatel|palt|palti)$/i.test(t)) return false;
  const targets = ["into", "intu"];
  return targets.some((target) => levenshtein(t, target) <= 2);
}

/** Whole trimmed line is only an into-typo marker + rate (e.g. `Into5`, `inyo5`). */
export function parseStandaloneIntoTypoRateDigits(line: string): string | null {
  const t = line.trim();
  const plain = /^\s*(?:into|ijto)\s*(\d{1,5})\s*$/i.exec(t);
  if (plain) return plain[1]!;
  const dotInto = /^\s*(\d{1,5})\.\s*(?:into|ijto|intu)\s*$/i.exec(t);
  if (dotInto) return dotInto[1]!;
  const m = /^\s*([a-zA-Z]{2,})\s*(\d{1,5})\s*$/i.exec(t);
  if (m && looksLikeIntoTypo(m[1]!)) return m[2]!;
  return null;
}

/**
 * Hindi-style "into" (often written "in to") means ×rate. Tolerate common phone typos
 * ("intu", "ijto", "ilto", "olto", …) via explicit patterns + fuzzy end-of-line match.
 * Require a digit immediately before the letter run so we don't rewrite e.g. "in town 10".
 */
export function normalizeIntoRateMarker(s: string): string {
  let out = s
    // Dot-separated jodi run + "with palt(i) N into" (WhatsApp: `37.48.50.41.36.27.with palt 5intu`).
    .replace(
      /(\d{2}(?:\.\d{2})+)\.\s*(?:with\s+)?(?:palt(?:i)?|palat(?:e|el)?)\s*(\d{1,5})(?:\s*(?:into|ijto|intu|in\s*t[ou])|(?:into|ijto|intu|in\s*t[ou]))?\s*$/i,
      "$1.=$2",
    )
    // Same shape with space before "with" (no trailing dot after last jodi).
    .replace(
      /(\d{2}(?:\.\d{2})+)\s+(?:with\s+)?(?:palt(?:i)?|palat(?:e|el)?)\s*(\d{1,5})(?:\s*(?:into|ijto|intu|in\s*t[ou])|(?:into|ijto|intu|in\s*t[ou]))?\s*$/i,
      "$1.=$2",
    )
    // `…42-into5` / `05-50-into15` / `77-59-95-inyo10` — hyphen before into (or typo);
    // emit spaced ` xN` so later NN-stake rules do not treat `05-50` as jodi×50.
    .replace(
      /[-–—]+\s*([a-zA-Z]{2,})\s*(\d{1,5})\s*$/gi,
      (full, letters: string, rate: string) =>
        /^(?:into|ijto)$/i.test(letters) || looksLikeIntoTypo(letters)
          ? ` x${rate}`
          : full,
    )
    // Must follow a digit — otherwise a standalone `Into5` line (continuation on next row) becomes orphan `x5`.
    .replace(/(?<=\d)\s*ij\s*to(?=\s*\d)/gi, " x")
    .replace(/(?<=\d)\s*in\s*t[ou](?=\s*\d)/gi, " x");
  // After a digit (optional dot/hyphen glue): [letters typo "into"] [rate] at end → xrate.
  // Allow `.` as separator so `83.29.entu20` and `75.into5` are handled (dot-separated format).
  out = out.replace(
    /(?<=\d)[.\-–—]*([a-zA-Z]{2,})\s*(\d{1,5})\s*$/gi,
    (full, letters: string, rate: string) => (looksLikeIntoTypo(letters) ? ` x${rate}` : full),
  );
  // Standalone "10.intu" / "10 into" lines where the rate number PRECEDES "into" (no rate after).
  // Converts the whole line to a rate-only token so pending pairs can inherit it.
  out = out
    .replace(/^(\d{1,5})\.\s*(?:into|ijto|intu)\s*$/i, "x$1")
    .replace(/^(\d{1,5})\.?\s*(?:in\s*t[ou])\s*$/i, "x$1");
  return out;
}
