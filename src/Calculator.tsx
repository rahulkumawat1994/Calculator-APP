import { useState } from "react";

interface Segment {
  line: string;
  rate: number;
  isWP: boolean;
  isDouble: boolean;
  count: number;
  lineTotal: number;
}

interface CalculationResult {
  results: Segment[];
  total: number;
}

function reverseNumber(num: number): number {
  return parseInt(
    String(num).padStart(2, "0").split("").reverse().join(""),
    10
  );
}

function normalizePair(num: number): string {
  const reversed = reverseNumber(num);
  return [num, reversed].sort().join("-");
}

function countSegment(allNumbers: number[], isWP: boolean): number {
  if (!isWP) return new Set(allNumbers).size;
  const seenPairs = new Set<string>();
  let count = 0;
  for (const num of allNumbers) {
    const key = normalizePair(num);
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      count += num === reverseNumber(num) ? 1 : 2;
    }
  }
  return count;
}

// For x-format: split every digit block into 2-digit pairs.
// e.g. "8307" → [83, 07], "735909" → [73, 59, 09]
function extractPairedNumbers(text: string): number[] {
  const allNumbers: number[] = [];
  for (const block of text.match(/\d+/g) ?? []) {
    if (block.length === 1) continue;
    if (block.length === 2) {
      allNumbers.push(Number(block));
    } else {
      for (let i = 0; i + 1 < block.length; i += 2) {
        allNumbers.push(Number(block.slice(i, i + 2)));
      }
    }
  }
  return allNumbers;
}

// Each line can have multiple groups, supporting three formats:
//   Paren format:  "23*28 70(150)wp 78--73 56-(50)wp"
//   X format:      "FB.74.83.56x15"  "62.38.8307.70x10"
//   Plain format:  "02,04,07,09,,,40 पलटके साथ"  (last number = rate, any text after = WP)
// Suffix "ab/AB/a/b" after the rate in any format → count × 2
function processLine(line: string): Segment[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const results: Segment[] = [];

  // --- Paren format: numbers(rate)[suffix] ---
  // Suffix letters: "wp" → WP mode, "a"/"b"/"ab" → double the count
  const parenPattern = /([^()]*)\((\d+)\)\s*([a-zA-Z]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = parenPattern.exec(trimmed)) !== null) {
    const numbersPart = match[1];
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix);
    const isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const allNumbers = (numbersPart.match(/(?<!\d)\d{2}(?!\d)/g) ?? []).map(
      Number
    );
    if (allNumbers.length === 0) continue;
    const count = countSegment(allNumbers, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const displayText = numbersPart
        .replace(/^[\s*\-_.,:|]+|[\s*\-_.,:|]+$/g, '')
        .trim();
      results.push({
        line: displayText || numbersPart.trim(),
        rate,
        isWP,
        isDouble,
        count,
        lineTotal: count * rate,
      });
    }
  }
  if (results.length > 0) return results;

  // --- X format: [prefix?][numbers]x[rate][suffix] ---
  // Handles concatenated digit blocks like 8307 → 83,07 and labels like "FB."
  const xPattern = /([^x]*)x(\d+)\s*([a-zA-Z]*)/gi;

  while ((match = xPattern.exec(trimmed)) !== null) {
    const numbersPart = match[1];
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix);
    const isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const allNumbers = extractPairedNumbers(numbersPart);
    if (allNumbers.length === 0) continue;
    const count = countSegment(allNumbers, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const displayText = numbersPart
        .replace(/^\D+/, '')
        .replace(/\D+$/, '')
        .trim();
      results.push({
        line: displayText || numbersPart.trim(),
        rate,
        isWP,
        isDouble,
        count,
        lineTotal: count * rate,
      });
    }
  }
  if (results.length > 0) return results;

  // --- Equals format: [numbers]=[rate][suffix] ---
  // e.g. "32.23.35.53.39.93=5"  "30.03.31.13=10wp"
  const eqPattern = /([^=]*)=+(\d+)\s*([a-zA-Z]*)/gi;

  while ((match = eqPattern.exec(trimmed)) !== null) {
    const numbersPart = match[1];
    const suffix = match[3] ?? '';
    const isWP = /wp/i.test(suffix);
    const isDouble = /[ab]/i.test(suffix);
    const rate = parseInt(match[2], 10);
    const allNumbers = extractPairedNumbers(numbersPart);
    if (allNumbers.length === 0) continue;
    const count = countSegment(allNumbers, isWP) * (isDouble ? 2 : 1);
    if (count > 0) {
      const displayText = numbersPart.replace(/^\D+/, '').replace(/\D+$/, '').trim();
      results.push({
        line: displayText || numbersPart.trim(),
        rate,
        isWP,
        isDouble,
        count,
        lineTotal: count * rate,
      });
    }
  }
  if (results.length > 0) return results;

  // --- Plain format: last number = rate, any text after last number = WP / double ---
  // Only applies when the line has a comma — e.g. "02,04,07,09,,,40 पलटके साथ"
  // Lines without commas and no rate marker are rate-less and get merged upstream.
  if (/,/.test(trimmed)) {
    const allMatches = [...trimmed.matchAll(/\d+/g)];
    if (allMatches.length >= 2) {
      const lastMatch = allMatches[allMatches.length - 1];
      const baseRate = Number(lastMatch[0]);
      const lastMatchEnd = (lastMatch.index ?? 0) + lastMatch[0].length;
      const afterText = trimmed.slice(lastMatchEnd);
      const isDouble = /[ab]/i.test(afterText);
      // WP if there's non-whitespace text that isn't just a/b letters
      const isWP = /\S/.test(afterText) && !/^[ab\s]+$/i.test(afterText.trim());
      const rate = baseRate;
      const textBeforeRate = trimmed.slice(0, lastMatch.index);
      const allNumbers = extractPairedNumbers(textBeforeRate);
      if (allNumbers.length > 0) {
        const count = countSegment(allNumbers, isWP) * (isDouble ? 2 : 1);
        if (count > 0) {
          const displayText = textBeforeRate.replace(/[,\s.]+$/, '').trim();
          results.push({
            line: displayText || textBeforeRate.trim(),
            rate,
            isWP,
            isDouble,
            count,
            lineTotal: count * rate,
          });
        }
      }
    }
  }

  return results;
}

