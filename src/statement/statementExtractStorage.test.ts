import { describe, expect, it } from "vitest";
import type { StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import {
  decodeStatementRowsFromFirestore,
  encodeStatementRowsForFirestore,
  STATEMENT_ROWS_ENCODING_GZIP,
  STATEMENT_ROWS_ENCODING_GZIP_CHUNKED,
} from "./statementExtractStorage";

function sampleRow(i: number): StatementWdDpRow {
  return {
    page: 1 + (i % 3),
    txnDate: "15-12-2025",
    transaction: `UPI/user${i}@okaxis/PAYMENT REF${i}`,
    withdrawals: i % 2 === 0 ? "100.00" : "",
    deposits: i % 2 === 1 ? "250.50" : "",
  };
}

describe("encodeStatementRowsForFirestore", () => {
  it("round-trips rows with gzip", () => {
    const rows = [sampleRow(1), sampleRow(2)];
    const encoded = encodeStatementRowsForFirestore(rows);
    expect(encoded.encoding).toBe(STATEMENT_ROWS_ENCODING_GZIP);
    expect(encoded.compressed).toBeTruthy();
    const decoded = decodeStatementRowsFromFirestore(
      encoded.encoding,
      encoded.compressed,
      undefined,
      undefined,
    );
    expect(decoded).toEqual(rows);
  });

  it("compresses large extracts below single-doc size", () => {
    const rows = Array.from({ length: 3000 }, (_, i) => sampleRow(i));
    const jsonLen = JSON.stringify(rows).length;
    const encoded = encodeStatementRowsForFirestore(rows);
    expect(encoded.encoding).toBe(STATEMENT_ROWS_ENCODING_GZIP);
    expect(encoded.compressed!.length).toBeLessThan(jsonLen / 2);
    expect(encoded.compressed!.length).toBeLessThan(900_000);
    const decoded = decodeStatementRowsFromFirestore(
      encoded.encoding,
      encoded.compressed,
      undefined,
      undefined,
    );
    expect(decoded.length).toBe(3000);
  });

  it("reads legacy plain rows array", () => {
    const rows = [sampleRow(0)];
    const legacy = rows.map((r) => ({
      page: r.page,
      txnDate: r.txnDate,
      transaction: r.transaction,
      withdrawals: r.withdrawals,
      deposits: r.deposits,
    }));
    const decoded = decodeStatementRowsFromFirestore(undefined, undefined, undefined, legacy);
    expect(decoded).toEqual(rows);
  });

  it("decodes chunked gzip payloads", () => {
    const rows = Array.from({ length: 200 }, (_, i) => sampleRow(i));
    const first = encodeStatementRowsForFirestore(rows.slice(0, 100));
    const second = encodeStatementRowsForFirestore(rows.slice(100));
    expect(first.compressed).toBeTruthy();
    expect(second.compressed).toBeTruthy();
    const decoded = decodeStatementRowsFromFirestore(
      STATEMENT_ROWS_ENCODING_GZIP_CHUNKED,
      undefined,
      [first.compressed!, second.compressed!],
      undefined,
    );
    expect(decoded.length).toBe(200);
    expect(decoded[0]!.transaction).toContain("user0");
    expect(decoded[199]!.transaction).toContain("user199");
  });
});
