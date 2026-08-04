import { useState, useEffect, useMemo, useLayoutEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import "./calculator/premium-calc.css";
import "./calculator/premium-motion.css";
import "./calculator/premium-hero-effect.css";
import type { AmountMotion } from "./calculator/AnimatedAmount";
import { HeroAmount, CLEAR_FINISH_MS, HERO_DEPART_MS } from "./calculator/HeroAmount";
import { PageBgShift } from "./calculator/PageBgShift";
import { HeroSubcaption } from "./calculator/HeroSubcaption";
import {
  HeroCalculateEffect,
  type HeroEffectVariant,
} from "./calculator/HeroCalculateEffect";
import { CalculatorResultsPanel } from "./calculator/CalculatorResultsPanel";
import {
  PatternAccuracyPanel,
} from "./calculator/PatternAccuracyPanel";
import { ClearConfirmModal } from "./calculator/ClearConfirmModal";
import {
  collectAllWaHeaders,
  collectPlainMarketSlotIds,
  detectSlotFromTimestamp,
  getStoredResultViewMode,
  lineCountFormatter,
  newBlockId,
  normPasteText,
  RESULT_VIEW_MODE_KEY,
  summarizeWaSlots,
  uniqueContactLabel,
  type CalcBlock,
  type PerUserCalc,
  type ResultViewMode,
  type TaggedMessages,
} from "./calculator/calcHelpers";
import type { ReportIssuePrefill } from "./calculator/reportIssueTypes";
import { scrollElementIntoView, scrollToElement } from "./calculator/scrollUtils";
import { prefersReducedMotion } from "./calculator/motion";
import { debounce } from "@/lib/debounce";
import { toast } from "react-toastify";
import {
  calculateTotal,
  getSkipAuditOnCalculateAll,
  parseWhatsAppMessages,
  parseWhatsAppHeaders,
  looksLikeWhatsApp,
  splitWhatsAppInputByContact,
  computePatternAccuracy,
  mergeIntoSessions,
  getCurrentSlot,
  formatSlotTime,
  NO_CONFIGURED_SLOTS_PLACEHOLDER_ID,
  upsertPaymentStubs,
  detectSlotFromMarketLine,
  splitPlainTextByMarketSlots,
  ledgerDateStringForSlot,
  CALC_LOCAL_ONLY_CHANGED_EVENT,
  CALCULATE_ALL_SKIP_AUDIT_KEY,
  toastApiError,
} from "@/lib";
import type { CalculationAuditPayload } from "@/data/firestoreDb";
import type {
  CalculationResult,
  SavedSession,
  GameSlot,
  AppSettings,
  PaymentRecord,
} from "@/types";
import { useHistoryOverlay } from "@/hooks/useHistoryOverlay";
import { getStoredCheckFontLevel } from "./NotebookBreakdown";
import ReportIssue from "./ReportIssue";

interface Props {
  slots: GameSlot[];
  settings: AppSettings;
  loadSessionsByDate: (date: string) => Promise<SavedSession[]>;
  loadPaymentsByDate: (date: string) => Promise<PaymentRecord[]>;
  saveSessionDoc: (session: SavedSession) => Promise<void>;
  savePaymentDoc: (payment: PaymentRecord) => Promise<void>;
  logCalculationAudit: (payload: CalculationAuditPayload) => Promise<void>;
}

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
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>(
    getStoredResultViewMode,
  );
  const [checkFontLevel, setCheckFontLevel] = useState(getStoredCheckFontLevel);
  /** Which user row has line-by-line breakdown open (accordion, one at a time). */
  const [expandedResultBlockId, setExpandedResultBlockId] = useState<
    string | null
  >(null);
  /** After opening a row, scroll its title into view (see useLayoutEffect below). */
  const [accordionScrollToBlockId, setAccordionScrollToBlockId] = useState<
    string | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [resultsAnimKey, setResultsAnimKey] = useState(0);
  const [ctaSuccess, setCtaSuccess] = useState(false);
  const [heroEffectToken, setHeroEffectToken] = useState(0);
  const [heroEffectVariant, setHeroEffectVariant] =
    useState<HeroEffectVariant>("success");
  const [amountMotion, setAmountMotion] = useState<AmountMotion>("idle");
  const [departTotal, setDepartTotal] = useState<string | null>(null);
  const [accuracyExiting, setAccuracyExiting] = useState(false);
  const [heroSubHold, setHeroSubHold] = useState<string | null>(null);
  const [heroSubExiting, setHeroSubExiting] = useState(false);
  const [resultsExiting, setResultsExiting] = useState(false);
  const heroAmountRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [bgShiftToken, setBgShiftToken] = useState(0);
  const [bgShiftOrigin, setBgShiftOrigin] = useState({ x: 0, y: 0 });
  const [bgGlowHold, setBgGlowHold] = useState(false);
  const bgGlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** While clear animations run, block edits must not wipe userResults early. */
  const preserveResultsOnBlockChangeRef = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const [reportPrefill, setReportPrefill] = useState<ReportIssuePrefill>({
    input: "",
  });
  const [reportKey, setReportKey] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  useHistoryOverlay(showReport, () => setShowReport(false));
  useHistoryOverlay(showClearConfirm, () => setShowClearConfirm(false));
  const [saving, setSaving] = useState(false);
  const [skipAuditOnCalculate, setSkipAuditOnCalculate] = useState(
    getSkipAuditOnCalculateAll,
  );
  useEffect(() => {
    const sync = () => setSkipAuditOnCalculate(getSkipAuditOnCalculateAll());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CALCULATE_ALL_SKIP_AUDIT_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      CALC_LOCAL_ONLY_CHANGED_EVENT,
      sync as EventListener,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        CALC_LOCAL_ONLY_CHANGED_EVENT,
        sync as EventListener,
      );
    };
  }, []);

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
  /** Plain paste used market lines (GL / DB / …) — not WhatsApp timestamps. */
  const [detectedViaMarket, setDetectedViaMarket] = useState(false);
  const [slotOverridden, setSlotOverridden] = useState(false);

  const enabledSlots = slots.filter((s) => s.enabled);
  const autoSlot = getCurrentSlot(slots);

  const [selectedSlotId, setSelectedSlotId] = useState<string>(autoSlot.id);

  const blocksTextSig = useMemo(
    () => blocks.map((b) => b.text).join("\n~\n"),
    [blocks],
  );

  useEffect(() => {
    return () => {
      if (bgGlowTimerRef.current) clearTimeout(bgGlowTimerRef.current);
    };
  }, []);

  const holdBgGlow = useCallback((ms = 8000) => {
    if (bgGlowTimerRef.current) clearTimeout(bgGlowTimerRef.current);
    setBgGlowHold(true);
    bgGlowTimerRef.current = setTimeout(() => {
      setBgGlowHold(false);
      bgGlowTimerRef.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    if (!enabledSlots.find((s) => s.id === selectedSlotId)) {
      setSelectedSlotId(autoSlot.id);
    }
  }, [slots, enabledSlots, selectedSlotId, autoSlot.id]);

  useLayoutEffect(() => {
    if (!accordionScrollToBlockId) return;
    const id = `result-user-${accordionScrollToBlockId}`;
    const scroll = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      scrollElementIntoView(el, "smooth");
      // Re-scroll after accordion expand reveals error details.
      window.setTimeout(() => {
        const elAfter = document.getElementById(id);
        if (elAfter) scrollElementIntoView(elAfter, "smooth");
      }, 560);
      window.setTimeout(() => {
        const elLate = document.getElementById(id);
        if (elLate) scrollElementIntoView(elLate, "smooth");
      }, 920);
      setAccordionScrollToBlockId(null);
      return true;
    };
    if (scroll()) return;
    // Results may mount on the next frame after calculate.
    const retry = window.setTimeout(() => {
      scroll();
    }, 100);
    return () => window.clearTimeout(retry);
  }, [accordionScrollToBlockId]);

  // Clear stale results immediately when input text changes
  useEffect(() => {
    if (!preserveResultsOnBlockChangeRef.current) {
      setUserResults(null);
      setIsSaved(false);
      setSavedInfo(null);
    }
  }, [blocksTextSig]);

  // Debounced slot detection — avoids full WA parse on every keystroke
  useEffect(() => {
    const runDetection = () => {
      const allMsgs = collectAllWaHeaders(blocks);
      const fallbackSlot =
        enabledSlots.find((s) => s.id === selectedSlotId) ?? autoSlot;

      if (allMsgs.length > 0) {
        setDetectedViaMarket(false);
        const tagged = allMsgs.map((msg) => {
          const firstLine =
            msg.text
              .replace(/\r\n/g, "\n")
              .split("\n")
              .map((x) => x.trim())
              .find((x) => x.length > 0) ?? "";
          const fromMarket = firstLine
            ? detectSlotFromMarketLine(firstLine, slots)
            : null;
          const fromTime = detectSlotFromTimestamp(msg.timestamp, slots);
          const slot = fromMarket ?? fromTime ?? fallbackSlot;
          return { slotId: slot.id };
        });
        const summary = summarizeWaSlots(tagged, slots);
        const uniqueIds = [...new Set(tagged.map((t) => t.slotId))];

        setDetectedSlotsSummary(summary || null);
        setDetectedMultiSlots(uniqueIds.length > 1);
        setWaSingleFallbackSlotId(uniqueIds.length === 1 ? uniqueIds[0] : null);

        if (!slotOverridden && uniqueIds.length === 1) {
          setSelectedSlotId(uniqueIds[0]);
        }
      } else {
        const plainIds = collectPlainMarketSlotIds(blocks, slots, fallbackSlot);
        if (plainIds.length > 0) {
          setDetectedViaMarket(true);
          const tagged = plainIds.map((id) => ({ slotId: id }));
          const summary = summarizeWaSlots(tagged, slots);
          const uniqueIds = [...new Set(plainIds)];
          setDetectedSlotsSummary(summary || null);
          setDetectedMultiSlots(uniqueIds.length > 1);
          setWaSingleFallbackSlotId(uniqueIds.length === 1 ? uniqueIds[0] : null);
          if (!slotOverridden && uniqueIds.length === 1) {
            setSelectedSlotId(uniqueIds[0]);
          }
        } else {
          setDetectedViaMarket(false);
          setDetectedSlotsSummary(null);
          setDetectedMultiSlots(false);
          setWaSingleFallbackSlotId(null);
          if (!slotOverridden) setSelectedSlotId(autoSlot.id);
        }
      }
    };

    const debouncedDetect = debounce(runDetection, 250);
    debouncedDetect();
    return () => debouncedDetect.cancel();
  }, [blocksTextSig, slots, autoSlot.id, selectedSlotId, slotOverridden, enabledSlots]);

  const selectedSlot =
    enabledSlots.find((s) => s.id === selectedSlotId) ?? autoSlot;

  const canPersistToHistory = slots.some((s) => s.enabled);

  const updateBlockText = (id: string, text: string) => {
    const existing = blocks.find((b) => b.id === id);
    if (existing && normPasteText(text) === normPasteText(existing.text)) {
      return;
    }

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
      const wa = parseWhatsAppHeaders(text);
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
          : x,
      );
    });
  };

  const handlePasteIntoBlock = async (id: string, currentText: string) => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        toast.info("Clipboard is empty.");
        return;
      }

      const normClip = normPasteText(clip);
      const normCurrent = normPasteText(currentText);

      if (!normCurrent) {
        updateBlockText(id, clip);
        return;
      }

      if (normClip === normCurrent || normCurrent.endsWith(normClip)) {
        toast.info("Already pasted.");
        return;
      }

      const next = `${currentText.replace(/\s+$/, "")}\n${clip}`;
      updateBlockText(id, next);
    } catch {
      toast.error("Couldn't read clipboard. Paste manually or allow permission.");
    }
  };

  const updateBlockLabel = (id: string, label: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, label, labelLocked: true } : b)),
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
      prev.length <= 1 ? prev : prev.filter((b) => b.id !== id),
    );
  };

  const lightOriginFrom = (el: HTMLElement | null) => {
    const rect = el?.getBoundingClientRect();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight * 0.88 };
  };

  const fireBgShift = (el: HTMLElement | null) => {
    setBgShiftOrigin(lightOriginFrom(el));
    setBgShiftToken((token) => token + 1);
  };

  const handleCalculate = () => {
    setCopied(false);
    setIsSaved(false);
    setSavedInfo(null);
    const skipAuditLog = getSkipAuditOnCalculateAll();
    setSkipAuditOnCalculate(skipAuditLog);

    if (!blocks.some((b) => b.text.trim())) {
      toast.error("Add text in at least one box before calculating.");
      return;
    }

    flushSync(() => setIsCalculating(true));
    fireBgShift(ctaRef.current);

    const runCalculation = () => {
    const hasEnabledSlot = slots.some((s) => s.enabled);
    const hasWaBlock = blocks.some((b) => looksLikeWhatsApp(b.text));
    if (hasWaBlock && !hasEnabledSlot) {
      setIsCalculating(false);
      toast.error(
        "Add and enable at least one game in Settings before calculating WhatsApp chats.",
      );
      scrollToElement("calc-game-section");
      return;
    }

    const ledgerOpDay = new Date();
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
          const firstLine =
            m.text
              .replace(/\r\n/g, "\n")
              .split("\n")
              .map((x) => x.trim())
              .find((x) => x.length > 0) ?? "";
          const fromMarket = firstLine
            ? detectSlotFromMarketLine(firstLine, slots)
            : null;
          const fromTime = detectSlotFromTimestamp(m.timestamp, slots);
          if (!fromMarket && !fromTime) waSlotFallbackCount++;
          const slot = fromMarket ?? fromTime ?? selectedSlot;
          // Keep chat header date + id from the parser — ledger rules apply to manual only.
          return { ...m, slotId: slot.id };
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
        if (!skipAuditLog) {
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
        }
      } else {
        const normalized = normPasteText(b.text);
        const parts = splitPlainTextByMarketSlots(
          normalized,
          slots,
          selectedSlot,
        );
        const useMarketSplit =
          parts.length > 1 ||
          (parts.length === 1 && parts[0].touchedByMarketLabel);

        if (useMarketSplit) {
          const timeStr = new Date()
            .toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
            .toLowerCase();
          const contact = displayLabel;
          const tagged = parts
            .filter((p) => p.text.trim().length > 0)
            .map((p, j) => {
              const body = p.text.trim();
              const slotObj =
                slots.find((s) => s.id === p.slotId) ?? selectedSlot;
              const date = ledgerDateStringForSlot(slotObj, ledgerOpDay);
              return {
                id: `manual|${b.id}|${j}|${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 7)}`,
                contact,
                date,
                timestamp: timeStr,
                text: body,
                result: calculateTotal(body),
                slotId: p.slotId,
              };
            }) as TaggedMessages[];

          if (tagged.length === 0) continue;

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
            isWAMode: false,
            waSlotFallbackCount: 0,
          });
          if (!skipAuditLog) {
            void logCalculationAudit({
              input: b.text,
              mode: "manual",
              total: nextResult.total,
              resultCount: nextResult.results.length,
              failedCount: allFailed.length,
              selectedSlotId: selectedSlot.id,
              selectedSlotName: selectedSlot.name,
            });
          }
        } else {
          const nextResult = calculateTotal(b.text);
          const timeStr = new Date()
            .toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
            .toLowerCase();
          const manualDate = ledgerDateStringForSlot(selectedSlot, ledgerOpDay);
          next.push({
            blockId: b.id,
            label: displayLabel,
            text: b.text,
            result: nextResult,
            pendingTagged: [
              {
                id: `manual|${b.id}|0|${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 7)}`,
                contact: displayLabel,
                date: manualDate,
                timestamp: timeStr,
                text: b.text.trim(),
                result: nextResult,
                slotId: selectedSlot.id,
              },
            ],
            isWAMode: false,
            waSlotFallbackCount: 0,
          });
          if (!skipAuditLog) {
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
      }
    }

    if (next.length === 0) {
      setIsCalculating(false);
      toast.error("Add text in at least one box before calculating.");
      scrollToElement("calc-inputs-section");
      return;
    }

    const firstErrorBlock = next.find(
      (u) => (u.result.failedLines?.length ?? 0) > 0,
    );
    if (firstErrorBlock) {
      setResultViewMode("check");
      try {
        localStorage.setItem(RESULT_VIEW_MODE_KEY, "check");
      } catch {
        /* ignore */
      }
    }
    const singleWithLines =
      !firstErrorBlock &&
      next.length === 1 &&
      next[0].result.results.length > 0
        ? next[0].blockId
        : null;
    const hadResults = Boolean(userResults?.length);
    flushSync(() => {
      setUserResults(next);
      if (!hadResults) setResultsAnimKey((k) => k + 1);
      setExpandedResultBlockId(
        firstErrorBlock?.blockId ?? singleWithLines,
      );
      setAccordionScrollToBlockId(firstErrorBlock?.blockId ?? null);
      setAmountMotion("arrive");
      setDepartTotal(null);
      setAccuracyExiting(false);
      setHeroSubExiting(false);
      setResultsExiting(false);
      setCtaSuccess(true);
      setHeroEffectVariant(firstErrorBlock ? "warn" : "success");
      setHeroEffectToken((token) => token + 1);
      setIsCalculating(false);
    });
    holdBgGlow();

    if (!firstErrorBlock) {
      let minPatternScore = 100;
      for (const u of next) {
        const b = computePatternAccuracy(u.result, {
          waSlotFallbackCount: u.isWAMode ? (u.waSlotFallbackCount ?? 0) : 0,
        });
        minPatternScore = Math.min(minPatternScore, b.scorePercent);
      }
      if (minPatternScore >= 100) {
        const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
        const scrollCombined = () =>
          scrollToElement("calc-combined-total", behavior);
        window.setTimeout(scrollCombined, 100);
        window.setTimeout(scrollCombined, 560);
      }
    }

    window.setTimeout(() => setCtaSuccess(false), 280);
    window.setTimeout(() => setAmountMotion("idle"), 520);
    };

    window.setTimeout(runCalculation, 0);
  };

  const handleSave = async (): Promise<boolean> => {
    if (!userResults?.length) return false;
    if (
      !canPersistToHistory ||
      selectedSlot.id === NO_CONFIGURED_SLOTS_PLACEHOLDER_ID
    ) {
      toast.error(
        "Add and enable at least one game in Settings before saving to History.",
      );
      scrollToElement("calc-game-section");
      return false;
    }
    setSaving(true);
    try {
      const allTagged: TaggedMessages[] = [];
      for (const u of userResults) {
        if (!u.pendingTagged?.length) continue;
        u.pendingTagged.forEach((m) => {
          allTagged.push({
            ...m,
            result: u.pendingTagged!.length === 1 ? u.result : m.result,
          } as TaggedMessages);
        });
      }

      if (allTagged.length === 0) {
        toast.error("Nothing to save. Calculate again and try saving.");
        return false;
      }

      const slotNames = new Set<string>();
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
            settings.commissionPct,
          );
        }
        await Promise.all(
          allPayments
            .filter((p) => !existingIds.has(p.id))
            .map((p) => savePaymentDoc(p)),
        );
      }

      allTagged.forEach((m) => {
        const name = slots.find((s) => s.id === m.slotId)?.name ?? m.slotId;
        slotNames.add(name);
      });

      setSavedInfo({
        date: dates.sort().join(", "),
        slots: [...slotNames],
      });
      setIsSaved(true);
      return true;
    } catch (err) {
      console.error("handleSave failed:", err);
      toastApiError(
        err,
        "Save failed. Please check your internet connection and try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const clearInputs = () => {
    setBlocks([
      { id: newBlockId(), label: "User 1", text: "", labelLocked: false },
    ]);
  };

  const resetCalculatorState = (inputsAlreadyCleared = false) => {
    setExpandedResultBlockId(null);
    setAccordionScrollToBlockId(null);
    if (!inputsAlreadyCleared) clearInputs();
    setUserResults(null);
    setCopied(false);
    setIsSaved(false);
    setSavedInfo(null);
    setDetectedSlotsSummary(null);
    setDetectedMultiSlots(false);
    setWaSingleFallbackSlotId(null);
    setDetectedViaMarket(false);
    setSlotOverridden(false);
    setBgGlowHold(false);
    if (bgGlowTimerRef.current) {
      clearTimeout(bgGlowTimerRef.current);
      bgGlowTimerRef.current = null;
    }
  };

  const resetClearMotion = () => {
    setAccuracyExiting(false);
    setHeroSubHold(null);
    setHeroSubExiting(false);
    setResultsExiting(false);
    setDepartTotal(null);
    setAmountMotion("idle");
  };

  const performClear = () => {
    setShowClearConfirm(false);

    if (prefersReducedMotion() || !userResults?.length) {
      resetCalculatorState();
      resetClearMotion();
      return;
    }

    preserveResultsOnBlockChangeRef.current = true;
    clearInputs();
    setDepartTotal(lineCountFormatter.format(grandTotal));
    setAmountMotion("depart");
    setAccuracyExiting(true);
    setResultsExiting(true);
    if (heroSubLabel) {
      setHeroSubHold(heroSubLabel);
      setHeroSubExiting(true);
    }

    window.setTimeout(() => {
      setDepartTotal(null);
      setAmountMotion("idle");
    }, HERO_DEPART_MS);

    window.setTimeout(() => {
      preserveResultsOnBlockChangeRef.current = false;
      resetCalculatorState(true);
      resetClearMotion();
    }, CLEAR_FINISH_MS);
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
        null,
    );
    setIsSaved(false);
  };

  const patternAccuracyAggregate = useMemo(() => {
    if (!userResults?.length) return null;
    let minScore = 100;
    const reasons: string[] = [];
    for (const u of userResults) {
      const b = computePatternAccuracy(u.result, {
        waSlotFallbackCount: u.isWAMode ? (u.waSlotFallbackCount ?? 0) : 0,
      });
      minScore = Math.min(minScore, b.scorePercent);
      for (const r of b.reasons) reasons.push(`${u.label}: ${r}`);
    }
    return { scorePercent: minScore, reasons };
  }, [userResults]);

  const grandTotal = userResults?.reduce((s, u) => s + u.result.total, 0) ?? 0;
  const uncountedFailedLines =
    userResults?.reduce((s, u) => s + (u.result.failedLines?.length ?? 0), 0) ??
    0;

  const heroSubLabel = useMemo(() => {
    if (!userResults?.length && uncountedFailedLines <= 0) return null;
    const parts: string[] = [];
    if (userResults?.length) {
      parts.push(
        `${userResults.length} user${userResults.length === 1 ? "" : "s"} calculated`,
      );
    }
    if (uncountedFailedLines > 0) {
      parts.push(
        `${uncountedFailedLines} line${uncountedFailedLines === 1 ? "" : "s"} not counted`,
      );
    }
    return parts.join(" · ");
  }, [uncountedFailedLines, userResults?.length]);

  const heroSubText = heroSubExiting ? heroSubHold : heroSubLabel;

  const defaultReportInput = useMemo(
    () =>
      blocks
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n--- next ---\n\n"),
    [blocks],
  );

  const openReport = useCallback(
    (prefill?: ReportIssuePrefill) => {
      setReportPrefill({
        input: prefill?.input ?? defaultReportInput,
        expected: prefill?.expected ?? "",
        note: prefill?.note ?? "",
      });
      setReportKey((k) => k + 1);
      setShowReport(true);
    },
    [defaultReportInput],
  );

  const openReportForFailedLine = useCallback(
    (failedLine: string, contextText: string) => {
      openReport({
        input: failedLine,
        note: contextText
          ? `From paste:\n${contextText.slice(0, 3000)}`
          : undefined,
      });
    },
    [openReport],
  );

  const showDetectedBadge = Boolean(detectedSlotsSummary) && !slotOverridden;
  const isClearingAnim = resultsExiting || Boolean(departTotal);
  const showSaveDock = canSaveBeforeClear && !isClearingAnim;
  const showCtaBar = !showSaveDock;
  const bgActive = isCalculating || bgGlowHold;

  const contentPadClass = showSaveDock
    ? "pc-content--save-dock"
    : "pc-content--dock";

  return (
    <div className={`pc-root${bgActive ? " pc-root--illuminated" : ""}`}>
      <div
        className={`pc-bg${bgActive ? " pc-bg--illuminated" : ""}`}
        aria-hidden
      >
        <PageBgShift
          token={bgShiftToken}
          origin={bgShiftOrigin}
          active={bgActive}
        />
        <div className="pc-orb pc-orb--1" />
        <div className="pc-orb pc-orb--2" />
        <div className="pc-orb pc-orb--3" />
      </div>

      <div className={`pc-content ${contentPadClass}`}>
        <section id="calc-game-section" className="pc-glass pc-reveal">
          <div className="pc-glass__head">
            <h2 className="pc-glass__title">Game</h2>
            <p className="pc-glass__desc">
              Fallback when no timestamp or market tag is detected
            </p>
          </div>
          <div className="pc-glass__body">
            {enabledSlots.length === 0 ? (
              <p className="pc-note pc-note--warn">
                Add a game in Settings to continue.
              </p>
            ) : (
              <select
                value={selectedSlotId}
                onChange={(e) => {
                  setSelectedSlotId(e.target.value);
                  setSlotOverridden(true);
                }}
                className="pc-select"
              >
                {enabledSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji} {s.name} — {formatSlotTime(s.time)}
                  </option>
                ))}
              </select>
            )}
            {showDetectedBadge ? (
              <p className="pc-note pc-note--ok">
                {detectedViaMarket
                  ? detectedMultiSlots
                    ? `Auto-detected · ${detectedSlotsSummary}`
                    : `Auto-detected · ${detectedSlotsSummary}`
                  : detectedMultiSlots
                    ? `Auto-detected · ${detectedSlotsSummary}`
                    : `Auto-detected · ${detectedSlotsSummary}`}
              </p>
            ) : slotOverridden ? (
              <p className="pc-note pc-note--warn">
                Manual selection ·{" "}
                <button
                  type="button"
                  className="pc-link"
                  onClick={() => {
                    setSlotOverridden(false);
                    setSelectedSlotId(waSingleFallbackSlotId ?? autoSlot.id);
                  }}
                >
                  Reset
                </button>
              </p>
            ) : (
              <p className="pc-note">
                WhatsApp lines auto-assign by message time.
              </p>
            )}
          </div>
        </section>

        <section id="calc-combined-total" className="pc-hero pc-reveal pc-reveal--1">
          <HeroCalculateEffect
            token={heroEffectToken}
            variant={heroEffectVariant}
            amountRef={heroAmountRef}
          />
          <p className="pc-eyebrow">Combined total</p>
          <HeroAmount
            amountRef={heroAmountRef}
            total={userResults?.length ? grandTotal : null}
            motion={amountMotion}
            departTotal={departTotal}
            resultsExiting={resultsExiting}
          />
          {heroSubText ? (
            <HeroSubcaption label={heroSubText} exiting={heroSubExiting} />
          ) : null}
        </section>

        {patternAccuracyAggregate ? (
          <PatternAccuracyPanel
            data={patternAccuracyAggregate}
            exiting={accuracyExiting}
          />
        ) : null}

        <section id="calc-inputs-section" className="pc-glass pc-reveal pc-reveal--3">
          <div className="pc-users-head">
            <div>
              <h2 className="pc-glass__title">Inputs</h2>
              <p className="pc-glass__desc">One section per person or chat</p>
            </div>
            <button type="button" onClick={addBlock} className="pc-add-btn">
              Add user
            </button>
          </div>

          {blocks.map((b, idx) => (
            <div
              key={b.id}
              className="pc-user"
              style={{ animationDelay: `${idx * 0.06}s` }}
            >
              <div className="pc-user__top">
                <span className="pc-user__label">Name</span>
                <input
                  type="text"
                  value={b.label}
                  onChange={(e) => updateBlockLabel(b.id, e.target.value)}
                  placeholder={`User ${idx + 1}`}
                  className="pc-user__name"
                />
                <button
                  type="button"
                  className="pc-user__paste"
                  onClick={() => void handlePasteIntoBlock(b.id, b.text)}
                  aria-label="Paste from clipboard"
                  title="Paste from clipboard"
                >
                  <svg
                    className="pc-user__paste-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span className="pc-user__paste-label">Paste</span>
                </button>
                {blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBlock(b.id)}
                    className="pc-user__remove"
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
                className="pc-terminal"
              />
            </div>
          ))}

          <button type="button" onClick={addBlock} className="pc-ghost-add">
            Add another user
          </button>

          <div className="pc-actions">
            <button
              type="button"
              onClick={requestClear}
              className="pc-action pc-action--danger"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => openReport()}
              className="pc-action"
            >
              Report issue
            </button>
          </div>
        </section>

        {userResults && userResults.length > 0 ? (
          <CalculatorResultsPanel
            exiting={resultsExiting}
            userResults={userResults}
            resultsAnimKey={resultsAnimKey}
            resultViewMode={resultViewMode}
            onResultViewModeChange={setResultViewMode}
            checkFontLevel={checkFontLevel}
            onCheckFontLevelChange={setCheckFontLevel}
            expandedResultBlockId={expandedResultBlockId}
            onExpandResult={setExpandedResultBlockId}
            onAccordionScrollTo={setAccordionScrollToBlockId}
            onUpdateUserResult={updateUserResult}
            onReportFailedLine={openReportForFailedLine}
            grandTotal={grandTotal}
            copied={copied}
            onCopy={handleCopy}
            isSaved={isSaved}
            savedInfo={savedInfo}
          />
        ) : null}
      </div>

      {!showCtaBar ? null : (
        <div className="pc-cta-bar">
          <div className="pc-cta-bar__inner">
            <div className="pc-cta-shell">
            <button
              ref={ctaRef}
              type="button"
              onClick={handleCalculate}
              disabled={isCalculating}
              aria-busy={isCalculating}
              className={`pc-cta${isCalculating ? " pc-cta--loading" : ""}${ctaSuccess ? " pc-cta--success" : ""}`}
            >
              <span className="pc-cta__label">
                {isCalculating ? "Calculating…" : "Calculate all"}
              </span>
              {isCalculating ? (
                <span className="pc-cta__spinner" aria-hidden />
              ) : null}
            </button>
            </div>
            {skipAuditOnCalculate ? (
              <p className="pc-audit">
                Local only · enable audit in{" "}
                <a href="/admin">Admin</a>
              </p>
            ) : null}
          </div>
        </div>
      )}

      {showReport && (
        <ReportIssue
          key={reportKey}
          prefill={reportPrefill}
          onClose={() => setShowReport(false)}
        />
      )}

      {showClearConfirm && (
        <ClearConfirmModal
          canSaveBeforeClear={canSaveBeforeClear}
          canPersistToHistory={canPersistToHistory}
          saving={saving}
          hasSavedResults={Boolean(userResults?.length) && isSaved}
          onSaveThenClear={() => void saveThenClear()}
          onClear={performClear}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

      {showSaveDock ? (
        <div className="pc-dock">
          <div className="pc-dock__grid">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !canPersistToHistory}
              className="pc-dock__save"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={requestClear}
              disabled={saving}
              className="pc-dock__clear"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
