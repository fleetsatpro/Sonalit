import React from 'react';
import { STATUS_BADGE_STYLES, RISK_BADGE_STYLES } from '@/lib/constants.js';

interface BadgeProps {
  variant: 'ok' | 'warn' | 'bad' | 'neutral';
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<string, string> = {
  ok: 'bg-cds-teal/15 text-cds-teal',
  warn: 'bg-cds-amber/15 text-cds-amber',
  bad: 'bg-cds-red/15 text-cds-red',
  neutral: 'bg-ink-3 text-text-1',
};

export function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-mono text-[9.5px] font-semibold px-[7px] py-[3px] rounded-[5px] tracking-wide whitespace-nowrap ${variantStyles[variant]} ${className}`}>
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
  return <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>;
}

export function RiskBadge({ risk }: { risk: string }) {
  const style = RISK_BADGE_STYLES[risk];
  if (!style) return <Badge variant="neutral">{risk.toUpperCase()}</Badge>;
  const variantMap: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
    'text-cds-teal': 'ok',
    'text-cds-amber': 'warn',
    'text-cds-red': 'bad',
  };
  return <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>;
}
