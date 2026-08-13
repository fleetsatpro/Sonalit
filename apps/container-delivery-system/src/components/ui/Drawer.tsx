import React from 'react';
import { useUIStore } from '@/stores/ui.js';

export function Drawer() {
  const { drawerOpen, drawerTitle, drawerContent, closeDrawer } = useUIStore();

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity z-[60] ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={closeDrawer}
      />
      <div
        className={`fixed top-0 right-0 bottom-0 w-[440px] max-w-full bg-ink-1 border-l border-glass-border-strong shadow-drawer transition-transform duration-200 ease-out z-[61] flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-5 border-b border-hair flex justify-between items-start flex-none">
          <div className="font-display font-bold text-base text-text-0">{drawerTitle}</div>
          <button
            className="w-[30px] h-[30px] rounded-lg bg-ink-2 border border-glass-border text-text-1 cursor-pointer flex items-center justify-center hover:bg-ink-3 hover:text-text-0 transition-colors"
            onClick={closeDrawer}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {drawerContent}
        </div>
      </div>
    </>
  );
}

export function DrawerField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-hair text-xs-tight">
      <span className="text-text-2">{label}</span>
      <span className="text-text-0 font-mono font-semibold">{value}</span>
    </div>
  );
}

export function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-2xs font-mono text-text-2 uppercase tracking-wider mb-2">{title}</div>
      {children}
    </div>
  );
}
