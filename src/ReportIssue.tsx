import { useState } from "react";

const SCRIPT_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined) ?? "";

interface Props {
  prefillInput?: string;
  onClose: () => void;
}

type Status = "idle" | "sending" | "success" | "error";

export default function ReportIssue({ prefillInput = "", onClose }: Props) {
  const [input, setInput] = useState(prefillInput);
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async () => {
    if (!input.trim()) return;
    if (!SCRIPT_URL) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      await fetch(SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          input: input.trim(),
          expected: expected.trim(),
          note: note.trim(),
          timestamp: new Date().toISOString(),
        }),
      });
      // no-cors means response is opaque — assume success if no throw
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-[480px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-[#1a1a1a]">
              🐛 Report a Pattern Issue
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Help us improve the calculator
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {status === "success" ? (
          <div className="px-6 py-12 text-center">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-lg font-bold text-green-700">Thank you!</p>
            <p className="text-sm text-gray-500 mt-1">
              Your feedback has been recorded. We'll review and improve the
              pattern.
            </p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 bg-[#1d6fb8] text-white font-semibold rounded-xl text-sm hover:bg-[#165fa3] transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Input that failed */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Input that didn't work <span className="text-red-500">*</span>
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste the exact text you entered..."
                rows={4}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full p-3 text-sm font-mono border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-xl outline-none resize-y bg-[#f8faff] text-[#111] transition-colors"
              />
            </div>

            {/* What they expected */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                What result did you expect?
              </label>
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="e.g. 4 numbers × 5 = 20"
                className="w-full p-3 text-sm border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-xl outline-none bg-[#f8faff] transition-colors"
              />
            </div>

            {/* Extra note */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Any additional notes{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. This format comes from WhatsApp..."
                className="w-full p-3 text-sm border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-xl outline-none bg-[#f8faff] transition-colors"
              />
            </div>

            {status === "error" && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                ⚠️ Failed to send. Please check your internet connection and try
                again.
              </p>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-3 text-sm font-semibold text-gray-500 border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || status === "sending"}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${
                  !input.trim() || status === "sending"
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-[#1d6fb8] hover:bg-[#165fa3] text-white cursor-pointer"
                }`}
              >
                {status === "sending" ? "Sending..." : "Submit Report"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
