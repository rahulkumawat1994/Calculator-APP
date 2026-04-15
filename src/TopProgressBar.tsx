import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

// ─── Context ──────────────────────────────────────────────────────────────────

interface LoadingCtx { inc: () => void; dec: () => void }
const Ctx = createContext<LoadingCtx>({ inc: () => {}, dec: () => {} });

/** Call inc() to start a loading operation, dec() when it finishes. */
export function useLoadingSignal(): LoadingCtx {
  return useContext(Ctx);
}

// ─── Provider (wrap the app with this) ───────────────────────────────────────

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const inc = useCallback(() => setCount(c => c + 1), []);
  const dec = useCallback(() => setCount(c => Math.max(0, c - 1)), []);

  return (
    <Ctx.Provider value={{ inc, dec }}>
      {children}
      {count > 0 && <TopProgressBar />}
    </Ctx.Provider>
  );
}

// ─── Bar component ────────────────────────────────────────────────────────────

function TopProgressBar() {
  return (
    <>
      <style>{`
        @keyframes topbar-wave {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .topbar-anim {
          animation: topbar-wave 1.4s linear infinite;
        }
      `}</style>
      <div
        className="fixed top-0 left-0 right-0 z-9999 h-[3px] pointer-events-none"
        role="progressbar"
        aria-label="Loading"
      >
        <div
          className="topbar-anim h-full w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, #1d6fb8 30%, #60a5fa 50%, #1d6fb8 70%, transparent 100%)",
            backgroundSize: "200% 100%",
          }}
        />
      </div>
    </>
  );
}
