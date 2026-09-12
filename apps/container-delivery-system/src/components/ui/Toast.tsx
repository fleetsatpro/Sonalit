import { useUIStore } from '@/stores/ui.js';

const dotColors: Record<string, string> = {
  success: 'bg-cds-teal shadow-glow-teal',
  error: 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]',
  info: 'bg-cds-blue shadow-[0_0_8px_rgba(91,154,255,0.5)]',
  warning: 'bg-cds-amber shadow-[0_0_8px_rgba(255,176,32,0.5)]',
};

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-ink-3 border border-glass-border-strong rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm-tight text-text-0 shadow-toast animate-fade-in-up cursor-pointer hover:bg-ink-4 transition-colors"
          onClick={() => removeToast(toast.id)}
        >
          <span className={`w-2 h-2 rounded-full flex-none ${dotColors[toast.type] ?? dotColors['success']}`} />
          {toast.message}
        </div>
      ))}
    </div>
  );
}
