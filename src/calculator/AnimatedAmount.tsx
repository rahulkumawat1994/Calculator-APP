import { useEffect, useRef, useState } from "react";
import {
  easeOutExpo,
  formatDisplayAmount,
  parseDisplayAmount,
  prefersReducedMotion,
} from "./motion";

export type AmountMotion = "idle" | "arrive" | "depart";

type Props = {
  value: string;
  className?: string;
  idle?: boolean;
  motion?: AmountMotion;
};

/** Hero total with count-up + directional enter/exit motion. */
export function AnimatedAmount({
  value,
  className = "",
  idle = false,
  motion = "idle",
}: Props) {
  const [display, setDisplay] = useState(value);
  const [pulse, setPulse] = useState(false);
  const rafRef = useRef<number | null>(null);
  const prevNumeric = useRef<number | null>(null);

  useEffect(() => {
    if (idle) {
      setDisplay(value);
      prevNumeric.current = null;
      return;
    }

    const target = parseDisplayAmount(value);
    if (target === null) {
      setDisplay(value);
      return;
    }

    if (motion === "depart") {
      setDisplay(formatDisplayAmount(target));
      prevNumeric.current = target;
      return;
    }

    const from =
      motion === "arrive"
        ? (prevNumeric.current ?? 0)
        : (prevNumeric.current ?? target);
    prevNumeric.current = target;

    if (prefersReducedMotion() || from === target) {
      setDisplay(formatDisplayAmount(target));
      return;
    }

    setPulse(true);
    const start = performance.now();
    const duration =
      motion === "arrive"
        ? Math.min(480, 140 + Math.log10(Math.abs(target - from) + 1) * 40)
        : Math.min(180, 80 + Math.log10(Math.abs(target - from) + 1) * 28);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutExpo(t);
      const current = from + (target - from) * eased;
      setDisplay(formatDisplayAmount(current));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(formatDisplayAmount(target));
        window.setTimeout(() => setPulse(false), 120);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, idle, motion]);

  const motionClass =
    motion === "arrive"
      ? " pc-hero__amount--arrive"
      : motion === "depart"
        ? " pc-hero__amount--depart"
        : "";

  return (
    <span
      className={`pc-hero__amount${pulse ? " pc-hero__amount--pulse" : ""}${idle ? " pc-hero__amount--idle" : ""}${motionClass} ${className}`.trim()}
      aria-live="polite"
    >
      {display}
    </span>
  );
}
