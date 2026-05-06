import { describe, expect, it } from "vitest";
import {
  parseMonthYearFromText,
  parseStatementPdfPeriodFromFileName,
  sortStatementPdfsByPeriod,
} from "./sortStatementPdfsByPeriod";

describe("parseMonthYearFromText", () => {
  it("parses D month YYYY", () => {
    expect(parseMonthYearFromText("1 jan 2025")).toEqual({ y: 2025, m: 1, d: 1 });
  });

  it("parses month word and year", () => {
    expect(parseMonthYearFromText("march 2026")).toEqual({ y: 2026, m: 3, d: null });
  });

  it("parses DD-MM-YYYY", () => {
    expect(parseMonthYearFromText("01-04-2025")).toEqual({ y: 2025, m: 4, d: 1 });
  });
});

describe("parseStatementPdfPeriodFromFileName", () => {
  it("uses range start for typical statement names", () => {
    expect(parseStatementPdfPeriodFromFileName("01-04-2025 to 30-04-2025.pdf")).toEqual({
      y: 2025,
      m: 4,
      d: 1,
    });
  });

  it("parses jan 2025 in filename", () => {
    const k = parseStatementPdfPeriodFromFileName("statement 1 jan 2025.pdf");
    expect(k).toEqual({ y: 2025, m: 1, d: 1 });
  });

  it("parses march 2026 in filename", () => {
    expect(parseStatementPdfPeriodFromFileName("report march 2026.pdf")).toEqual({
      y: 2026,
      m: 3,
      d: null,
    });
  });
});

describe("sortStatementPdfsByPeriod", () => {
  const d = (name: string, tag: string) => ({ name, tag });

  it("keeps upload order", () => {
    const docs = [d("march 2026.pdf", "b"), d("1 jan 2025.pdf", "a")];
    expect(sortStatementPdfsByPeriod(docs, "upload").map((x) => x.tag)).toEqual(["b", "a"]);
  });

  it("sorts old to new by filename period", () => {
    const docs = [d("march 2026.pdf", "newer"), d("1 jan 2025.pdf", "older")];
    expect(sortStatementPdfsByPeriod(docs, "period-asc").map((x) => x.tag)).toEqual(["older", "newer"]);
  });

  it("sorts new to old by filename period", () => {
    const docs = [d("1 jan 2025.pdf", "older"), d("march 2026.pdf", "newer")];
    expect(sortStatementPdfsByPeriod(docs, "period-desc").map((x) => x.tag)).toEqual(["newer", "older"]);
  });

  it("places undated filenames last when sorting by period", () => {
    const docs = [d("unknown.pdf", "x"), d("april 2025.pdf", "y")];
    expect(sortStatementPdfsByPeriod(docs, "period-asc").map((x) => x.tag)).toEqual(["y", "x"]);
  });

  it("sorts items that only have fileName (e.g. Firebase extracts)", () => {
    const rows = [
      { fileName: "march 2026.pdf", tag: "newer" },
      { fileName: "1 jan 2025.pdf", tag: "older" },
    ];
    expect(sortStatementPdfsByPeriod(rows, "period-asc").map((x) => x.tag)).toEqual(["older", "newer"]);
  });
});
