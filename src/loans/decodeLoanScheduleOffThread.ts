import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";
import {
  capDecodedScheduleRows,
  decodeLoanScheduleChunksAsync,
  decodeLoanScheduleRowsFromFirestore,
  MAX_COMPRESSED_SCHEDULE_CHARS,
  MAX_SCHEDULE_ROWS_DECODE,
} from "./loanScheduleStorage";

const DECODE_TIMEOUT_MS = 12_000;

function decodeLoanScheduleSync(
  encoding: string | undefined,
  compressed: string | undefined,
  chunkPayloads: string[] | undefined,
  scheduleRowCount?: number,
): LoanScheduleRow[] {
  if (
    scheduleRowCount != null &&
    scheduleRowCount > MAX_SCHEDULE_ROWS_DECODE * 3 &&
    !chunkPayloads?.length
  ) {
    console.warn("[loans] schedule row count too high, skipping decode");
    return [];
  }

  if (chunkPayloads?.length) {
    const totalChars = chunkPayloads.reduce((sum, c) => sum + c.length, 0);
    if (totalChars > MAX_COMPRESSED_SCHEDULE_CHARS * 2) {
      console.warn("[loans] chunk payloads too large to decode safely");
      return [];
    }
    return capDecodedScheduleRows(
      decodeLoanScheduleRowsFromFirestore(encoding, undefined, chunkPayloads),
    );
  }
  if (compressed && compressed.length > MAX_COMPRESSED_SCHEDULE_CHARS) {
    console.warn("[loans] compressed schedule skipped (too large)");
    return [];
  }
  return capDecodedScheduleRows(
    decodeLoanScheduleRowsFromFirestore(encoding, compressed, undefined),
  );
}

/** Decode without a Web Worker (worker was hanging without resolving). */
export async function decodeLoanScheduleSafe(
  encoding: string | undefined,
  compressed: string | undefined,
  chunkPayloads: string[] | undefined,
  scheduleRowCount?: number,
): Promise<LoanScheduleRow[]> {
  if (chunkPayloads?.length) {
    const totalChars = chunkPayloads.reduce((sum, c) => sum + c.length, 0);
    if (totalChars > MAX_COMPRESSED_SCHEDULE_CHARS * 2) {
      console.warn("[loans] chunk payloads too large to decode safely");
      return [];
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Schedule decode timed out — try re-importing the PDF."));
      }, DECODE_TIMEOUT_MS);
      decodeLoanScheduleChunksAsync(chunkPayloads)
        .then((rows) => {
          clearTimeout(timer);
          resolve(capDecodedScheduleRows(rows));
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Schedule decode timed out — try re-importing the PDF."));
    }, DECODE_TIMEOUT_MS);

    // Yield so "Loading schedule rows" can paint before gzip/JSON work.
    setTimeout(() => {
      try {
        const rows = decodeLoanScheduleSync(encoding, compressed, chunkPayloads, scheduleRowCount);
        clearTimeout(timer);
        resolve(rows);
      } catch (e) {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  });
}
