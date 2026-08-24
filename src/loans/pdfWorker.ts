import * as pdfjs from "pdfjs-dist";

let workerReady = false;

export function ensureLoanPdfWorker(): void {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  workerReady = true;
}
