import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import {
  canonicalRowsForFingerprint,
  fingerprintStatementExtract,
} from "./statementExtractFingerprint";

const sampleRows: StatementWdDpRow[] = [
  { page: 1, txnDate: "01/01/2025", transaction: "UPI", withdrawals: "100", deposits: "" },
];

describe("canonicalRowsForFingerprint", () => {
  it("copies row fields", () => {
    expect(canonicalRowsForFingerprint(sampleRows)).toEqual(sampleRows);
  });
});

describe("fingerprintStatementExtract", () => {
  it("is stable for same name and rows", async () => {
    const a = await fingerprintStatementExtract("Stmt.PDF", sampleRows);
    const b = await fingerprintStatementExtract("stmt.pdf", sampleRows);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when row content changes", async () => {
    const a = await fingerprintStatementExtract("a.pdf", sampleRows);
    const b = await fingerprintStatementExtract("a.pdf", [
      { ...sampleRows[0]!, withdrawals: "101" },
    ]);
    expect(a).not.toBe(b);
  });

  it("treats different basename paths as same if basename matches", async () => {
    const a = await fingerprintStatementExtract("/x/foo.pdf", sampleRows);
    const b = await fingerprintStatementExtract("FOO.PDF", sampleRows);
    expect(a).toBe(b);
  });
});
