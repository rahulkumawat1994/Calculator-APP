import { useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";
import "./premium-hero-effect.css";

export type HeroEffectVariant = "success" | "warn";

type Props = {
  token: number;
  variant?: HeroEffectVariant;
  amountRef: RefObject<HTMLElement | null>;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  streak: boolean;
  rotation: number;
};

const SUCCESS_COLORS = ["#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#e0e7ff"];
const WARN_COLORS = ["#d97706", "#f59e0b", "#fbbf24", "#fde68a", "#fff7ed"];
const PARTICLE_COUNT = 28;
const DURATION_MS = 1_050;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function spawnParticles(
  originX: number,
  originY: number,
  variant: HeroEffectVariant,
): Particle[] {
  const colors = variant === "success" ? SUCCESS_COLORS : WARN_COLORS;

  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const angle =
      (Math.PI * 2 * index) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.45;
    const speed = 1.4 + Math.random() * 3.2;
    const streak = Math.random() > 0.72;

    return {
      x: originX + (Math.random() - 0.5) * 18,
      y: originY + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.8,
      life: 0,
      maxLife: 0.55 + Math.random() * 0.45,
      size: streak ? 1.2 + Math.random() * 1.4 : 1.4 + Math.random() * 2.2,
      color: pick(colors),
      streak,
      rotation: angle + Math.PI / 2,
    };
  });
}

export function HeroCalculateEffect({
  token,
  variant = "success",
  amountRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (token <= 0) return;
    if (prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    const anchor = amountRef.current;
    if (!canvas || !anchor) return;

    const hero = anchor.closest(".pc-hero");
    if (!hero) return;

    const heroRect = hero.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.ceil(heroRect.width * dpr);
    canvas.height = Math.ceil(heroRect.height * dpr);
    canvas.style.width = `${heroRect.width}px`;
    canvas.style.height = `${heroRect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const originX = anchorRect.left - heroRect.left + anchorRect.width / 2;
    const originY = anchorRect.top - heroRect.top + anchorRect.height / 2;
    const particles = spawnParticles(originX, originY, variant);
    const start = performance.now();

    const draw = (now: number) => {
      const elapsed = (now - start) / DURATION_MS;
      if (elapsed >= 1) {
        ctx.clearRect(0, 0, heroRect.width, heroRect.height);
        return;
      }

      ctx.clearRect(0, 0, heroRect.width, heroRect.height);

      for (const particle of particles) {
        particle.life = elapsed / particle.maxLife;
        if (particle.life >= 1) continue;

        const t = particle.life;
        const fade = 1 - Math.pow(t, 1.6);
        const x = particle.x + particle.vx * t * 58;
        const y =
          particle.y + particle.vy * t * 58 + t * t * 18;

        ctx.save();
        ctx.globalAlpha = fade * 0.85;
        ctx.fillStyle = particle.color;
        ctx.strokeStyle = particle.color;

        if (particle.streak) {
          ctx.translate(x, y);
          ctx.rotate(particle.rotation);
          ctx.fillRect(
            -particle.size * 2.8,
            -particle.size * 0.35,
            particle.size * 5.6,
            particle.size * 0.7,
          );
        } else {
          ctx.beginPath();
          ctx.arc(x, y, particle.size, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [amountRef, token, variant]);

  if (token <= 0 || prefersReducedMotion()) return null;

  return (
    <div
      className={`pc-hero-fx pc-hero-fx--${variant}`}
      aria-hidden
    >
      <canvas ref={canvasRef} className="pc-hero-fx__canvas" />
      <div key={`ring-a-${token}`} className="pc-hero-fx__ring pc-hero-fx__ring--a" />
      <div key={`ring-b-${token}`} className="pc-hero-fx__ring pc-hero-fx__ring--b" />
      <div key={`shimmer-${token}`} className="pc-hero-fx__shimmer" />
    </div>
  );
}
