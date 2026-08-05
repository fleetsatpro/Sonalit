import React from 'react';
import { useUIStore } from '@/stores/ui.js';

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => {
        const dotColor = toast.type === 'error' ? 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]' : 'bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,0.6)]';
        return (
          <div
            key={toast.id}
            className="bg-ink-3 border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 flex items-center gap-2.5 text-[13px] text-text-0 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.65)] animate-fade-in"
          >
            <span className={`w-2 h-2 rounded-full flex-none ${dotColor}`} />
            {toast.message}
          </div>
        );
      })}
    </div>
  );
}
