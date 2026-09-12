import { Outlet } from '@tanstack/react-router';
import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/auth.js';
import { api } from '../lib/api.js';
import GlobalPanicAlarm from '../components/layout/GlobalPanicAlarm.js';
import HandoverPinSetup from '../components/HandoverPinSetup.js';

interface PinStatus {
  has_pin: boolean;
  must_change: boolean;
  locked: boolean;
}

interface HeaderState {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  onRefresh?: () => void;
}

interface HeaderContextValue {
  header: HeaderState;
  setHeader: (h: HeaderState) => void;
}

const HandoverHeaderContext = createContext<HeaderContextValue | null>(null);

const DEFAULT_HEADER: HeaderState = {
  title: 'Handover Queue',
  subtitle: 'Convoys awaiting signed handover forms',
};

export function useHandoverHeader() {
  const ctx = useContext(HandoverHeaderContext);
  if (!ctx) throw new Error('useHandoverHeader must be used within HandoverShell');
  return ctx.setHeader;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function HandoverShell() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [time, setTime] = useState(() => fmt());
  const [pinSetupDone, setPinSetupDone] = useState(false);
  const [header, setHeader] = useState<HeaderState>(DEFAULT_HEADER);
  const headerCtx = useMemo(() => ({ header, setHeader }), [header]);

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
  const displayName = user?.name || user?.email || 'Officer';

  if (pinLoading && isHandoverOfficer) {
    return (
      <>
        <GlobalPanicAlarm />
        <div className="ho-shell">
          <Header displayName={displayName} time={time} onLogout={clearAuth} header={DEFAULT_HEADER} />
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
          <Header displayName={displayName} time={time} onLogout={clearAuth} header={{ title: 'Account setup', subtitle: 'Secure your handover sign-in' }} />
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
        <Header displayName={displayName} time={time} onLogout={clearAuth} header={header} />
        <main className="ho-content">
          <HandoverHeaderContext.Provider value={headerCtx}>
            <Outlet />
          </HandoverHeaderContext.Provider>
        </main>
      </div>
      <ShellStyles />
    </>
  );
}

function Header({
  displayName,
  time,
  onLogout,
  header,
}: {
  displayName: string;
  time: string;
  onLogout: () => void;
  header: HeaderState;
}) {
  return (
    <header className="ho-bar">
      <div className="ho-bar-row1">
        <div className="ho-brand">
          <span className="ho-avatar">{initials(displayName)}</span>
          <div className="ho-brand-text">
            <span className="ho-brand-kicker">Sonalit</span>
            <span className="ho-brand-sub">{displayName}</span>
          </div>
        </div>
        <div className="ho-bar-actions">
          <div className="ho-live-clock">
            <span className="ho-live-dot" />
            <span className="ho-clock">{time}</span>
          </div>
          {header.onRefresh && (
            <button className="ho-icon-btn" onClick={header.onRefresh} aria-label="Refresh">
              <RefreshGlyph />
            </button>
          )}
          <button className="ho-icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="ho-bar-row2">
        <span className="ho-title-badge">{header.icon ?? <Shield size={18} strokeWidth={2} />}</span>
        <div className="ho-title-block">
          <h1 className="ho-title">{header.title}</h1>
          <p className="ho-subtitle">{header.subtitle}</p>
        </div>
      </div>
    </header>
  );
}

function RefreshGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
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
        padding: max(10px, env(safe-area-inset-top)) 16px 14px;
        background: rgba(6, 11, 24, 0.85);
        box-shadow: 0 1px 0 rgba(232,238,247,.08);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .ho-bar-row1 {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .ho-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .ho-avatar {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        background: rgba(34,232,255,.14);
        color: var(--d-sig);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-family: var(--d-font-mono);
        font-size: 12px;
        font-weight: 600;
      }

      .ho-brand-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .ho-brand-kicker {
        font-family: var(--d-font-mono);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: .16em;
        text-transform: uppercase;
        color: var(--d-t2);
        line-height: 1.3;
      }

      .ho-brand-sub {
        font-size: 11px;
        color: var(--d-t3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 46vw;
      }

      .ho-bar-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .ho-live-clock {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
      }

      .ho-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--d-sig);
        animation: ho-live-pulse 1.8s ease-in-out infinite;
      }

      .ho-clock {
        font-family: var(--d-font-mono);
        font-size: 13px;
        font-weight: 500;
        letter-spacing: .02em;
        font-variant-numeric: tabular-nums;
        color: var(--d-sig);
      }

      .ho-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        border: none;
        background: transparent;
        color: var(--d-t2);
        cursor: pointer;
        transition: all .15s;
      }
      .ho-icon-btn:hover {
        background: var(--d-well);
        color: var(--d-t1);
      }
      .ho-icon-btn:active {
        transform: scale(.94);
      }

      .ho-bar-row2 {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: 16px;
      }

      .ho-title-badge {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: rgba(34,232,255,.12);
        color: var(--d-sig);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .ho-title-block {
        min-width: 0;
      }

      .ho-title {
        font-family: var(--d-font);
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -.01em;
        color: var(--d-t1);
        margin: 0;
        line-height: 1.25;
      }

      .ho-subtitle {
        font-size: 13px;
        color: var(--d-t2);
        margin: 2px 0 0;
        line-height: 1.4;
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
        border: 2px solid rgba(232,238,247,.08);
        border-top-color: var(--d-sig);
        border-radius: 50%;
        animation: ho-shell-spin .7s linear infinite;
      }

      @keyframes ho-shell-spin {
        to { transform: rotate(360deg); }
      }

      @keyframes ho-live-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: .45; transform: scale(.72); }
      }

      @media (prefers-reduced-motion: reduce) {
        .ho-shell-loader, .ho-live-dot { animation: none; }
      }
    `}</style>
  );
}
