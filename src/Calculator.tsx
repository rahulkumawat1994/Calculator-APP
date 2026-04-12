import { useState } from "react";
import {
  calculateTotal,
  parseWhatsAppMessages,
  mergeIntoSessions,
} from "./calcUtils";
import type { CalculationResult, SavedSession } from "./types";

interface Props {
  sessions: SavedSession[];
  onSave: (sessions: SavedSession[]) => void;
}

export default function Calculator({ sessions, onSave }: Props) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedToHistory, setSavedToHistory] = useState(false);

  const handleCalculate = () => {
    const waMessages = parseWhatsAppMessages(input);

    if (waMessages && waMessages.length > 0) {
      // WhatsApp mode — combine all messages for the current result display
      const combined: CalculationResult = {
        results: waMessages.flatMap(m => m.result.results),
        total: waMessages.reduce((s, m) => s + m.result.total, 0),
      };
      setResult(combined);

      // Merge into history sessions
      const updated = mergeIntoSessions(sessions, waMessages);
      onSave(updated);
      setSavedToHistory(true);
      setTimeout(() => setSavedToHistory(false), 2500);
    } else {
      // Plain mode — calculate normally
      const calcResult = calculateTotal(input);
      setResult(calcResult);

      if (input.trim() && calcResult.total > 0) {
        const now = new Date();
        const date = `${String(now.getDate()).padStart(2, "0")}/${String(
          now.getMonth() + 1
        ).padStart(2, "0")}/${now.getFullYear()}`;
        const timeStr = now
          .toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
          .toLowerCase();
        // Use Date.now() in the id so each manual calculation is a separate entry
        const uniqueId = `manual|${date}|${Date.now()}`;
        const updated = mergeIntoSessions(sessions, [
          {
            id: uniqueId,
            contact: "Manual Entry",
            date,
            timestamp: timeStr,
            text: input.trim(),
            result: calcResult,
          },
        ]);
        onSave(updated);
      }
    }
    setCopied(false);
  };

  const handleClear = () => {
    setInput("");
    setResult(null);
    setCopied(false);
    setSavedToHistory(false);
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
      <div className="w-full max-w-[520px] text-center mb-7">
        <div className="text-4xl mb-2 leading-none">🧮</div>
        <h1 className="text-[28px] font-bold text-[#1a1a1a] mb-1.5 leading-tight">
          Calculator
        </h1>
        <p className="text-[17px] text-[#555] leading-relaxed">
          Type or paste your numbers below
        </p>
      </div>

      {/* Input card */}
      <div className="w-full max-w-[520px] bg-white rounded-[20px] shadow-[0_6px_32px_rgba(0,0,0,0.10)] p-7">
        <label className="block text-[19px] font-bold text-[#222] mb-2.5">
          Enter your numbers:
        </label>

        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={"43*93*(75)wp\n48--98-(50)wp\n47--42*(35)wp"}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full min-h-[180px] p-4 text-xl font-mono border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[14px] resize-y outline-none text-[#111] leading-[1.8] bg-[#f8faff] tracking-wide transition-colors"
        />

        <button
          onClick={handleCalculate}
          className="block w-full mt-[18px] py-5 text-[22px] font-bold bg-[#1d6fb8] text-white border-none rounded-[14px] cursor-pointer shadow-[0_4px_14px_rgba(29,111,184,0.35)] font-serif active:opacity-85 transition-opacity"
        >
          ✅ Calculate
        </button>

        {savedToHistory && (
          <div className="mt-3 text-center text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl py-2">
            ✓ Saved to History
          </div>
        )}

        <button
          onClick={handleClear}
          className="block w-full mt-3 py-[18px] text-xl font-semibold bg-white text-[#c0392b] border-[2.5px] border-[#e0b0ad] rounded-[14px] cursor-pointer font-serif active:opacity-85 transition-opacity"
        >
          🗑 Clear
        </button>
      </div>

      {/* Result section */}
      {result && (
        <div className="w-full max-w-[520px] mt-6">
          {/* Total box */}
          <div className="bg-[#1d6fb8] rounded-[20px] px-6 py-7 shadow-[0_6px_24px_rgba(29,111,184,0.30)] flex items-center justify-between">
            <div>
              <div className="text-[16px] font-semibold text-white/75 uppercase tracking-widest mb-1.5">
                Total Amount
              </div>
              <div className="text-[54px] font-extrabold text-white leading-none">
                {result.total}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className={`px-5 py-3.5 text-[18px] font-bold text-white border-2 border-white/50 rounded-xl cursor-pointer font-serif whitespace-nowrap transition-colors ${
                copied ? "bg-[#27ae60]" : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>

          {/* Line breakdown */}
          {result.results.length > 0 && (
            <div className="bg-white rounded-[20px] p-6 mt-4 shadow-[0_4px_20px_rgba(0,0,0,0.07)]">
              <div className="text-[19px] font-bold text-[#222] mb-4 border-b-2 border-[#f0f0f0] pb-2.5">
                Line by Line
              </div>

              {result.results.map((r, i) => (
                <div
                  key={i}
                  className={`rounded-xl border border-[#e8eef8] p-[14px_16px] mb-2.5 ${
                    i % 2 === 0 ? "bg-[#f4f8ff]" : "bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="min-w-[28px] h-7 rounded-full bg-[#1d6fb8] text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-mono text-[#333] mb-2 break-all leading-relaxed">
                        {r.line}
                        {r.isWP && (
                          <span className="inline-block text-[13px] font-bold px-2.5 py-0.5 rounded-full ml-2 bg-blue-100 text-blue-700 align-middle">
                            WP
                          </span>
                        )}
                        {r.isDouble && (
                          <span className="inline-block text-[13px] font-bold px-2.5 py-0.5 rounded-full ml-2 bg-yellow-100 text-yellow-800 align-middle">
                            AB
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[17px] text-[#666] font-serif">
                          {r.count} × {r.rate}
                        </span>
                        <span className="text-[22px] font-extrabold text-[#1d6fb8]">
                          = {r.lineTotal}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Grand total row */}
              <div className="flex justify-between items-center mt-1.5 px-4 py-3.5 bg-[#1d6fb8] rounded-xl">
                <span className="text-xl font-bold text-white">Grand Total</span>
                <span className="text-[28px] font-extrabold text-white">
                  {result.total}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
