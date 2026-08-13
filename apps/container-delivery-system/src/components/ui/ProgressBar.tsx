import React from 'react';

interface ProgressBarProps {
  value: number;
  color?: string;
  width?: string;
  showLabel?: boolean;
}

export function ProgressBar({ value, color = 'bg-cds-orange', width = 'w-[60px]', showLabel }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2">
      <div className={`${width} h-[5px] rounded-full bg-ink-3 overflow-hidden`}>
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      {showLabel && <span className="font-mono text-[11px] text-text-1 tabular">{clamped}%</span>}
    </div>
  );
}
