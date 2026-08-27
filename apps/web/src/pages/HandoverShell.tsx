import { Outlet } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Signal, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/auth.js';
import GlobalPanicAlarm from '../components/layout/GlobalPanicAlarm.js';

export default function HandoverShell() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [time, setTime] = useState(() => fmt());

  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <GlobalPanicAlarm />
      <div className="ho-shell">
        <header className="ho-bar">
          <div className="ho-brand">
            <div className="ho-logo">
              <span className="ho-logo-s">S</span>
              <span className="ho-logo-dot" />
            </div>
            <div className="ho-titles">
              <div className="ho-app-name">HANDOVER</div>
              {user && <div className="ho-user">{user.name || user.email}</div>}
            </div>
          </div>
          <div className="ho-status">
            <Signal size={13} strokeWidth={2.2} />
            <span className="ho-clock">{time}</span>
          </div>
          <button className="ho-logout" onClick={() => clearAuth()} aria-label="Sign out" title="Sign out">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </header>
        <main className="ho-content">
          <Outlet />
        </main>
      </div>

      <style>{`
        .ho-shell {
          display: flex;
          flex-direction: column;
          height: 100dvh;
          width: 100%;
          background: var(--d-void);
          overflow: hidden;
        }
        .ho-bar {
          flex-shrink: 0;
          height: 56px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 16px;
          background: var(--d-carbon);
          border-bottom: 1px solid var(--d-rim);
        }
        .ho-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }
        .ho-logo {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, var(--d-orange) 0%, var(--d-sig) 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          flex-shrink: 0;
        }
        .ho-logo-s {
          font-family: var(--d-font-display);
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          line-height: 1;
        }
        .ho-logo-dot {
          position: absolute;
          bottom: 5px;
          right: 5px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #fff;
        }
        .ho-titles {
          min-width: 0;
        }
        .ho-app-name {
          font-family: var(--d-font-display);
          font-size: 11px;
          letter-spacing: .18em;
          color: var(--d-t1);
          font-weight: 600;
          line-height: 1.2;
        }
        .ho-user {
          font-family: var(--d-font-mono);
          font-size: 10px;
          color: var(--d-t2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
          margin-top: 1px;
        }
        .ho-status {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--d-sig);
          flex-shrink: 0;
        }
        .ho-clock {
          font-family: var(--d-font-mono);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: .06em;
          font-variant-numeric: tabular-nums;
          color: var(--d-sig);
          text-shadow: 0 0 12px var(--d-sglow);
        }
        .ho-logout {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--d-rim2);
          background: none;
          color: var(--d-t2);
          cursor: pointer;
          transition: all .15s;
        }
        .ho-logout:hover { border-color: var(--d-rim3); color: var(--d-t1); }
        .ho-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
      `}</style>
    </>
  );
}

function fmt() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
