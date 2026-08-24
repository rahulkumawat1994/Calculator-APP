import type { LoanScheduleRow } from "./extractLoanScheduleFromPdf";

export async function fingerprintLoanSchedule(
  fileName: string,
  rows: LoanScheduleRow[],
): Promise<string> {
  const sample = rows.length > 64
    ? [...rows.slice(0, 32), ...rows.slice(-32)]
    : rows;
  const payload = JSON.stringify({
    fileName: fileName.trim(),
    rowCount: rows.length,
    rows: sample.map((r) => ({
      installmentNo: r.installmentNo,
      dueDate: r.dueDate,
      installmentAmount: r.installmentAmount,
      interest: r.interest,
      principal: r.principal,
      balancePrincipal: r.balancePrincipal,
    })),
  });
  const data = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex.slice(0, 32);
}
