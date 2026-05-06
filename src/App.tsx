import { lazy, Suspense, useState } from "react";
import { AppLoginModal } from "@/auth/AppLoginModal";
import { hasAppAuthCookie } from "@/auth/appAuthCookie";
import Calculator from "./Calculator";
import { useAppData } from "@/hooks/useAppData";
import { useHistoryOverlay } from "@/hooks/useHistoryOverlay";
import { useShellTab, type ShellTab } from "@/hooks/useShellTab";
import { LoadingProvider } from "./TopProgressBar";
import {
  AlertBanner,
  AppLoadingState,
  Button,
  Card,
  IconTabBar,
  Modal,
  PageContainer,
  TabSuspenseFallback,
} from "./ui";

const GamesView = lazy(() => import("./GamesView"));
const SlotsSettings = lazy(() => import("./SlotsSettings"));

const TABS: { id: ShellTab; icon: string; label: string }[] = [
  { id: "calculator", icon: "🧮", label: "Calculate" },
  { id: "games", icon: "💰", label: "Payments" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useShellTab();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [postLoginAdminCta, setPostLoginAdminCta] = useState(false);
  const [appAuthed, setAppAuthed] = useState(() => hasAppAuthCookie());

  useHistoryOverlay(loginModalOpen, () => setLoginModalOpen(false));
  useHistoryOverlay(postLoginAdminCta, () => setPostLoginAdminCta(false));

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
    saveGameResult,
    loadGameResultsByDate,
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
          trailing={
            appAuthed ? (
              <a
                href="/admin"
                className="flex shrink-0 items-center justify-center self-center rounded-md px-2 py-1 text-[11px] font-bold tracking-wide text-[#1d6fb8] hover:underline"
              >
                Admin
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPostLoginAdminCta(false);
                  setLoginModalOpen(true);
                }}
                className="flex shrink-0 items-center justify-center self-center rounded-md px-2 py-1 text-[11px] font-bold tracking-wide text-[#1d6fb8] hover:underline"
              >
                Login
              </button>
            )
          }
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
          <div
            className={
              tab === "calculator" ? "flex flex-col items-center" : "hidden"
            }
          >
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
                  loadGameResultsByDate={loadGameResultsByDate}
                  saveGameResult={saveGameResult}
                  saveSessionDoc={saveSessionDoc}
                  deleteSessionDoc={deleteSessionDoc}
                  deletePaymentsByContactDate={deletePaymentsByContactDate}
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

      <AppLoginModal
        open={loginModalOpen}
        allowDismiss
        title="Sign in"
        onClose={() => setLoginModalOpen(false)}
        onSuccess={() => {
          setAppAuthed(true);
          setLoginModalOpen(false);
          setPostLoginAdminCta(true);
        }}
      />

      {postLoginAdminCta && (
        <Modal
          open
          onBackdropClick={() => setPostLoginAdminCta(false)}
          backdrop="dim"
          overlayClassName="p-4"
        >
          <Card
            surface="panel"
            className="w-full max-w-[400px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-login-admin-title"
          >
            <div className="border-b border-[#e7eef7] px-5 py-4">
              <h2
                id="post-login-admin-title"
                className="text-[18px] font-extrabold text-[#1a1a1a]"
              >
                Signed in
              </h2>
              <p className="mt-2 text-[13px] leading-snug text-gray-600">
                Open the internal <strong className="font-semibold text-[#1a1a1a]">Admin</strong> area when you are
                ready. Your session is stored in a cookie for 5 days.
              </p>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <Button
                type="button"
                variant="primary"
                className="w-full py-3 text-[15px] font-bold"
                onClick={() => window.location.assign("/admin")}
              >
                Go to Admin
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full py-3 text-[15px] font-semibold"
                onClick={() => setPostLoginAdminCta(false)}
              >
                Stay on calculator
              </Button>
            </div>
          </Card>
        </Modal>
      )}
    </LoadingProvider>
  );
}
