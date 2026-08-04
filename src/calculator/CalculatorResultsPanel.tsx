import EditableBreakdown from "../EditableBreakdown";
import NotebookBreakdown, {
  CHECK_FONT_LEVELS,
  persistCheckFontLevel,
} from "../NotebookBreakdown";
import { AnimatedAmount } from "./AnimatedAmount";
import {
  lineCountFormatter,
  RESULT_VIEW_MODE_KEY,
  type PerUserCalc,
  type ResultViewMode,
} from "./calcHelpers";

export type CalculatorResultsPanelProps = {
  userResults: PerUserCalc[];
  resultsAnimKey: number;
  exiting?: boolean;
  resultViewMode: ResultViewMode;
  onResultViewModeChange: (mode: ResultViewMode) => void;
  checkFontLevel: number;
  onCheckFontLevelChange: (level: number) => void;
  expandedResultBlockId: string | null;
  onExpandResult: (blockId: string | null) => void;
  onAccordionScrollTo: (blockId: string) => void;
  onUpdateUserResult: (blockId: string, result: PerUserCalc["result"]) => void;
  onReportFailedLine: (failedLine: string, contextText: string) => void;
  grandTotal: number;
  copied: boolean;
  onCopy: () => void;
  isSaved: boolean;
  savedInfo: { date: string; slots: string[] } | null;
};

