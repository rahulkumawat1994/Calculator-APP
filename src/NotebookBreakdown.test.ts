import { describe, expect, it } from "vitest";
import { parseWhatsAppMessages } from "@/calc/whatsapp";
import { buildNotebookRowsSingle } from "./NotebookBreakdown";
import {
  findRateHighlightStart,
  shouldBoldRateOnLine,
} from "./notebookRateHighlight";

describe("findRateHighlightStart", () => {
  it("80.08.30.03=30 — highlights =30 only, not jodi 30 in dot chain", () => {
    const text = "80.08.30.03=30 गाजियाबाद";
    const start = findRateHighlightStart(text, 30);
    expect(start).toBe(text.indexOf("=30") + 1);
    expect(text.slice(start!, start! + 2)).toBe("30");
  });

  it("09--59(75(wp — highlights (75", () => {
    const text = "09--59(75(wp";
    expect(findRateHighlightStart(text, 75)).toBe(text.indexOf("75"));
  });

  it("58 44 x10 — highlights x10", () => {
    const text = "58 44 x10";
    expect(findRateHighlightStart(text, 10)).toBe(text.lastIndexOf("10"));
  });

  it("77.30 दिसावर — highlights trailing dot-rate 30", () => {
    const text = "77.30 दिसावर";
    expect(findRateHighlightStart(text, 30)).toBe(text.indexOf(".30") + 1);
  });
});

describe("shouldBoldRateOnLine", () => {
  it("standalone rate row on last line of segment", () => {
    expect(
      shouldBoldRateOnLine("10", 10, { isLastSourceLineOfSegment: true }),
    ).toBe(true);
    expect(
      shouldBoldRateOnLine("28", 10, { isLastSourceLineOfSegment: false }),
    ).toBe(false);
  });
});

describe("buildNotebookRowsSingle — FB / number / rate rows", () => {
  const block = `[01/06, 5:29 pm] skgonline1979: FB 
28
10`;

  it("highlights rate on its own line for single WA message", () => {
    const wa = parseWhatsAppMessages(block)!;
    const result = {
      results: wa.flatMap((m) => m.result.results),
      total: wa.reduce((s, m) => s + m.result.total, 0),
    };
    const rows = buildNotebookRowsSingle(wa[0]!.text, {
      results: result.results,
      total: result.total,
    });
    const rateRow = rows.find((r) => r.left === "10");
    expect(rateRow?.boldRate).toBe(10);
    const numRow = rows.find((r) => r.left === "28");
    expect(numRow?.boldRate).toBeUndefined();
  });

  it("highlights rate per message when block has two WA messages", () => {
    const two = `${block}
[01/06, 5:30 pm] skgonline1979: FB 
55
20`;
    const wa = parseWhatsAppMessages(two)!;
    expect(wa.length).toBe(2);
    const result = {
      results: wa.flatMap((m) => m.result.results),
      total: wa.reduce((s, m) => s + m.result.total, 0),
    };
    let offset = 0;
    for (const m of wa) {
      const n = m.result.results.length;
      const rows = buildNotebookRowsSingle(m.text, {
        results: result.results.slice(offset, offset + n),
        total: result.results
          .slice(offset, offset + n)
          .reduce((s, r) => s + r.lineTotal, 0),
      });
      const rateLine = rows.find((r) => r.left === String(m.result.results[0]!.rate));
      expect(rateLine?.boldRate).toBe(m.result.results[0]!.rate);
      offset += n;
    }
  });
});
