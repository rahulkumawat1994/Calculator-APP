import { prefersReducedMotion } from "./motion";
import "./premium-page-light.css";

export type BgShiftOrigin = {
  x: number;
  y: number;
};

type Props = {
  token: number;
  origin: BgShiftOrigin;
  active?: boolean;
};

/** Background-only color shift — sits behind all content. */
export function PageBgShift({ token, origin, active = false }: Props) {
  const motion = !prefersReducedMotion();

  return (
    <div
      className={`pc-bg__shift${active ? " pc-bg__shift--active" : ""}`}
      style={
        {
          "--burst-x": `${origin.x}px`,
          "--burst-y": `${origin.y}px`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {active && motion ? (
        <div className="pc-bg__water">
          <div className="pc-bg__water-blob pc-bg__water-blob--1" />
          <div className="pc-bg__water-blob pc-bg__water-blob--2" />
          <div className="pc-bg__water-blob pc-bg__water-blob--3" />
        </div>
      ) : null}
      {token > 0 && motion ? (
        <div key={`ripple-${token}`} className="pc-bg__ripple" />
      ) : null}
    </div>
  );
}
