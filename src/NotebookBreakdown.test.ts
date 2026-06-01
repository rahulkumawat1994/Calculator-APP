import { describe, expect, it } from "vitest";
import { findRateHighlightStart } from "./notebookRateHighlight";

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
});
