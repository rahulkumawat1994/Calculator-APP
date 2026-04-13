import { useState, useEffect } from "react";
import {
  calculateTotal,
  parseWhatsAppMessages,
  mergeIntoSessions,
  getCurrentSlot,
  formatSlotTime,
  upsertPaymentStubs,
} from "./calcUtils";
import EditableBreakdown from "./EditableBreakdown";
import ReportIssue from "./ReportIssue";
import type { CalculationResult, SavedSession, GameSlot, PaymentRecord } from "./types";

interface Props {
  sessions:       SavedSession[];
  slots:          GameSlot[];
  payments:       PaymentRecord[];
  onSave:         (sessions: SavedSession[]) => void;
  onSavePayments: (payments: PaymentRecord[]) => void;
}

export default function Calculator({ sessions, slots, payments, onSave, onSavePayments }: Props) {
  const [input,           setInput]           = useState("");
  const [result,          setResult]          = useState<CalculationResult | null>(null);
  const [copied,          setCopied]          = useState(false);
  const [savedToHistory,  setSavedToHistory]  = useState(false);
  const [lastSessionIds,  setLastSessionIds]  = useState<string[]>([]);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [showReport,      setShowReport]      = useState(false);

  const enabledSlots = slots.filter(s => s.enabled);
  const autoSlot     = getCurrentSlot(slots);

  const [selectedSlotId, setSelectedSlotId] = useState<string>(autoSlot.id);

  useEffect(() => {
    const still = enabledSlots.find(s => s.id === selectedSlotId);
    if (!still) setSelectedSlotId(autoSlot.id);
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSlot = enabledSlots.find(s => s.id === selectedSlotId) ?? autoSlot;

  const handleCalculate = () => {
    const waMessages = parseWhatsAppMessages(input);

    if (waMessages && waMessages.length > 0) {
      const tagged = waMessages.map(m => ({ ...m, slotId: selectedSlot.id }));
      const combined: CalculationResult = {
        results: tagged.flatMap(m => m.result.results),
        total:   tagged.reduce((s, m) => s + m.result.total, 0),
      };
      setResult(combined);

      const updated = mergeIntoSessions(sessions, tagged);
      onSave(updated);

      const contacts = [...new Set(tagged.map(m => m.contact))];
      const date = tagged[0]?.date ?? todayDate();
      onSavePayments(upsertPaymentStubs(payments, contacts, selectedSlot, date));

      const affectedIds = updated
        .filter(s => tagged.some(m => m.contact === s.contact && m.date === s.date))
        .map(s => s.id);
      setLastSessionIds(affectedIds);
      setHasUnsavedEdits(false);
      flashSaved();
    } else {
      const calcResult = calculateTotal(input);
      setResult(calcResult);

      if (input.trim() && calcResult.total > 0) {
        const date = todayDate();
        const timeStr = new Date()
          .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
          .toLowerCase();
        const uniqueId = `manual|${date}|${Date.now()}`;
        const updated = mergeIntoSessions(sessions, [{
          id: uniqueId,
          contact: "Manual Entry",
          date,
          timestamp: timeStr,
          text: input.trim(),
          result: calcResult,
          slotId: selectedSlot.id,
        }]);
        onSave(updated);
        onSavePayments(upsertPaymentStubs(payments, ["Manual Entry"], selectedSlot, date));

        const sid = `Manual Entry|${date}`;
        setLastSessionIds(updated.filter(s => s.id === sid).map(s => s.id));
        setHasUnsavedEdits(false);
      }
    }
    setCopied(false);
  };

  const handleSaveToHistory = () => {
    if (!result || !lastSessionIds.length) return;
    onSave(sessions.map(s => lastSessionIds.includes(s.id) ? { ...s, overrideResult: result } : s));
    setHasUnsavedEdits(false);
    flashSaved();
  };

  const flashSaved = () => {
    setSavedToHistory(true);
    setTimeout(() => setSavedToHistory(false), 2500);
  };

  const handleClear = () => {
    setInput(""); setResult(null); setCopied(false);
    setSavedToHistory(false); setLastSessionIds([]); setHasUnsavedEdits(false);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(String(result.total)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

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
            📌 These numbers are for:
          </div>
          <select
            value={selectedSlotId}
            onChange={e => setSelectedSlotId(e.target.value)}
            className="w-full text-[18px] font-extrabold text-[#1d6fb8] bg-[#f0f6ff] border-2 border-[#c5d8f0] rounded-[12px] px-4 py-3 outline-none cursor-pointer"
          >
            {enabledSlots.map(s => (
              <option key={s.id} value={s.id}>
                {s.emoji}  {s.name} Game  —  {formatSlotTime(s.time)}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-gray-400 mt-2">
            Changes automatically based on time. You can also pick manually.
          </p>
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

        {savedToHistory && (
          <div className="mt-3 text-center text-[15px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-xl py-2.5">
            ✓ Saved
          </div>
        )}

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
          {/* Total box */}
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

          {result.results.length > 0 && (
            <div className="bg-white rounded-[20px] p-6 mt-4 shadow-[0_4px_20px_rgba(0,0,0,0.07)]">
              <div className="flex items-center justify-between mb-4 border-b-2 border-[#f0f0f0] pb-2.5">
                <span className="text-[18px] font-bold text-[#222]">Line by Line</span>
                {lastSessionIds.length > 0 && (
                  <button
                    onClick={handleSaveToHistory}
                    disabled={!hasUnsavedEdits}
                    className={`text-[14px] font-semibold rounded-xl px-4 py-2 transition-colors shadow-sm ${
                      hasUnsavedEdits
                        ? "bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    💾 {hasUnsavedEdits ? "Save" : "Saved"}
                  </button>
                )}
              </div>
              <EditableBreakdown
                result={result}
                onChange={r => { setResult(r); setHasUnsavedEdits(true); }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function todayDate(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}
