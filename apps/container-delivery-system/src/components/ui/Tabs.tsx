import React from 'react';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'underline' | 'pills';
}

export function Tabs({ tabs, activeId, onChange, variant = 'underline' }: TabsProps) {
  if (variant === 'pills') {
    return (
      <div className="flex gap-2" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeId === tab.id}
            onClick={() => onChange(tab.id)}
            className={`text-[12px] font-medium px-3.5 py-1.5 rounded-full transition-colors ${
              activeId === tab.id
                ? 'bg-cds-orange text-white'
                : 'bg-ink-3 text-text-1 hover:text-text-0 hover:bg-ink-4'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 font-mono tabular">{tab.count}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex border-b border-hair" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeId === tab.id}
          onClick={() => onChange(tab.id)}
          className={`text-[12.5px] font-medium px-4 py-2.5 -mb-px transition-colors border-b-2 ${
            activeId === tab.id
              ? 'border-cds-orange text-cds-orange'
              : 'border-transparent text-text-2 hover:text-text-0'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 font-mono text-[11px] tabular">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
