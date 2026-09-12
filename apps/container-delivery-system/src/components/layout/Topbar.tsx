import React, { useState, useEffect } from 'react';
import { IconButton } from '@/components/ui/Button.js';
import { useUIStore } from '@/stores/ui.js';

interface TopbarProps {
  title: string;
  subtitle: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const [time, setTime] = useState('');
  const { addToast } = useUIStore();
  const [notifCount, setNotifCount] = useState(3);

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }) + ' EAT');
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-16 flex-none border-b border-hair flex items-center gap-4 px-6 bg-ink-1/70 backdrop-blur-[14px]">
      <div>
        <div className="font-display font-bold text-sm text-text-0">{title}</div>
        <div className="text-2xs text-text-2 font-mono tracking-wide">{subtitle}</div>
      </div>

      <div className="flex-1 max-w-[420px] h-9 rounded-xl bg-ink-2 border border-glass-border flex items-center gap-2 px-3 text-text-0 text-[13px] ml-4 focus-within:border-glass-border-hover transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          className="bg-transparent border-none outline-none text-text-0 font-sans flex-1 placeholder:text-text-2"
          placeholder='Ask AI — "show delayed containers today"'
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              addToast(`AI: "${e.currentTarget.value.trim()}" — running query…`);
              e.currentTarget.value = '';
            }
          }}
        />
        <kbd className="font-mono text-[10px] text-text-2 border border-glass-border-strong rounded-md px-1.5 py-px">⌘K</kbd>
      </div>

      <div className="ml-auto flex items-center gap-3.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-2xs font-mono font-medium border border-glass-border-strong text-text-1 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-cds-teal shadow-glow-teal animate-pulse-dot" />
          Live · Shift Bravo
        </div>
        <div className="font-mono text-2xs text-text-1 border border-glass-border-strong rounded-full px-2.5 py-1.5 whitespace-nowrap">
          {time}
        </div>
        <IconButton
          onClick={() => {
            setNotifCount(0);
            addToast(`${notifCount} new field-review alerts`);
          }}
          title="Notifications"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          {notifCount > 0 && <span className="absolute top-[5px] right-[6px] w-[7px] h-[7px] rounded-full bg-cds-orange shadow-glow" />}
        </IconButton>
        <div className="w-8 h-8 rounded-xl bg-ink-3 border border-glass-border-strong flex items-center justify-center font-display text-xs font-bold text-text-0">
          RK
        </div>
      </div>
    </div>
  );
}
