import { useEffect, useRef } from "react";
import "./premium-accuracy-panel.css";

export type PatternAccuracyData = {
  scorePercent: number;
  reasons: string[];
};

type Props = {
  data: PatternAccuracyData;
  exiting: boolean;
  onExitComplete?: () => void;
};

function fillClass(score: number) {
  if (score >= 100) return "pc-accuracy__fill--ok";
  if (score >= 99) return "pc-accuracy__fill--warn";
  return "pc-accuracy__fill--bad";
}

export function PatternAccuracyPanel({
  data,
  exiting,
  onExitComplete,
}: Props) {
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!exiting) return;

    const shell = shellRef.current;
    if (!shell) return;

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== shell || event.propertyName !== "grid-template-rows") {
        return;
      }
      onExitComplete?.();
    };

    shell.addEventListener("transitionend", handleTransitionEnd);
    return () => shell.removeEventListener("transitionend", handleTransitionEnd);
  }, [exiting, onExitComplete]);

  return (
    <section
      ref={shellRef}
      className={[
        "pc-accuracy-shell",
        "pc-glass",
        exiting ? "pc-accuracy-shell--exit" : "pc-accuracy-shell--open",
      ].join(" ")}
      aria-hidden={exiting}
    >
      <div className="pc-accuracy-shell__inner">
        <div className="pc-accuracy">
          <div className="pc-accuracy__row">
            <span className="pc-accuracy__label">Pattern match</span>
            <span className="pc-accuracy__value">
              {data.scorePercent >= 100
                ? "100%"
                : `${data.scorePercent.toFixed(1)}%`}
            </span>
          </div>
          <div className="pc-accuracy__track">
            <div
              className={`pc-accuracy__fill ${fillClass(data.scorePercent)}`}
              style={{
                width: `${Math.min(100, data.scorePercent)}%`,
              }}
            />
          </div>
          {data.reasons.length > 0 ? (
            <ul className="pc-accuracy__reasons">
              {data.reasons.slice(0, 8).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
