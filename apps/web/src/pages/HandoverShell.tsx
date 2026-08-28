import { Outlet } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, LogOut, Wifi } from 'lucide-react';
import { useAuthStore } from '../stores/auth.js';
import { api } from '../lib/api.js';
import GlobalPanicAlarm from '../components/layout/GlobalPanicAlarm.js';
import HandoverPinSetup from '../components/HandoverPinSetup.js';

interface PinStatus {
  has_pin: boolean;
  must_change: boolean;
  locked: boolean;
}

export default function HandoverShell() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [time, setTime] = useState(() => fmt());
  const [pinSetupDone, setPinSetupDone] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  const isHandoverOfficer = user?.role === 'handover_officer';

  const { data: pinStatus, isLoading: pinLoading } = useQuery({
    queryKey: ['handover-pin-status'],
    queryFn: async () => (await api.get<{ data: PinStatus }>('/handover-auth/pin/status')).data.data,
    enabled: isHandoverOfficer && !pinSetupDone,
    retry: false,
  });

  const needsPinSetup = isHandoverOfficer && !pinSetupDone && pinStatus && !pinStatus.has_pin;

  if (pinLoading && isHandoverOfficer) {
    return (
      <>
        <GlobalPanicAlarm />
        <div className="ho-shell">
          <Header user={user} time={time} onLogout={clearAuth} />
          <main className="ho-content">
            <div className="ho-shell-loading">
              <div className="ho-shell-loader" />
            </div>
          </main>
        </div>
        <ShellStyles />
      </>
    );
  }

  if (needsPinSetup) {
    return (
      <>
        <GlobalPanicAlarm />
        <div className="ho-shell">
          <Header user={user} time={time} onLogout={clearAuth} />
          <main className="ho-content">
            <HandoverPinSetup onComplete={() => setPinSetupDone(true)} />
          </main>
        </div>
        <ShellStyles />
      </>
    );
  }

  return (
    <>
      <GlobalPanicAlarm />
      <div className="ho-shell">
        <Header user={user} time={time} onLogout={clearAuth} />
        <main className="ho-content">
          <Outlet />
        </main>
      </div>
      <ShellStyles />
    </>
  );
}

function Header({
  user,
  time,
  onLogout,
}: {
  user: { name?: string; email?: string } | null;
  time: string;
  onLogout: () => void;
}) {
  return (
    <header className="ho-bar">
      <div className="ho-brand">
        <div className="ho-logo">
          <Shield size={15} strokeWidth={2.2} />
        </div>
        <div className="ho-titles">
          <div className="ho-app-name">
            <span className="ho-app-sonalit">SONALIT</span>
            <span className="ho-app-sep" />
            <span className="ho-app-label">HANDOVER</span>
          </div>
          {user && <div className="ho-user">{user.name || user.email}</div>}
        </div>
      </div>
      <div className="ho-status">
        <Wifi size={12} strokeWidth={2.2} />
        <span className="ho-clock">{time}</span>
      </div>
      <button className="ho-logout" onClick={onLogout} aria-label="Sign out" title="Sign out">
        <LogOut size={15} strokeWidth={2} />
      </button>
    </header>
  );
}

function fmt() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ShellStyles() {
  return (
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
        height: 54px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 14px;
        background: var(--d-carbon);
        box-shadow: 0 1px 0 rgba(200,215,240,.06);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .ho-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .ho-logo {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(139,107,255,.15), rgba(34,232,255,.15));
        box-shadow: 0 0 0 1px rgba(34,232,255,.12);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--d-sig);
        flex-shrink: 0;
      }

      .ho-titles {
        min-width: 0;
      }

      .ho-app-name {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .ho-app-sonalit {
        font-family: var(--d-font-display);
        font-size: 10px;
        letter-spacing: .18em;
        color: var(--d-t1);
        font-weight: 600;
        line-height: 1.2;
      }

      .ho-app-sep {
        width: 1px;
        height: 10px;
        background: rgba(200,215,240,.1);
      }

      .ho-app-label {
        font-family: var(--d-font-mono);
        font-size: 9px;
        letter-spacing: .16em;
        color: var(--d-sig);
        font-weight: 600;
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
        gap: 5px;
        color: var(--d-sig);
        flex-shrink: 0;
      }

      .ho-clock {
        font-family: var(--d-font-mono);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .06em;
        font-variant-numeric: tabular-nums;
        color: var(--d-sig);
      }

      .ho-logout {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 9px;
        border: none;
        box-shadow: 0 0 0 1px rgba(200,215,240,.08);
        background: var(--d-deep);
        color: var(--d-t2);
        cursor: pointer;
        transition: all .2s;
      }
      .ho-logout:hover {
        box-shadow: 0 0 0 1px rgba(200,215,240,.14);
        color: var(--d-t1);
        background: var(--d-well);
      }

      .ho-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }

      .ho-shell-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }

      .ho-shell-loader {
        width: 28px;
        height: 28px;
        border: 2px solid rgba(200,215,240,.08);
        border-top-color: var(--d-sig);
        border-radius: 50%;
        animation: ho-shell-spin .7s linear infinite;
      }

      @keyframes ho-shell-spin {
        to { transform: rotate(360deg); }
      }

      @media (prefers-reduced-motion: reduce) {
        .ho-shell-loader { animation: none; border-color: var(--d-sig); }
      }
    `}</style>
  );
}
