import { useState, useEffect } from "react";
import {
  calculateTotal,
  parseWhatsAppMessages,
  mergeIntoSessions,
  getCurrentSlot,
  formatSlotTime,
  slotMinutes,
  upsertPaymentStubs,
} from "./calcUtils";
import EditableBreakdown from "./EditableBreakdown";
import ReportIssue from "./ReportIssue";
import type { CalculationResult, SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";

interface Props {
  slots:               GameSlot[];
  settings:            AppSettings;
  loadSessionsByDate:  (date: string) => Promise<SavedSession[]>;
  loadPaymentsByDate:  (date: string) => Promise<PaymentRecord[]>;
  saveSessionDoc:      (session: SavedSession) => Promise<void>;
  savePaymentDoc:      (payment: PaymentRecord) => Promise<void>;
}

// ─── Auto-detect slot from a timestamp string ─────────────────────────────────
// Mirrors getCurrentSlot logic but uses the message's own time.
function detectSlotFromTimestamp(timeStr: string, slots: GameSlot[]): GameSlot | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3]?.toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  const msgMinutes = h * 60 + m;
  const enabled = slots.filter(s => s.enabled);
  const sorted  = [...enabled].sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
  return sorted.find(s => slotMinutes(s.time) > msgMinutes) ?? sorted[0] ?? null;
}

