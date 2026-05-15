import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  FileWarning, MapPin, Clock, Smartphone, Filter, AlertTriangle,
  RefreshCw, ChevronDown
} from 'lucide-react';
import { guardianAPI, incidentAPI } from '../services/api';
import socketService from '../services/socket';

const G = {
  bg: '#080C14', card: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.07)',
  gold: '#F0B429', goldBg: 'rgba(240,180,41,0.08)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.08)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.08)', redBd: 'rgba(239,68,68,0.25)',
  amber: '#f59e0b', amberBg: 'rgba(245,158,11,0.08)', amberBd: 'rgba(245,158,11,0.25)',
  cyan: '#22D3A0', cyanBg: 'rgba(34,211,160,0.08)',
  blue: '#3b82f6', blueBg: 'rgba(59,130,246,0.08)', blueBd: 'rgba(59,130,246,0.25)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.08)', orangeBd: 'rgba(249,115,22,0.25)',
  text: '#e2e8f0', muted: '#94a3b8', low: '#475569',
};

const CATEGORIES = [
  { value: 'all',            label: 'All Categories' },
  { value: 'suspicious',     label: 'Suspicious Activity' },
  { value: 'roadblock',      label: 'Roadblock' },
  { value: 'theft',          label: 'Theft' },
  { value: 'attack',         label: 'Attack' },
  { value: 'accident',       label: 'Accident' },
  { value: 'medical',        label: 'Medical' },
  { value: 'checkpoint',     label: 'Checkpoint' },
  { value: 'delivery_issue', label: 'Delivery Issue' },
  { value: 'vehicle_issue',  label: 'Vehicle Issue' },
  { value: 'hijack',         label: 'Hijack' },
];

const SEVERITIES = [
  { value: 'all',      label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high',     label: 'High' },
  { value: 'medium',   label: 'Medium' },
  { value: 'low',      label: 'Low' },
];

function getCategoryStyle(cat) {
  const c = cat?.toLowerCase();
  if (['attack', 'theft', 'hijack'].includes(c))        return { color: G.red,    bg: G.redBg,    border: G.redBd };
  if (['suspicious', 'roadblock'].includes(c))           return { color: G.amber,  bg: G.amberBg,  border: G.amberBd };
  if (['accident', 'medical'].includes(c))               return { color: G.blue,   bg: G.blueBg,   border: G.blueBd };
  if (['checkpoint', 'delivery_issue'].includes(c))      return { color: G.cyan,   bg: G.cyanBg,   border: `rgba(34,211,160,0.25)` };
  if (['vehicle_issue'].includes(c))                     return { color: G.orange, bg: G.orangeBg, border: G.orangeBd };
  return { color: G.muted, bg: G.card, border: G.border };
}

function getSeverityStyle(sev) {
  const s = sev?.toLowerCase();
  if (s === 'critical') return { color: G.red,    bg: G.redBg    };
  if (s === 'high')     return { color: G.orange, bg: G.orangeBg };
  if (s === 'medium')   return { color: G.amber,  bg: G.amberBg  };
  return                        { color: G.green,  bg: G.greenBg  };
}

function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtCategoryLabel(cat) {
  const found = CATEGORIES.find(c => c.value === cat);
  return found?.label || (cat || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function CategoryBadge({ category }) {
  const s = getCategoryStyle(category);
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 6, padding: '2px 8px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.08em', fontFamily: 'monospace',
    }}>
      {fmtCategoryLabel(category).toUpperCase()}
    </span>
  );
}

function SeverityChip({ severity }) {
  const s = getSeverityStyle(severity);
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 5, padding: '1px 7px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.08em', fontFamily: 'monospace',
    }}>
      {(severity || 'low').toUpperCase()}
    </span>
  );
}

