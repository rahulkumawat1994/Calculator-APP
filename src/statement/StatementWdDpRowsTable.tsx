import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StatementPdfPageTotal, StatementWdDpRow } from "./extractStatementColumnsFromPdf";
import { formatStatementInrMoney, parseStatementMoneyAmount, sumStatementWdDpRows } from "./statementMoneyParse";

function TxnRow({
  row,
  rowNumber,
}: {
  row: StatementWdDpRow;
  rowNumber: number;
}) {
  return (
    <tr className="border-b border-slate-100/80 align-top even:bg-slate-50/40 hover:bg-sky-50/50">
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-400">{rowNumber}</td>
      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500">{row.page}</td>
      <td className="px-3 py-2.5 font-sans text-xs text-slate-700 whitespace-pre-wrap wrap-break-word">
        {row.txnDate || <span className="text-slate-300">—</span>}
      </td>
      <td className="min-w-0 px-3 py-2.5 font-sans text-xs leading-snug text-slate-800 whitespace-pre-wrap wrap-break-word">
        {row.transaction || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums">
        {row.withdrawals || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2.5 pr-4 text-right text-xs tabular-nums">
        {row.deposits || <span className="text-slate-300">—</span>}
      </td>
    </tr>
  );
}

function PdfPrintedPageTotalRow({
  printed,
  computedWithdrawals,
  computedDeposits,
}: {
  printed: StatementPdfPageTotal;
  computedWithdrawals: number;
  computedDeposits: number;
}) {
  const printedWd = parseStatementMoneyAmount(printed.withdrawals);
  const printedDep = parseStatementMoneyAmount(printed.deposits);
  const wdMatch = computedWithdrawals === printedWd;
  const depMatch = computedDeposits === printedDep;
  const allMatch = wdMatch && depMatch;

  return (
    <tr className="border-b border-slate-200 bg-amber-50/50">
      <td className="px-3 py-2 text-right text-xs text-slate-400">—</td>
      <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{printed.page}</td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2 font-sans text-xs text-slate-700">
        <span className="font-medium text-slate-800">PDF printed total</span>
        {allMatch ? (
          <span className="ml-2 text-emerald-700">matches</span>
        ) : (
          <span className="ml-2 text-amber-800">check totals</span>
        )}
      </td>
      <td
        className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${
          wdMatch ? "text-slate-800" : "text-amber-900"
        }`}
      >
        {formatStatementInrMoney(printedWd)}
      </td>
      <td
        className={`px-3 py-2 pr-4 text-right text-xs font-semibold tabular-nums ${
          depMatch ? "text-slate-800" : "text-amber-900"
        }`}
      >
        {formatStatementInrMoney(printedDep)}
      </td>
    </tr>
  );
}

function PdfPrintedGrandTotalRow({
  printed,
  computedWithdrawals,
  computedDeposits,
}: {
  printed: StatementPdfPageTotal;
  computedWithdrawals: number;
  computedDeposits: number;
}) {
  const printedWd = parseStatementMoneyAmount(printed.withdrawals);
  const printedDep = parseStatementMoneyAmount(printed.deposits);
  const wdMatch = computedWithdrawals === printedWd;
  const depMatch = computedDeposits === printedDep;
  const allMatch = wdMatch && depMatch;

  return (
    <tr className="border-t-2 border-slate-300 bg-amber-50/60">
      <td className="px-3 py-2.5 text-right text-xs text-slate-400">—</td>
      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500">{printed.page}</td>
      <td className="px-3 py-2.5" />
      <td className="px-3 py-2.5 font-sans text-xs font-semibold text-slate-800">
        PDF grand total
        {allMatch ? (
          <span className="ml-2 font-normal text-emerald-700">matches</span>
        ) : (
          <span className="ml-2 font-normal text-amber-800">check totals</span>
        )}
      </td>
      <td
        className={`px-3 py-2.5 text-right text-xs font-semibold tabular-nums ${
          wdMatch ? "text-slate-900" : "text-amber-900"
        }`}
      >
        {formatStatementInrMoney(printedWd)}
      </td>
      <td
        className={`px-3 py-2.5 pr-4 text-right text-xs font-semibold tabular-nums ${
          depMatch ? "text-slate-900" : "text-amber-900"
        }`}
      >
        {formatStatementInrMoney(printedDep)}
      </td>
    </tr>
  );
}

function PageTotalRow({
  page,
  withdrawals,
  deposits,
  rowCount,
  listIndex,
  open,
  onToggle,
}: {
  page: number;
  withdrawals: number;
  deposits: number;
  rowCount: number;
  listIndex: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="border-b border-slate-200 bg-slate-100/80 cursor-pointer transition hover:bg-slate-200/60"
    >
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">{listIndex}</td>
      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{page}</td>
      <td className="px-3 py-2.5" />
      <td className="px-3 py-2.5 font-sans text-xs font-semibold text-slate-800">
        <span className="mr-1.5 text-slate-400" aria-hidden>{open ? "▾" : "▸"}</span>
        Page {page} total (calculated)
        <span className="ml-1.5 font-normal text-slate-500">({rowCount})</span>
      </td>
      <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">
        {formatStatementInrMoney(withdrawals)}
      </td>
      <td className="px-3 py-2.5 pr-4 text-right text-xs font-semibold tabular-nums text-slate-900">
        {formatStatementInrMoney(deposits)}
      </td>
    </tr>
  );
}

export function StatementWdDpRowsTable({
  rows,
  rowKeyPrefix,
  onlyPageTotals = false,
  pdfPageTotals = [],
  showPdfPrintedTotals = false,
}: {
  rows: StatementWdDpRow[];
  rowKeyPrefix: string;
  onlyPageTotals?: boolean;
  pdfPageTotals?: StatementPdfPageTotal[];
  showPdfPrintedTotals?: boolean;
}) {
  const [toggledPages, setToggledPages] = useState<Set<number>>(() => new Set());

  const printedPageTotalsByPage = useMemo(() => {
    const map = new Map<number, StatementPdfPageTotal>();
    for (const t of pdfPageTotals) {
      if (t.kind === "page") map.set(t.page, t);
    }
    return map;
  }, [pdfPageTotals]);

  const printedGrandTotal = useMemo(
    () => pdfPageTotals.find((t) => t.kind === "grand"),
    [pdfPageTotals],
  );

  const allRowSums = useMemo(() => sumStatementWdDpRows(rows), [rows]);

  const pages = useMemo(
    () => [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b),
    [rows],
  );

  const rowsByPage = useMemo(() => {
    const map = new Map<number, StatementWdDpRow[]>();
    for (const r of rows) {
      const list = map.get(r.page) ?? [];
      list.push(r);
      map.set(r.page, list);
    }
    return map;
  }, [rows]);

  useEffect(() => {
    setToggledPages(new Set());
  }, [rowKeyPrefix, onlyPageTotals]);

  const detailsVisible = (page: number) =>
    onlyPageTotals ? toggledPages.has(page) : !toggledPages.has(page);

  const togglePage = (page: number) => {
    setToggledPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  let rowNumber = 0;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="stmt-table-scroll">
        <table className="w-full min-w-0 table-fixed border-collapse text-left text-[13px]">
        <colgroup>
          <col className="w-10" />
          <col className="w-11" />
          <col className="w-28" />
          <col className="w-[min(18rem,42vw)]" />
          <col className="w-24" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-3 pl-4 text-right">#</th>
            <th className="px-3 py-3">Pg</th>
            <th className="px-3 py-3">Txn date</th>
            <th className="px-3 py-3 text-left">Transaction</th>
            <th className="px-3 py-3 text-right">Withdrawals</th>
            <th className="px-3 py-3 pr-4 text-right">Deposits</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-800">
          {pages.map((page, pageIndex) => {
            const pageRows = rowsByPage.get(page) ?? [];
            const sums = sumStatementWdDpRows(pageRows);
            const open = detailsVisible(page);
            const blocks: ReactNode[] = [];

            if (!onlyPageTotals && open) {
              for (const row of pageRows) {
                rowNumber += 1;
                blocks.push(
                  <TxnRow key={`${rowKeyPrefix}-${page}-r${rowNumber}`} row={row} rowNumber={rowNumber} />,
                );
              }
            }

            blocks.push(
              <PageTotalRow
                key={`${rowKeyPrefix}-${page}-total`}
                page={page}
                withdrawals={sums.withdrawals}
                deposits={sums.deposits}
                rowCount={pageRows.length}
                listIndex={pageIndex + 1}
                open={open}
                onToggle={() => togglePage(page)}
              />,
            );

            const printedPageTotal = printedPageTotalsByPage.get(page);
            if (showPdfPrintedTotals && printedPageTotal) {
              blocks.push(
                <PdfPrintedPageTotalRow
                  key={`${rowKeyPrefix}-${page}-pdf-total`}
                  printed={printedPageTotal}
                  computedWithdrawals={sums.withdrawals}
                  computedDeposits={sums.deposits}
                />,
              );
            }

            if (onlyPageTotals && open) {
              for (const row of pageRows) {
                rowNumber += 1;
                blocks.push(
                  <TxnRow key={`${rowKeyPrefix}-${page}-d${rowNumber}`} row={row} rowNumber={rowNumber} />,
                );
              }
            }

            return blocks;
          })}
          {showPdfPrintedTotals && printedGrandTotal ? (
            <PdfPrintedGrandTotalRow
              printed={printedGrandTotal}
              computedWithdrawals={allRowSums.withdrawals}
              computedDeposits={allRowSums.deposits}
            />
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}