export function CalculatorResultsPanel({
  userResults,
  resultsAnimKey,
  exiting = false,
  resultViewMode,
  onResultViewModeChange,
  checkFontLevel,
  onCheckFontLevelChange,
  expandedResultBlockId,
  onExpandResult,
  onAccordionScrollTo,
  onUpdateUserResult,
  onReportFailedLine,
  grandTotal,
  copied,
  onCopy,
  isSaved,
  savedInfo,
}: CalculatorResultsPanelProps) {
  if (!userResults.length) return null;

  return (
    <div
      key={resultsAnimKey}
      className={`pc-results ${exiting ? "pc-results-exit" : "pc-results-enter"}`}
    >
      <div className="pc-results__head">
        <div className="min-w-0">
          <h2 className="pc-glass__title">Breakdown</h2>
          <p className="pc-glass__desc">
            {resultViewMode === "check"
              ? "Message and math side by side"
              : "Tap a row for line details"}
          </p>
          {resultViewMode === "check" && (
            <div
              className="pc-font-row"
              role="group"
              aria-label="Check view text size"
            >
              <span className="pc-glass__desc">Size</span>
              <button
                type="button"
                aria-label="Smaller text"
                disabled={checkFontLevel <= 0}
                onClick={() => {
                  const next = Math.max(0, checkFontLevel - 1);
                  onCheckFontLevelChange(next);
                  persistCheckFontLevel(next);
                }}
                className="pc-font-btn"
              >
                A−
              </button>
              <button
                type="button"
                aria-label="Bigger text"
                disabled={checkFontLevel >= CHECK_FONT_LEVELS.length - 1}
                onClick={() => {
                  const next = Math.min(
                    CHECK_FONT_LEVELS.length - 1,
                    checkFontLevel + 1,
                  );
                  onCheckFontLevelChange(next);
                  persistCheckFontLevel(next);
                }}
                className="pc-font-btn"
              >
                A+
              </button>
            </div>
          )}
        </div>
        <div className="pc-segment" role="group" aria-label="Result view">
          {(
            [
              { id: "summary" as const, label: "Summary" },
              { id: "check" as const, label: "Check" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={resultViewMode === opt.id}
              onClick={() => {
                onResultViewModeChange(opt.id);
                try {
                  localStorage.setItem(RESULT_VIEW_MODE_KEY, opt.id);
                } catch {
                  /* ignore */
                }
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {userResults.map((u) => {
        const isOpen = expandedResultBlockId === u.blockId;
        const hasLines = u.result.results.length > 0;
        const hasExpandable =
          resultViewMode === "check"
            ? hasLines || (u.result.failedLines?.length ?? 0) > 0
            : hasLines;
        const failedLineCount = u.result.failedLines?.length ?? 0;
        const hasError = failedLineCount > 0;
        const lineCount = u.result.results.length;
        const lineCountLabel = hasLines
          ? `${lineCountFormatter.format(lineCount)} ${
              lineCount === 1 ? "line" : "lines"
            }`
          : "";
        const reportLine = (line: string) =>
          onReportFailedLine(line, u.text);

        return (
          <div
            key={u.blockId}
            id={`result-user-${u.blockId}`}
            data-has-parse-error={hasError ? "true" : undefined}
            className={`pc-result${hasError ? " pc-result--error" : ""}`}
          >
            <button
              type="button"
              disabled={!hasExpandable}
              aria-expanded={hasExpandable ? isOpen : undefined}
              aria-label={
                hasExpandable
                  ? `${u.label}: ${
                      hasError
                        ? `${failedLineCount} failed line${
                            failedLineCount === 1 ? "" : "s"
                          }. `
                        : ""
                    }${
                      resultViewMode === "summary" && hasLines
                        ? `${lineCountLabel}, `
                        : ""
                    }total ${lineCountFormatter.format(u.result.total)}${
                      hasError ? " (some lines not counted)" : ""
                    }`
                  : `${u.label}: no line items${
                      hasError
                        ? `, ${failedLineCount} failed line${
                            failedLineCount === 1 ? "" : "s"
                          }`
                        : ""
                    }`
              }
              onMouseDown={(e) => {
                if (!hasExpandable) return;
                e.preventDefault();
              }}
              onClick={() => {
                if (!hasExpandable) return;
                if (expandedResultBlockId === u.blockId) {
                  onExpandResult(null);
                  return;
                }
                onExpandResult(u.blockId);
                onAccordionScrollTo(u.blockId);
              }}
              className="pc-result__trigger"
            >
              <div className="flex min-w-0 flex-col items-start gap-1">
                <span className="pc-result__name truncate w-full">
                  {u.label}
                </span>
                {hasError && (
                  <span className="pc-badge">{failedLineCount} not read</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="pc-result__total">
                  {lineCountFormatter.format(u.result.total)}
                  {hasError && <span aria-hidden>*</span>}
                </span>
                {hasExpandable && (
                  <span className="pc-glass__desc" aria-hidden>
                    ▼
                  </span>
                )}
              </div>
            </button>
            {hasExpandable && (
              <div
                className={`pc-result__collapse${isOpen ? " pc-result__collapse--open" : ""}`}
              >
                <div className="pc-result__collapse-inner">
                  <div className="pc-result__body">
                    {isOpen &&
                      (resultViewMode === "check" ? (
                        <NotebookBreakdown
                          text={u.text}
                          result={u.result}
                          onChange={(r) => onUpdateUserResult(u.blockId, r)}
                          onReportFailedLine={reportLine}
                          fontLevel={checkFontLevel}
                        />
                      ) : (
                        hasLines && (
                          <EditableBreakdown
                            result={u.result}
                            onChange={(r) => onUpdateUserResult(u.blockId, r)}
                            onReportFailedLine={reportLine}
                            compact
                          />
                        )
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="pc-total-card">
        <div>
          <p className="pc-eyebrow">All users</p>
          <AnimatedAmount
            value={lineCountFormatter.format(grandTotal)}
            className="!text-[2rem]"
          />
        </div>
        <button
          type="button"
          onClick={onCopy}
          className={`pc-copy-btn${copied ? " pc-copy-btn--done" : ""}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {isSaved && savedInfo && (
        <div className="pc-saved">
          <div className="font-bold mb-1">Saved to History</div>
          <div>Date: {savedInfo.date}</div>
          <div>
            Game{savedInfo.slots.length > 1 ? "s" : ""}:{" "}
            {savedInfo.slots.join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
