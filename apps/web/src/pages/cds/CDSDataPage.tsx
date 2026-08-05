import React, { useState } from 'react';
import { Search } from 'lucide-react';

interface Column { key: string; label: string; mono?: boolean; color?: string }
interface KPI { label: string; value: string; delta?: string; up?: boolean }

interface PageDef {
  title: string;
  subtitle: string;
  kpis?: KPI[];
  columns: Column[];
  rows: Record<string, string | number>[];
  statusKey?: string;
}

const statusColors: Record<string, string> = {
  active: '#22c55e', online: '#22c55e', delivered: '#22c55e', resolved: '#22c55e', completed: '#22c55e', approved: '#22c55e', operational: '#22c55e', verified: '#22c55e',
  transit: '#37e6ff', in_transit: '#37e6ff', processing: '#37e6ff', pending: '#ffb020', review: '#ffb020', draft: '#a78bfa', created: '#a78bfa', scheduled: '#a78bfa',
  delayed: '#ff3b5c', offline: '#ff3b5c', critical: '#ff3b5c', overdue: '#ff3b5c', expired: '#ff3b5c', tamper: '#ff3b5c', high: '#ff3b5c', suspended: '#ff3b5c',
  medium: '#ffb020', low: '#33d6a8', closed: '#64748b', inactive: '#64748b', idle: '#64748b', weak: '#ffb020',
  strong: '#22c55e', normal: '#22c55e', warning: '#ffb020', info: '#37e6ff',
};

const glass: React.CSSProperties = { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 };
const cell: React.CSSProperties = { padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 13, textAlign: 'left' as const };

export function makeCDSPage(def: PageDef) {
  return function CDSPage() {
    const [search, setSearch] = useState('');

    const filtered = def.rows.filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return Object.values(r).some(v => String(v).toLowerCase().includes(q));
    });

    return (
      <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>{def.title}</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 4, fontFamily: 'monospace', letterSpacing: '.08em' }}>{def.subtitle}</p>
        </div>

        {def.kpis && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(def.kpis.length, 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
            {def.kpis.map(k => (
              <div key={k.label} style={{ ...glass, padding: '14px 18px' }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.15em', color: 'rgba(255,255,255,.5)', fontFamily: 'monospace' }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginTop: 5 }}>{k.value}</div>
                {k.delta && <div style={{ fontSize: 11, marginTop: 3, color: k.up ? '#33d6a8' : '#ffb020', fontWeight: 600 }}>{k.up ? '↑' : '↓'} {k.delta}</div>}
              </div>
            ))}
          </div>
        )}

        <div style={{ ...glass, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{filtered.length} records</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.3)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                style={{ padding: '7px 12px 7px 30px', fontSize: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: '#fff', outline: 'none', width: 200 }}
              />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {def.columns.map(col => (
                    <th key={col.key} style={{ ...cell, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', fontFamily: 'monospace' }}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    {def.columns.map(col => {
                      const val = String(row[col.key] ?? '—');
                      const isStatus = col.key === def.statusKey;
                      const sc = isStatus ? (statusColors[val.toLowerCase().replace(/\s/g, '_')] ?? 'rgba(255,255,255,.6)') : undefined;
                      return (
                        <td key={col.key} style={{ ...cell, fontFamily: col.mono ? 'monospace' : undefined, fontSize: col.mono ? 12 : 13, fontWeight: col.key === def.columns[0]?.key ? 600 : 400, color: sc ?? col.color ?? 'rgba(255,255,255,.75)' }}>
                          {isStatus ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                              {val}
                            </span>
                          ) : val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={def.columns.length} style={{ ...cell, textAlign: 'center', color: 'rgba(255,255,255,.3)', padding: 40 }}>No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };
}
