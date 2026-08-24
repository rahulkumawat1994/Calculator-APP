import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  deleteLoanRecord,
  loadLoanBorrowersDB,
  loadLoanDocForDetail,
  loadLoansForBorrower,
  saveLoanBorrowersDB,
  saveLoanRecord,
  type LoanRecord,
} from "./data/firestoreDb";
import {
  clearEmisPaidForLoan,
  loadEmisPaidForLoan,
  persistEmisPaidForLoan,
  addLoanBorrower,
  loadActiveLoanBorrowerId,
  loadLoanBorrowers,
  persistActiveLoanBorrowerId,
  persistLoanBorrowers,
  persistLoanColumnBoundariesForLoan,
  resolveActiveLoanBorrowerId,
  type LoanBorrower,
} from "./loans/loanBorrowers";
import {
  ALL_LOAN_COLUMNS,
  DEFAULT_LOAN_COLUMN_ORDER,
  LOAN_COLUMN_LABELS,
  type LoanColumnId,
} from "./loans/loanColumns";
import {
  type LoanColumnBoundaries,
  equalColumnBoundaries,
} from "./loans/loanColumnBoundaries";
import {
  computeLoanDetailSummary,
  deriveLoanMetaFromSchedule,
  emiFromAnnualRate,
  formatLoanInr,
  formatLoanRate,
  isLoanScheduleRowEmpty,
  prepareScheduleRowsForUi,
  buildPrepaymentPlan,
  repairLegacyPartPaymentRows,
  rowPartPaymentAmount,
  type PrepaymentRule,
} from "./loans/loanCalc";
import {
  parseBoundedInt,
  parseMoneyInput,
  isoDateFromDueDateText,
  previewLoanTerms,
  partPaymentRecordsFromDrafts,
  partPaymentsFromRecords,
  type PartPaymentDraft,
} from "./loans/loanPageHelpers";
import type { LoanScheduleRow } from "./loans/extractLoanScheduleFromPdf";
import { fingerprintLoanSchedule } from "./loans/loanScheduleFingerprint";
import { decodeLoanScheduleSafe } from "./loans/decodeLoanScheduleOffThread";

const LoansPdfColumnGuideModal = lazy(() => import("./LoansPdfColumnGuideModal"));
const LoanScheduleChart = lazy(() => import("./loans/LoanScheduleChart"));

const SCHEDULE_PAGE_SIZE = 80;

type LoanModalMode = { mode: "add" } | { mode: "edit"; loan: LoanRecord };

type LoanDraft = {
  name: string;
  lender: string;
  loanType: string;
  source: "pdf" | "manual";
  principal: string;
  rate: string;
  tenure: string;
  startDate: string;
  regenerateSchedule: boolean;
  partPayments: PartPaymentDraft[];
  pdfFile: File | null;
  columnOrder: LoanColumnId[];
  boundaries: LoanColumnBoundaries | null;
  pdfPreviewRows: LoanScheduleRow[] | null;
};

const EMPTY_LOAN_DRAFT: LoanDraft = {
  name: "",
  lender: "",
  loanType: "",
  source: "pdf",
  principal: "",
  rate: "",
  tenure: "240",
  startDate: "",
  regenerateSchedule: true,
  partPayments: [],
  pdfFile: null,
  columnOrder: DEFAULT_LOAN_COLUMN_ORDER,
  boundaries: null,
  pdfPreviewRows: null,
};

function newPartPaymentId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createPartPaymentDraft(): PartPaymentDraft {
  return { id: newPartPaymentId(), date: "", amount: "" };
}

type PrepayRuleRow = {
  id: string;
  afterInstallmentInput: string;
  amountInput: string;
  everyMonthsInput: string;
  closeLoan: boolean;
};

function newPrepayRuleId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createPrepayRule(defaultAfter: number): PrepayRuleRow {
  return {
    id: newPrepayRuleId(),
    afterInstallmentInput: String(defaultAfter),
    amountInput: "100000",
    everyMonthsInput: "12",
    closeLoan: false,
  };
}

function parsePrepayRulesForPlan(rows: PrepayRuleRow[], tenure: number): PrepaymentRule[] {
  const parsed: PrepaymentRule[] = [];
  for (const row of rows) {
    const afterInstallment = parseBoundedInt(row.afterInstallmentInput, 1, tenure, 1);
    if (row.closeLoan) {
      parsed.push({
        afterInstallment,
        amount: 0,
        everyMonths: 0,
        closeLoan: true,
      });
      continue;
    }
    const amount = Number(row.amountInput.replace(/,/g, "").trim());
    if (!Number.isFinite(amount) || amount <= 0) continue;
    parsed.push({
      afterInstallment,
      amount,
      everyMonths: parseBoundedInt(row.everyMonthsInput, 0, 120, 0),
      closeLoan: false,
    });
  }
  return parsed;
}

function slugifyLoanId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "loan";
}

