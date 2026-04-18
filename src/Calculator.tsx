import { useState, useEffect, useMemo, useLayoutEffect } from "react";
import { toast } from "react-toastify";
import { toastApiError } from "./apiToast";
import {
  calculateTotal,
  parseWhatsAppMessages,
  splitWhatsAppInputByContact,
  computePatternAccuracy,
  mergeIntoSessions,
  getCurrentSlot,
  formatSlotTime,
  slotMinutes,
  NO_CONFIGURED_SLOTS_PLACEHOLDER_ID,
  upsertPaymentStubs,
  type ParsedMessage,
} from "./calcUtils";
import EditableBreakdown from "./EditableBreakdown";
import ReportIssue from "./ReportIssue";
import type { CalculationAuditPayload } from "./firestoreDb";
import type {
  CalculationResult,
  SavedSession,
  GameSlot,
  AppSettings,
  PaymentRecord,
} from "./types";

interface Props {
  slots: GameSlot[];
  settings: AppSettings;
  loadSessionsByDate: (date: string) => Promise<SavedSession[]>;
  loadPaymentsByDate: (date: string) => Promise<PaymentRecord[]>;
  saveSessionDoc: (session: SavedSession) => Promise<void>;
  savePaymentDoc: (payment: PaymentRecord) => Promise<void>;
  logCalculationAudit: (payload: CalculationAuditPayload) => Promise<void>;
}

// ─── Auto-detect slot from a timestamp string ─────────────────────────────────
function detectSlotFromTimestamp(
  timeStr: string,
  slots: GameSlot[]
): GameSlot | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3]?.toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  const msgMinutes = h * 60 + m;
  const enabled = slots.filter((s) => s.enabled);
  const sorted = [...enabled].sort(
    (a, b) => slotMinutes(a.time) - slotMinutes(b.time)
  );
  return (
    sorted.find((s) => slotMinutes(s.time) > msgMinutes) ?? sorted[0] ?? null
  );
}

