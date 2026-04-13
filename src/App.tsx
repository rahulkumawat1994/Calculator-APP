import { useState } from "react";
import Calculator from "./Calculator";
import History from "./History";
import GamesView from "./GamesView";
import SlotsSettings from "./SlotsSettings";
import { useAppData } from "./useAppData";

type Tab = "calculator" | "history" | "games" | "settings";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "calculator", icon: "🧮", label: "Calculate" },
  { id: "history",    icon: "📅", label: "History"   },
  { id: "games",      icon: "💰", label: "Payments"  },
  { id: "settings",   icon: "⚙️",  label: "Settings"  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("calculator");

  const {
    loading, dbError,
    sessions, slots, settings, payments,
    handleSaveSessions, handleSaveSlots, handleSaveSettings, handleSavePayments,
  } = useAppData();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#eef2f7] flex flex-col items-center justify-center gap-4">
        <div className="text-[48px]">🧮</div>
        <div className="text-[18px] font-bold text-[#1d6fb8]">Loading your data…</div>
        <div className="text-[13px] text-gray-400">Connecting to database</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] font-serif">

      {/* Tab bar */}
      <div className="sticky top-0 z-10 bg-white border-b-2 border-[#dde8f0] shadow-md">
        <div className="max-w-[980px] mx-auto flex">
          {TABS.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-3 pb-2.5 border-b-[3px] transition-colors ${
                tab === id
                  ? "border-[#1d6fb8] text-[#1d6fb8]"
                  : "border-transparent text-gray-400 active:text-gray-600"
              }`}
            >
              <span className="text-[22px] leading-none">{icon}</span>
              <span className="text-[11px] font-bold tracking-wide">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {dbError && (
        <div className="bg-orange-50 border-b-2 border-orange-200 px-4 py-2 text-center text-[13px] text-orange-700 font-semibold">
          ⚠️ Could not reach database — using local data. Check your internet connection.
        </div>
      )}

      <div className="max-w-[680px] mx-auto px-3 pt-5 pb-16">

        {tab === "calculator" && (
          <div className="flex flex-col items-center">
            <Calculator
              sessions={sessions}
              slots={slots}
              payments={payments}
              onSave={handleSaveSessions}
              onSavePayments={handleSavePayments}
            />
          </div>
        )}

        {tab === "history" && (
          <History
            sessions={sessions}
            slots={slots}
            payments={payments}
            onUpdate={handleSaveSessions}
            onSavePayments={handleSavePayments}
          />
        )}

        {tab === "games" && (
          <GamesView
            sessions={sessions}
            slots={slots}
            payments={payments}
            settings={settings}
            onSavePayments={handleSavePayments}
          />
        )}

        {tab === "settings" && (
          <SlotsSettings
            slots={slots}
            settings={settings}
            onSaveSlots={handleSaveSlots}
            onSaveSettings={handleSaveSettings}
          />
        )}

      </div>
    </div>
  );
}
