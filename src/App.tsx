import { useState } from "react";
import Calculator from "./Calculator";
import History from "./History";
import GamesView from "./GamesView";
import SlotsSettings from "./SlotsSettings";
import { useAppData } from "./useAppData";
import { LoadingProvider } from "./TopProgressBar";

type Tab = "calculator" | "history" | "games" | "settings";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "calculator", icon: "🧮", label: "Calculate" },
  { id: "history", icon: "📅", label: "History" },
  { id: "games", icon: "💰", label: "Payments" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("calculator");

  const {
    loading,
    dbError,
    writeError,
    slots,
    settings,
    handleSaveSlots,
    handleSaveSettings,
    saveSessionDoc,
    deleteSessionDoc,
    loadSessionsByDate,
    loadSessionsByMonth,
    loadSessionDatesForMonth,
    savePaymentDoc,
    deletePaymentsByContactDate,
    loadPaymentsByDate,
    loadPaymentsByMonth,
    logCalculationAudit,
  } = useAppData();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#eef2f7] flex flex-col items-center justify-center gap-4">
        <div className="text-[48px]">🧮</div>
        <div className="text-[18px] font-bold text-[#1d6fb8]">
          Loading your data…
        </div>
        <div className="text-[13px] text-gray-400">Connecting to database</div>
      </div>
    );
  }

  return (
    <LoadingProvider>
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
              <span className="text-[11px] font-bold tracking-wide">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {dbError && (
        <div className="bg-orange-50 border-b-2 border-orange-200 px-4 py-2 text-center text-[13px] text-orange-700 font-semibold">
          ⚠️ Could not reach database — using local data. Check your internet
          connection.
        </div>
      )}

      {writeError && (
        <div className="bg-red-50 border-b-2 border-red-200 px-4 py-2 text-center text-[13px] text-red-700 font-semibold">
          ⚠️ Settings could not be saved to the database. Changes are saved
          locally only.
        </div>
      )}

      <div className="max-w-[680px] mx-auto px-3 pt-5 pb-16">
        {/* Calculator is always mounted to preserve input state between tab switches */}
        <div className={tab === "calculator" ? "flex flex-col items-center" : "hidden"}>
          <Calculator
            slots={slots}
            settings={settings}
            loadSessionsByDate={loadSessionsByDate}
            loadPaymentsByDate={loadPaymentsByDate}
            saveSessionDoc={saveSessionDoc}
            savePaymentDoc={savePaymentDoc}
            logCalculationAudit={logCalculationAudit}
          />
        </div>

        {tab === "history" && (
          <History
            slots={slots}
            loadSessionsByDate={loadSessionsByDate}
            loadPaymentsByDate={loadPaymentsByDate}
            loadSessionDatesForMonth={loadSessionDatesForMonth}
            saveSessionDoc={saveSessionDoc}
            deleteSessionDoc={deleteSessionDoc}
            deletePaymentsByContactDate={deletePaymentsByContactDate}
          />
        )}

        {tab === "games" && (
          <GamesView
            slots={slots}
            settings={settings}
            loadSessionsByDate={loadSessionsByDate}
            loadSessionsByMonth={loadSessionsByMonth}
            loadSessionDatesForMonth={loadSessionDatesForMonth}
            loadPaymentsByDate={loadPaymentsByDate}
            loadPaymentsByMonth={loadPaymentsByMonth}
            savePaymentDoc={savePaymentDoc}
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
    </LoadingProvider>
  );
}
