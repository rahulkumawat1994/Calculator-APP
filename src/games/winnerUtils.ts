import type { Segment } from "@/types";

export function extractLineNumbers(line: string): string[] {
  return line.match(/\d+/g) ?? [];
}

export function reverseNumStr(n: string): string {
  return n.split("").reverse().join("");
}

export function getWinningSegments(
  segments: Segment[],
  winningNum: string,
): Array<{ seg: Segment; matchedNumber: string; isUlta: boolean }> {
  if (!winningNum) return [];
  const rev = reverseNumStr(winningNum);
  const results: Array<{
    seg: Segment;
    matchedNumber: string;
    isUlta: boolean;
  }> = [];
  for (const seg of segments) {
    const nums = extractLineNumbers(seg.line);
    for (const n of nums) {
      if (n === winningNum) {
        results.push({ seg, matchedNumber: n, isUlta: false });
        break;
      }
      if (seg.isWP && n === rev) {
        results.push({ seg, matchedNumber: n, isUlta: true });
        break;
      }
    }
  }
  return results;
}
