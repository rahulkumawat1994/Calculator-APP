import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from './App';
import AdminPage from './AdminPage';
import { useReportIssueNotifications } from './useReportIssueNotifications';

const isAdminPath = window.location.pathname === '/admin' || window.location.pathname === '/audit';

/** Firestore listener + browser notifications; must run on /admin too (App is not mounted there). */
function ReportIssueNotificationsHost() {
  useReportIssueNotifications();
  return null;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <>
      <ReportIssueNotificationsHost />
      {isAdminPath ? <AdminPage /> : <App />}
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
