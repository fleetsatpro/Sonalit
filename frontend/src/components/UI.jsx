import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';

export function Button({ children, variant = 'primary', size = 'md', loading, className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-navy-900 active:scale-[0.98]';
  const variants = {
    primary:   'bg-gold text-navy-950 hover:bg-gold-light focus:ring-gold shadow-lg shadow-gold/10',
    secondary: 'bg-navy-700 text-slate-200 hover:bg-navy-600 border border-white/10 focus:ring-white/20',
    danger:    'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 focus:ring-danger',
    ghost:     'text-slate-400 hover:text-slate-200 hover:bg-white/5 focus:ring-white/10',
    success:   'bg-success/10 text-success border border-success/30 hover:bg-success/20 focus:ring-success',
    outline:   'border border-gold/40 text-gold hover:bg-gold/5 focus:ring-gold/30',
  };
  const sizes = { xs: 'px-2.5 py-1 text-xs', sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', header, action, glow, accent }) {
  return (
    <div className={`overflow-hidden transition-all duration-200 ${glow ? 'card-glow' : 'card'} ${className}`}>
      {(header || action) && (
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex items-center gap-2.5">
            {accent && <div className="w-1 h-4 rounded-full" style={{ background: accent }} />}
            <h3 className="font-semibold text-slate-300 font-display text-sm tracking-wide">{header}</h3>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const severityMap = {
  critical: 'bg-red-500/15 text-red-400 border border-red-500/30',
  high:     'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  medium:   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  low:      'bg-success/15 text-success border border-success/30',
  info:     'bg-purple-500/15 text-purple-400 border border-purple-500/30',
};
const statusMap = {
  active:      'bg-success/15 text-success border border-success/30',
  idle:        'bg-slate-500/15 text-slate-400 border border-slate-500/30',
  planned:     'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  completed:   'bg-success/15 text-success border border-success/30',
  aborted:     'bg-danger/15 text-danger border border-danger/30',
  delayed:     'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  incident:    'bg-red-500/15 text-red-400 border border-red-500/30',
  maintenance: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  offline:     'bg-slate-700/50 text-slate-500 border border-slate-700',
};

export function Badge({ children, severity, status, className = '', dot }) {
  const style = severity ? severityMap[severity] : status ? statusMap[status] : 'bg-navy-700 text-slate-300 border border-white/5';
  const dotColor = severity === 'critical' ? 'bg-red-400' : severity === 'high' ? 'bg-amber-400' : status === 'active' ? 'bg-success' : 'bg-slate-400';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium font-mono ${style} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${severity === 'critical' ? 'animate-pulse' : ''}`} />}
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) { document.addEventListener('keydown', handler); document.body.style.overflow = 'hidden'; }
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
         onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className={`w-full ${sizes[size]} bg-navy-900 border border-white/10 rounded-xl shadow-2xl animate-fade-in`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="font-display text-base font-semibold text-slate-100 tracking-wide">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, side = 'right', width = 'max-w-md' }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) { document.addEventListener('keydown', handler); document.body.style.overflow = 'hidden'; }
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [open, onClose]);
  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed top-0 ${side === 'right' ? 'right-0' : 'left-0'} h-full z-50 w-full ${width} bg-navy-900 border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <h2 className="font-display text-base font-semibold text-slate-100 tracking-wide">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

const TabsCtx = createContext(null);
export function Tabs({ value, onChange, children, className = '' }) {
  return <TabsCtx.Provider value={{ value, onChange }}><div className={className}>{children}</div></TabsCtx.Provider>;
}
export function TabList({ children, className = '' }) {
  return <div className={`flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5 ${className}`}>{children}</div>;
}
export function Tab({ value, children }) {
  const ctx = useContext(TabsCtx);
  const active = ctx.value === value;
  return (
    <button onClick={() => ctx.onChange(value)}
      className={`flex-1 px-3 py-1.5 text-xs font-medium font-mono tracking-wide rounded-md transition-all duration-150 ${active ? 'bg-gold text-navy-950 shadow-md' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
      {children}
    </button>
  );
}
export function TabPanel({ value, children }) {
  const ctx = useContext(TabsCtx);
  if (ctx.value !== value) return null;
  return <div className="animate-fade-in">{children}</div>;
}

const ToastCtx = createContext(null);
let toastId = 0;
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = (msg, type = 'info', duration = 4000) => {
    const id = ++toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  };
  const remove = (id) => setToasts(t => t.filter(x => x.id !== id));
  const icons = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info };
  const styles = { success: 'border-success/30 text-success', error: 'border-danger/30 text-danger', warning: 'border-amber-500/30 text-amber-400', info: 'border-blue-500/30 text-blue-400' };
  return (
    <ToastCtx.Provider value={{ toast: add }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const Icon = icons[t.type] || Info;
          return (
            <div key={t.id} className={`pointer-events-auto flex items-start gap-3 bg-navy-800 border ${styles[t.type]} rounded-xl px-4 py-3 shadow-2xl max-w-sm w-full animate-fade-in`}>
              <Icon size={16} className="mt-0.5 flex-shrink-0" />
              <p className="text-sm text-slate-200 flex-1 leading-snug">{t.msg}</p>
              <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-slate-300 flex-shrink-0"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

export function Input({ label, error, className = '', prefix, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{prefix}</span>}
        <input className={`w-full bg-navy-800 border ${error ? 'border-danger/50 focus:border-danger' : 'border-white/10 focus:border-gold/50'} rounded-lg ${prefix ? 'pl-9' : 'px-3'} py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors ${className}`} {...props} />
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>}
      <select className={`bg-navy-800 border ${error ? 'border-danger/50' : 'border-white/10 focus:border-gold/50'} rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors appearance-none ${className}`} {...props}>{children}</select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return <div className={`${sizes[size]} border-2 border-gold/20 border-t-gold rounded-full animate-spin`} />;
}

export function Skeleton({ className = '', lines }) {
  if (lines) return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-navy-800 rounded animate-pulse ${i === lines - 1 ? 'w-3/4' : 'w-full'}`} />
      ))}
    </div>
  );
  return <div className={`bg-navy-800 rounded animate-pulse ${className}`} />;
}

export function SkeletonCard({ className = '' }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-2 w-32" />
        </div>
        <Skeleton className="w-12 h-12 rounded-lg" />
      </div>
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      {Icon && <div className="w-16 h-16 rounded-2xl bg-navy-800 border border-white/5 flex items-center justify-center mb-4"><Icon size={28} className="text-slate-600" /></div>}
      <p className="text-slate-400 font-medium">{title}</p>
      {subtitle && <p className="text-slate-600 text-sm mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></>}>
      <p className="text-slate-300 text-sm leading-relaxed">{message}</p>
    </Modal>
  );
}

export function KPICard({ label, value, sub, icon: Icon, color = 'text-gold', trend, pulse, accentColor }) {
  const accent = accentColor || (
    color === 'text-gold' ? '#F0B429' :
    color === 'text-success' ? '#22D3A0' :
    color === 'text-danger' || color?.includes('danger') ? '#F25252' :
    color === 'text-blue-400' ? '#60a5fa' : '#F0B429'
  );
  return (
    <div
      className="card-glow p-5 overflow-hidden relative"
      style={{ borderRadius: 16 }}
    >
      {/* top accent line */}
      <div className="kpi-accent" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] uppercase tracking-[0.18em] text-slate-600 font-mono mb-2.5">{label}</p>
          <p
            className={`font-display text-3xl font-bold tabular-nums leading-none ${color} ${pulse ? 'animate-pulse' : ''}`}
            style={pulse ? { textShadow: `0 0 20px ${accent}` } : {}}
          >
            {value ?? '—'}
          </p>
          {sub && <p className="text-[11px] text-slate-600 mt-2 font-mono truncate leading-snug">{sub}</p>}
        </div>
        {Icon && (
          <div
            className="flex-shrink-0 p-2.5 rounded-xl"
            style={{
              background: `${accent}12`,
              border: `1px solid ${accent}22`,
            }}
          >
            <Icon size={18} style={{ color: accent }} />
          </div>
        )}
      </div>

      {trend !== undefined && (
        <div className={`mt-3 flex items-center gap-1 text-xs font-mono ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
          <span>{trend >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(trend)}% vs last week</span>
        </div>
      )}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action, mono }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h1 className={`font-display font-bold text-slate-100 tracking-widest ${mono ? 'font-mono text-sm text-gold' : 'text-lg'}`}>{title}</h1>
        {subtitle && <p className="text-slate-500 text-sm font-mono mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatRow({ label, value, valueClass = 'text-slate-200' }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500 font-mono">{label}</span>
      <span className={`text-xs font-medium font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}