function newLoanId(name: string, existing: LoanRecord[]): string {
  const base = slugifyLoanId(name);
  if (!existing.some((l) => l.id === base)) return base;
  let n = 2;
  while (existing.some((l) => l.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function PartPaymentsEditor({
  partPayments,
  onChange,
}: {
  partPayments: PartPaymentDraft[];
  onChange: (next: PartPaymentDraft[]) => void;
}) {
  const update = (id: string, patch: Partial<PartPaymentDraft>) => {
    onChange(partPayments.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const remove = (id: string) => {
    onChange(partPayments.filter((p) => p.id !== id));
  };

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">Any part payments so far?</p>
        <button
          type="button"
          onClick={() => onChange([...partPayments, createPartPaymentDraft()])}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          + Add part payment
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        Extra amounts paid toward principal — use the date you actually paid, not the next EMI due
        date.
      </p>
      {partPayments.length === 0 ? (
        <p className="text-xs text-gray-500">Skip if you haven&apos;t made any part payments.</p>
      ) : (
        <div className="space-y-2">
          {partPayments.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap gap-2 items-end rounded-lg border border-gray-100 bg-white p-2"
            >
              <label className="text-xs text-gray-600 space-y-1 min-w-[140px] grow">
                <span>Payment date</span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                  value={p.date}
                  onChange={(e) => update(p.id, { date: e.target.value })}
                />
              </label>
              <label className="text-xs text-gray-600 space-y-1 min-w-[120px] grow">
                <span>Amount (₹)</span>
                <input
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm tabular-nums"
                  placeholder="50,000"
                  value={p.amount}
                  onChange={(e) => update(p.id, { amount: e.target.value })}
                />
              </label>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnOrderEditor({
  order,
  onChange,
}: {
  order: LoanColumnId[];
  onChange: (next: LoanColumnId[]) => void;
}) {
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[idx]!;
    next[idx] = next[j]!;
    next[j] = a;
    onChange(next);
  };
  const remove = (idx: number) => {
    if (order.length <= 2) return;
    onChange(order.filter((_, i) => i !== idx));
  };
  const add = (id: LoanColumnId) => {
    if (order.includes(id)) return;
    onChange([...order, id]);
  };
  const missing = ALL_LOAN_COLUMNS.filter((c) => !order.includes(c));

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-600">Column order (left → right in PDF)</p>
      <ul className="space-y-1">
        {order.map((id, idx) => (
          <li
            key={id}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          >
            <span className="flex-1">{LOAN_COLUMN_LABELS[id]}</span>
            <button
              type="button"
              className="px-2 text-gray-500 hover:text-gray-800"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
            >
              ↑
            </button>
            <button
              type="button"
              className="px-2 text-gray-500 hover:text-gray-800"
              onClick={() => move(idx, 1)}
              disabled={idx === order.length - 1}
            >
              ↓
            </button>
            <button
              type="button"
              className="px-2 text-red-500 hover:text-red-700 disabled:opacity-30"
              onClick={() => remove(idx)}
              disabled={order.length <= 2}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {missing.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => add(id)}
              className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-indigo-400 hover:text-indigo-600"
            >
              + {LOAN_COLUMN_LABELS[id]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LoansPage() {
  const [borrowers, setBorrowers] = useState<LoanBorrower[]>(() => loadLoanBorrowers());
  const [activeBorrowerId, setActiveBorrowerId] = useState(() =>
    resolveActiveLoanBorrowerId(loadLoanBorrowers(), loadActiveLoanBorrowerId()),
  );
  const [loanList, setLoanList] = useState<LoanRecord[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanRecord | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const skipDetailLoadRef = useRef<string | null>(null);
  const scheduleLoadedForIdRef = useRef<string | null>(null);
  const detailLoadSeqRef = useRef(0);
  const detailBorrowerIdRef = useRef(activeBorrowerId);

  const [addBorrowerOpen, setAddBorrowerOpen] = useState(false);
  const [newBorrowerName, setNewBorrowerName] = useState("");
  const [loanModal, setLoanModal] = useState<LoanModalMode | null>(null);
  const [loanDraft, setLoanDraft] = useState<LoanDraft>(EMPTY_LOAN_DRAFT);
  const [loanParsing, setLoanParsing] = useState(false);
  const [loanSaving, setLoanSaving] = useState(false);

  const [guidePdf, setGuidePdf] = useState<{ data: ArrayBuffer; fileName: string; loanKey: string } | null>(null);
  const [guideColumnOrder, setGuideColumnOrder] = useState<LoanColumnId[]>(DEFAULT_LOAN_COLUMN_ORDER);
  const [guideBoundaries, setGuideBoundaries] = useState<LoanColumnBoundaries>([]);

  const [schedulePage, setSchedulePage] = useState(0);
  const [scheduleRows, setScheduleRows] = useState<LoanScheduleRow[]>([]);
  const [scheduleTruncated, setScheduleTruncated] = useState(false);
  const [parsedRowCount, setParsedRowCount] = useState(0);
  const [emisPaidOverride, setEmisPaidOverride] = useState<number | null>(null);
  const [emisPaidInput, setEmisPaidInput] = useState("");
  const [prepayOpen, setPrepayOpen] = useState(false);
  const [prepayRules, setPrepayRules] = useState<PrepayRuleRow[]>(() => [createPrepayRule(1)]);
  const [prepayShowSchedule, setPrepayShowSchedule] = useState(false);
  const [prepaySchedulePage, setPrepaySchedulePage] = useState(0);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    if (!selectedLoanId) return;
    const match = loanList.find((l) => l.id === selectedLoanId);
    detailBorrowerIdRef.current = match?.borrowerId ?? activeBorrowerId;
  }, [selectedLoanId, loanList, activeBorrowerId]);

  const schedulePageCount = Math.max(1, Math.ceil(scheduleRows.length / SCHEDULE_PAGE_SIZE));
  const scheduleSlice = scheduleRows.slice(
    schedulePage * SCHEDULE_PAGE_SIZE,
    (schedulePage + 1) * SCHEDULE_PAGE_SIZE,
  );

  const termsPreview = useMemo(() => {
    if (!loanModal) return null;
    const includePartPayments =
      loanDraft.source === "manual" &&
      (loanModal.mode === "add" ||
        (loanModal.mode === "edit" && loanDraft.regenerateSchedule));
    return previewLoanTerms(
      loanDraft.principal,
      loanDraft.rate,
      loanDraft.tenure,
      loanDraft.startDate,
      includePartPayments ? loanDraft.partPayments : [],
    );
  }, [
    loanModal,
    loanDraft.principal,
    loanDraft.rate,
    loanDraft.tenure,
    loanDraft.startDate,
    loanDraft.source,
    loanDraft.regenerateSchedule,
    loanDraft.partPayments,
  ]);

  const editingLoan = loanModal?.mode === "edit" ? loanModal.loan : null;

  const effectivePartPayments = useMemo(() => {
    if (scheduleRows.length === 0) return [];
    if (selectedLoan?.partPayments?.length) {
      return partPaymentsFromRecords(selectedLoan.partPayments);
    }
    if (selectedLoan?.emiAmount) {
      return repairLegacyPartPaymentRows(scheduleRows, selectedLoan.emiAmount).partPayments;
    }
    return [];
  }, [scheduleRows, selectedLoan?.partPayments, selectedLoan?.emiAmount]);

  const loanInsights = useMemo(() => {
    if (scheduleRows.length === 0 || scheduleLoading) return null;
    return computeLoanDetailSummary(
      scheduleRows,
      emisPaidOverride,
      selectedLoan?.interestRate ?? null,
      selectedLoan?.scheduleRowCount ?? parsedRowCount,
      {
        emiAmount: selectedLoan?.emiAmount,
        openingPrincipal: selectedLoan?.principal,
        partPayments: effectivePartPayments,
      },
    );
  }, [
    scheduleRows,
    scheduleLoading,
    emisPaidOverride,
    selectedLoan?.interestRate,
    selectedLoan?.scheduleRowCount,
    selectedLoan?.emiAmount,
    selectedLoan?.principal,
    parsedRowCount,
    effectivePartPayments,
  ]);

  const analytics = loanInsights?.analytics ?? null;
  const progress = loanInsights?.progress ?? null;

  const nextScheduledPartPayment = useMemo(() => {
    if (!analytics?.nextInstallmentNo || scheduleRows.length === 0) return 0;
    const n = Number.parseInt(analytics.nextInstallmentNo.trim(), 10);
    if (!Number.isFinite(n)) return 0;
    for (const r of scheduleRows) {
      const rn = Number.parseInt(r.installmentNo.trim(), 10);
      if (rn === n) return rowPartPaymentAmount(r);
    }
    return 0;
  }, [analytics?.nextInstallmentNo, scheduleRows]);

  const activeLoanKey =
    selectedLoan ? `${selectedLoan.borrowerId}__${selectedLoan.id}` : null;

  const defaultPrepayAfterMonth = progress
    ? Math.min(progress.paidInstallments + 1, progress.totalInstallments)
    : 1;

  const prepayPlan = useMemo(() => {
    if (!prepayOpen || scheduleRows.length === 0 || !progress) return null;
    const rate = selectedLoan?.interestRate ?? progress.estimatedAnnualRate;
    const tenure = selectedLoan?.scheduleRowCount ?? parsedRowCount;
    const rules = parsePrepayRulesForPlan(prepayRules, tenure);
    if (rules.length === 0) return null;
    return buildPrepaymentPlan(scheduleRows, {
      rules,
      annualRatePercent: rate,
      tenureMonths: tenure,
    });
  }, [
    prepayOpen,
    scheduleRows,
    progress,
    selectedLoan?.interestRate,
    selectedLoan?.scheduleRowCount,
    parsedRowCount,
    prepayRules,
  ]);

  const syncBorrowersCloud = useCallback(async (list: LoanBorrower[], activeId: string) => {
    try {
      await saveLoanBorrowersDB({ borrowers: list, activeBorrowerId: activeId });
    } catch {
      toast.error("Could not sync family list to cloud.");
    }
  }, []);

  useEffect(() => {
    void loadLoanBorrowersDB().then((cloud) => {
      if (!cloud) return;
      setBorrowers(cloud.borrowers);
      persistLoanBorrowers(cloud.borrowers);
      const localActive = loadActiveLoanBorrowerId();
      const cloudIds = new Set(cloud.borrowers.map((b) => b.id));
      const preferred =
        localActive && cloudIds.has(localActive)
          ? localActive
          : resolveActiveLoanBorrowerId(cloud.borrowers, cloud.activeBorrowerId);
      setActiveBorrowerId((prev) => (prev === preferred ? prev : preferred));
      persistActiveLoanBorrowerId(preferred);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    void loadLoansForBorrower(activeBorrowerId)
      .then((list) => {
        if (cancelled) return;
        setLoanList(list);
        setSelectedLoanId((prev) => {
          if (list.length === 0) return null;
          if (prev && list.some((l) => l.id === prev)) return prev;
          return list[0]!.id;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoanList([]);
          toast.error("Could not load loans.");
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBorrowerId]);

  useEffect(() => {
    if (!selectedLoanId) {
      setSelectedLoan(null);
      setScheduleRows([]);
      setScheduleTruncated(false);
      setParsedRowCount(0);
      setEmisPaidOverride(null);
      setScheduleLoading(false);
      scheduleLoadedForIdRef.current = null;
      return;
    }

    if (skipDetailLoadRef.current === selectedLoanId) {
      skipDetailLoadRef.current = null;
      scheduleLoadedForIdRef.current = selectedLoanId;
      setScheduleLoading(false);
      return;
    }

    if (scheduleLoadedForIdRef.current === selectedLoanId && scheduleRows.length > 0) {
      setScheduleLoading(false);
      return;
    }

    const seq = ++detailLoadSeqRef.current;
    let cancelled = false;
    setScheduleRows([]);
    setScheduleTruncated(false);
    setParsedRowCount(0);
    setScheduleLoading(true);
    scheduleLoadedForIdRef.current = null;

    const listMeta = loanList.find((l) => l.id === selectedLoanId);
    if (listMeta) {
      setSelectedLoan({ ...listMeta, rows: [] });
    }

    const borrowerId = detailBorrowerIdRef.current;
    const loanId = selectedLoanId;

    void loadLoanDocForDetail(borrowerId, loanId)
      .then(async (result) => {
        if (seq !== detailLoadSeqRef.current) return;
        if (!result) {
          toast.error("Could not load loan.");
          setSelectedLoan(null);
          return;
        }
        const { meta, payload } = result;
        setSelectedLoan({ ...meta, rows: [] });
        setEmisPaidOverride(loadEmisPaidForLoan(`${meta.borrowerId}__${meta.id}`));

        const rows = await decodeLoanScheduleSafe(
          payload.encoding,
          payload.compressed,
          payload.chunks,
          payload.scheduleRowCount,
        );
        if (seq !== detailLoadSeqRef.current) return;

        const prepared = prepareScheduleRowsForUi(rows, payload.scheduleRowCount);
        scheduleLoadedForIdRef.current = loanId;
        setScheduleRows(prepared.rows);
        setScheduleTruncated(prepared.truncated);
        setParsedRowCount(prepared.originalCount);

        if (prepared.rows.length === 0 && payload.scheduleRowCount > 0) {
          toast.warn(
            "Schedule could not be decoded. Delete this loan and re-import with Preview extract.",
          );
        }
        if (prepared.truncated && prepared.rows.length > 0) {
          toast.warn(
            "Schedule has many rows — showing a capped subset. Re-import with column guide if totals look wrong.",
          );
        }
      })
      .catch((e) => {
        if (!cancelled && seq === detailLoadSeqRef.current) {
          const msg = e instanceof Error ? e.message : "Could not load repayment schedule.";
          toast.error(msg);
        }
      })
      .finally(() => {
        if (seq === detailLoadSeqRef.current) setScheduleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLoanId]);

  useEffect(() => {
    setSchedulePage(0);
    setPrepayOpen(false);
    setShowChart(false);
    setPrepayShowSchedule(false);
    setPrepaySchedulePage(0);
  }, [selectedLoanId]);

  useEffect(() => {
    if (!progress) return;
    const def = Math.min(progress.paidInstallments + 1, progress.totalInstallments);
    setPrepayRules([createPrepayRule(def)]);
  }, [selectedLoanId, progress?.totalInstallments]);

  useEffect(() => {
    if (!selectedLoanId || !progress || scheduleLoading) return;
    const override = loadEmisPaidForLoan(`${detailBorrowerIdRef.current}__${selectedLoanId}`);
    setEmisPaidInput(String(override ?? progress.paidInstallments));
  }, [selectedLoanId, scheduleLoading, progress?.totalInstallments]);

  useEffect(() => {
    setPrepaySchedulePage(0);
  }, [prepayRules]);

  const prepaySchedulePageCount = prepayPlan
    ? Math.max(1, Math.ceil(prepayPlan.schedulePreview.length / SCHEDULE_PAGE_SIZE))
    : 1;
  const prepayScheduleSlice = prepayPlan
    ? prepayPlan.schedulePreview.slice(
        prepaySchedulePage * SCHEDULE_PAGE_SIZE,
        (prepaySchedulePage + 1) * SCHEDULE_PAGE_SIZE,
      )
    : [];

  const switchBorrower = (id: string) => {
    setActiveBorrowerId(id);
    persistActiveLoanBorrowerId(id);
    syncBorrowersCloud(borrowers, id);
    setSelectedLoanId(null);
    setSelectedLoan(null);
    setScheduleRows([]);
    setScheduleTruncated(false);
    setParsedRowCount(0);
    setEmisPaidOverride(null);
    scheduleLoadedForIdRef.current = null;
  };

  const handleAddBorrower = () => {
    const res = addLoanBorrower(borrowers, newBorrowerName);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setBorrowers(res.borrowers);
    setNewBorrowerName("");
    setAddBorrowerOpen(false);
    switchBorrower(res.newId);
    syncBorrowersCloud(res.borrowers, res.newId);
    toast.success("Person added.");
  };

  const parseLoanPdf = useCallback(
    async (
      file: File,
      columnOrder: LoanColumnId[],
      boundaries?: LoanColumnBoundaries | null,
    ): Promise<{ rows: LoanScheduleRow[]; boundaries?: LoanColumnBoundaries }> => {
      const data = await file.arrayBuffer();
      const { extractLoanScheduleFromPdfData } = await import("./loans/extractLoanScheduleFromPdf");
      const result = await extractLoanScheduleFromPdfData(data, {
        columnOrder,
        columnBoundaries: boundaries ?? undefined,
      });
      return {
        rows: result.rows.filter((r) => !isLoanScheduleRowEmpty(r)),
        boundaries: result.boundaries,
      };
    },
    [],
  );

  const closeLoanModal = () => {
    setLoanModal(null);
    setLoanDraft(EMPTY_LOAN_DRAFT);
  };

  const openAddLoanModal = () => {
    setLoanModal({ mode: "add" });
    setLoanDraft(EMPTY_LOAN_DRAFT);
  };

  const openEditLoan = (loan: LoanRecord) => {
    const firstDue =
      loan.id === selectedLoanId && scheduleRows.length > 0
        ? scheduleRows[0]!.dueDate
        : "";
    setLoanModal({ mode: "edit", loan });
    setLoanDraft({
      name: loan.name,
      lender: loan.lender,
      loanType: loan.loanType,
      source: loan.scheduleFileName ? "pdf" : "manual",
      principal: loan.principal != null ? String(loan.principal) : "",
      rate: loan.interestRate != null ? String(loan.interestRate) : "",
      tenure: String(loan.tenureMonths ?? loan.scheduleRowCount ?? 240),
      startDate: firstDue ? isoDateFromDueDateText(firstDue) : "",
      regenerateSchedule: !loan.scheduleFileName,
      partPayments: [],
      pdfFile: null,
      columnOrder: loan.columnOrder ?? DEFAULT_LOAN_COLUMN_ORDER,
      boundaries: loan.columnBoundaries ?? null,
      pdfPreviewRows: null,
    });
  };

  const patchLoanDraft = (patch: Partial<LoanDraft>) => {
    setLoanDraft((d) => ({ ...d, ...patch }));
  };

  const handlePreviewLoanPdf = async () => {
    if (!loanDraft.pdfFile) {
      toast.info("Choose a repayment schedule PDF first.");
      return;
    }
    setLoanParsing(true);
    try {
      const { rows, boundaries } = await parseLoanPdf(
        loanDraft.pdfFile,
        loanDraft.columnOrder,
        loanDraft.boundaries,
      );
      patchLoanDraft({
        pdfPreviewRows: rows,
        boundaries: boundaries ?? loanDraft.boundaries,
      });
      if (rows.length === 0) toast.warn("No rows found — drag column dividers in Column guide.");
      else toast.success(`Found ${rows.length} installments.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read PDF.");
    } finally {
      setLoanParsing(false);
    }
  };

  const handleSaveLoan = async () => {
    if (!loanModal) return;
    const name = loanDraft.name.trim();
    const lender = loanDraft.lender.trim();
    if (!name) {
      toast.error("Enter a loan name.");
      return;
    }
    if (!lender) {
      toast.error("Enter lender name.");
      return;
    }

    const loanType = loanDraft.loanType.trim();

    if (loanModal.mode === "add") {
      let rowsToSave: LoanScheduleRow[] = [];
      let scheduleFileName: string | null = null;
      let columnOrder = loanDraft.columnOrder;
      let boundaries = loanDraft.boundaries;
      let principal: number | null = null;
      let interestRate: number | null = null;
      let tenureMonths: number | null = null;
      let emiAmount: number | null = null;
      let partPayments: LoanRecord["partPayments"] = undefined;

      if (loanDraft.source === "manual") {
        if (!termsPreview || termsPreview.rows.length === 0) {
          toast.error("Enter valid principal, interest rate, and tenure.");
          return;
        }
        rowsToSave = termsPreview.rows;
        scheduleFileName = null;
        columnOrder = DEFAULT_LOAN_COLUMN_ORDER;
        boundaries = null;
        principal = termsPreview.principal;
        interestRate = termsPreview.rate;
        tenureMonths = termsPreview.tenure;
        emiAmount = termsPreview.emi;
        const records = partPaymentRecordsFromDrafts(loanDraft.partPayments);
        if (records.length > 0) partPayments = records;
      } else {
        if (!loanDraft.pdfFile) {
          toast.error("Upload a repayment schedule PDF.");
          return;
        }
        if (!loanDraft.pdfPreviewRows?.length) {
          toast.info("Click Preview extract first to verify installments.");
          return;
        }
        const prepared = prepareScheduleRowsForUi(
          loanDraft.pdfPreviewRows,
          loanDraft.pdfPreviewRows.length,
        );
        rowsToSave = prepared.rows;
        if (rowsToSave.length === 0) {
          toast.error("No schedule rows extracted.");
          return;
        }
        if (prepared.truncated) {
          toast.warn(
            `Parsed ${prepared.originalCount} rows — saving ${rowsToSave.length}. Use column guide if junk rows were included.`,
          );
        }
        scheduleFileName = loanDraft.pdfFile.name;
        columnOrder = loanDraft.columnOrder;
        boundaries = loanDraft.boundaries;
        const derived = deriveLoanMetaFromSchedule(rowsToSave);
        principal = derived.principal;
        interestRate = derived.interestRate;
        tenureMonths = derived.tenureMonths;
        emiAmount = derived.emiAmount;
      }

      setLoanSaving(true);
      try {
        const id = newLoanId(name, loanList);
        const fingerprint = await fingerprintLoanSchedule(scheduleFileName ?? "manual", rowsToSave);
        const loanKey = `${activeBorrowerId}__${id}`;
        if (boundaries) {
          persistLoanColumnBoundariesForLoan(loanKey, boundaries);
        }

        const savedLoan: LoanRecord = {
          id,
          borrowerId: activeBorrowerId,
          name,
          lender,
          loanType,
          principal,
          interestRate,
          tenureMonths,
          emiAmount,
          columnOrder,
          columnBoundaries: boundaries,
          scheduleFileName,
          scheduleRowCount: tenureMonths ?? rowsToSave.length,
          scheduleFingerprint: fingerprint,
          partPayments,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
          rows: rowsToSave,
        };

        skipDetailLoadRef.current = id;
        scheduleLoadedForIdRef.current = id;
        const preparedSave = prepareScheduleRowsForUi(rowsToSave, tenureMonths ?? rowsToSave.length);
        setLoanList((prev) => [{ ...savedLoan, rows: [] }, ...prev.filter((l) => l.id !== id)]);
        setSelectedLoan({ ...savedLoan, rows: [] });
        setScheduleRows(preparedSave.rows);
        setScheduleTruncated(preparedSave.truncated);
        setParsedRowCount(preparedSave.originalCount);
        setSelectedLoanId(id);
        setEmisPaidOverride(null);
        closeLoanModal();

        await saveLoanRecord({
          id,
          borrowerId: activeBorrowerId,
          name,
          lender,
          loanType,
          principal,
          interestRate,
          tenureMonths,
          emiAmount,
          columnOrder,
          columnBoundaries: boundaries,
          scheduleFileName,
          scheduleRowCount: tenureMonths ?? rowsToSave.length,
          scheduleFingerprint: fingerprint,
          partPayments,
          rows: rowsToSave,
        });

        toast.success("Loan saved.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save loan.");
      } finally {
        setLoanSaving(false);
      }
      return;
    }

    const existing = loanModal.loan;
    const principal = parseMoneyInput(loanDraft.principal);
    const rate = parseMoneyInput(loanDraft.rate);
    const tenure = parseBoundedInt(
      loanDraft.tenure,
      1,
      600,
      existing.tenureMonths ?? existing.scheduleRowCount,
    );
    const isManual = !existing.scheduleFileName;
    const shouldRegenerate =
      isManual && loanDraft.regenerateSchedule && termsPreview && termsPreview.rows.length > 0;

    if (shouldRegenerate && !termsPreview) {
      toast.error("Enter valid principal, interest rate, and tenure.");
      return;
    }

    let rowsToSave = scheduleRows;
    if (existing.id !== selectedLoanId || scheduleRows.length === 0) {
      toast.error("Open this loan and wait for the schedule to load before saving.");
      return;
    }

    let emiAmount = existing.emiAmount;
    let scheduleFingerprint = existing.scheduleFingerprint;
    let principalVal = principal ?? existing.principal;
    let rateVal = rate ?? existing.interestRate;
    let tenureMonths = tenure;
    let partPayments = existing.partPayments;

    if (shouldRegenerate && termsPreview) {
      rowsToSave = termsPreview.rows;
      emiAmount = termsPreview.emi;
      principalVal = termsPreview.principal;
      rateVal = termsPreview.rate;
      tenureMonths = termsPreview.tenure;
      scheduleFingerprint = await fingerprintLoanSchedule("manual", rowsToSave);
      const records = partPaymentRecordsFromDrafts(loanDraft.partPayments);
      partPayments = records.length > 0 ? records : undefined;
    } else if (principal != null && principal > 0) {
      principalVal = principal;
    }
    if (rate != null && rate >= 0) rateVal = rate;
    if (emiAmount == null && principalVal != null && rateVal != null && tenureMonths > 0) {
      emiAmount = emiFromAnnualRate(principalVal, rateVal, tenureMonths);
    }

    setLoanSaving(true);
    try {
      const updated: LoanRecord = {
        ...existing,
        name,
        lender,
        loanType,
        principal: principalVal,
        interestRate: rateVal,
        tenureMonths,
        emiAmount,
        scheduleRowCount: tenureMonths,
        scheduleFingerprint,
        partPayments,
        updatedAtMs: Date.now(),
        rows: rowsToSave,
      };

      await saveLoanRecord({
        id: updated.id,
        borrowerId: updated.borrowerId,
        name: updated.name,
        lender: updated.lender,
        loanType: updated.loanType,
        principal: updated.principal,
        interestRate: updated.interestRate,
        tenureMonths: updated.tenureMonths,
        emiAmount: updated.emiAmount,
        columnOrder: updated.columnOrder,
        columnBoundaries: updated.columnBoundaries,
        scheduleFileName: updated.scheduleFileName,
        scheduleRowCount: updated.scheduleRowCount,
        scheduleFingerprint: updated.scheduleFingerprint,
        partPayments: updated.partPayments,
        createdAtMs: existing.createdAtMs,
        rows: rowsToSave,
      });

      skipDetailLoadRef.current = updated.id;
      scheduleLoadedForIdRef.current = updated.id;
      const prepared = prepareScheduleRowsForUi(rowsToSave, tenureMonths);
      setLoanList((prev) =>
        prev.map((l) => (l.id === updated.id ? { ...updated, rows: [] } : l)),
      );
      setSelectedLoan({ ...updated, rows: [] });
      if (selectedLoanId === updated.id) {
        setScheduleRows(prepared.rows);
        setScheduleTruncated(prepared.truncated);
        setParsedRowCount(prepared.originalCount);
      }
      closeLoanModal();
      toast.success("Loan updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update loan.");
    } finally {
      setLoanSaving(false);
    }
  };

  const openColumnGuideForForm = async () => {
    if (!loanDraft.pdfFile) return;
    const data = await loanDraft.pdfFile.arrayBuffer();
    setGuideColumnOrder(loanDraft.columnOrder);
    setGuideBoundaries(
      loanDraft.boundaries ?? equalColumnBoundaries(loanDraft.columnOrder.length + 1, 600),
    );
    setGuidePdf({ data, fileName: loanDraft.pdfFile.name, loanKey: "new-loan" });
  };

  const openColumnGuideForLoan = async (loan: LoanRecord) => {
    if (!loan.scheduleFileName) {
      toast.info("Re-upload PDF to adjust columns.");
      return;
    }
    toast.info("Upload the PDF again to use column guide on saved loans.");
  };

  const handleDeleteLoan = async (loan: LoanRecord) => {
    if (!confirm(`Delete loan "${loan.name}"?`)) return;
    await deleteLoanRecord(loan.borrowerId, loan.id);
    toast.success("Loan deleted.");
    const list = await loadLoansForBorrower(activeBorrowerId);
    setLoanList(list);
    if (selectedLoanId === loan.id) {
      setSelectedLoanId(list[0]?.id ?? null);
      setSelectedLoan(null);
      setScheduleRows([]);
      setScheduleTruncated(false);
      setParsedRowCount(0);
      setEmisPaidOverride(null);
      scheduleLoadedForIdRef.current = null;
      clearEmisPaidForLoan(`${loan.borrowerId}__${loan.id}`);
    }
  };

  const activeBorrower = borrowers.find((b) => b.id === activeBorrowerId);
  const headerLoan = selectedLoan ?? loanList.find((l) => l.id === selectedLoanId) ?? null;

  return (
    <div className="min-h-screen bg-[#eef2f7] text-gray-900">
      <header className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-500">Loans</p>
            <h1 className="text-lg font-bold text-gray-900">EMI tracker</h1>
          </div>
          <a href="/admin" className="text-sm text-gray-600 hover:text-indigo-600">← Admin</a>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3 flex flex-wrap gap-2 items-center">
          {borrowers.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => switchBorrower(b.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                b.id === activeBorrowerId
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-200 text-gray-700"
              }`}
            >
              {b.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAddBorrowerOpen(true)}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
          >
            + Person
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-2xl border border-gray-200/90 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">
              {activeBorrower?.name ?? "Loans"}
            </h2>
            <button
              type="button"
              onClick={() => openAddLoanModal()}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
            >
              + Loan
            </button>
          </div>
          {listLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : loanList.length === 0 ? (
            <p className="text-sm text-gray-500">No loans yet. Add one from a PDF or enter details manually.</p>
          ) : (
            <ul className="space-y-1">
              {loanList.map((loan) => (
                <li key={loan.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedLoanId(loan.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                      loan.id === selectedLoanId
                        ? "bg-indigo-50 text-indigo-900 font-medium"
                        : "hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    <span className="block truncate">{loan.name}</span>
                    <span className="block text-xs text-gray-500 truncate">{loan.lender}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          {listLoading && loanList.length === 0 ? (
            <div className="rounded-2xl border border-gray-200/90 bg-white p-8 text-center text-gray-500 shadow-sm">
              Loading loans…
            </div>
          ) : !headerLoan ? (
            <div className="rounded-2xl border border-gray-200/90 bg-white p-8 text-center text-gray-500 shadow-sm">
              Select a loan or add one to see the repayment schedule.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{headerLoan.name}</h2>
                    <p className="text-sm text-gray-500">{headerLoan.lender}</p>
                    {headerLoan.loanType && (
                      <p className="text-xs text-gray-400 mt-0.5">{headerLoan.loanType}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditLoan(headerLoan)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => openColumnGuideForLoan(headerLoan)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Column guide
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLoan(headerLoan)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {scheduleLoading && scheduleRows.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">Loading schedule rows…</p>
              )}

              {!scheduleLoading && scheduleRows.length === 0 && selectedLoanId && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No schedule rows to display. Re-import with Preview extract.
                </p>
              )}

              {!scheduleLoading && analytics && progress && (
                <div className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] uppercase text-gray-400 font-semibold">Principal</p>
                      <p className="text-lg font-bold tabular-nums">
                        ₹{formatLoanInr(headerLoan.principal ?? analytics.openingPrincipal ?? analytics.totalPrincipal)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-3">
                      <p className="text-[10px] uppercase text-blue-500 font-semibold">EMI</p>
                      <p className="text-lg font-bold tabular-nums text-blue-900">
                        ₹{formatLoanInr(headerLoan.emiAmount ?? analytics.avgEmi)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-[10px] uppercase text-amber-600 font-semibold">Interest rate</p>
                      <p className="text-lg font-bold tabular-nums text-amber-900">
                        {progress.estimatedAnnualRate != null
                          ? `${formatLoanRate(progress.estimatedAnnualRate)}%`
                          : headerLoan.interestRate != null
                            ? `${formatLoanRate(headerLoan.interestRate)}%`
                            : "—"}
                      </p>
                      <p className="text-[10px] text-amber-700/80">per year (est.)</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <p className="text-[10px] uppercase text-emerald-600 font-semibold">Interest (full)</p>
                      <p className="text-lg font-bold tabular-nums text-emerald-900">
                        ₹{formatLoanInr(analytics.totalInterest)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-violet-50 p-3">
                      <p className="text-[10px] uppercase text-violet-600 font-semibold">Balance now</p>
                      <p className="text-lg font-bold tabular-nums text-violet-900">
                        ₹{formatLoanInr(progress.currentBalance ?? analytics.closingBalance ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-indigo-50 p-3">
                      <p className="text-[10px] uppercase text-indigo-600 font-semibold">EMIs</p>
                      <p className="text-lg font-bold tabular-nums text-indigo-900">
                        {progress.paidInstallments}/{progress.totalInstallments}
                      </p>
                      <p className="text-[10px] text-indigo-700/80">{progress.emisRemaining} left</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800">EMI progress</h3>
                      <span className="text-xs text-gray-500">{progress.completionPercent}% complete</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${progress.completionPercent}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 items-end">
                      <label className="text-xs text-gray-600 space-y-1">
                        <span>EMIs paid (adjust if needed)</span>
                        <input
                          type="number"
                          min={0}
                          max={progress.totalInstallments}
                          value={emisPaidInput}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEmisPaidInput(raw);
                            if (!activeLoanKey) return;
                            if (raw === "") {
                              setEmisPaidOverride(null);
                              clearEmisPaidForLoan(activeLoanKey);
                              return;
                            }
                            const n = Number(raw);
                            if (!Number.isFinite(n)) return;
                            const v = Math.min(
                              progress.totalInstallments,
                              Math.max(0, Math.round(n)),
                            );
                            setEmisPaidOverride(v);
                            persistEmisPaidForLoan(activeLoanKey, v);
                          }}
                          onBlur={() => {
                            if (!activeLoanKey || !progress) return;
                            if (emisPaidInput.trim() === "") {
                              const fallback = progress.paidByDueDate;
                              setEmisPaidInput(String(fallback));
                              setEmisPaidOverride(null);
                              clearEmisPaidForLoan(activeLoanKey);
                              return;
                            }
                            const v = parseBoundedInt(
                              emisPaidInput,
                              0,
                              progress.totalInstallments,
                              progress.paidByDueDate,
                            );
                            setEmisPaidInput(String(v));
                            setEmisPaidOverride(v);
                            persistEmisPaidForLoan(activeLoanKey, v);
                          }}
                          className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm tabular-nums"
                        />
                      </label>
                      <button
                        type="button"
                        className="text-xs text-indigo-600 hover:text-indigo-800"
                        onClick={() => {
                          if (!activeLoanKey || !progress) return;
                          setEmisPaidOverride(null);
                          clearEmisPaidForLoan(activeLoanKey);
                          setEmisPaidInput(String(progress.paidByDueDate));
                        }}
                      >
                        Reset to due dates ({progress.paidByDueDate} paid)
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-white border border-gray-100 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase">Paid so far</p>
                        <p className="mt-1 tabular-nums">
                          Principal <span className="font-semibold">₹{formatLoanInr(progress.principalPaid)}</span>
                        </p>
                        <p className="tabular-nums">
                          Interest <span className="font-semibold">₹{formatLoanInr(progress.interestPaid)}</span>
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Total ₹{formatLoanInr(progress.totalPaid)}</p>
                      </div>
                      <div className="rounded-lg bg-white border border-gray-100 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase">Still to pay</p>
                        <p className="mt-1 tabular-nums">
                          Principal <span className="font-semibold">₹{formatLoanInr(progress.principalRemaining)}</span>
                        </p>
                        <p className="tabular-nums">
                          Interest <span className="font-semibold">₹{formatLoanInr(progress.interestRemaining)}</span>
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Total ₹{formatLoanInr(progress.totalRemaining)}</p>
                      </div>
                    </div>
                  </div>

                  {analytics.nextDueDate && (
                    <p className="text-sm text-gray-600">
                      Next due: <span className="font-semibold">{analytics.nextDueDate}</span>
                      {analytics.nextEmiAmount != null && (
                        <> · EMI ₹{formatLoanInr(analytics.nextEmiAmount)}</>
                      )}
                      {nextScheduledPartPayment > 0 && (
                        <>
                          {" "}
                          · part payment ₹{formatLoanInr(nextScheduledPartPayment)} on that date
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {scheduleRows.length > 0 && progress && (
                <div className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
                  {prepayOpen ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-800">Prepayment plan</h3>
                        <button
                          type="button"
                          className="text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => setPrepayOpen(false)}
                        >
                          Close
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Add one or more prepayments. Same EMI kept.{" "}
                        <span className="text-gray-400">
                          Every 0 = once after that EMI · 1 = monthly · 12 = yearly · Close loan = full
                          balance at that EMI.
                        </span>
                      </p>

                      <div className="space-y-2">
                        {prepayRules.map((rule) => (
                          <div
                            key={rule.id}
                            className="flex flex-wrap gap-2 items-end rounded-lg border border-gray-100 bg-gray-50/80 p-3"
                          >
                            <label className="text-xs text-gray-600 space-y-1">
                              <span>After EMI #</span>
                              <input
                                type="number"
                                min={1}
                                max={progress.totalInstallments}
                                value={rule.afterInstallmentInput}
                                onChange={(e) =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? { ...r, afterInstallmentInput: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                onBlur={() =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? {
                                            ...r,
                                            afterInstallmentInput: String(
                                              parseBoundedInt(
                                                r.afterInstallmentInput,
                                                1,
                                                progress.totalInstallments,
                                                defaultPrepayAfterMonth,
                                              ),
                                            ),
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm tabular-nums bg-white"
                              />
                            </label>
                            <label className="text-xs text-gray-600 space-y-1 min-w-[120px]">
                              <span>Amount (₹)</span>
                              <input
                                type="text"
                                value={rule.closeLoan ? "" : rule.amountInput}
                                disabled={rule.closeLoan}
                                placeholder={rule.closeLoan ? "Full balance" : "100000"}
                                onChange={(e) =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id ? { ...r, amountInput: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm tabular-nums bg-white disabled:bg-gray-100"
                              />
                            </label>
                            <label className="text-xs text-gray-600 space-y-1">
                              <span>Every (mo)</span>
                              <input
                                type="number"
                                min={0}
                                max={120}
                                value={rule.closeLoan ? "" : rule.everyMonthsInput}
                                disabled={rule.closeLoan}
                                placeholder={rule.closeLoan ? "—" : "0=once"}
                                onChange={(e) =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? { ...r, everyMonthsInput: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                onBlur={() =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id && !r.closeLoan
                                        ? {
                                            ...r,
                                            everyMonthsInput: String(
                                              parseBoundedInt(r.everyMonthsInput, 0, 120, 0),
                                            ),
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm tabular-nums bg-white disabled:bg-gray-100"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
                              <input
                                type="checkbox"
                                checked={rule.closeLoan}
                                onChange={(e) =>
                                  setPrepayRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? { ...r, closeLoan: e.target.checked }
                                        : r,
                                    ),
                                  )
                                }
                                className="rounded border-gray-300"
                              />
                              Close loan
                            </label>
                            {prepayRules.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-red-600 hover:text-red-800 pb-1.5"
                                onClick={() =>
                                  setPrepayRules((prev) => prev.filter((r) => r.id !== rule.id))
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          onClick={() =>
                            setPrepayRules((prev) => [
                              ...prev,
                              createPrepayRule(defaultPrepayAfterMonth),
                            ])
                          }
                        >
                          + Add prepayment
                        </button>
                      </div>

                      {prepayPlan ? (
                        <div className="space-y-3">
                          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-3">
                              <p className="text-[10px] uppercase text-emerald-700 font-semibold">
                                Interest saved
                              </p>
                              <p className="text-lg font-bold tabular-nums text-emerald-900">
                                ₹{formatLoanInr(prepayPlan.interestSaved)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 p-3">
                              <p className="text-[10px] uppercase text-indigo-700 font-semibold">
                                Tenure change
                              </p>
                              <p className="text-lg font-bold tabular-nums text-indigo-900">
                                −{prepayPlan.monthsSaved} EMIs
                              </p>
                              <p className="text-[10px] text-indigo-700/80">
                                {prepayPlan.originalRemainingMonths} → {prepayPlan.newRemainingMonths} left
                              </p>
                            </div>
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                              <p className="text-[10px] uppercase text-gray-500 font-semibold">
                                Future interest
                              </p>
                              <p className="text-sm tabular-nums">
                                <span className="text-gray-400">Without </span>
                                ₹{formatLoanInr(prepayPlan.originalTotalInterest)}
                              </p>
                              <p className="text-sm tabular-nums font-semibold">
                                <span className="text-gray-400">With plan </span>
                                ₹{formatLoanInr(prepayPlan.newTotalInterest)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                              <p className="text-[10px] uppercase text-gray-500 font-semibold">
                                Extra paid
                              </p>
                              <p className="text-lg font-bold tabular-nums">
                                ₹{formatLoanInr(prepayPlan.totalExtraPaid)}
                              </p>
                            </div>
                          </div>

                          {prepayPlan.schedulePreview.length > 0 && (
                            <div>
                              <button
                                type="button"
                                className="text-xs text-indigo-600 hover:text-indigo-800"
                                onClick={() => setPrepayShowSchedule((v) => !v)}
                              >
                                {prepayShowSchedule ? "Hide" : "Show"} projected schedule (
                                {prepayPlan.schedulePreview.length} EMIs)
                              </button>
                              {prepayShowSchedule && (
                                <div className="mt-2 space-y-2">
                                  {prepayPlan.schedulePreview.length > SCHEDULE_PAGE_SIZE && (
                                    <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                                      <span>
                                        Page {prepaySchedulePage + 1} of {prepaySchedulePageCount}
                                      </span>
                                      <div className="flex gap-1">
                                        <button
                                          type="button"
                                          disabled={prepaySchedulePage === 0}
                                          onClick={() =>
                                            setPrepaySchedulePage((p) => Math.max(0, p - 1))
                                          }
                                          className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40"
                                        >
                                          Prev
                                        </button>
                                        <button
                                          type="button"
                                          disabled={prepaySchedulePage >= prepaySchedulePageCount - 1}
                                          onClick={() =>
                                            setPrepaySchedulePage((p) =>
                                              Math.min(prepaySchedulePageCount - 1, p + 1),
                                            )
                                          }
                                          className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40"
                                        >
                                          Next
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  <div className="overflow-x-auto max-h-80 border border-gray-100 rounded-lg">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                                        <tr>
                                          <th className="px-2 py-1.5 text-left">EMI</th>
                                          <th className="px-2 py-1.5 text-left">Due date</th>
                                          <th className="px-2 py-1.5 text-right">Opening</th>
                                          <th className="px-2 py-1.5 text-right">EMI</th>
                                          <th className="px-2 py-1.5 text-right">Interest</th>
                                          <th className="px-2 py-1.5 text-right">Principal</th>
                                          <th className="px-2 py-1.5 text-right">Extra</th>
                                          <th className="px-2 py-1.5 text-right">Closing</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {prepayScheduleSlice.map((step) => (
                                          <tr key={step.installmentNo} className="border-t border-gray-50">
                                            <td className="px-2 py-1 tabular-nums">{step.installmentNo}</td>
                                            <td className="px-2 py-1 text-gray-600 whitespace-nowrap">
                                              {step.dueDate || "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums">
                                              {step.openingBalance > 0
                                                ? formatLoanInr(step.openingBalance)
                                                : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums">
                                              {step.emi > 0 ? formatLoanInr(step.emi) : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums">
                                              {step.interest > 0 ? formatLoanInr(step.interest) : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums">
                                              {step.principal > 0 ? formatLoanInr(step.principal) : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums text-emerald-700">
                                              {step.extraPrepay > 0 ? formatLoanInr(step.extraPrepay) : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right tabular-nums">
                                              {formatLoanInr(step.closingBalance)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {prepayPlan.newRemainingMonths === 0 && (
                                    <p className="text-xs text-gray-500">
                                      Loan closes at EMI #
                                      {prepayPlan.schedulePreview[prepayPlan.schedulePreview.length - 1]
                                        ?.installmentNo ?? "—"}
                                      .
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">
                          Add at least one valid prepayment rule (amount or close loan).
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPrepayOpen(true)}
                      className="w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Open prepayment plan calculator
                    </button>
                  )}
                </div>
              )}

              {scheduleRows.length > 0 && (
                <div className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
                  {showChart ? (
                    <Suspense fallback={<p className="text-sm text-gray-500 text-center py-6">Loading chart…</p>}>
                      <LoanScheduleChart rows={scheduleRows} />
                    </Suspense>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowChart(true)}
                      className="w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Show principal vs interest chart
                    </button>
                  )}
                </div>
              )}

              {scheduleRows.length > 0 && (
                <div className="rounded-2xl border border-gray-200/90 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-gray-100 px-4 py-3 flex justify-between items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-800">
                      Schedule · {scheduleRows.length} rows
                      {scheduleTruncated && (
                        <span className="text-gray-400 font-normal">
                          {" "}
                          ({parsedRowCount} parsed, capped for display)
                        </span>
                      )}
                    </h3>
                    {headerLoan.scheduleFileName && (
                      <span className="text-xs text-gray-400 truncate max-w-[200px]">
                        {headerLoan.scheduleFileName}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-[480px]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Due date</th>
                          <th className="px-3 py-2 text-right">EMI</th>
                          <th className="px-3 py-2 text-right">Interest</th>
                          <th className="px-3 py-2 text-right">Principal</th>
                          <th className="px-3 py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleSlice.map((row, i) => (
                          <tr
                            key={`${schedulePage}-${schedulePage * SCHEDULE_PAGE_SIZE + i}`}
                            className="border-t border-gray-50 hover:bg-gray-50/80"
                          >
                            <td className="px-3 py-1.5 tabular-nums">
                              {row.installmentNo || schedulePage * SCHEDULE_PAGE_SIZE + i + 1}
                            </td>
                            <td className="px-3 py-1.5">{row.dueDate}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{row.installmentAmount}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{row.interest}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{row.principal}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{row.balancePrincipal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {schedulePageCount > 1 && (
                    <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2 text-sm">
                      <button
                        type="button"
                        disabled={schedulePage === 0}
                        onClick={() => setSchedulePage((p) => Math.max(0, p - 1))}
                        className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <span className="text-gray-500 text-xs">
                        Page {schedulePage + 1} of {schedulePageCount}
                      </span>
                      <button
                        type="button"
                        disabled={schedulePage >= schedulePageCount - 1}
                        onClick={() => setSchedulePage((p) => Math.min(schedulePageCount - 1, p + 1))}
                        className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {addBorrowerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setAddBorrowerOpen(false)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Add family member</h2>
            <input
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Name"
              value={newBorrowerName}
              onChange={(e) => setNewBorrowerName(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button type="button" className="flex-1 rounded-lg border py-2 text-sm" onClick={() => setAddBorrowerOpen(false)}>Cancel</button>
              <button type="button" className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm text-white font-medium" onClick={handleAddBorrower}>Add</button>
            </div>
          </div>
        </div>
      )}

      {loanModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onMouseDown={(e) => e.target === e.currentTarget && closeLoanModal()}
        >
          <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-xl max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">
              {loanModal.mode === "add" ? "Add loan" : "Edit loan"}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {loanModal.mode === "add"
                ? `For ${activeBorrower?.name} — import a schedule PDF or enter loan terms manually.`
                : editingLoan?.scheduleFileName
                  ? "Update loan details — schedule rows stay as imported unless you re-add the loan with a PDF."
                  : "Update loan details — regenerate schedule when loan terms change."}
            </p>
            {loanModal.mode === "add" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => patchLoanDraft({ source: "pdf" })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                    loanDraft.source === "pdf"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  From PDF
                </button>
                <button
                  type="button"
                  onClick={() => patchLoanDraft({ source: "manual" })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                    loanDraft.source === "manual"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  Manual entry
                </button>
              </div>
            )}
            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder={loanModal.mode === "add" ? "Loan name (e.g. Home loan)" : "Loan name"}
                value={loanDraft.name}
                onChange={(e) => patchLoanDraft({ name: e.target.value })}
              />
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder={loanModal.mode === "add" ? "Lender (e.g. HDFC)" : "Lender"}
                value={loanDraft.lender}
                onChange={(e) => patchLoanDraft({ lender: e.target.value })}
              />
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder={
                  loanModal.mode === "add"
                    ? "Type (optional — home, car, personal)"
                    : "Type (optional)"
                }
                value={loanDraft.loanType}
                onChange={(e) => patchLoanDraft({ loanType: e.target.value })}
              />
              {loanModal.mode === "add" && loanDraft.source === "manual" ? (
                <>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                    placeholder="Principal (₹)"
                    value={loanDraft.principal}
                    onChange={(e) => patchLoanDraft({ principal: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                      placeholder="Interest rate %"
                      value={loanDraft.rate}
                      onChange={(e) => patchLoanDraft({ rate: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                      placeholder="Tenure (months)"
                      value={loanDraft.tenure}
                      onChange={(e) => patchLoanDraft({ tenure: e.target.value })}
                      onBlur={() =>
                        patchLoanDraft({
                          tenure: String(parseBoundedInt(loanDraft.tenure, 1, 600, 240)),
                        })
                      }
                    />
                  </div>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">
                      First EMI date (optional)
                    </span>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={loanDraft.startDate}
                      onChange={(e) => patchLoanDraft({ startDate: e.target.value })}
                    />
                  </label>
                  <PartPaymentsEditor
                    partPayments={loanDraft.partPayments}
                    onChange={(partPayments) => patchLoanDraft({ partPayments })}
                  />
                  {termsPreview && (
                    <p className="text-sm text-emerald-700 font-medium">
                      EMI ₹{formatLoanInr(termsPreview.emi)} · {termsPreview.rows.length}{" "}
                      installments
                      {termsPreview.partPaymentCount > 0 && (
                        <>
                          {" "}
                          · {termsPreview.partPaymentCount} part payments (₹
                          {formatLoanInr(termsPreview.partPaymentTotal)})
                        </>
                      )}
                      {termsPreview.rows.length < termsPreview.tenure && (
                        <> · loan closes in {termsPreview.rows.length} months</>
                      )}
                    </p>
                  )}
                </>
              ) : loanModal.mode === "add" ? (
                <>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Repayment schedule PDF</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="mt-1 w-full text-sm"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        patchLoanDraft({ pdfFile: f ?? null, pdfPreviewRows: null });
                      }}
                    />
                  </label>
                  <ColumnOrderEditor
                    order={loanDraft.columnOrder}
                    onChange={(columnOrder) => patchLoanDraft({ columnOrder })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!loanDraft.pdfFile || loanParsing || loanSaving}
                      onClick={() => void handlePreviewLoanPdf()}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loanParsing ? "Reading…" : "Preview extract"}
                    </button>
                    <button
                      type="button"
                      disabled={!loanDraft.pdfFile}
                      onClick={() => void openColumnGuideForForm()}
                      className="rounded-lg border border-indigo-200 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      Column guide
                    </button>
                  </div>
                  {loanDraft.pdfPreviewRows && (
                    <p className="text-sm text-emerald-700 font-medium">
                      {loanDraft.pdfPreviewRows.length} installments ready to save.
                    </p>
                  )}
                  {loanDraft.pdfFile && !loanDraft.pdfPreviewRows?.length && !loanParsing && (
                    <p className="text-sm text-amber-700">Click Preview extract before saving.</p>
                  )}
                </>
              ) : (
                <>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                    placeholder="Principal (₹)"
                    value={loanDraft.principal}
                    onChange={(e) => patchLoanDraft({ principal: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                      placeholder="Interest rate %"
                      value={loanDraft.rate}
                      onChange={(e) => patchLoanDraft({ rate: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums"
                      placeholder="Tenure (months)"
                      value={loanDraft.tenure}
                      onChange={(e) => patchLoanDraft({ tenure: e.target.value })}
                      onBlur={() =>
                        patchLoanDraft({
                          tenure: String(
                            parseBoundedInt(
                              loanDraft.tenure,
                              1,
                              600,
                              editingLoan?.tenureMonths ?? editingLoan?.scheduleRowCount ?? 240,
                            ),
                          ),
                        })
                      }
                    />
                  </div>
                  {!editingLoan?.scheduleFileName && (
                    <>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">
                          First EMI date (optional)
                        </span>
                        <input
                          type="date"
                          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          value={loanDraft.startDate}
                          onChange={(e) => patchLoanDraft({ startDate: e.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={loanDraft.regenerateSchedule}
                          onChange={(e) =>
                            patchLoanDraft({ regenerateSchedule: e.target.checked })
                          }
                          className="rounded border-gray-300"
                        />
                        Regenerate schedule from updated terms
                      </label>
                      {loanDraft.regenerateSchedule && (
                        <PartPaymentsEditor
                          partPayments={loanDraft.partPayments}
                          onChange={(partPayments) => patchLoanDraft({ partPayments })}
                        />
                      )}
                      {loanDraft.regenerateSchedule && termsPreview && (
                        <p className="text-sm text-emerald-700 font-medium">
                          EMI ₹{formatLoanInr(termsPreview.emi)} · {termsPreview.rows.length}{" "}
                          installments
                          {termsPreview.partPaymentCount > 0 && (
                            <>
                              {" "}
                              · {termsPreview.partPaymentCount} part payments (₹
                              {formatLoanInr(termsPreview.partPaymentTotal)})
                            </>
                          )}
                          {termsPreview.rows.length < termsPreview.tenure && (
                            <> · loan closes in {termsPreview.rows.length} months</>
                          )}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border py-2 text-sm"
                onClick={() => closeLoanModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  loanSaving ||
                  loanParsing ||
                  (loanModal.mode === "add"
                    ? loanDraft.source === "manual"
                      ? !termsPreview?.rows.length
                      : !loanDraft.pdfPreviewRows?.length
                    : scheduleLoading ||
                      (editingLoan?.id === selectedLoanId && scheduleRows.length === 0))
                }
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm text-white font-medium disabled:opacity-50"
                onClick={() => void handleSaveLoan()}
              >
                {loanSaving
                  ? "Saving…"
                  : loanModal.mode === "add"
                    ? "Save loan"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {guidePdf && (
        <Suspense fallback={null}>
          <LoansPdfColumnGuideModal
            data={guidePdf.data}
            fileName={guidePdf.fileName}
            columnOrder={guideColumnOrder}
            columnBoundaries={guideBoundaries}
            onColumnBoundariesChange={(b) => {
              setGuideBoundaries(b);
              if (guidePdf.loanKey === "new-loan") {
                patchLoanDraft({ boundaries: b, pdfPreviewRows: null });
              }
            }}
            onClose={() => setGuidePdf(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
