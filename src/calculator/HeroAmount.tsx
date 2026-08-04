import type { RefObject } from "react";
import { AnimatedAmount, type AmountMotion } from "./AnimatedAmount";
import { lineCountFormatter } from "./calcHelpers";

/** Must match premium-hero-effect.css depart duration. */
export const HERO_DEPART_MS = 480;
export const CLEAR_FINISH_MS = 520;

type Props = {
  total: number | null;
  motion: AmountMotion;
  /** Frozen total string while the depart animation runs. */
  departTotal: string | null;
  resultsExiting: boolean;
  amountRef?: RefObject<HTMLDivElement | null>;
};

export function HeroAmount({
  total,
  motion,
  departTotal,
  resultsExiting,
  amountRef,
}: Props) {
  const formatted =
    total != null ? lineCountFormatter.format(total) : null;
  const showValue =
    Boolean(departTotal) || (formatted != null && !resultsExiting);
  const showDash = !showValue || Boolean(departTotal);
  const isIdle = showDash && !departTotal;

  return (
    <div
      ref={amountRef}
      className={[
        "pc-hero__amount-wrap",
        departTotal ? "pc-hero__amount-wrap--depart" : "",
        isIdle ? "pc-hero__amount-wrap--idle" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showValue ? (
        <AnimatedAmount
          value={departTotal ?? formatted!}
          motion={departTotal ? "depart" : motion}
          className="pc-hero__amount--value"
        />
      ) : null}
      {showDash ? (
        <span className="pc-hero__amount pc-hero__amount--idle pc-hero__amount--dash">
          —
        </span>
      ) : null}
    </div>
  );
}
