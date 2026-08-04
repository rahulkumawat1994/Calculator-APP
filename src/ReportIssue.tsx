import { useState } from "react";
import { toastApiError } from "@/lib";
import { logReportIssue } from "@/data/firestoreDb";
import { notifyReportListenersAfterSubmit } from "@/services/reportNotify";
import { Modal } from "./ui";
import type { ReportIssuePrefill } from "./calculator/reportIssueTypes";
import "./calculator/premium-calc.css";
import "./calculator/premium-motion.css";

interface Props {
  prefill?: ReportIssuePrefill;
  /** @deprecated Use `prefill.input` */
  prefillInput?: string;
  onClose: () => void;
}

type Status = "idle" | "sending" | "success" | "error";

export default function ReportIssue({
  prefill,
  prefillInput = "",
  onClose,
}: Props) {
  const initial = prefill ?? { input: prefillInput };
  const [input, setInput] = useState(initial.input ?? "");
  const [expected, setExpected] = useState(initial.expected ?? "");
  const [note, setNote] = useState(initial.note ?? "");
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
    <Modal
      open
      onBackdropClick={status === "sending" ? undefined : onClose}
      backdrop="blurred"
      overlayClassName="p-4 pc-modal-overlay"
    >
      <div
        className="pc-modal pc-modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
      >
        {status === "success" ? (
          <div className="pc-modal__body">
            <div
              className="pc-modal__icon pc-modal__icon--success"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 id="report-issue-title" className="pc-modal__title">
              Thank you
            </h2>
            <p className="pc-modal__desc">
              Your feedback has been recorded. We&apos;ll review it and improve
              the pattern.
            </p>
            <div className="pc-modal__actions">
              <button
                type="button"
                onClick={onClose}
                className="pc-modal__btn pc-modal__btn--primary"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pc-modal__head">
              <button
                type="button"
                onClick={onClose}
                disabled={status === "sending"}
                className="pc-modal__close"
                aria-label="Close"
              >
                ×
              </button>
              <div
                className="pc-modal__icon pc-modal__icon--info"
                aria-hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </div>
              <h2 id="report-issue-title" className="pc-modal__title">
                Report a pattern issue
              </h2>
              <p className="pc-modal__desc">
                Help us improve the calculator
              </p>
            </div>

            <div className="pc-modal__form">
              <div className="pc-modal__field">
                <label htmlFor="report-input" className="pc-modal__label">
                  Input that didn&apos;t work{" "}
                  <span className="pc-modal__required">*</span>
                </label>
                <textarea
                  id="report-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste the exact text you entered…"
                  rows={4}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="pc-modal__textarea"
                />
              </div>

              <div className="pc-modal__field">
                <label htmlFor="report-expected" className="pc-modal__label">
                  What result did you expect?
                </label>
                <input
                  id="report-expected"
                  type="text"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="e.g. 4 numbers × 5 = 20"
                  className="pc-modal__input"
                />
              </div>

              <div className="pc-modal__field">
                <label htmlFor="report-note" className="pc-modal__label">
                  Additional notes{" "}
                  <span className="pc-modal__label-hint">(optional)</span>
                </label>
                <input
                  id="report-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. This format comes from WhatsApp…"
                  className="pc-modal__input"
                />
              </div>

              {status === "error" && (
                <p className="pc-modal__error" role="alert">
                  Failed to send. Please check your internet connection and try
                  again.
                </p>
              )}

              <div className="pc-modal__actions pc-modal__actions--row">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={status === "sending"}
                  className="pc-modal__btn pc-modal__btn--ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!input.trim() || status === "sending"}
                  className={`pc-modal__btn pc-modal__btn--accent${status === "sending" ? " pc-modal__btn--loading" : ""}`}
                >
                  {status === "sending" ? (
                    <>
                      <span className="pc-modal__spinner" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    "Submit report"
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
