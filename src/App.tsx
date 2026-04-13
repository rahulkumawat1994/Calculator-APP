import { useState } from "react";
import Calculator from "./Calculator";
import History from "./History";
import GamesView from "./GamesView";
import SlotsSettings from "./SlotsSettings";
import {
  loadSessions, saveSessions,
  loadGameSlots, saveGameSlots,
  loadSettings, saveSettings,
  loadPaymentRecords, savePaymentRecords,
} from "./calcUtils";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";

type Tab = "calculator" | "history" | "games" | "settings";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "calculator", icon: "🧮", label: "Calculate" },
  { id: "history",    icon: "📅", label: "History"   },
  { id: "games",      icon: "💰", label: "Payments"  },
  { id: "settings",   icon: "⚙️",  label: "Settings"  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("calculator");
  const [sessions,  setSessions]  = useState<SavedSession[]>(loadSessions);
  const [slots,     setSlots]     = useState<GameSlot[]>(loadGameSlots);
  const [settings,  setSettings]  = useState<AppSettings>(loadSettings);
  const [payments,  setPayments]  = useState<PaymentRecord[]>(loadPaymentRecords);

  const handleSaveSessions  = (u: SavedSession[])  => { setSessions(u);  saveSessions(u); };
  const handleSaveSlots     = (u: GameSlot[])       => { setSlots(u);     saveGameSlots(u); };
  const handleSaveSettings  = (u: AppSettings)      => { setSettings(u);  saveSettings(u); };
  const handleSavePayments  = (u: PaymentRecord[])  => { setPayments(u);  savePaymentRecords(u); };

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
