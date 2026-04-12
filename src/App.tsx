import { useState } from "react";
import Calculator from "./Calculator";
import History from "./History";
import { loadSessions, saveSessions } from "./calcUtils";
import type { SavedSession } from "./types";

export default function App() {
  const [sessions, setSessions] = useState<SavedSession[]>(loadSessions);

  const handleSave = (updated: SavedSession[]) => {
    setSessions(updated);
    saveSessions(updated);
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] font-serif">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center gap-6 px-4 pt-6 pb-12 max-w-[980px] mx-auto">

        {/* Left — Calculator */}
        <div className="flex flex-col items-center w-full lg:max-w-[520px] shrink-0">
          <Calculator sessions={sessions} onSave={handleSave} />
        </div>

        {/* Right — History (sticky sidebar on desktop) */}
        <div className="w-full lg:w-[400px] shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
          <History sessions={sessions} onUpdate={handleSave} />
        </div>

      </div>
    </div>
  );
}