function FieldReportCard({ report }) {
  const s = getCategoryStyle(report.category);
  return (
    <div style={{
      background: G.card, border: `1px solid ${s.border}`,
      borderRadius: 13, padding: '14px 16px',
      borderLeft: `3px solid ${s.color}`,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <CategoryBadge category={report.category} />
          <SeverityChip severity={report.severity} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Clock size={10} style={{ color: G.low }} />
          <span style={{ fontSize: 10, color: G.low, fontFamily: 'monospace' }}>
            {fmtRelative(report.created_at || report.reported_at)}
          </span>
        </div>
      </div>

      {/* Device + description */}
      {report.device_name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <Smartphone size={10} style={{ color: G.muted }} />
          <span style={{ fontSize: 11, color: G.muted }}>{report.device_name}</span>
        </div>
      )}

      {report.description && (
        <p style={{ fontSize: 12, color: G.text, lineHeight: 1.6, marginBottom: 10 }}>
          {report.description}
        </p>
      )}

      {/* GPS coords */}
      {(report.lat || report.latitude) && (report.lng || report.longitude) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
          <MapPin size={11} style={{ color: s.color }} />
          <a
            href={`https://maps.google.com/?q=${report.lat || report.latitude},${report.lng || report.longitude}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: s.color, fontFamily: 'monospace', textDecoration: 'none' }}
          >
            {Number(report.lat || report.latitude).toFixed(5)}, {Number(report.lng || report.longitude).toFixed(5)}
          </a>
        </div>
      )}
    </div>
  );
}

function SelectFilter({ value, onChange, options, icon: Icon }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {Icon && (
        <Icon size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: G.muted, pointerEvents: 'none' }} />
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: G.card, border: `1px solid ${G.border}`, borderRadius: 8,
          padding: `6px ${Icon ? '28px' : '10px'} 6px ${Icon ? '28px' : '10px'}`,
          fontSize: 11, color: G.text, cursor: 'pointer', outline: 'none',
          appearance: 'none', paddingRight: 28,
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={10} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: G.muted, pointerEvents: 'none' }} />
    </div>
  );
}

// ─── Field Reports Tab ──────────────────────────────────────────────────────

function FieldReportsTab({ devices }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('all');
  const [sevFilter, setSevFilter] = useState('all');
  const [devFilter, setDevFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const params = {};
      if (catFilter !== 'all') params.category = catFilter;
      if (sevFilter !== 'all') params.severity = sevFilter;
      if (devFilter !== 'all') params.device_id = devFilter;
      const res = await guardianAPI.reports(params);
      setReports(res.data?.data || res.data?.reports || res.data || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [catFilter, sevFilter, devFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onReport = (data) => {
      const report = {
        _id: data.report_id || `local-${Date.now()}`,
        category: data.category,
        severity: data.severity || 'medium',
        device_name: data.device_name || data.device_id,
        description: data.description,
        lat: data.lat, lng: data.lng,
        created_at: data.timestamp || new Date().toISOString(),
      };
      setReports(prev => [report, ...prev]);
      toast(`Field report: ${fmtCategoryLabel(data.category)}`, {
        icon: '📋',
        style: { borderLeft: `3px solid ${getCategoryStyle(data.category).color}` },
      });
    };
    socketService.on('device:report', onReport);
    return () => socketService.off('device:report', onReport);
  }, []);

  const deviceOptions = [
    { value: 'all', label: 'All Devices' },
    ...devices.map(d => ({ value: d._id || d.id || d.device_id, label: d.name || d.device_id })),
  ];

  const filtered = reports.filter(r => {
    if (catFilter !== 'all' && r.category !== catFilter) return false;
    if (sevFilter !== 'all' && r.severity !== sevFilter) return false;
    if (devFilter !== 'all' && (r.device_id || r._device) !== devFilter) return false;
    return true;
  });

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={13} style={{ color: G.muted }} />
        <SelectFilter value={catFilter} onChange={setCatFilter} options={CATEGORIES} />
        <SelectFilter value={sevFilter} onChange={setSevFilter} options={SEVERITIES} />
        {devices.length > 0 && (
          <SelectFilter value={devFilter} onChange={setDevFilter} options={deviceOptions} icon={Smartphone} />
        )}
        <button
          onClick={load}
          style={{
            background: G.card, border: `1px solid ${G.border}`, borderRadius: 8,
            padding: '6px 10px', cursor: 'pointer', color: G.muted, display: 'flex', alignItems: 'center', gap: 5,
          }}
          title="Refresh"
        >
          <RefreshCw size={11} />
          <span style={{ fontSize: 11 }}>Refresh</span>
        </button>
        <span style={{ fontSize: 11, color: G.low, marginLeft: 4 }}>
          {filtered.length} report{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Report cards */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 160 }}>
          <div style={{ width: 28, height: 28, border: `2px solid ${G.gold}30`, borderTopColor: G.gold, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: G.card, border: `1px solid ${G.border}`, borderRadius: 12,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <FileWarning size={28} style={{ color: G.low, margin: '0 auto 10px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: G.muted, margin: '0 0 4px' }}>No field reports</p>
          <p style={{ fontSize: 12, color: G.low, margin: 0 }}>
            {catFilter !== 'all' || sevFilter !== 'all' || devFilter !== 'all'
              ? 'No reports match the current filters.'
              : 'Field reports from Guardian devices will appear here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {filtered.map((r, i) => (
            <FieldReportCard key={r._id || r.id || i} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── System Incidents Tab ───────────────────────────────────────────────────

function IncidentStatusBadge({ status }) {
  const map = {
    open:        { color: G.red,    bg: G.redBg    },
    investigating:{ color: G.amber, bg: G.amberBg  },
    resolved:    { color: G.green,  bg: G.greenBg  },
    closed:      { color: G.muted,  bg: G.card     },
  };
  const s = map[status?.toLowerCase()] || map.open;
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 5, padding: '1px 7px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.08em', fontFamily: 'monospace',
    }}>
      {(status || 'open').toUpperCase()}
    </span>
  );
}

function SystemIncidentsTab() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState('all');

  useEffect(() => {
    incidentAPI.list().then(res => {
      setIncidents(res.data?.data || res.data?.incidents || res.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = incidents.filter(inc =>
    sevFilter === 'all' || inc.severity === sevFilter
  );

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={13} style={{ color: G.muted }} />
        <SelectFilter value={sevFilter} onChange={setSevFilter} options={SEVERITIES} />
        <span style={{ fontSize: 11, color: G.low, marginLeft: 4 }}>
          {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 160 }}>
          <div style={{ width: 28, height: 28, border: `2px solid ${G.gold}30`, borderTopColor: G.gold, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: G.card, border: `1px solid ${G.border}`, borderRadius: 12,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <AlertTriangle size={28} style={{ color: G.low, margin: '0 auto 10px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: G.muted, margin: '0 0 4px' }}>No incidents</p>
          <p style={{ fontSize: 12, color: G.low, margin: 0 }}>System incidents will appear here.</p>
        </div>
      ) : (
        <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${G.border}` }}>
                  {['TITLE', 'SEVERITY', 'STATUS', 'VEHICLE / CONVOY', 'REPORTED', 'RESOLVED'].map(h => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left', fontSize: 9,
                      fontFamily: 'monospace', color: G.low, letterSpacing: '0.12em', fontWeight: 700,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((inc, i) => {
                  const sevStyle = getSeverityStyle(inc.severity);
                  return (
                    <tr key={inc._id || inc.id || i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: `1px solid ${G.border}` }}>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: G.text, maxWidth: 240 }}>
                        <p style={{ margin: 0, fontWeight: 600, marginBottom: 2 }}>{inc.title || '—'}</p>
                        {inc.description && (
                          <p style={{ margin: 0, fontSize: 10, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                            {inc.description}
                          </p>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          background: sevStyle.bg, color: sevStyle.color,
                          borderRadius: 5, padding: '1px 7px', fontSize: 9, fontWeight: 700,
                          letterSpacing: '0.08em', fontFamily: 'monospace',
                        }}>
                          {(inc.severity || 'low').toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <IncidentStatusBadge status={inc.status} />
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted }}>
                        {inc.convoy_name || inc.vehicle_name || inc.convoy_id || inc.vehicle_id || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {fmtRelative(inc.created_at)}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {inc.resolved_at ? fmtRelative(inc.resolved_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function IncidentCenterPage() {
  const [activeTab, setActiveTab] = useState('field');
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    guardianAPI.devices().then(res => {
      setDevices(res.data?.data || res.data?.devices || res.data || []);
    }).catch(() => {});
  }, []);

  const tabs = [
    { id: 'field',  label: 'FIELD REPORTS',    icon: FileWarning  },
    { id: 'system', label: 'SYSTEM INCIDENTS',  icon: AlertTriangle },
  ];

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FileWarning size={22} style={{ color: G.gold }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: G.text, margin: 0 }}>Incident Center</h1>
          <p style={{ fontSize: 12, color: G.muted, margin: 0 }}>Field reports & system incidents</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: `1px solid ${G.border}`, paddingBottom: 0 }}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'transparent', border: 'none',
                borderBottom: isActive ? `2px solid ${G.gold}` : '2px solid transparent',
                padding: '8px 16px', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                color: isActive ? G.gold : G.muted,
                marginBottom: -1, transition: 'all 0.15s',
              }}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'field'  && <FieldReportsTab devices={devices} />}
      {activeTab === 'system' && <SystemIncidentsTab />}
    </div>
  );
}
