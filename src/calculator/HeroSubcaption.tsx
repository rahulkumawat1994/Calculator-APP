import "./premium-hero-effect.css";

type Props = {
  label: string;
  exiting: boolean;
};

export function HeroSubcaption({ label, exiting }: Props) {
  return (
    <div
      className={[
        "pc-hero__sub-shell",
        exiting ? "pc-hero__sub-shell--exit" : "pc-hero__sub-shell--open",
      ].join(" ")}
    >
      <div className="pc-hero__sub-shell__inner">
        <p className="pc-hero__sub">{label}</p>
      </div>
    </div>
  );
}
