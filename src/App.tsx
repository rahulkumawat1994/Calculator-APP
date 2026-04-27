import { lazy, Suspense, useState } from "react";
import Calculator from "./Calculator";
import { useAppData } from "@/hooks/useAppData";
import { LoadingProvider } from "./TopProgressBar";
import {
  AlertBanner,
  AppLoadingState,
  IconTabBar,
  PageContainer,
  TabSuspenseFallback,
} from "./ui";

const History = lazy(() => import("./History"));
const GamesView = lazy(() => import("./GamesView"));
const SlotsSettings = lazy(() => import("./SlotsSettings"));

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
    return <AppLoadingState />;
  }

  return (
    <LoadingProvider>
    <div className="min-h-screen bg-[#eef2f7] font-serif">
      <IconTabBar
        items={TABS}
        value={tab}
        onChange={setTab}
      />

      {dbError && (
        <AlertBanner tone="warning">
          ⚠️ Could not reach database — using local data. Check your internet
          connection.
        </AlertBanner>
      )}

      {writeError && (
        <AlertBanner tone="error">
          ⚠️ Settings could not be saved to the database. Changes are saved
          locally only.
        </AlertBanner>
      )}

      <PageContainer>
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

        {tab !== "calculator" && (
          <Suspense fallback={<TabSuspenseFallback />}>
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
          </Suspense>
        )}
      </PageContainer>
    </div>
    </LoadingProvider>
  );
}
