import { WifiOff } from 'lucide-react';
import { useState, useEffect } from 'react';

import { isReachable, startConnectivity, subscribe as subscribeConnectivity } from '../lib/offline/connectivity.js';

/**
 * Surfaces are exempt from the offline takeover when they are built to keep
 * working without a connection. The Yard/Port field app is the whole reason
 * this exists: a container yard is a dead zone by nature, and blanking the
 * screen there would strand a worker mid-clamp with nothing but a Retry
 * button — while its own queue (pages/field/offlineQueue.ts) is perfectly
 * capable of saving the action and syncing it later.
 *
 * Everything else genuinely can't do useful work offline — a live fleet map or
 * a dashboard of stale numbers is worse than an honest "you're offline".
 */
const OFFLINE_CAPABLE = [/^\/field(\/|$)/];

function isOfflineCapable(pathname: string): boolean {
  return OFFLINE_CAPABLE.some(re => re.test(pathname));
}

export default function OfflineGuard({ children }: { children: React.ReactNode }) {
  // Sourced from the connectivity manager, not navigator.onLine. This guard
  // blanks the entire app, so it must not fire on a flag that reports a live
  // interface behind a captive portal — nor, worse, take the app away from a
  // worker whose requests are actually succeeding. The manager only says
  // OFFLINE after repeated real failures.
  const [online, setOnline] = useState(isReachable);
  const [, tick] = useState(0);

  useEffect(() => {
    startConnectivity();
    setOnline(isReachable());
    return subscribeConnectivity(() => { setOnline(isReachable()); });
  }, []);

  // This component sits above the router, so there's no router context to read
  // the current route from — poll instead, but only while offline, and only to
  // re-render. The path itself is read fresh during render below.
  useEffect(() => {
    if (online) return;
    const id = window.setInterval(() => { tick(n => n + 1); }, 500);
    return () => { window.clearInterval(id); };
  }, [online]);

  // Read the live location rather than holding it in state. Holding it meant
  // the value captured at mount (/login) was still there when the offline
  // event fired on /field/yard — so the guard blanked the screen for a single
  // render before correcting itself, and that one frame unmounted the whole
  // tree and wiped the worker's half-filled clamp form.
  if (!online && !isOfflineCapable(window.location.pathname)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-4">
        <WifiOff size={48} className="text-slate-400" />
        <h1 className="text-2xl font-bold">You&apos;re offline</h1>
        <p className="text-slate-400 text-center max-w-sm">
          Check your internet connection. Cached pages are still available.
        </p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
