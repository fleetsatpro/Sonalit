import React from 'react';

interface ProgressBarProps {
  value: number;
  color?: string;
  width?: string;
}

export function ProgressBar({ value, color = 'bg-cds-orange', width = 'w-[60px]' }: ProgressBarProps) {
  return (
    <div className={`${width} h-[5px] rounded bg-ink-3 overflow-hidden`}>
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
