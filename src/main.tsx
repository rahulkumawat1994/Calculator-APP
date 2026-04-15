import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AdminPage from './AdminPage';

const isAdminPath = window.location.pathname === '/admin' || window.location.pathname === '/audit';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isAdminPath ? <AdminPage /> : <App />}
  </React.StrictMode>,
);
