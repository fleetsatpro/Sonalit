import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
export default function UpdateAvailableToast() {
    const [waitingSW, setWaitingSW] = useState(null);
    useEffect(() => {
        if (!('serviceWorker' in navigator))
            return;
        let cancelled = false;
        navigator.serviceWorker.ready.then((registration) => {
            if (cancelled)
                return;
            // Already waiting before this component mounted
            if (registration.waiting) {
                setWaitingSW(registration.waiting);
            }
            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW)
                    return;
                newSW.addEventListener('statechange', () => {
                    // 'installed' with an active controller means a waiting SW is ready
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        if (!cancelled)
                            setWaitingSW(newSW);
                    }
                });
            });
        });
        return () => { cancelled = true; };
    }, []);
    if (!waitingSW)
        return null;
    function activateUpdate() {
        waitingSW?.postMessage({ type: 'SKIP_WAITING' });
        setWaitingSW(null);
        // Reload happens via the controllerchange listener in main.tsx
    }
    return (<div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3 shadow-lg text-white text-sm">
      <span>A new version is available.</span>
      <button onClick={activateUpdate} className="flex items-center gap-1 rounded bg-orange-600 hover:bg-orange-700 px-3 py-1 font-medium text-xs">
        <RefreshCw size={12}/>
        Update
      </button>
    </div>);
}
