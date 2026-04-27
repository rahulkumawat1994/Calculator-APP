import { useState } from "react";
import { toastApiError } from "@/lib";
import { logReportIssue } from "@/data/firestoreDb";
import { notifyReportListenersAfterSubmit } from "@/services/reportNotify";
import { Button, Card, Modal } from "./ui";

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
    setStatus("sending");
    try {
      const logId = await logReportIssue({
        input: input.trim(),
        expected: expected.trim(),
        note: note.trim(),
      });
      void notifyReportListenersAfterSubmit(logId);
      setStatus("success");
    } catch (err) {
      toastApiError(err, "Could not send your report. Please try again.");
      setStatus("error");
    }
  };

  return (
    <Modal open onBackdropClick={onClose} backdrop="dim" overlayClassName="p-4">
      <Card
        surface="panel"
        className="max-w-[480px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2
              id="report-issue-title"
              className="text-lg font-bold text-[#1a1a1a]"
            >
              🐛 Report a Pattern Issue
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Help us improve the calculator
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl font-bold leading-none text-gray-400 transition-colors hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {status === "success" ? (
          <div className="px-6 py-12 text-center">
            <div className="mb-3 text-5xl">✅</div>
            <p className="text-lg font-bold text-green-700">Thank you!</p>
            <p className="mt-1 text-sm text-gray-500">
              Your feedback has been recorded. We'll review and improve the
              pattern.
            </p>
            <Button
              variant="primary"
              onClick={onClose}
              className="mt-6 rounded-xl px-6 py-2.5 text-sm font-semibold"
            >
              Close
            </Button>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
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
                className="w-full resize-y rounded-xl border-2 border-[#c5cfe0] bg-[#f8faff] p-3 font-mono text-sm text-[#111] outline-none transition-colors focus:border-[#1d6fb8]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                What result did you expect?
              </label>
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="e.g. 4 numbers × 5 = 20"
                className="w-full rounded-xl border-2 border-[#c5cfe0] bg-[#f8faff] p-3 text-sm outline-none transition-colors focus:border-[#1d6fb8]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                Any additional notes{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. This format comes from WhatsApp..."
                className="w-full rounded-xl border-2 border-[#c5cfe0] bg-[#f8faff] p-3 text-sm outline-none transition-colors focus:border-[#1d6fb8]"
              />
            </div>

            {status === "error" && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-500">
                ⚠️ Failed to send. Please check your internet connection and try
                again.
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl border-2 py-3 text-sm font-semibold"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={!input.trim() || status === "sending"}
                className="flex-1 rounded-xl py-3 text-sm font-bold"
              >
                {status === "sending" ? "Sending..." : "Submit Report"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Modal>
  );
}