function preprocessText(text: string): string {
  // Handles timestamps like [14:26, 12/04/2026] and [6:16 pm, 12/04/2026]
  // Sender can be a phone number (+91 93513 40631) or a contact name (John, राहुल)
  return text.replace(/\[[^\]]*\]\s*[^:]+:\s*/g, "\n").trim();
}

function extractFirstRate(line: string): { rate: number; suffix: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/\((\d+)\)\s*([a-zA-Z]*)/i))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  if ((m = line.match(/[xX](\d+)\s*([a-zA-Z]*)/))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  if ((m = line.match(/=+(\d+)\s*([a-zA-Z]*)/))) return { rate: parseInt(m[1]), suffix: m[2] ?? '' };
  return null;
}

function calculateTotal(text: string): CalculationResult {
  const cleaned = preprocessText(text);

  // Rate-less lines (no paren/x/=/comma rate) borrow the rate from the NEXT rated line
  // and are kept as a SEPARATE breakdown row (not merged into the rated line's text).
  const rawLines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const mergedLines: string[] = [];
  let pending = "";

  for (const line of rawLines) {
    const hasExplicitRate = /\(\d+\)/.test(line) || /x\d+/i.test(line) || /=\d+/.test(line);
    const hasCommaRate = /,/.test(line);
    if (!hasExplicitRate && !hasCommaRate) {
      pending = pending ? pending + " " + line : line;
    } else {
      if (pending) {
        const rateInfo = extractFirstRate(line);
        if (rateInfo) {
          // Push pending as its own segment with the borrowed rate
          mergedLines.push(`${pending}(${rateInfo.rate})${rateInfo.suffix}`);
        } else {
          // Fallback: merge as before if rate can't be extracted
          mergedLines.push(pending + " " + line);
        }
        pending = "";
      }
      mergedLines.push(line);
    }
  }
  if (pending) mergedLines.push(pending);

  const results = mergedLines.flatMap(processLine);
  return { results, total: results.reduce((s, r) => s + r.lineTotal, 0) };
}

