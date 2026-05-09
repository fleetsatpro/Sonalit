import React, { useEffect, useRef } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

// ── Button ─────────────────────────────────────────────────────────────
export function Button({ children, variant = 'primary', size = 'md', loading, className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-navy-900';
  const variants = {
    primary: 'bg-gold text-navy-950 hover:bg-gold-light focus:ring-gold',
    secondary: 'bg-navy-700 text-slate-200 hover:bg-navy-800 border border-white/10 focus:ring-white/20',
    danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 focus:ring-danger',
    ghost: 'text-slate-400 hover:text-slate-200 hover:bg-white/5 focus:ring-white/10',
    success: 'bg-success/10 text-success border border-success/30 hover:bg-success/20 focus:ring-success',
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

// ── Card ───────────────────────────────────────────────────────────────
export function Card({ children, className = '', header, action }) {
  return (
    <div className={`bg-navy-900 border border-white/5 rounded-xl overflow-hidden ${className}`}>
      {(header || action) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-semibold text-slate-200 font-display text-sm tracking-wide">{header}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────
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
  maintenance: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  offline:     'bg-slate-700/50 text-slate-500 border border-slate-700',
};

export function Badge({ children, severity, status, className = '' }) {
  const style = severity ? severityMap[severity] : status ? statusMap[status] : 'bg-navy-700 text-slate-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium font-mono ${style} ${className}`}>
      {children}
    </span>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
         onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className={`w-full ${sizes[size]} bg-navy-900 border border-white/10 rounded-xl shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="font-display text-base font-semibold text-slate-100 tracking-wide">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────
export function Input({ label, error, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>}
      <input className={`bg-navy-800 border ${error ? 'border-danger/50 focus:border-danger' : 'border-white/10 focus:border-gold/50'} rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors ${className}`} {...props} />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

// ── Select ─────────────────────────────────────────────────────────────
export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</label>}
      <select className={`bg-navy-800 border ${error ? 'border-danger/50' : 'border-white/10 focus:border-gold/50'} rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors appearance-none ${className}`} {...props}>
        {children}
      </select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return <div className={`${sizes[size]} border-2 border-gold/20 border-t-gold rounded-full animate-spin`} />;
}

// ── EmptyState ─────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      {Icon && <Icon size={48} className="text-slate-700 mb-4" />}
      <p className="text-slate-400 font-medium">{title}</p>
      {subtitle && <p className="text-slate-600 text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

// ── ConfirmDialog ──────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </>}>
      <p className="text-slate-300 text-sm">{message}</p>
    </Modal>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────
export function KPICard({ label, value, sub, icon: Icon, color = 'text-gold', trend }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500 font-mono mb-2">{label}</p>
          <p className={`font-display text-3xl font-bold ${color}`}>{value ?? '—'}</p>
          {sub && <p className="text-xs text-slate-500 mt-1 font-mono">{sub}</p>}
        </div>
        {Icon && (
          <div className="p-3 bg-navy-800 rounded-lg border border-white/5">
            <Icon size={20} className={color} />
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div className={`mt-3 text-xs font-mono ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs last week
        </div>
      )}
    </Card>
  );
}
