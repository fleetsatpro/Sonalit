import React from 'react';
import { Link } from '@tanstack/react-router';
import { Container, Lock, Truck, AlertTriangle, Clock, CheckCircle, TrendingUp } from 'lucide-react';

const kpis = [
  { label: 'ACTIVE CONTAINERS', value: '128', delta: '+6 today', up: true, icon: Container, color: '#33d6a8' },
  { label: 'IN TRANSIT', value: '54', delta: '+3 vs yesterday', up: true, icon: Truck, color: '#37e6ff' },
  { label: 'DELIVERED TODAY', value: '41', delta: '+12%', up: true, icon: CheckCircle, color: '#22c55e' },
  { label: 'ACTIVE LOCKS', value: '112', delta: '8 offline', up: false, icon: Lock, color: '#ff7a00' },
  { label: 'LOCKS REMOVED', value: '38', delta: '+9 today', up: true, icon: Lock, color: '#a78bfa' },
  { label: 'PENDING UNCLAMP', value: '6', delta: '2 delayed', up: false, icon: Clock, color: '#ffb020' },
  { label: 'DELAYED TRIPS', value: '2', delta: '-1 vs yesterday', up: true, icon: AlertTriangle, color: '#ff3b5c' },
  { label: 'AVG TRANSIT', value: '6h 12m', delta: '-18m', up: true, icon: TrendingUp, color: '#37e6ff' },
];

const activities = [
  { icon: '🔒', text: 'Clamp completed — TGHU3456789 (SL23891)', meta: '09:17 · John Kamau · 99% confidence' },
  { icon: '🚛', text: 'Truck departed — KDK 456P to Mombasa Port', meta: '09:18 · System · Auto-logged' },
  { icon: '📍', text: 'Checkpoint reached — A8, Mariakani', meta: '11:42 · GPS Beacon · 100%' },
  { icon: '🔄', text: 'Excel synchronized — 14 records', meta: '12:00 · System · Scheduled sync' },
  { icon: '🏗️', text: 'Port arrival — MSCU7712340', meta: '13:20 · Port Team A · Gate 4' },
  { icon: '🔓', text: 'Lock removed — SL23881', meta: '13:54 · Port Team A · 99% confidence' },
  { icon: '🤖', text: 'AI extracted data — Supervisor message flagged', meta: '13:40 · AI Extract v4 · 64%' },
];

const containers = [
  { id: 'TGHU3456789', status: 'transit', truck: 'KDK 456P', driver: 'John Kamau', dest: 'Mombasa Port', eta: '18:40', progress: 64 },
  { id: 'MSCU7712340', status: 'delivered', truck: 'KBZ 902L', driver: 'Peter Otieno', dest: 'Mombasa Port', eta: 'Arrived', progress: 100 },
  { id: 'CMAU5581223', status: 'delayed', truck: 'KDA 112B', driver: 'Grace Wanjiru', dest: 'JKIA Cargo', eta: '21:10 (+2h)', progress: 41 },
  { id: 'HLXU9903312', status: 'transit', truck: 'KCE 771D', driver: 'Samuel Kiptoo', dest: 'Mombasa Port', eta: '23:05', progress: 28 },
  { id: 'OOCL2261890', status: 'transit', truck: 'KDG 330F', driver: 'Alice Njeri', dest: 'Mombasa Port', eta: '19:50', progress: 77 },
];

const statusColor: Record<string, string> = {
  transit: '#37e6ff', delivered: '#22c55e', delayed: '#ff3b5c', created: '#a78bfa', closed: '#64748b',
};

const cell: React.CSSProperties = { padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 13 };
const glass: React.CSSProperties = { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 };

export default function CDSDashboard() {
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Container Delivery System</h1>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 4, fontFamily: 'monospace', letterSpacing: '.08em' }}>TODAY'S OPERATIONS OVERVIEW</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} style={{ ...glass, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 14, right: 14, opacity: 0.15 }}><Icon size={28} color={k.color} /></div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.15em', color: 'rgba(255,255,255,.5)', fontFamily: 'monospace' }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
              <div style={{ fontSize: 11, marginTop: 4, color: k.up ? '#33d6a8' : '#ffb020', fontWeight: 600 }}>
                {k.up ? '↑' : '↓'} {k.delta}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16 }}>
        <div style={{ ...glass, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Active Containers</span>
            <Link to="/cds/containers" style={{ fontSize: 11, color: '#ff7a00', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', fontFamily: 'monospace' }}>
                <th style={{ ...cell, textAlign: 'left' }}>CONTAINER</th>
                <th style={{ ...cell, textAlign: 'left' }}>STATUS</th>
                <th style={{ ...cell, textAlign: 'left' }}>TRUCK</th>
                <th style={{ ...cell, textAlign: 'left' }}>DRIVER</th>
                <th style={{ ...cell, textAlign: 'left' }}>ETA</th>
                <th style={{ ...cell, textAlign: 'left' }}>PROGRESS</th>
              </tr>
            </thead>
            <tbody>
              {containers.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <td style={{ ...cell, fontWeight: 600, color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>{c.id}</td>
                  <td style={cell}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: statusColor[c.status] }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor[c.status] }} />
                      {c.status}
                    </span>
                  </td>
                  <td style={{ ...cell, color: 'rgba(255,255,255,.7)', fontSize: 12 }}>{c.truck}</td>
                  <td style={{ ...cell, color: 'rgba(255,255,255,.7)' }}>{c.driver}</td>
                  <td style={{ ...cell, color: 'rgba(255,255,255,.7)', fontFamily: 'monospace', fontSize: 12 }}>{c.eta}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)' }}>
                        <div style={{ width: `${c.progress}%`, height: '100%', borderRadius: 2, background: statusColor[c.status] }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', fontFamily: 'monospace', minWidth: 30 }}>{c.progress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...glass, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Activity Feed</span>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {activities.map((a, i) => (
              <div key={i} style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.04)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{a.text}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.4)', marginTop: 3, fontFamily: 'monospace' }}>{a.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
