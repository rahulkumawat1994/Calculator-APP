import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from './App';
import AdminPage from './AdminPage';
import { useReportIssuePush } from './useReportIssuePush';

const isAdminPath = window.location.pathname === '/admin' || window.location.pathname === '/audit';

function ReportPushHost() {
  useReportIssuePush();
  return null;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <>
      <ReportPushHost />
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