export default function Calculator() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCalculate = () => {
    setResult(calculateTotal(input));
    setCopied(false);
  };

  const handleClear = () => {
    setInput("");
    setResult(null);
    setCopied(false);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(String(result.total)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex flex-col items-center px-4 pt-6 pb-12 font-serif">
      {/* Header */}
      <div className="w-full max-w-[520px] text-center mb-7">
        <div className="text-4xl mb-2 leading-none">🧮</div>
        <h1 className="text-[28px] font-bold text-[#1a1a1a] mb-1.5 leading-tight">
          Calculator
        </h1>
        <p className="text-[17px] text-[#555] leading-relaxed">
          Type or paste your numbers below
        </p>
      </div>

      {/* Input card */}
      <div className="w-full max-w-[520px] bg-white rounded-[20px] shadow-[0_6px_32px_rgba(0,0,0,0.10)] p-7">
        <label className="block text-[19px] font-bold text-[#222] mb-2.5">
          Enter your numbers:
        </label>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"43*93*(75)wp\n48--98-(50)wp\n47--42*(35)wp"}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full min-h-[180px] p-4 text-xl font-mono border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[14px] resize-y outline-none text-[#111] leading-[1.8] bg-[#f8faff] tracking-wide transition-colors"
        />

        <button
          onClick={handleCalculate}
          className="block w-full mt-[18px] py-5 text-[22px] font-bold bg-[#1d6fb8] text-white border-none rounded-[14px] cursor-pointer shadow-[0_4px_14px_rgba(29,111,184,0.35)] font-serif active:opacity-85 transition-opacity"
        >
          ✅ Calculate
        </button>

        <button
          onClick={handleClear}
          className="block w-full mt-3 py-[18px] text-xl font-semibold bg-white text-[#c0392b] border-[2.5px] border-[#e0b0ad] rounded-[14px] cursor-pointer font-serif active:opacity-85 transition-opacity"
        >
          🗑 Clear
        </button>
      </div>

      {/* Result section */}
      {result && (
        <div className="w-full max-w-[520px] mt-6">
          {/* Total box */}
          <div className="bg-[#1d6fb8] rounded-[20px] px-6 py-7 shadow-[0_6px_24px_rgba(29,111,184,0.30)] flex items-center justify-between">
            <div>
              <div className="text-[16px] font-semibold text-white/75 uppercase tracking-widest mb-1.5">
                Total Amount
              </div>
              <div className="text-[54px] font-extrabold text-white leading-none">
                {result.total}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className={`px-5 py-3.5 text-[18px] font-bold text-white border-2 border-white/50 rounded-xl cursor-pointer font-serif whitespace-nowrap transition-colors ${
                copied ? "bg-[#27ae60]" : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>

          {/* Line breakdown */}
          {result.results.length > 0 && (
            <div className="bg-white rounded-[20px] p-6 mt-4 shadow-[0_4px_20px_rgba(0,0,0,0.07)]">
              <div className="text-[19px] font-bold text-[#222] mb-4 border-b-2 border-[#f0f0f0] pb-2.5">
                Line by Line
              </div>

              {result.results.map((r, i) => (
                <div
                  key={i}
                  className={`rounded-xl border border-[#e8eef8] p-[14px_16px] mb-2.5 ${
                    i % 2 === 0 ? "bg-[#f4f8ff]" : "bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="min-w-[28px] h-7 rounded-full bg-[#1d6fb8] text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-mono text-[#333] mb-2 break-all leading-relaxed">
                        {r.line}
                        {r.isWP && (
                          <span className="inline-block text-[13px] font-bold px-2.5 py-0.5 rounded-full ml-2 bg-blue-100 text-blue-700 align-middle">
                            WP
                          </span>
                        )}
                        {r.isDouble && (
                          <span className="inline-block text-[13px] font-bold px-2.5 py-0.5 rounded-full ml-2 bg-yellow-100 text-yellow-800 align-middle">
                            AB
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[17px] text-[#666] font-serif">
                          {r.count} × {r.rate}
                        </span>
                        <span className="text-[22px] font-extrabold text-[#1d6fb8]">
                          = {r.lineTotal}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Grand total */}
              <div className="flex justify-between items-center mt-1.5 px-4 py-3.5 bg-[#1d6fb8] rounded-xl">
                <span className="text-xl font-bold text-white">
                  Grand Total
                </span>
                <span className="text-[28px] font-extrabold text-white">
                  {result.total}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
