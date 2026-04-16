import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from './App';
import AdminPage from './AdminPage';
import FcmDemo from './FcmDemo';
import { useReportIssuePush } from './useReportIssuePush';

const path = window.location.pathname;
const isAdminPath = path === '/admin' || path === '/audit';
const isFcmDemoPath = path === '/fcm-demo';

function ReportPushHost() {
  useReportIssuePush();
  return null;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <>
      {!isFcmDemoPath && <ReportPushHost />}
      {isFcmDemoPath ? <FcmDemo /> : isAdminPath ? <AdminPage /> : <App />}
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
