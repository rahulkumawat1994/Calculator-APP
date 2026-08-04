import { useEffect, useRef, useState } from "react";
import {
  easeOutExpo,
  formatDisplayAmount,
  parseDisplayAmount,
  prefersReducedMotion,
} from "./motion";

type Props = {
  value: string;
  className?: string;
  idle?: boolean;
};

/** Hero total with count-up + celebration pulse when the value changes. */
export function AnimatedAmount({ value, className = "", idle = false }: Props) {
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

    const from = prevNumeric.current ?? 0;
    prevNumeric.current = target;

    if (prefersReducedMotion() || from === target) {
      setDisplay(formatDisplayAmount(target));
      if (from !== target) {
        setPulse(true);
        const t = window.setTimeout(() => setPulse(false), 280);
        return () => window.clearTimeout(t);
      }
      return;
    }

    setPulse(true);
    const start = performance.now();
    const duration = Math.min(
      320,
      120 + Math.log10(Math.abs(target - from) + 1) * 40,
    );

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutExpo(t);
      const current = from + (target - from) * eased;
      setDisplay(formatDisplayAmount(current));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(formatDisplayAmount(target));
        window.setTimeout(() => setPulse(false), 220);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, idle]);

  return (
    <span
      className={`pc-hero__amount${pulse ? " pc-hero__amount--pulse" : ""}${idle ? " pc-hero__amount--idle" : ""} ${className}`.trim()}
      aria-live="polite"
    >
      {display}
    </span>
  );
}
