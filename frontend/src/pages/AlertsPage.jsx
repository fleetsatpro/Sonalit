import { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCircle, Filter, AlertTriangle, Zap, TrendingUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { alertsAPI, aiAPI } from '../services/api';
import { useAlertStore } from '../store';
import socketService from '../services/socket';
import { Card, Button, Spinner, EmptyState } from '../components/UI';
import { formatDate } from '../utils/helpers';

const severityConfig = {
  critical: { color: 'text-danger',  bg: 'bg-danger/10',  border: 'border-danger/20',  dot: 'bg-danger'  },
  high:     { color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20', dot: 'bg-orange-400' },
  medium:   { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', dot: 'bg-amber-400' },
  low:      { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', dot: 'bg-slate-500' },
};

function AlertRow({ alert, onAck, onResolve }) {
  const s = severityConfig[alert.severity] || severityConfig.low;
  const isResolved = !!alert.resolved_at;
  const isAcked = !!alert.acknowledged_at;

  return (
    <div className={`px-5 py-4 border-b border-white/[0.04] last:border-0 ${isResolved ? 'opacity-50' : ''} hover:bg-white/[0.01] transition-colors`}>
      <div className="flex items-start gap-3">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${s.dot} ${!isResolved && !isAcked ? 'animate-pulse' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[9px] font-mono font-bold ${s.color}`}>{alert.severity?.toUpperCase()}</span>
            <span className="text-[9px] font-mono text-slate-600">{alert.type?.replace(/_/g, ' ')}</span>
            {alert.auto_generated && (
              <span className="text-[9px] font-mono text-blue-400/70 bg-blue-400/10 px-1.5 py-0.5 rounded">AUTO</span>
            )}
            {isResolved && <span className="text-[9px] font-mono text-success">RESOLVED</span>}
            {isAcked && !isResolved && <span className="text-[9px] font-mono text-amber-400">ACKNOWLEDGED</span>}
          </div>
          <p className="text-sm text-slate-200 leading-snug">{alert.message}</p>
          <div className="flex items-center gap-3 mt-1">
            {alert.vehicle_reg && <span className="text-[10px] font-mono text-slate-500">{alert.vehicle_reg}</span>}
            {alert.convoy_name && <span className="text-[10px] font-mono text-slate-500">{alert.convoy_name}</span>}
            <span className="text-[10px] text-slate-600">{formatDate(alert.created_at)}</span>
          </div>
        </div>
        {!isResolved && (
          <div className="flex gap-1.5 flex-shrink-0">
            {!isAcked && (
              <button onClick={() => onAck(alert.id)}
                className="px-2.5 py-1.5 text-[10px] font-mono border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors">
                ACK
              </button>
            )}
            <button onClick={() => onResolve(alert.id)}
              className="px-2.5 py-1.5 text-[10px] font-mono border border-success/30 text-success hover:bg-success/10 rounded-lg transition-colors">
              RESOLVE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const { fetchUnread } = useAlertStore();

  const load = useCallback(async () => {
    try {
      const params = { limit: 50 };
      if (severityFilter) params.severity = severityFilter;
      if (!showResolved) params.resolved = 'false';
      const [alertRes, anomalyRes] = await Promise.all([
        alertsAPI.list(params),
        tab === 'anomalies' ? aiAPI.anomalies() : Promise.resolve({ data: { data: [] } }),
      ]);
      setAlerts(alertRes.data.data || []);
      if (anomalyRes.data?.data) setAnomalies(anomalyRes.data.data);
    } catch {} finally { setLoading(false); }
  }, [severityFilter, showResolved, tab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = socketService.onAlert(() => { load(); fetchUnread(); });
    return unsub;
  }, [load, fetchUnread]);

  // Load anomalies when tab changes
  useEffect(() => {
    if (tab === 'anomalies') {
      aiAPI.anomalies()
        .then(r => setAnomalies(r.data.data || []))
        .catch(() => {});
    }
  }, [tab]);

  const acknowledge = async (id) => {
    try {
      await alertsAPI.acknowledge(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a));
      toast.success('Alert acknowledged');
      fetchUnread();
    } catch { toast.error('Failed'); }
  };

  const resolve = async (id) => {
    try {
      await alertsAPI.resolve(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved_at: new Date().toISOString() } : a));
      toast.success('Alert resolved');
      fetchUnread();
    } catch { toast.error('Failed'); }
  };

  const stats = {
    critical: alerts.filter(a => a.severity === 'critical' && !a.resolved_at).length,
    high:     alerts.filter(a => a.severity === 'high' && !a.resolved_at).length,
    open:     alerts.filter(a => !a.resolved_at).length,
    auto:     alerts.filter(a => a.auto_generated).length,
  };

  const visibleAlerts = tab === 'anomalies' ? anomalies : alerts;

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div>
        <h1 className="font-display text-lg font-bold text-gold tracking-widest">ALERTS & ANOMALIES</h1>
        <p className="text-slate-500 text-sm font-mono mt-0.5">Security and operational alert management</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['CRITICAL', stats.critical, 'text-danger'],
          ['HIGH',     stats.high,     'text-orange-400'],
          ['OPEN',     stats.open,     'text-amber-400'],
          ['AI-GENERATED', stats.auto, 'text-blue-400'],
        ].map(([label, val, color]) => (
          <div key={label} className="bg-navy-900 border border-white/5 rounded-xl p-4 text-center">
            <p className={`font-display text-2xl font-bold ${color}`}>{val}</p>
            <p className="text-[9px] font-mono text-slate-500 tracking-wider mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-navy-900 border border-white/5 rounded-xl p-1">
          {[['all','All Alerts'],['anomalies','AI Anomalies']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-colors
                ${tab === key ? 'bg-gold/10 text-gold border border-gold/20' : 'text-slate-500 hover:text-slate-300'}`}>
              {label.toUpperCase()}
            </button>
          ))}
        </div>

        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="bg-navy-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All severities</option>
          {['critical','high','medium','low'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}
            className="accent-gold" />
          Show resolved
        </label>
      </div>

      {/* Alert list */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : visibleAlerts.length === 0 ? (
          <EmptyState icon={tab === 'anomalies' ? TrendingUp : Bell}
            title={tab === 'anomalies' ? 'No anomalies detected' : 'No alerts'}
            subtitle={tab === 'anomalies' ? 'AI monitoring is active — anomalies appear here' : 'All clear'} />
        ) : (
          <div>
            {visibleAlerts.map(a => (
              <AlertRow key={a.id} alert={a} onAck={acknowledge} onResolve={resolve} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
