import React from 'react';
import { STATUS_BADGE_STYLES, RISK_BADGE_STYLES } from '@/lib/constants.js';

type BadgeVariant = 'ok' | 'warn' | 'bad' | 'neutral' | 'info' | 'orange';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  ok: 'bg-cds-teal/15 text-cds-teal',
  warn: 'bg-cds-amber/15 text-cds-amber',
  bad: 'bg-cds-red/15 text-cds-red',
  neutral: 'bg-ink-3 text-text-1',
  info: 'bg-cds-blue/15 text-cds-blue',
  orange: 'bg-cds-orange/15 text-cds-orange',
};

export function Badge({ variant, children, className = '', dot }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-mono text-2xs font-semibold px-[7px] py-[3px] rounded-badge tracking-wide whitespace-nowrap gap-1.5 ${variantStyles[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${variant === 'ok' ? 'bg-cds-teal' : variant === 'warn' ? 'bg-cds-amber' : variant === 'bad' ? 'bg-cds-red' : variant === 'orange' ? 'bg-cds-orange' : 'bg-current'}`} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status];
  if (!style) return <Badge variant="neutral">{status.toUpperCase()}</Badge>;
  const variantMap: Record<string, BadgeVariant> = {
    'text-cds-teal': 'ok',
    'text-cds-amber': 'warn',
    'text-cds-red': 'bad',
    'text-text-1': 'neutral',
    'text-cds-orange': 'orange',
  };
  return <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>;
}

export function RiskBadge({ risk }: { risk: string }) {
  const style = RISK_BADGE_STYLES[risk];
  if (!style) return <Badge variant="neutral">{risk.toUpperCase()}</Badge>;
  const variantMap: Record<string, BadgeVariant> = {
    'text-cds-teal': 'ok',
    'text-cds-amber': 'warn',
    'text-cds-red': 'bad',
  };
  return <Badge variant={variantMap[style.color] ?? 'neutral'}>{style.label}</Badge>;
}
