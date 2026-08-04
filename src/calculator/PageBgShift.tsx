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
    <>
      {motion ? (
        <svg className="pc-bg__filter-defs" aria-hidden>
          <filter id="pc-bg-water-filter" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.014 0.02"
              numOctaves="2"
              seed="4"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                dur="7s"
                values="0.012 0.018;0.018 0.012;0.012 0.018"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>
      ) : null}
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
    </>
  );
}
