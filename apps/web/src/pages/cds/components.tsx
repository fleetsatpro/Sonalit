import React, { useEffect, useRef, useState, useMemo } from 'react';
import { STATUS_BADGE_STYLES, RISK_BADGE_STYLES } from './constants.js';
import { useCDSStore } from './store.js';

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export function Card({
  children,
  className = '',
  onClick,
  hover = false,
}: CardProps) {
  return (
    <div
      className={`bg-gradient-to-b from-[rgba(255,255,255,0.025)] to-[rgba(255,255,255,0.008)] border border-[rgba(255,255,255,0.07)] rounded-[14px] ${hover ? 'cursor-pointer transition-colors hover:border-[rgba(255,255,255,0.12)]' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Button & IconButton                                                */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

const buttonVariantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-cds-orange text-[#170d00] shadow-[0_8px_20px_-8px_rgba(255,122,0,0.35)] hover:brightness-110',
  ghost:
    'bg-ink-2 text-text-1 border border-[rgba(255,255,255,0.12)] hover:bg-ink-3 hover:text-text-0',
  danger: 'bg-cds-red text-[#2b0000] hover:brightness-110',
  success: 'bg-cds-teal/15 text-cds-teal border border-cds-teal/30',
};

const buttonSizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 text-[11px] px-2.5 rounded-lg gap-1',
  md: 'h-9 text-[12.5px] px-3.5 rounded-[10px] gap-1.5',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`font-display font-semibold inline-flex items-center justify-center cursor-pointer border-0 transition-all duration-100 whitespace-nowrap active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${buttonSizeStyles[size]} ${buttonVariantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-[34px] h-[34px] rounded-[9px] border-none bg-transparent text-text-1 cursor-pointer flex items-center justify-center transition-colors hover:bg-ink-3 hover:text-text-0 flex-none relative ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge, StatusBadge, RiskBadge                                      */
/* ------------------------------------------------------------------ */

interface BadgeProps {
  variant: 'ok' | 'warn' | 'bad' | 'neutral';
  children: React.ReactNode;
  className?: string;
}

const badgeVariantStyles: Record<string, string> = {
  ok: 'bg-cds-teal/15 text-cds-teal',
  warn: 'bg-cds-amber/15 text-cds-amber',
  bad: 'bg-cds-red/15 text-cds-red',
  neutral: 'bg-ink-3 text-text-1',
};

export function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-mono text-[9.5px] font-semibold px-[7px] py-[3px] rounded-[5px] tracking-wide whitespace-nowrap ${badgeVariantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status];
  if (!style) return <Badge variant="neutral">{status.toUpperCase()}</Badge>;
  const variantMap: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
    'text-cds-teal': 'ok',
    'text-cds-amber': 'warn',
    'text-cds-red': 'bad',
    'text-text-1': 'neutral',
    'text-cds-orange': 'warn',
  };
  return (
    <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>
  );
}

export function RiskBadge({ risk }: { risk: string }) {
  const style = RISK_BADGE_STYLES[risk];
  if (!style) return <Badge variant="neutral">{risk.toUpperCase()}</Badge>;
  const variantMap: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
    'text-cds-teal': 'ok',
    'text-cds-amber': 'warn',
    'text-cds-red': 'bad',
  };
  return (
    <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  ProgressBar                                                        */
/* ------------------------------------------------------------------ */

interface ProgressBarProps {
  value: number;
  color?: string;
  width?: string;
}

export function ProgressBar({
  value,
  color = 'bg-cds-orange',
  width = 'w-[60px]',
}: ProgressBarProps) {
  return (
    <div className={`${width} h-[5px] rounded bg-ink-3 overflow-hidden`}>
      <div
        className={`h-full rounded ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPICard                                                            */
/* ------------------------------------------------------------------ */

interface KPICardProps {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
  sparkline?: number[];
}

export function KPICard({
  label,
  value,
  delta,
  trend,
  sparkline,
}: KPICardProps) {
  const [displayValue, setDisplayValue] = useState('0');
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) {
      setDisplayValue(value);
      return;
    }
    mounted.current = true;
    const numMatch = value.match(/[\d.]+/);
    if (!numMatch) {
      setDisplayValue(value);
      return;
    }
    const target = parseFloat(numMatch[0]);
    const prefix = value.slice(0, numMatch.index);
    const suffix = value.slice((numMatch.index ?? 0) + numMatch[0].length);
    let cur = 0;
    const steps = 24;
    const inc = target / steps;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      cur += inc;
      if (i >= steps) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(`${prefix}${Math.round(cur)}${suffix}`);
      }
    }, 18);
    return () => clearInterval(timer);
  }, [value]);

  const sparkPoints = sparkline
    ?.map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * 100;
      const y = 34 - (v / 100) * 32;
      return `${x},${Math.max(2, Math.min(32, y))}`;
    })
    .join(' ');

  return (
    <Card className="p-4 relative overflow-hidden">
      <div className="font-mono text-[11px] text-text-2 tracking-wide">
        {label}
      </div>
      <div className="font-display font-extrabold text-[28px] mt-1.5 text-text-0">
        {displayValue}
      </div>
      <div
        className={`text-[11px] mt-1.5 flex items-center gap-1 font-mono ${trend === 'up' ? 'text-cds-teal' : 'text-cds-red'}`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          {trend === 'up' ? (
            <path d="M6 15l6-6 6 6" />
          ) : (
            <path d="M6 9l6 6 6-6" />
          )}
        </svg>
        {delta}
      </div>
      {sparkPoints && (
        <svg
          className="absolute right-0 bottom-0 left-0 h-[34px] opacity-55"
          viewBox="0 0 100 34"
          preserveAspectRatio="none"
        >
          <polyline
            points={sparkPoints}
            fill="none"
            stroke={trend === 'up' ? '#33d6a8' : '#ff5c5c'}
            strokeWidth="2"
          />
        </svg>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable & FilterChip                                             */
/* ------------------------------------------------------------------ */

interface Column<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  emptyMessage?: string;
  pageSize?: number;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  searchable,
  searchPlaceholder,
  filters,
  emptyMessage = 'No records found.',
  pageSize = 25,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(data.length / pageSize);
  const paged = useMemo(
    () => data.slice(page * pageSize, (page + 1) * pageSize),
    [data, page, pageSize],
  );

  const handleSort = (colId: string) => {
    if (sortCol === colId)
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(colId);
      setSortDir('asc');
    }
  };

  return (
    <div>
      {(searchable || filters) && (
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          {filters}
          {searchable && (
            <div className="h-[34px] rounded-[9px] bg-ink-2 border border-[rgba(255,255,255,0.07)] flex items-center gap-[7px] px-[11px] text-text-2 text-[12.5px] ml-auto min-w-[220px]">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="bg-transparent border-none outline-none text-text-0 font-sans flex-1"
                placeholder={searchPlaceholder ?? 'Search...'}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="border border-[rgba(255,255,255,0.07)] rounded-[14px] bg-gradient-to-b from-[rgba(255,255,255,0.025)] to-[rgba(255,255,255,0.008)] overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium ${col.sortable ? 'cursor-pointer select-none hover:text-text-1' : ''} ${col.className ?? ''}`}
                  onClick={
                    col.sortable ? () => handleSort(col.id) : undefined
                  }
                >
                  {col.header}
                  {sortCol === col.id && (
                    <span className="ml-1">
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-8 text-center text-text-2"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className={`border-t border-[rgba(255,255,255,0.07)] transition-colors ${onRowClick ? 'cursor-pointer hover:bg-ink-2' : ''}`}
                  onClick={
                    onRowClick ? () => onRowClick(row) : undefined
                  }
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={`px-3.5 py-3 text-text-0 ${col.className ?? ''}`}
                    >
                      {col.accessor(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-[11px] text-text-2 font-mono">
          <span>
            Page {page + 1} of {totalPages} ({data.length} records)
          </span>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 rounded bg-ink-2 border border-[rgba(255,255,255,0.07)] text-text-1 disabled:opacity-30"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <button
              className="px-2 py-1 rounded bg-ink-2 border border-[rgba(255,255,255,0.07)] text-text-1 disabled:opacity-30"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`text-[11.5px] font-mono px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${active ? 'bg-cds-orange/15 text-cds-orange border-cds-orange/20' : 'text-text-2 border-[rgba(255,255,255,0.12)] bg-ink-2 hover:bg-ink-3'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  CDSDrawer & DrawerField                                            */
/* ------------------------------------------------------------------ */

export function CDSDrawer() {
  const { drawerOpen, drawerTitle, drawerContent, closeDrawer } = useCDSStore();

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/65 transition-opacity z-[60] ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={closeDrawer}
      />
      <div
        className={`fixed top-0 right-0 bottom-0 w-[420px] max-w-full bg-ink-1 border-l border-[rgba(255,255,255,0.12)] transition-transform duration-200 z-[61] flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-5 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-start flex-none">
          <div className="font-display font-bold text-base text-text-0">
            {drawerTitle}
          </div>
          <button
            className="w-[30px] h-[30px] rounded-lg bg-ink-2 border-none text-text-1 cursor-pointer flex items-center justify-center hover:bg-ink-3"
            onClick={closeDrawer}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{drawerContent}</div>
      </div>
    </>
  );
}

export function DrawerField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between py-2.5 border-b border-[rgba(255,255,255,0.07)] text-[12.5px]">
      <span className="text-text-2">{label}</span>
      <span className="text-text-0 font-mono font-semibold">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CDSToastContainer                                                  */
/* ------------------------------------------------------------------ */

export function CDSToastContainer() {
  const toasts = useCDSStore((s) => s.toasts);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => {
        const dotColor =
          toast.type === 'error'
            ? 'bg-cds-red shadow-[0_0_8px_rgba(255,92,92,0.6)]'
            : 'bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,0.6)]';
        return (
          <div
            key={toast.id}
            className="bg-ink-3 border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 flex items-center gap-2.5 text-[13px] text-text-0 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.65)] animate-fade-in"
          >
            <span
              className={`w-2 h-2 rounded-full flex-none ${dotColor}`}
            />
            {toast.message}
          </div>
        );
      })}
    </div>
  );
}
