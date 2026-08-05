import React, { useEffect, useRef, useState } from 'react';
import { Card } from './Card.js';

interface KPICardProps {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
  sparkline?: number[];
}

export function KPICard({ label, value, delta, trend, sparkline }: KPICardProps) {
  const [displayValue, setDisplayValue] = useState('0');
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) { setDisplayValue(value); return; }
    mounted.current = true;
    const numMatch = value.match(/[\d.]+/);
    if (!numMatch) { setDisplayValue(value); return; }
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

  const sparkPoints = sparkline?.map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * 100;
    const y = 34 - (v / 100) * 32;
    return `${x},${Math.max(2, Math.min(32, y))}`;
  }).join(' ');

  return (
    <Card className="p-4 relative overflow-hidden">
      <div className="font-mono text-[11px] text-text-2 tracking-wide">{label}</div>
      <div className="font-display font-extrabold text-[28px] mt-1.5 text-text-0">{displayValue}</div>
      <div className={`text-[11px] mt-1.5 flex items-center gap-1 font-mono ${trend === 'up' ? 'text-cds-teal' : 'text-cds-red'}`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          {trend === 'up' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
        </svg>
        {delta}
      </div>
      {sparkPoints && (
        <svg className="absolute right-0 bottom-0 left-0 h-[34px] opacity-55" viewBox="0 0 100 34" preserveAspectRatio="none">
          <polyline points={sparkPoints} fill="none" stroke={trend === 'up' ? '#33d6a8' : '#ff5c5c'} strokeWidth="2" />
        </svg>
      )}
    </Card>
  );
}