function todayDate(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

// Holds the WhatsApp-parsed messages (tagged with slotId) waiting to be saved
type TaggedMessages = ReturnType<typeof parseWhatsAppMessages> extends (infer T)[] | null ? T & { slotId: string } : never;

export default function Calculator({
  slots, settings,
  loadSessionsByDate, loadPaymentsByDate,
  saveSessionDoc, savePaymentDoc,
}: Props) {
  const [input,          setInput]          = useState("");
  const [result,         setResult]         = useState<CalculationResult | null>(null);
  const [copied,         setCopied]         = useState(false);
  const [showReport,     setShowReport]     = useState(false);
  const [saving,         setSaving]         = useState(false);

  // After calculation, what's pending to be saved
  const [pendingTagged,  setPendingTagged]  = useState<(TaggedMessages)[] | null>(null); // WA messages
  const [isWAMode,       setIsWAMode]       = useState(false); // true = WA input

  // After save
  const [savedInfo,      setSavedInfo]      = useState<{ date: string; slots: string[] } | null>(null);
  const [isSaved,        setIsSaved]        = useState(false);

  // Detected slot from WhatsApp timestamps (null = no detection)
  const [detectedSlotId, setDetectedSlotId] = useState<string | null>(null);
  const [slotOverridden, setSlotOverridden] = useState(false);

  const enabledSlots = slots.filter(s => s.enabled);
  const autoSlot     = getCurrentSlot(slots);

  const [selectedSlotId, setSelectedSlotId] = useState<string>(autoSlot.id);

  useEffect(() => {
    if (!enabledSlots.find(s => s.id === selectedSlotId)) {
      setSelectedSlotId(autoSlot.id);
    }
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect slot when input changes and looks like WhatsApp
  useEffect(() => {
    const messages = parseWhatsAppMessages(input);
    if (messages && messages.length > 0) {
      const detected = detectSlotFromTimestamp(messages[0].timestamp, slots);
      if (detected) {
        setDetectedSlotId(detected.id);
        if (!slotOverridden) setSelectedSlotId(detected.id);
      } else {
        setDetectedSlotId(null);
      }
    } else {
      setDetectedSlotId(null);
      if (!slotOverridden) setSelectedSlotId(autoSlot.id);
    }
    // Reset save state when input changes
    setPendingTagged(null);
    setIsSaved(false);
    setSavedInfo(null);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSlot = enabledSlots.find(s => s.id === selectedSlotId) ?? autoSlot;

  // ── Step 1: Calculate only (no DB) ──────────────────────────────────────────
  const handleCalculate = () => {
    setCopied(false);
    setIsSaved(false);
    setSavedInfo(null);

    const waMessages = parseWhatsAppMessages(input);

    if (waMessages && waMessages.length > 0) {
      const tagged = waMessages.map(m => {
        const auto = detectSlotFromTimestamp(m.timestamp, slots);
        return { ...m, slotId: (auto ?? selectedSlot).id };
      }) as TaggedMessages[];
      setResult({
        results: tagged.flatMap(m => m.result.results),
        total:   tagged.reduce((s, m) => s + m.result.total, 0),
      });
      setPendingTagged(tagged);
      setIsWAMode(true);
    } else {
      // Manual entry — just show result, nothing pending
      setResult(calculateTotal(input));
      setPendingTagged(null);
      setIsWAMode(false);
    }
  };

  // ── Step 2: Save to Firestore (only when user explicitly asks) ───────────────
  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      if (isWAMode && pendingTagged && pendingTagged.length > 0) {
        // ── WhatsApp save ────────────────────────────────────────────────────
        const tagged = pendingTagged;
        const dates  = [...new Set(tagged.map(m => m.date))];
        const existing: SavedSession[] = (
          await Promise.all(dates.map(d => loadSessionsByDate(d)))
        ).flat();

        const updated = mergeIntoSessions(existing, tagged);
        await Promise.all(updated.map(s => saveSessionDoc(s)));

        const date = tagged[0]?.date ?? todayDate();
        const existingPayments = await loadPaymentsByDate(date);
        const existingIds = new Set(existingPayments.map(p => p.id));

        const slotContactMap = new Map<string, Set<string>>();
        for (const m of tagged) {
          if (!slotContactMap.has(m.slotId)) slotContactMap.set(m.slotId, new Set());
          slotContactMap.get(m.slotId)!.add(m.contact);
        }

        let allPayments = [...existingPayments];
        for (const [slotId, contacts] of slotContactMap) {
          const slotObj = slots.find(s => s.id === slotId) ?? selectedSlot;
          allPayments = upsertPaymentStubs(allPayments, [...contacts], slotObj, date, settings.commissionPct);
        }
        await Promise.all(allPayments.filter(p => !existingIds.has(p.id)).map(p => savePaymentDoc(p)));

        const assignedSlotNames = [...new Set(
          tagged.map(m => slots.find(s => s.id === m.slotId)?.name ?? m.slotId)
        )];
        setSavedInfo({ date, slots: assignedSlotNames });

      } else {
        // ── Manual entry save ────────────────────────────────────────────────
        const date    = todayDate();
        const timeStr = new Date()
          .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
          .toLowerCase();
        const uniqueId = `manual|${date.replace(/\//g, "-")}|${Date.now()}`;
        const existing = await loadSessionsByDate(date);
        const updated  = mergeIntoSessions(existing, [{
          id: uniqueId, contact: "Manual Entry", date, timestamp: timeStr,
          text: input.trim(), result, slotId: selectedSlot.id,
        }]);
        await Promise.all(updated.map(s => saveSessionDoc(s)));

        const existingPayments = await loadPaymentsByDate(date);
        const newPayments = upsertPaymentStubs(
          existingPayments, ["Manual Entry"], selectedSlot, date, settings.commissionPct
        );
        const newIds = new Set(existingPayments.map(p => p.id));
        await Promise.all(newPayments.filter(p => !newIds.has(p.id)).map(p => savePaymentDoc(p)));

        setSavedInfo({ date, slots: [selectedSlot.name] });
      }

      setIsSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setInput(""); setResult(null); setCopied(false);
    setPendingTagged(null); setIsWAMode(false);
    setIsSaved(false); setSavedInfo(null);
    setDetectedSlotId(null); setSlotOverridden(false);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(String(result.total)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const detectedSlot      = detectedSlotId ? enabledSlots.find(s => s.id === detectedSlotId) : null;
  const showDetectedBadge = detectedSlot && !slotOverridden;

  return (
    <>
      {/* Header */}
      <div className="w-full max-w-[520px] text-center mb-4">
        <h1 className="text-[26px] font-bold text-[#1a1a1a] leading-tight">Calculator</h1>
        <p className="text-[15px] text-[#777] mt-1">Paste or type the numbers below</p>
      </div>

      {/* ── Game selector ── */}
      <div className="w-full max-w-[520px] mb-4">
        <div className="bg-white rounded-[18px] shadow-sm border-2 border-[#dde8f8] p-4">
          <div className="text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            📌 These numbers are for (fallback if no timestamp detected):
          </div>
          <select
            value={selectedSlotId}
            onChange={e => {
              setSelectedSlotId(e.target.value);
              setSlotOverridden(true);
            }}
            className="w-full text-[18px] font-extrabold text-[#1d6fb8] bg-[#f0f6ff] border-2 border-[#c5d8f0] rounded-[12px] px-4 py-3 outline-none cursor-pointer"
          >
            {enabledSlots.map(s => (
              <option key={s.id} value={s.id}>
                {s.emoji}  {s.name} Game  —  {formatSlotTime(s.time)}
              </option>
            ))}
          </select>
          {showDetectedBadge ? (
            <p className="text-[12px] text-green-700 font-semibold mt-2">
              🔍 Auto-detected from message time ({detectedSlot!.name} Game)
            </p>
          ) : slotOverridden ? (
            <p className="text-[12px] text-orange-600 font-semibold mt-2">
              ✏️ Manually selected · <button className="underline" onClick={() => {
                setSlotOverridden(false);
                const detected = detectedSlotId ? enabledSlots.find(s => s.id === detectedSlotId) : null;
                setSelectedSlotId(detected?.id ?? autoSlot.id);
              }}>Reset to auto</button>
            </p>
          ) : (
            <p className="text-[12px] text-gray-400 mt-2">
              WhatsApp messages are auto-assigned per message time. This is only used for manual entries.
            </p>
          )}
        </div>
      </div>

      {/* ── Input card ── */}
      <div className="w-full max-w-[520px] bg-white rounded-[20px] shadow-[0_6px_32px_rgba(0,0,0,0.10)] p-6">
        <label className="block text-[18px] font-bold text-[#222] mb-2">
          Enter numbers:
        </label>

        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={"43*93*(75)wp\n48--98-(50)wp\n47--42*(35)wp"}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full min-h-[180px] p-4 text-[18px] font-mono border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[14px] resize-y outline-none text-[#111] leading-[1.8] bg-[#f8faff] tracking-wide transition-colors"
        />

        <button
          onClick={handleCalculate}
          className="block w-full mt-4 py-5 text-[22px] font-bold bg-[#1d6fb8] text-white rounded-[14px] cursor-pointer shadow-[0_4px_14px_rgba(29,111,184,0.35)] active:opacity-85 transition-opacity"
        >
          ✅ Calculate
        </button>

        <button
          onClick={handleClear}
          className="block w-full mt-3 py-4 text-[18px] font-semibold bg-white text-[#c0392b] border-[2.5px] border-[#e0b0ad] rounded-[14px] cursor-pointer active:opacity-85 transition-opacity"
        >
          🗑 Clear
        </button>

        <button
          onClick={() => setShowReport(true)}
          className="block w-full mt-2 py-2.5 text-[13px] font-semibold text-gray-400 hover:text-[#1d6fb8] transition-colors text-center"
        >
          🐛 Report a number pattern issue
        </button>
      </div>

      {showReport && (
        <ReportIssue prefillInput={input} onClose={() => setShowReport(false)} />
      )}

      {/* ── Result ── */}
      {result && (
        <div className="w-full max-w-[520px] mt-5">

          {/* Total card */}
          <div className="bg-[#1d6fb8] rounded-[20px] px-6 py-7 shadow-[0_6px_24px_rgba(29,111,184,0.30)] flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold text-white/70 uppercase tracking-widest mb-1">
                Total Amount
              </div>
              <div className="text-[56px] font-extrabold text-white leading-none">
                {result.total}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className={`px-5 py-3.5 text-[17px] font-bold text-white border-2 border-white/50 rounded-xl cursor-pointer whitespace-nowrap transition-colors ${
                copied ? "bg-[#27ae60]" : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>

          {/* ── Save to History card ── */}
          <div className="mt-3">
            {isSaved && savedInfo ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-[16px] px-4 py-3.5">
                <div className="text-[15px] font-bold text-green-700 mb-1">✅ Saved to History!</div>
                <div className="text-[13px] text-green-700">
                  <span className="font-semibold">Date:</span> {savedInfo.date}
                </div>
                <div className="text-[13px] text-green-700">
                  <span className="font-semibold">Game{savedInfo.slots.length > 1 ? "s" : ""}:</span> {savedInfo.slots.join(", ")}
                </div>
                <div className="text-[12px] text-green-600 mt-1.5">
                  Go to <span className="font-bold">History</span> or <span className="font-bold">Payments</span> tab → <span className="font-bold">{savedInfo.date}</span>
                </div>
              </div>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className={`w-full py-4 text-[17px] font-bold rounded-[16px] border-2 transition-all active:opacity-80 disabled:opacity-50 ${
                  isWAMode
                    ? "bg-green-600 text-white border-green-600 shadow-sm"
                    : "bg-white text-green-700 border-green-300"
                }`}
              >
                {saving ? "⏳ Saving…" : "💾 Save to History"}
              </button>
            )}
          </div>

          {/* Line-by-line breakdown */}
          {result.results.length > 0 && (
            <div className="bg-white rounded-[20px] p-6 mt-4 shadow-[0_4px_20px_rgba(0,0,0,0.07)]">
              <div className="mb-4 border-b-2 border-[#f0f0f0] pb-2.5">
                <span className="text-[18px] font-bold text-[#222]">Line by Line</span>
              </div>
              <EditableBreakdown
                result={result}
                onChange={r => { setResult(r); setIsSaved(false); }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
