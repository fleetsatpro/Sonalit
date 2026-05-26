import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineGuard({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  if (!online) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-4">
        <WifiOff size={48} className="text-slate-400" />
        <h1 className="text-2xl font-bold">You're offline</h1>
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
