import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
// ─── Helpers ──────────────────────────────────────────────────────────────────
const MN = 'IBM Plex Mono, monospace';
const SANS = 'Archivo, system-ui, sans-serif';
const LIME = '#C8FF00', CYAN = '#00D4FF', RED = '#FF3B6B', AMBER = '#FFAA00';
const AV_PALETTE = [
    { bg: 'rgba(200,255,0,.1)', col: LIME, ring: 'rgba(200,255,0,.28)' },
    { bg: 'rgba(0,212,255,.1)', col: CYAN, ring: 'rgba(0,212,255,.28)' },
    { bg: 'rgba(255,170,0,.1)', col: AMBER, ring: 'rgba(255,170,0,.28)' },
    { bg: 'rgba(155,140,255,.1)', col: '#9B8CFF', ring: 'rgba(155,140,255,.28)' },
    { bg: 'rgba(255,59,107,.1)', col: RED, ring: 'rgba(255,59,107,.28)' },
    { bg: 'rgba(52,211,153,.1)', col: '#34D399', ring: 'rgba(52,211,153,.28)' },
];
const avColor = (id) => AV_PALETTE[id.charCodeAt(0) % AV_PALETTE.length];
const initials = (name) => {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '');
};
function licStatus(expiry) {
    if (!expiry)
        return 'unknown';
    const exp = new Date(expiry).getTime();
    const now = Date.now();
    if (exp < now)
        return 'expired';
    if (exp < now + 60 * 86400_000)
        return 'expiring';
    return 'valid';
}
const LIC_CFG = {
    expired: { col: RED, label: 'Expired', icon: '⚠' },
    expiring: { col: AMBER, label: 'Expiring', icon: '⏱' },
    valid: { col: LIME, label: 'Valid', icon: '✓' },
    unknown: { col: '#55556A', label: '—', icon: '' },
};
function scoreColor(s) {
    if (s == null)
        return { col: '#55556A', bg: 'rgba(255,255,255,.04)' };
    if (s >= 85)
        return { col: LIME, bg: 'rgba(200,255,0,.12)' };
    if (s >= 70)
        return { col: CYAN, bg: 'rgba(0,212,255,.12)' };
    if (s >= 55)
        return { col: AMBER, bg: 'rgba(255,170,0,.12)' };
    return { col: RED, bg: 'rgba(255,59,107,.12)' };
}
const STATUS_CFG = {
    active: { bg: 'rgba(200,255,0,.08)', col: LIME, border: 'rgba(200,255,0,.2)', dot: true },
    inactive: { bg: 'rgba(155,140,255,.09)', col: '#A89EFF', border: 'rgba(155,140,255,.2)' },
    suspended: { bg: 'rgba(255,59,107,.1)', col: '#FF6B8A', border: 'rgba(255,59,107,.22)', dot: true },
    'on trip': { bg: 'rgba(0,212,255,.08)', col: CYAN, border: 'rgba(0,212,255,.18)', dot: true },
};
// ─── Sub-components ───────────────────────────────────────────────────────────
function ScoreRing({ score }) {
    const { col } = scoreColor(score);
    if (score == null)
        return <span style={{ fontFamily: MN, fontSize: 11, color: '#55556A' }}>—</span>;
    const R = 15, C = 2 * Math.PI * R, fill = (score / 100) * C;
    return (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
        <svg width="36" height="36" viewBox="0 0 36 36" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="18" cy="18" r={R} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="2.5"/>
          <circle cx="18" cy="18" r={R} fill="none" stroke={col} strokeWidth="2.5" strokeDasharray={`${fill.toFixed(1)} ${C.toFixed(1)}`} strokeLinecap="round"/>
        </svg>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontFamily: MN, fontSize: 9, fontWeight: 500, color: col }}>{score}</div>
      </div>
      <div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18, lineHeight: 1, color: col }}>{score}</div>
        <div style={{ height: 2, width: 40, background: 'rgba(255,255,255,.08)', borderRadius: 1, marginTop: 4 }}>
          <div style={{ height: '100%', width: `${score}%`, background: col, borderRadius: 1 }}/>
        </div>
      </div>
    </div>);
}
function SBadge({ status }) {
    const c = STATUS_CFG[status] ?? STATUS_CFG['inactive'];
    return (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 100, fontSize: 11, fontWeight: 500, fontFamily: SANS, whiteSpace: 'nowrap', background: c.bg, color: c.col, border: `1px solid ${c.border}` }}>
      {c.dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.col, animation: status === 'on trip' ? 'drv-blink 1.4s ease-in-out infinite' : undefined }}/>}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>);
}
// ─── Add Driver Form ───────────────────────────────────────────────────────────
const addSchema = z.object({
    name: z.string().min(1, 'Required'),
    license_number: z.string().min(1, 'Required'),
    license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    email: z.string().email().nullable().optional(),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 e.g. +2541234567').nullable().optional(),
});
function AddModal({ onClose }) {
    const qc = useQueryClient();
    const user = useAuthStore(s => s.user);
    const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(addSchema) });
    const mut = useMutation({
        mutationFn: (d) => api.post('/drivers', { ...d, org_id: user?.org_id }),
        onSuccess: () => { void qc.invalidateQueries({ queryKey: ['drivers'] }); onClose(); },
    });
    const inp = (lbl, key, extra) => (<div>
      <label style={{ display: 'block', fontFamily: MN, fontSize: 9, color: '#55556A', letterSpacing: '.1em', marginBottom: 5 }}>{lbl.toUpperCase()}</label>
      <input {...register(key)} {...extra} style={{ width: '100%', background: '#1A1A20', border: '1px solid rgba(255,255,255,.11)', borderRadius: 7, padding: '9px 11px', fontFamily: SANS, fontSize: 13, color: '#EEEEF5', outline: 'none' }} onFocus={e => (e.target.style.borderColor = LIME)} onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,.11)')}/>
      {errors[key] && <p style={{ fontFamily: MN, fontSize: 9, color: RED, marginTop: 3 }}>{String(errors[key]?.message ?? '')}</p>}
    </div>);
    return (<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0C0C0E', border: '1px solid rgba(255,255,255,.11)', borderRadius: 12, padding: 28, width: 480, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18, color: '#EEEEF5' }}>Add Driver</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#55556A', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <form onSubmit={handleSubmit(d => mut.mutate(d))} noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {inp('Full Name', 'name')}
            {inp('License Number', 'license_number')}
            {inp('License Expiry', 'license_expiry', { placeholder: '2027-12-31' })}
            {inp('Email', 'email', { type: 'email' })}
            {inp('Phone (E.164)', 'phone', { placeholder: '+2541234567' })}
          </div>
          {mut.isError && <p style={{ fontFamily: MN, fontSize: 10, color: RED, marginBottom: 12 }}>Failed to add driver.</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={mut.isPending} style={{ flex: 1, background: LIME, border: 'none', borderRadius: 6, padding: '10px 0', fontFamily: SANS, fontWeight: 600, fontSize: 13, color: '#0C0C0E', cursor: 'pointer', opacity: mut.isPending ? .6 : 1 }}>
              {mut.isPending ? 'Adding…' : 'Add Driver'}
            </button>
            <button type="button" onClick={onClose} style={{ padding: '10px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,.11)', borderRadius: 6, fontFamily: SANS, fontSize: 13, color: '#9898B0', cursor: 'pointer' }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>);
}
// ─── Expanded Row Panel ────────────────────────────────────────────────────────
function ExpandedPanel({ d, onStatusChange }) {
    const lic = licStatus(d.license_expiry);
    const licCfg = LIC_CFG[lic];
    return (<tr>
      <td colSpan={8} style={{ padding: 0 }}>
        <div style={{ background: '#1A1A20', borderTop: '1px solid rgba(255,255,255,.06)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div style={{ padding: '18px 20px', borderRight: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.12em', color: '#55556A', marginBottom: 10 }}>DRIVER PROFILE</div>
            {[['Full name', d.name], ['Employee ID', d.employee_id ?? '—'], ['Joined', d.created_at ? new Date(d.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'], ['License class', d.license_class ?? '—'], ['Phone', d.phone ?? '—']].map(([k, v]) => (<div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                <span style={{ color: '#55556A' }}>{k}</span>
                <span style={{ color: '#9898B0', fontFamily: MN, fontSize: 11 }}>{v}</span>
              </div>))}
          </div>
          <div style={{ padding: '18px 20px', borderRight: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.12em', color: '#55556A', marginBottom: 10 }}>COMPLIANCE</div>
            {[['License #', d.license_number ?? '—'], ['Expiry', d.license_expiry ?? '—'], ['Status', <span key="s" style={{ color: licCfg.col, fontFamily: MN, fontSize: 11 }}>{licCfg.icon} {licCfg.label}</span>], ['Vehicle', d.vehicle_registration ?? 'Unassigned'], ['Driver status', <SBadge key="sb" status={d.status}/>]].map(([k, v]) => (<div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                <span style={{ color: '#55556A' }}>{k}</span>
                <span style={{ color: '#9898B0', fontFamily: MN, fontSize: 11 }}>{v}</span>
              </div>))}
          </div>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.12em', color: '#55556A', marginBottom: 10 }}>QUICK ACTIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => window.open(`mailto:${d.email ?? ''}`, '_blank')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#242430', border: '1px solid rgba(255,255,255,.11)', borderRadius: 6, padding: '9px 16px', fontFamily: SANS, fontSize: 12, fontWeight: 500, color: '#9898B0', cursor: 'pointer' }}>
                ✉ Send Notice
              </button>
              {d.status !== 'suspended' ? (<button onClick={() => onStatusChange(d.id, 'suspended')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 6, padding: '9px 16px', fontFamily: SANS, fontSize: 12, fontWeight: 500, color: RED, cursor: 'pointer' }}>
                  🚫 Suspend Driver
                </button>) : (<button onClick={() => onStatusChange(d.id, 'active')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(200,255,0,.08)', border: `1px solid rgba(200,255,0,.2)`, borderRadius: 6, padding: '9px 16px', fontFamily: SANS, fontSize: 12, fontWeight: 500, color: LIME, cursor: 'pointer' }}>
                  ✓ Reactivate Driver
                </button>)}
              <button onClick={() => onStatusChange(d.id, d.status === 'inactive' ? 'active' : 'inactive')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#242430', border: '1px solid rgba(255,255,255,.11)', borderRadius: 6, padding: '9px 16px', fontFamily: SANS, fontSize: 12, fontWeight: 500, color: '#9898B0', cursor: 'pointer' }}>
                {d.status === 'inactive' ? '▶ Mark Active' : '⏸ Mark Inactive'}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>);
}
export default function Drivers() {
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [sort, setSort] = useState('score-d');
    const [expanded, setExpanded] = useState(new Set());
    const [showAdd, setShowAdd] = useState(false);
    const [alertDismissed, setAlertDismissed] = useState(false);
    const { data, isLoading } = useQuery({
        queryKey: ['drivers'],
        queryFn: async () => { const r = await api.get('/drivers?limit=200'); return r.data; },
        staleTime: 30_000, refetchInterval: 60_000,
    });
    const statusMut = useMutation({
        mutationFn: ({ id, status }) => api.put(`/drivers/${id}`, { status }),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['drivers'] }),
    });
    const all = data?.data ?? [];
    const kpi = useMemo(() => {
        const active = all.filter(d => d.status === 'active').length;
        const onTrip = all.filter(d => d.status === 'active' && d.vehicle_registration).length;
        const suspended = all.filter(d => d.status === 'suspended').length;
        const inactive = all.filter(d => d.status === 'inactive').length;
        const validLic = all.filter(d => licStatus(d.license_expiry) === 'valid').length;
        const scores = all.map(d => d.driver_score).filter((s) => s != null);
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        const compliance = all.length ? Math.round((validLic / all.length) * 100) : 0;
        return { total: all.length, active, onTrip, suspended, inactive, compliance, avgScore, validLic };
    }, [all]);
    const issueDrivers = useMemo(() => all.filter(d => {
        const s = licStatus(d.license_expiry);
        return s === 'expired' || s === 'expiring';
    }), [all]);
    const rows = useMemo(() => {
        let list = all.filter(d => {
            if (filter === 'on trip')
                return d.status === 'active' && !!d.vehicle_registration;
            if (filter !== 'all')
                return d.status === filter;
            return true;
        }).filter(d => {
            if (!search)
                return true;
            const q = search.toLowerCase();
            return (d.name + (d.email ?? '') + (d.license_number ?? '') + (d.phone ?? '')).toLowerCase().includes(q);
        });
        list = [...list].sort((a, b) => {
            if (sort === 'name')
                return a.name.localeCompare(b.name);
            if (sort === 'score-d')
                return (b.driver_score ?? -1) - (a.driver_score ?? -1);
            return (a.driver_score ?? 101) - (b.driver_score ?? 101);
        });
        return list;
    }, [all, filter, search, sort]);
    const toggle = (id) => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    return (<div style={{ background: '#0C0C0E', minHeight: '100%', color: '#EEEEF5', fontFamily: SANS }}>
      <style>{`
        @keyframes drv-blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes drv-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .drv-row{animation:drv-in .22s ease both;cursor:pointer}
        .drv-row:hover{background:rgba(255,255,255,.025)!important}
      `}</style>

      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', padding: '28px 28px 0', gap: 16 }}>
        <div>
          <div style={{ fontFamily: MN, fontSize: 10, color: '#55556A', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 20, height: 1, background: LIME, display: 'inline-block' }}/>
            Sonalit Fleet OS
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 52, letterSpacing: '.02em', lineHeight: .9, color: '#EEEEF5', textTransform: 'uppercase' }}>
            DRIVERS<span style={{ color: LIME }}>.</span>
          </div>
          <div style={{ fontFamily: MN, fontSize: 11, color: '#55556A', marginTop: 8, letterSpacing: '.04em' }}>roster · compliance · performance · live status</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: 4 }}>
          {[{ label: 'Reports', icon: '📊' }, { label: 'Import CSV', icon: '⬆' }].map(b => (<button key={b.label} style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, padding: '9px 16px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,.11)', background: '#242430', color: '#9898B0', display: 'flex', alignItems: 'center', gap: 6 }}>{b.icon} {b.label}</button>))}
          <button onClick={() => setShowAdd(true)} style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '9px 16px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LIME}`, background: LIME, color: '#0C0C0E', display: 'flex', alignItems: 'center', gap: 6 }}>+ Add Driver</button>
        </div>
      </div>

      {/* Alert strip */}
      {!alertDismissed && issueDrivers.length > 0 && (<div style={{ margin: '20px 28px 0', borderRadius: 8, border: '1px solid rgba(255,59,107,.25)', background: 'rgba(255,59,107,.07)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,59,107,.15)', border: '1px solid rgba(255,59,107,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: RED }}>⚠</div>
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'rgba(255,180,190,.9)' }}>
            <strong style={{ color: '#FF8099', fontWeight: 600 }}>{issueDrivers.length} compliance issue{issueDrivers.length > 1 ? 's' : ''} detected</strong>
            {' — '}{issueDrivers.slice(0, 2).map(d => `${d.name}'s license ${licStatus(d.license_expiry) === 'expired' ? 'has expired' : 'expires soon'}`).join(' · ')}. Action required.
          </div>
          <button onClick={() => setAlertDismissed(true)} style={{ fontFamily: MN, fontSize: 10, color: '#55556A', cursor: 'pointer', padding: '5px 10px', border: '1px solid rgba(255,255,255,.06)', borderRadius: 5, background: 'transparent' }}>Dismiss</button>
        </div>)}

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr) 1.4fr 1.4fr', gap: 1, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, overflow: 'hidden', margin: '24px 28px 0' }}>
        {[
            { label: 'Total Drivers', val: kpi.total, col: '#9898B0', foot: 'across all fleets' },
            { label: 'Active', val: kpi.active, col: LIME, foot: 'available now' },
            { label: 'On Trip', val: kpi.onTrip, col: CYAN, foot: 'currently driving' },
            { label: 'Suspended', val: kpi.suspended, col: RED, foot: 'needs review' },
        ].map(k => (<div key={k.label} style={{ background: '#1A1A20', padding: '20px 20px 18px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: k.col, borderRadius: 0 }}/>
            <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.15em', textTransform: 'uppercase', color: '#55556A', marginBottom: 10 }}>{k.label}</div>
            <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 40, lineHeight: 1, color: k.col }}>{k.val}</div>
            <div style={{ fontFamily: MN, fontSize: 11, color: '#55556A', marginTop: 6 }}>{k.foot}</div>
            <div style={{ height: 2, borderRadius: 1, marginTop: 12, background: k.col, width: `${kpi.total ? Math.round((k.val / kpi.total) * 100) : 0}%` }}/>
          </div>))}
        <div style={{ background: '#1A1A20', padding: '20px 22px 18px', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: AMBER }}/>
          <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.15em', color: '#55556A', marginBottom: 10, textTransform: 'uppercase' }}>Compliance</div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 36, lineHeight: 1, color: AMBER }}>{kpi.compliance}<span style={{ fontSize: 20, fontWeight: 300 }}>%</span></div>
          <div style={{ fontFamily: MN, fontSize: 10, color: '#55556A', marginTop: 2 }}>{kpi.validLic} of {kpi.total} licenses valid</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 3 }}>
            {Array.from({ length: kpi.total }, (_, i) => (<div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < kpi.validLic ? LIME : RED }}/>))}
          </div>
        </div>
        <div style={{ background: '#1A1A20', padding: '20px 22px 18px', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: CYAN }}/>
          <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.15em', color: '#55556A', marginBottom: 10, textTransform: 'uppercase' }}>Avg Score</div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 36, lineHeight: 1, color: CYAN }}>{kpi.avgScore ?? '—'}<span style={{ fontSize: 20, fontWeight: 300 }}>/100</span></div>
          <div style={{ fontFamily: MN, fontSize: 10, color: '#55556A', marginTop: 2 }}>fleet performance index</div>
          {kpi.avgScore != null && (<div style={{ marginTop: 10, display: 'flex', gap: 3 }}>
              <div style={{ height: 4, borderRadius: 2, background: CYAN, width: `${kpi.avgScore}%`, flex: 'none' }}/>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2E2E3C' }}/>
            </div>)}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 28px 0', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#55556A', pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, license…" style={{ width: '100%', background: '#1A1A20', border: '1px solid rgba(255,255,255,.11)', borderRadius: 7, padding: '9px 11px 9px 34px', fontFamily: SANS, fontSize: 13, color: '#EEEEF5', outline: 'none' }} onFocus={e => (e.target.style.borderColor = LIME)} onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,.11)')}/>
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {['all', 'active', 'on trip', 'inactive', 'suspended'].map(f => (<button key={f} onClick={() => setFilter(f)} style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, padding: '7px 13px', borderRadius: 100, cursor: 'pointer', border: `1px solid ${filter === f ? LIME : 'rgba(255,255,255,.11)'}`, background: filter === f ? LIME : 'transparent', color: filter === f ? '#0C0C0E' : '#55556A', whiteSpace: 'nowrap' }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ marginLeft: 'auto', background: '#1A1A20', border: '1px solid rgba(255,255,255,.11)', borderRadius: 7, padding: '8px 12px', fontFamily: MN, fontSize: 11, color: '#9898B0', outline: 'none', cursor: 'pointer' }}>
          <option value="score-d">Score ↓</option>
          <option value="score-a">Score ↑</option>
          <option value="name">Name A→Z</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ padding: '16px 28px 0', overflowX: 'auto' }}>
        {isLoading && <div style={{ textAlign: 'center', padding: 60, fontFamily: MN, fontSize: 10, color: '#55556A', letterSpacing: '.1em' }}>LOADING DRIVERS…</div>}
        {!isLoading && (<table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: 40 }}/><col style={{ width: 200 }}/><col style={{ width: 175 }}/><col style={{ width: 110 }}/><col style={{ width: 90 }}/><col style={{ width: 115 }}/><col style={{ width: 120 }}/><col style={{ width: 90 }}/></colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.11)' }}>
                {['', 'DRIVER', 'CONTACT', 'VEHICLE', 'LICENSE', 'STATUS', 'SCORE', 'ACTIONS'].map(h => (<th key={h} style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#55556A', padding: '10px 12px', textAlign: 'left', fontWeight: 400 }}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (<tr><td colSpan={8} style={{ padding: '60px 12px', textAlign: 'center', fontFamily: MN, fontSize: 10, color: '#55556A', letterSpacing: '.1em' }}>NO DRIVERS MATCH YOUR SEARCH</td></tr>)}
              {rows.map((d, idx) => {
                const av = avColor(d.id);
                const lic = licStatus(d.license_expiry);
                const lcfg = LIC_CFG[lic];
                const isExp = expanded.has(d.id);
                return [
                    <tr key={d.id} onClick={() => toggle(d.id)} className="drv-row" style={{ borderBottom: '1px solid rgba(255,255,255,.06)', animationDelay: `${idx * 18}ms` }}>
                    <td style={{ padding: '16px 12px' }}><input type="checkbox" onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, borderRadius: 4, accentColor: LIME, cursor: 'pointer' }}/></td>
                    <td style={{ padding: '16px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: av.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MN, fontSize: 12, fontWeight: 700, color: av.col, flexShrink: 0, position: 'relative', border: `1.5px solid ${av.ring}` }}>
                          {initials(d.name).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#EEEEF5', lineHeight: 1.2 }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: '#55556A', fontFamily: MN, marginTop: 1 }}>{d.employee_id ?? 'driver'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      <div style={{ fontSize: 11, color: '#9898B0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.email ?? '—'}</div>
                      <div style={{ fontSize: 10, color: '#55556A', fontFamily: MN, marginTop: 2 }}>{d.phone ?? '—'}</div>
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      {d.vehicle_registration
                            ? <span style={{ fontFamily: MN, fontSize: 11, fontWeight: 500, background: '#242430', border: '1px solid rgba(255,255,255,.11)', padding: '4px 9px', borderRadius: 5, letterSpacing: '.05em', color: '#9898B0', display: 'inline-block' }}>{d.vehicle_registration}</span>
                            : <span style={{ color: '#55556A', fontFamily: MN, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      <div style={{ fontFamily: MN, fontSize: 10, fontWeight: 500, color: lcfg.col, display: 'flex', alignItems: 'center', gap: 4 }}>{lcfg.icon} {lcfg.label}</div>
                      <div style={{ fontSize: 10, color: '#55556A', fontFamily: MN, marginTop: 2 }}>{d.license_number ?? '—'}</div>
                    </td>
                    <td style={{ padding: '16px 12px' }}><SBadge status={d.status}/></td>
                    <td style={{ padding: '16px 12px' }}><ScoreRing score={d.driver_score}/></td>
                    <td style={{ padding: '16px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {['✏', '👁', '🗑'].map((ic, i) => (<button key={i} style={{ width: 28, height: 28, borderRadius: 6, background: '#242430', border: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12 }}>{ic}</button>))}
                      </div>
                    </td>
                  </tr>,
                    isExp ? <ExpandedPanel key={`exp-${d.id}`} d={d} onStatusChange={(id, status) => statusMut.mutate({ id, status })}/> : null
                ];
            })}
            </tbody>
          </table>)}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px 28px', fontFamily: MN, fontSize: 11, color: '#55556A' }}>
        <span>Showing <strong style={{ color: '#9898B0' }}>{rows.length}</strong> of {kpi.total} drivers</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, background: '#1A1A20', border: '1px solid rgba(255,255,255,.06)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: LIME, animation: 'drv-blink 1.4s infinite' }}/>Live
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, background: '#1A1A20', border: '1px solid rgba(255,255,255,.06)' }}>Updated just now</span>
        </div>
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)}/>}
    </div>);
}