function todayDate(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}/${String(
    now.getMonth() + 1
  ).padStart(2, "0")}/${now.getFullYear()}`;
}

function newBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
}

const lineCountFormatter = new Intl.NumberFormat("en-IN");

/** Normalize pasted body text so duplicate segment detection is stable across OS line endings. */
function normPasteText(s: string): string {
  return s.trim().replace(/\r\n/g, "\n");
}

/** WhatsApp header contact(s); empty / missing → `User ${fallbackIndex1}` (1-based). */
function uniqueContactLabel(
  messages: ParsedMessage[],
  fallbackIndex1: number
): string {
  const uniq = [
    ...new Set(
      messages
        .map((m) => m.contact.replace(/\s+/g, " ").trim())
        .filter((c) => c.length > 0)
    ),
  ];
  if (uniq.length === 0) return `User ${fallbackIndex1}`;
  if (uniq.length === 1) return uniq[0];
  if (uniq.length <= 3) return uniq.join(", ");
  return `${uniq.slice(0, 2).join(", ")} +${uniq.length - 2} more`;
}

type CalcBlock = {
  id: string;
  label: string;
  text: string;
  labelLocked?: boolean;
};

type TaggedMessages = ReturnType<typeof parseWhatsAppMessages> extends
  | (infer T)[]
  | null
  ? T & { slotId: string }
  : never;

/** Unique slot display names in message order (WA per-message assignment). */
function summarizeWaSlots(
  tagged: Array<{ slotId: string }>,
  allSlots: GameSlot[]
): string {
  const nameById = new Map(allSlots.map((s) => [s.id, s.name]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of tagged) {
    const label = nameById.get(m.slotId) ?? m.slotId;
    if (!seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order.join(", ");
}

/** All WhatsApp messages from every block, in order (for multi-game detection). */
function collectAllParsedWaMessages(blocks: CalcBlock[]): ParsedMessage[] {
  const out: ParsedMessage[] = [];
  for (const b of blocks) {
    const m = parseWhatsAppMessages(b.text);
    if (m?.length) out.push(...m);
  }
  return out;
}

type PerUserCalc = {
  blockId: string;
  label: string;
  text: string;
  result: CalculationResult;
  pendingTagged: TaggedMessages[] | null;
  isWAMode: boolean;
  /** WhatsApp messages where timestamp did not map to a game (menu fallback used). */
  waSlotFallbackCount?: number;
};

export default function Calculator({
  slots,
  settings,
  loadSessionsByDate,
  loadPaymentsByDate,
  saveSessionDoc,
  savePaymentDoc,
  logCalculationAudit,
}: Props) {
  const [blocks, setBlocks] = useState<CalcBlock[]>([
    { id: newBlockId(), label: "User 1", text: "", labelLocked: false },
  ]);
  const [userResults, setUserResults] = useState<PerUserCalc[] | null>(null);
  /** Which user row has line-by-line breakdown open (accordion, one at a time). */
  const [expandedResultBlockId, setExpandedResultBlockId] = useState<
    string | null
  >(null);
  /** After opening a row, scroll its title into view (see useLayoutEffect below). */
  const [accordionScrollToBlockId, setAccordionScrollToBlockId] = useState<
    string | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [savedInfo, setSavedInfo] = useState<{
    date: string;
    slots: string[];
  } | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  /** Comma-separated game names from all WA lines (all blocks); null if no WA paste. */
  const [detectedSlotsSummary, setDetectedSlotsSummary] = useState<
    string | null
  >(null);
  /** More than one distinct game inferred from timestamps across the paste. */
  const [detectedMultiSlots, setDetectedMultiSlots] = useState(false);
  /** When exactly one game applies to all WA lines — used for "Reset to auto" + syncing the dropdown. */
  const [waSingleFallbackSlotId, setWaSingleFallbackSlotId] = useState<
    string | null
  >(null);
  const [slotOverridden, setSlotOverridden] = useState(false);

  const enabledSlots = slots.filter((s) => s.enabled);
  const autoSlot = getCurrentSlot(slots);

  const [selectedSlotId, setSelectedSlotId] = useState<string>(autoSlot.id);

  const blocksTextSig = useMemo(
    () => blocks.map((b) => `${b.label}\t${b.text}`).join("\n~\n"),
    [blocks]
  );

  useEffect(() => {
    if (!enabledSlots.find((s) => s.id === selectedSlotId)) {
      setSelectedSlotId(autoSlot.id);
    }
  }, [slots, enabledSlots, selectedSlotId, autoSlot.id]);

  useLayoutEffect(() => {
    if (!accordionScrollToBlockId) return;
    const el = document.getElementById(
      `result-user-${accordionScrollToBlockId}`
    );
    el?.scrollIntoView({ block: "start", behavior: "auto", inline: "nearest" });
    setAccordionScrollToBlockId(null);
  }, [accordionScrollToBlockId]);

  // Auto-detect games from all WhatsApp lines (all blocks); sync dropdown only when a single game applies
  useEffect(() => {
    const allMsgs = collectAllParsedWaMessages(blocks);
    const fallbackSlot =
      enabledSlots.find((s) => s.id === selectedSlotId) ?? autoSlot;

    if (allMsgs.length > 0) {
      const tagged = allMsgs.map((msg) => ({
        slotId: (detectSlotFromTimestamp(msg.timestamp, slots) ?? fallbackSlot)
          .id,
      }));
      const summary = summarizeWaSlots(tagged, slots);
      const uniqueIds = [...new Set(tagged.map((t) => t.slotId))];

      setDetectedSlotsSummary(summary || null);
      setDetectedMultiSlots(uniqueIds.length > 1);
      setWaSingleFallbackSlotId(uniqueIds.length === 1 ? uniqueIds[0] : null);

      if (!slotOverridden && uniqueIds.length === 1) {
        setSelectedSlotId(uniqueIds[0]);
      }
    } else {
      setDetectedSlotsSummary(null);
      setDetectedMultiSlots(false);
      setWaSingleFallbackSlotId(null);
      if (!slotOverridden) setSelectedSlotId(autoSlot.id);
    }
    setUserResults(null);
    setIsSaved(false);
    setSavedInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotOverridden omitted like original; selectedSlotId needed for fallback assignment
  }, [blocksTextSig, slots, autoSlot.id, selectedSlotId]);

  const selectedSlot =
    enabledSlots.find((s) => s.id === selectedSlotId) ?? autoSlot;

  const canPersistToHistory = slots.some((s) => s.enabled);

  const updateBlockText = (id: string, text: string) => {
    const split = splitWhatsAppInputByContact(text.trim());
    if (split && split.length > 1) {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx < 0) return prev;
        const segmentTexts = new Set(split.map((s) => normPasteText(s.text)));
        const newBlocks: CalcBlock[] = split.map((seg, j) => ({
          id: newBlockId(),
          label: seg.contact.trim() || `User ${idx + j + 1}`,
          text: seg.text,
          labelLocked: false,
        }));
        // Drop following rows that are the same snippet as a new segment (avoids duplicate
        // users when the full chat is pasted again into the first box after an earlier split).
        const tail = prev
          .slice(idx + 1)
          .filter((b) => !segmentTexts.has(normPasteText(b.text)));
        return [...prev.slice(0, idx), ...newBlocks, ...tail];
      });
      setUserResults(null);
      setIsSaved(false);
      setSavedInfo(null);
      return;
    }

    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const b = prev[idx];
      const wa = parseWhatsAppMessages(text);
      let nextLabel = b.label;
      let nextLocked = b.labelLocked ?? false;
      if (wa && wa.length > 0) {
        nextLabel = uniqueContactLabel(wa, idx + 1);
        nextLocked = false;
      } else if (!nextLocked) {
        nextLabel = `User ${idx + 1}`;
      }
      return prev.map((x) =>
        x.id === id
          ? { ...x, text, label: nextLabel, labelLocked: nextLocked }
          : x
      );
    });
  };

  const updateBlockLabel = (id: string, label: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, label, labelLocked: true } : b))
    );
  };

  const addBlock = () => {
    const n = blocks.length + 1;
    setBlocks((prev) => [
      ...prev,
      { id: newBlockId(), label: `User ${n}`, text: "", labelLocked: false },
    ]);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) =>
      prev.length <= 1 ? prev : prev.filter((b) => b.id !== id)
    );
  };

  const handleCalculate = () => {
    setCopied(false);
    setIsSaved(false);
    setSavedInfo(null);

    const hasEnabledSlot = slots.some(s => s.enabled);
    const hasWaBlock = blocks.some(b => {
      const wa = parseWhatsAppMessages(b.text);
      return Boolean(wa && wa.length > 0);
    });
    if (hasWaBlock && !hasEnabledSlot) {
      toast.error("Add and enable at least one game in Settings before calculating WhatsApp chats.");
      return;
    }

    const next: PerUserCalc[] = [];
    for (let idx = 0; idx < blocks.length; idx++) {
      const b = blocks[idx];
      const raw = b.text.trim();
      if (!raw) continue;

      const waMessages = parseWhatsAppMessages(b.text);
      const displayLabel =
        waMessages && waMessages.length > 0
          ? uniqueContactLabel(waMessages, idx + 1)
          : b.label.trim() || `User ${idx + 1}`;

      if (waMessages && waMessages.length > 0) {
        let waSlotFallbackCount = 0;
        const tagged = waMessages.map((m) => {
          const auto = detectSlotFromTimestamp(m.timestamp, slots);
          if (!auto) waSlotFallbackCount++;
          return { ...m, slotId: (auto ?? selectedSlot).id };
        }) as TaggedMessages[];
        const allFailed = tagged.flatMap((m) => m.result.failedLines ?? []);
        const nextResult: CalculationResult = {
          results: tagged.flatMap((m) => m.result.results),
          total: tagged.reduce((s, m) => s + m.result.total, 0),
          ...(allFailed.length > 0 ? { failedLines: allFailed } : {}),
        };
        next.push({
          blockId: b.id,
          label: displayLabel,
          text: b.text,
          result: nextResult,
          pendingTagged: tagged,
          isWAMode: true,
          waSlotFallbackCount,
        });
        void logCalculationAudit({
          input: b.text,
          mode: "wa",
          total: nextResult.total,
          resultCount: nextResult.results.length,
          failedCount: allFailed.length,
          selectedSlotId: selectedSlot.id,
          selectedSlotName: selectedSlot.name,
          waSlotsSummary: summarizeWaSlots(tagged, slots),
          waMessageCount: tagged.length,
        });
      } else {
        const nextResult = calculateTotal(b.text);
        next.push({
          blockId: b.id,
          label: displayLabel,
          text: b.text,
          result: nextResult,
          pendingTagged: null,
          isWAMode: false,
          waSlotFallbackCount: 0,
        });
        void logCalculationAudit({
          input: b.text,
          mode: "manual",
          total: nextResult.total,
          resultCount: nextResult.results.length,
          failedCount: nextResult.failedLines?.length ?? 0,
          selectedSlotId: selectedSlot.id,
          selectedSlotName: selectedSlot.name,
        });
      }
    }

    if (next.length === 0) {
      toast.error("Add text in at least one box before calculating.");
      return;
    }
    const singleWithLines =
      next.length === 1 && next[0].result.results.length > 0
        ? next[0].blockId
        : null;
    setExpandedResultBlockId(singleWithLines);
    setAccordionScrollToBlockId(null);
    setUserResults(next);
  };

  const handleSave = async (): Promise<boolean> => {
    if (!userResults?.length) return false;
    if (!canPersistToHistory || selectedSlot.id === NO_CONFIGURED_SLOTS_PLACEHOLDER_ID) {
      toast.error("Add and enable at least one game in Settings before saving to History.");
      return false;
    }
    setSaving(true);
    try {
      const allTagged: TaggedMessages[] = [];
      for (const u of userResults) {
        if (u.isWAMode && u.pendingTagged?.length)
          allTagged.push(...u.pendingTagged);
      }

      const slotNames = new Set<string>();
      let dateSummary = "";

      if (allTagged.length > 0) {
        const dates = [...new Set(allTagged.map((m) => m.date))];
        const existing: SavedSession[] = (
          await Promise.all(dates.map((d) => loadSessionsByDate(d)))
        ).flat();

        const updated = mergeIntoSessions(existing, allTagged);
        await Promise.all(updated.map((s) => saveSessionDoc(s)));

        const dateSlotContactMap = new Map<string, Map<string, Set<string>>>();
        for (const m of allTagged) {
          if (!dateSlotContactMap.has(m.date))
            dateSlotContactMap.set(m.date, new Map());
          const slotMap = dateSlotContactMap.get(m.date)!;
          if (!slotMap.has(m.slotId)) slotMap.set(m.slotId, new Set());
          slotMap.get(m.slotId)!.add(m.contact);
        }

        for (const [date, slotMap] of dateSlotContactMap) {
          const existingPayments = await loadPaymentsByDate(date);
          const existingIds = new Set(existingPayments.map((p) => p.id));
          let allPayments = [...existingPayments];
          for (const [slotId, contacts] of slotMap) {
            const slotObj = slots.find((s) => s.id === slotId) ?? selectedSlot;
            allPayments = upsertPaymentStubs(
              allPayments,
              [...contacts],
              slotObj,
              date,
              settings.commissionPct
            );
          }
          await Promise.all(
            allPayments
              .filter((p) => !existingIds.has(p.id))
              .map((p) => savePaymentDoc(p))
          );
        }

        dateSummary = [...dateSlotContactMap.keys()].sort().join(", ");
        allTagged.forEach((m) => {
          const name = slots.find((s) => s.id === m.slotId)?.name ?? m.slotId;
          slotNames.add(name);
        });
      }

      const date = todayDate();
      const timeStr = new Date()
        .toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        .toLowerCase();

      for (const u of userResults) {
        if (u.isWAMode) continue;
        const uniqueId = `manual|${date.replace(/\//g, "-")}|${
          u.blockId
        }|${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const existing = await loadSessionsByDate(date);
        const contact = u.label.trim() || "Manual Entry";
        const updated = mergeIntoSessions(existing, [
          {
            id: uniqueId,
            contact,
            date,
            timestamp: timeStr,
            text: u.text.trim(),
            result: u.result,
            slotId: selectedSlot.id,
          },
        ]);
        await Promise.all(updated.map((s) => saveSessionDoc(s)));

        const existingPayments = await loadPaymentsByDate(date);
        const newPayments = upsertPaymentStubs(
          existingPayments,
          [contact],
          selectedSlot,
          date,
          settings.commissionPct
        );
        const existingIds = new Set(existingPayments.map((p) => p.id));
        await Promise.all(
          newPayments
            .filter((p) => !existingIds.has(p.id))
            .map((p) => savePaymentDoc(p))
        );

        slotNames.add(selectedSlot.name);
      }

      const manualDates = userResults.some((u) => !u.isWAMode) ? [date] : [];
      const parts = [dateSummary, ...manualDates].filter(Boolean);
      const mergedDates = [
        ...new Set(
          parts
            .join(",")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        ),
      ].join(", ");

      setSavedInfo({
        date: mergedDates || date,
        slots: [...slotNames],
      });
      setIsSaved(true);
      return true;
    } catch (err) {
      console.error("handleSave failed:", err);
      toastApiError(
        err,
        "Save failed. Please check your internet connection and try again."
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const performClear = () => {
    setShowClearConfirm(false);
    setExpandedResultBlockId(null);
    setAccordionScrollToBlockId(null);
    setBlocks([
      { id: newBlockId(), label: "User 1", text: "", labelLocked: false },
    ]);
    setUserResults(null);
    setCopied(false);
    setIsSaved(false);
    setSavedInfo(null);
    setDetectedSlotsSummary(null);
    setDetectedMultiSlots(false);
    setWaSingleFallbackSlotId(null);
    setSlotOverridden(false);
  };

  const needsClearConfirm =
    blocks.some((b) => b.text.trim()) ||
    blocks.length > 1 ||
    Boolean(userResults?.length);

  const canSaveBeforeClear = Boolean(userResults?.length) && !isSaved;

  const requestClear = () => {
    if (!needsClearConfirm) performClear();
    else setShowClearConfirm(true);
  };

  const saveThenClear = async () => {
    const ok = await handleSave();
    if (ok) performClear();
  };

  const handleCopy = () => {
    if (!userResults?.length) return;
    const grand = userResults.reduce((s, u) => s + u.result.total, 0);
    navigator.clipboard
      .writeText(String(grand))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        /* clipboard blocked */
      });
  };

  const updateUserResult = (blockId: string, r: CalculationResult) => {
    setUserResults(
      (prev) =>
        prev?.map((u) => (u.blockId === blockId ? { ...u, result: r } : u)) ??
        null
    );
    setIsSaved(false);
  };

  const patternAccuracyAggregate = useMemo(() => {
    if (!userResults?.length) return null;
    let minScore = 100;
    const reasons: string[] = [];
    for (const u of userResults) {
      const b = computePatternAccuracy(u.result, {
        waSlotFallbackCount: u.isWAMode ? u.waSlotFallbackCount ?? 0 : 0,
      });
      minScore = Math.min(minScore, b.scorePercent);
      for (const r of b.reasons) reasons.push(`${u.label}: ${r}`);
    }
    return { scorePercent: minScore, reasons };
  }, [userResults]);

  const grandTotal = userResults?.reduce((s, u) => s + u.result.total, 0) ?? 0;
  const anyWAMode = userResults?.some((u) => u.isWAMode) ?? false;
  const reportPrefill = blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n--- next ---\n\n");

  const showDetectedBadge = Boolean(detectedSlotsSummary) && !slotOverridden;

  return (
    <>
      <div className="w-full max-w-[520px] text-center mb-4">
        <h1 className="text-[26px] font-bold text-[#1a1a1a] leading-tight">
          Calculator
        </h1>
        <details className="mt-2 text-left rounded-[12px] border border-[#e4edf8] bg-[#f9fbfd] px-3 py-2 open:shadow-sm">
          <summary className="cursor-pointer select-none list-none text-center text-[13px] font-semibold text-[#1d6fb8] hover:text-[#165fa3] [&::-webkit-details-marker]:hidden flex items-center justify-center gap-2">
            <span aria-hidden className="text-[10px] opacity-80">
              ▼
            </span>
            Tips: pasting chats &amp; multiple users
          </summary>
          <p className="text-[15px] text-[#777] mt-2 pt-2 border-t border-[#e8eef5] leading-snug">
            Paste each person&apos;s WhatsApp text in its own box — names fill
            in from the chat; otherwise User 1, User 2, … One chat with{" "}
            <strong>several contacts</strong> splits into separate boxes
            automatically. Then calculate.
          </p>
        </details>
      </div>

      <div className="w-full max-w-[520px] mb-4">
        <div className="bg-white rounded-[18px] shadow-sm border-2 border-[#dde8f8] p-4">
          <div className="text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            📌 These numbers are for (fallback if no timestamp detected):
          </div>
          {enabledSlots.length === 0 ? (
            <div className="rounded-[12px] border-2 border-amber-200 bg-amber-50 px-4 py-3 text-left text-[14px] font-semibold text-amber-900">
              No games yet. Open <strong>Settings</strong>, tap <strong>Add game</strong>, then save — then return here to pick a game for manual entries.
            </div>
          ) : (
            <select
              value={selectedSlotId}
              onChange={(e) => {
                setSelectedSlotId(e.target.value);
                setSlotOverridden(true);
              }}
              className="w-full text-[18px] font-extrabold text-[#1d6fb8] bg-[#f0f6ff] border-2 border-[#c5d8f0] rounded-[12px] px-4 py-3 outline-none cursor-pointer"
            >
              {enabledSlots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name} Game — {formatSlotTime(s.time)}
                </option>
              ))}
            </select>
          )}
          {showDetectedBadge ? (
            <div className="mt-2 space-y-1">
              <p className="text-[12px] text-green-700 font-semibold">
                🔍{" "}
                {detectedMultiSlots
                  ? `Auto-detected from message times (${detectedSlotsSummary})`
                  : `Auto-detected from message time (${detectedSlotsSummary} Game)`}
              </p>
              {detectedMultiSlots && (
                <p className="text-[11px] text-green-700/90 leading-snug">
                  Each line uses the game for its timestamp. The menu above is
                  only a fallback when a time cannot be read.
                </p>
              )}
            </div>
          ) : slotOverridden ? (
            <p className="text-[12px] text-orange-600 font-semibold mt-2">
              ✏️ Manually selected ·{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setSlotOverridden(false);
                  setSelectedSlotId(waSingleFallbackSlotId ?? autoSlot.id);
                }}
              >
                Reset to auto
              </button>
            </p>
          ) : (
            <p className="text-[12px] text-gray-400 mt-2">
              WhatsApp messages are auto-assigned per message time. This is only
              used for manual entries.
            </p>
          )}
        </div>
      </div>

      <div className="w-full max-w-[520px] bg-white rounded-[20px] shadow-[0_6px_32px_rgba(0,0,0,0.10)] p-2 md:p-4 space-y-5">
        <div
          className={`rounded-[14px] border-2 px-3.5 py-3 ${
            !patternAccuracyAggregate
              ? "border-[#e4edf8] bg-[#f8fafc]"
              : patternAccuracyAggregate.scorePercent >= 100
              ? "border-green-200 bg-green-50/90"
              : patternAccuracyAggregate.scorePercent >= 99
              ? "border-amber-200 bg-amber-50/90"
              : "border-red-200 bg-red-50/90"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-extrabold text-gray-600 uppercase tracking-wide">
              Pattern accuracy
            </span>
            {patternAccuracyAggregate ? (
              <span
                className={`text-[22px] font-black tabular-nums leading-none ${
                  patternAccuracyAggregate.scorePercent >= 100
                    ? "text-green-800"
                    : patternAccuracyAggregate.scorePercent >= 99
                    ? "text-amber-800"
                    : "text-red-800"
                }`}
              >
                {patternAccuracyAggregate.scorePercent >= 100
                  ? "100%"
                  : `${patternAccuracyAggregate.scorePercent.toFixed(1)}%`}
              </span>
            ) : (
              <span className="text-[13px] font-semibold text-gray-400">—</span>
            )}
          </div>
          {patternAccuracyAggregate &&
            patternAccuracyAggregate.reasons.length > 0 && (
              <ul className="mt-2 text-[11px] text-gray-700 list-disc pl-4 space-y-1 max-h-[120px] overflow-y-auto">
                {patternAccuracyAggregate.reasons
                  .slice(0, 12)
                  .map((line, i) => (
                    <li key={i} className="wrap-break-word">
                      {line}
                    </li>
                  ))}
              </ul>
            )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="block text-[18px] font-bold text-[#222]">
            User inputs
          </label>
          <button
            type="button"
            onClick={addBlock}
            className="shrink-0 text-[13px] font-bold text-[#1d6fb8] bg-[#f0f6ff] border-2 border-[#c5d8f0] rounded-[10px] px-3 py-1.5 active:opacity-80"
          >
            + Add user
          </button>
        </div>

        {blocks.map((b, idx) => (
          <div
            key={b.id}
            className="rounded-[14px] border-2 border-[#e4edf8] bg-[#fafcff] p-2 md:p-4 space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[12px] font-bold text-gray-500 shrink-0">
                Name
              </label>
              <input
                type="text"
                value={b.label}
                onChange={(e) => updateBlockLabel(b.id, e.target.value)}
                placeholder={`User ${idx + 1} or contact from WhatsApp`}
                className="flex-1 min-w-[120px] text-[15px] font-semibold border-2 border-[#d5e0f0] rounded-[10px] px-3 py-2 outline-none focus:border-[#1d6fb8] bg-white"
              />
              {blocks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeBlock(b.id)}
                  className="text-[12px] font-bold text-red-600 border border-red-200 rounded-[8px] px-2 py-1.5 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
            </div>
            <textarea
              value={b.text}
              onChange={(e) => updateBlockText(b.id, e.target.value)}
              placeholder={
                "43*93*(75)wp\n48--98-(50)wp\nor paste WhatsApp chat…"
              }
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full min-h-[140px] p-3 text-[16px] font-mono border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[12px] resize-y outline-none text-[#111] leading-[1.8] bg-white tracking-wide transition-colors"
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addBlock}
          className="block w-full text-[13px] font-bold text-[#1d6fb8] bg-[#f0f6ff] border-2 border-[#c5d8f0] rounded-[10px] px-3 py-2.5 active:opacity-80 hover:bg-[#e8f2ff] transition-colors"
        >
          + Add user
        </button>

        <button
          type="button"
          onClick={handleCalculate}
          className="block w-full py-5 text-[22px] font-bold bg-[#1d6fb8] text-white rounded-[14px] cursor-pointer shadow-[0_4px_14px_rgba(29,111,184,0.35)] active:opacity-85 transition-opacity"
        >
          ✅ Calculate all
        </button>

        <button
          type="button"
          onClick={requestClear}
          className="block w-full py-4 text-[18px] font-semibold bg-white text-[#c0392b] border-[2.5px] border-[#e0b0ad] rounded-[14px] cursor-pointer active:opacity-85 transition-opacity"
        >
          🗑 Clear all
        </button>

        <button
          type="button"
          onClick={() => setShowReport(true)}
          className="block w-full py-2.5 text-[13px] font-semibold text-gray-400 hover:text-[#1d6fb8] transition-colors text-center"
        >
          🐛 Report a number pattern issue
        </button>
      </div>

      {showReport && (
        <ReportIssue
          prefillInput={reportPrefill}
          onClose={() => setShowReport(false)}
        />
      )}

      {showClearConfirm && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowClearConfirm(false);
          }}
        >
          <div
            className="bg-white rounded-[20px] shadow-2xl w-full max-w-[400px] overflow-hidden border-2 border-[#dde8f0]"
            role="dialog"
            aria-labelledby="clear-dialog-title"
            aria-modal="true"
          >
            <div className="px-5 py-4 border-b border-[#e7eef7]">
              <h2
                id="clear-dialog-title"
                className="text-[18px] font-extrabold text-[#1a1a1a]"
              >
                Clear everything?
              </h2>
              <p className="text-[13px] text-gray-600 mt-2 leading-snug">
                {canSaveBeforeClear
                  ? "You have calculated results that are not saved to History yet. Save them first, or clear without saving."
                  : Boolean(userResults?.length) && isSaved
                  ? "This will remove all users, pasted text, and the on-screen summary. Your data is already saved in History."
                  : "You have pasted text or extra user boxes. This will remove all of it."}
              </p>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {canSaveBeforeClear && (
                <button
                  type="button"
                  disabled={saving || !canPersistToHistory}
                  onClick={() => void saveThenClear()}
                  className="w-full py-3 rounded-[12px] text-[15px] font-bold bg-green-600 text-white disabled:opacity-50 active:opacity-90"
                >
                  {saving ? "⏳ Saving…" : "💾 Save to History & clear"}
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={performClear}
                className="w-full py-3 rounded-[12px] text-[15px] font-bold bg-red-50 text-red-700 border-2 border-red-200 disabled:opacity-50 active:opacity-90"
              >
                Clear without saving
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowClearConfirm(false)}
                className="w-full py-3 rounded-[12px] text-[15px] font-semibold text-gray-600 bg-white border-2 border-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {userResults && userResults.length > 0 && (
        <div className="w-full max-w-[520px] mt-5 space-y-3">
          <div className="px-1">
            <h2 className="text-[17px] font-bold text-[#222]">
              Results by user
            </h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Tap a row to show or hide line-by-line details.
            </p>
          </div>

          {userResults.map((u) => {
            const isOpen = expandedResultBlockId === u.blockId;
            const hasLines = u.result.results.length > 0;
            const failedLineCount = u.result.failedLines?.length ?? 0;
            const hasError = failedLineCount > 0;
            const lineCount = u.result.results.length;
            const lineCountLabel = hasLines
              ? `${lineCountFormatter.format(lineCount)} ${
                  lineCount === 1 ? "line" : "lines"
                }`
              : "";
            return (
              <div
                key={u.blockId}
                id={`result-user-${u.blockId}`}
                data-has-parse-error={hasError ? "true" : undefined}
                className={`bg-white rounded-[18px] border-2 shadow-sm overflow-hidden scroll-mt-[76px] ${
                  hasError ? "border-red-500" : "border-[#dde8f0]"
                }`}
              >
                <button
                  type="button"
                  disabled={!hasLines}
                  aria-expanded={hasLines ? isOpen : undefined}
                  aria-label={
                    hasLines
                      ? `${u.label}: ${
                          hasError
                            ? `${failedLineCount} failed line${
                                failedLineCount === 1 ? "" : "s"
                              }. `
                            : ""
                        }${lineCountLabel}, total ${lineCountFormatter.format(
                          u.result.total
                        )}`
                      : `${u.label}: no line items${
                          hasError
                            ? `, ${failedLineCount} failed line${
                                failedLineCount === 1 ? "" : "s"
                              }`
                            : ""
                        }`
                  }
                  onMouseDown={(e) => {
                    if (!hasLines) return;
                    e.preventDefault();
                  }}
                  onClick={() => {
                    if (!hasLines) return;
                    if (expandedResultBlockId === u.blockId) {
                      setExpandedResultBlockId(null);
                      return;
                    }
                    setExpandedResultBlockId(u.blockId);
                    setAccordionScrollToBlockId(u.blockId);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 bg-[#f6f9fd] text-left transition-colors ${
                    hasLines
                      ? "hover:bg-[#eef4fc] cursor-pointer border-b border-[#e3edf7]"
                      : "opacity-70 cursor-default border-b border-[#e3edf7]"
                  }`}
                >
                  <div className="flex flex-col items-start min-w-0 gap-1">
                    <span className="text-[16px] font-extrabold text-[#1a1a1a] truncate w-full">
                      {u.label}
                    </span>
                    {hasLines ? (
                      <span className="inline-flex items-center gap-2 rounded-[10px] bg-white border border-[#d5e4f5] px-2.5 py-1 shadow-sm">
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                          Lines
                        </span>
                        <span className="text-[15px] font-black tabular-nums text-[#1d6fb8] leading-none">
                          {lineCountFormatter.format(lineCount)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[12px] font-semibold text-gray-600">
                        No line items to expand
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[22px] font-black text-[#1d6fb8] tabular-nums">
                      {u.result.total}
                    </span>
                    {hasLines && (
                      <span
                        className="text-[11px] font-bold text-[#4a6685] w-5 text-center select-none"
                        aria-hidden
                      >
                        {isOpen ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </button>
                {isOpen && hasLines && (
                  <div className="p-4 border-t border-[#eef2f7]">
                    <EditableBreakdown
                      result={u.result}
                      onChange={(r) => updateUserResult(u.blockId, r)}
                      compact
                    />
                  </div>
                )}
              </div>
            );
          })}

          <div className="bg-[#1d6fb8] rounded-[20px] px-6 py-7 shadow-[0_6px_24px_rgba(29,111,184,0.30)] flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-white/70 uppercase tracking-widest mb-1">
                All users total
              </div>
              <div className="text-[48px] font-extrabold text-white leading-none tabular-nums">
                {grandTotal}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className={`shrink-0 px-5 py-3.5 text-[17px] font-bold text-white border-2 border-white/50 rounded-xl cursor-pointer whitespace-nowrap transition-colors ${
                copied ? "bg-[#27ae60]" : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {copied ? "✓ Copied" : "📋 Copy total"}
            </button>
          </div>

          <div className="mt-1">
            {isSaved && savedInfo ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-[16px] px-4 py-3.5">
                <div className="text-[15px] font-bold text-green-700 mb-1">
                  ✅ Saved to History!
                </div>
                <div className="text-[13px] text-green-700">
                  <span className="font-semibold">Date:</span> {savedInfo.date}
                </div>
                <div className="text-[13px] text-green-700">
                  <span className="font-semibold">
                    Game{savedInfo.slots.length > 1 ? "s" : ""}:
                  </span>{" "}
                  {savedInfo.slots.join(", ")}
                </div>
                <div className="text-[12px] text-green-600 mt-1.5">
                  Go to <span className="font-bold">History</span> or{" "}
                  <span className="font-bold">Payments</span> tab to review.
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !canPersistToHistory}
                className={`w-full py-4 text-[17px] font-bold rounded-[16px] border-2 transition-all active:opacity-80 disabled:opacity-50 ${
                  anyWAMode
                    ? "bg-green-600 text-white border-green-600 shadow-sm"
                    : "bg-white text-green-700 border-green-300"
                }`}
              >
                {saving ? "⏳ Saving…" : "💾 Save to History"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
