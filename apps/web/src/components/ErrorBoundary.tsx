import { AlertTriangle, RefreshCw, MessageSquare } from 'lucide-react';

// Request ID is injected by the backend X-Request-Id header and stored here on
// API errors. Falls back to a random client-side ID so Sentry events are linkable.
function getRequestId(): string {
  return (window as Window & { _lastRequestId?: string })._lastRequestId
    ?? `client-${Math.random().toString(36).slice(2)}`;
}

export function RootErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const requestId = getRequestId();

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-xl p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-900/40 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} className="text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-400 mb-1 font-mono break-all">{error.message}</p>
        <p className="text-xs text-slate-600 mb-4">Request ID: {requestId}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} />
            Reload
          </button>
          <a
            href={`https://github.com/fleetsatpro/sonalit/issues/new?title=Error: ${encodeURIComponent(error.message)}&body=Request+ID:+${encodeURIComponent(requestId)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
          >
            <MessageSquare size={14} />
            Report a bug
          </a>
        </div>
      </div>
    </div>
  );
}
