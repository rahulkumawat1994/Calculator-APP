import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from "./App";
import AdminPage from "./AdminPage";
import { ProtectedAppSession } from "@/auth/ProtectedAppSession";
import { useReportIssuePush } from "@/hooks/useReportIssuePush";

const StatementPage = lazy(() => import("./StatementPage"));
const MoneyViewPage = lazy(() => import("./MoneyViewPage"));

function normalizeAppPathname(p: string): string {
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

const path = normalizeAppPathname(window.location.pathname);
const isAdminPath = path === "/admin" || path === "/audit";
const isStatementPath = path === "/statement";
const isMoneyViewPath = path === "/money-view";

function ReportPushHost() {
  useReportIssuePush();
  return null;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <>
      <ReportPushHost />
      {isAdminPath ? (
        <ProtectedAppSession>
          <AdminPage />
        </ProtectedAppSession>
      ) : isStatementPath ? (
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] text-gray-600">
              Loading…
            </div>
          }
        >
          <ProtectedAppSession>
            <StatementPage />
          </ProtectedAppSession>
        </Suspense>
      ) : isMoneyViewPath ? (
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] text-gray-600">
              Loading…
            </div>
          }
        >
          <MoneyViewPage />
        </Suspense>
      ) : (
        <App />
      )}
      <ToastContainer
        position="top-center"
        newestOnTop
        closeOnClick
        pauseOnFocusLoss={false}
        pauseOnHover
        theme="light"
        limit={4}
      />
    </>
  </React.StrictMode>,
);
