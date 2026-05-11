import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Toaster
      position="top-right"
      toastOptions={{
        style: { background: '#0D1321', color: '#e2e8f0', border: '1px solid #1a2235', fontFamily: 'Space Grotesk, sans-serif' },
        success: { iconTheme: { primary: '#22D3A0', secondary: '#0D1321' } },
        error: { iconTheme: { primary: '#F25252', secondary: '#0D1321' } },
      }}
    />
  </React.StrictMode>
);
