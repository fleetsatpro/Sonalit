import { useEffect, useState } from 'react';
import { Bell, CheckCheck, ShieldCheck, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAlertStore } from '../store';
import { Badge, Button, Card, Spinner, EmptyState } from '../components/UI';
import { formatDate, truncate } from '../utils/helpers';

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export default function AlertsPage() {
  const { alerts, total, loading, fetchAlerts, acknowledge, resolve } = useAlertStore();
  const [severity, setSeverity] = useState('');
  const [resolved, setResolved] = useState('false');
  const [actingId, setActingId] = useState(null);

  useEffect(() => {
    fetchAlerts({ severity: severity || undefined, resolved, limit: 50 });
  }, [severity, resolved]);

  const handleAck = async (id) => {
    setActingId(id);
    try { await acknowledge(id); toast.success('Alert acknowledged'); }
    catch (e) { toast.error(e.response?.data?.error || 'Action failed'); }
    finally { setActingId(null); }
  };

  const handleResolve = async (id) => {
    setActingId(id);
    try { await resolve(id); toast.success('Alert resolved'); }
    catch (e) { toast.error(e.response?.data?.error || 'Action failed'); }
    finally { setActingId(null); }
  };

  const severityBorder = { critical: 'border-l-red-500', high: 'border-l-amber-500', medium: 'border-l-blue-500', low: 'border-l-success' };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">ALERTS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{total ?? alerts.length} matching alerts</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
          <Filter size={13} /> Filters:
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}
          className="bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-gold/40 transition-colors">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={resolved} onChange={(e) => setResolved(e.target.value)}
          className="bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-gold/40 transition-colors">
          <option value="false">Open</option>
          <option value="true">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : alerts.length === 0 ? (
        <Card><EmptyState icon={Bell} title="No alerts" subtitle="All clear — nothing matches your filters" /></Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`bg-navy-900 border border-white/5 border-l-2 ${severityBorder[a.severity] || 'border-l-slate-700'} rounded-xl px-5 py-4 flex items-start gap-4 hover:bg-navy-800/50 transition-colors`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2 mb-1">
                  <Badge severity={a.severity}>{a.severity}</Badge>
                  <span className="text-xs font-mono text-slate-500 bg-navy-800 px-2 py-0.5 rounded">{a.type}</span>
                  {a.vehicle_reg && <span className="text-xs font-mono text-gold">{a.vehicle_reg}</span>}
                  {a.region && <span className="text-xs text-slate-600">{a.region}</span>}
                </div>
                <p className="text-sm text-slate-200 leading-snug">{a.message}</p>
                <div className="flex items-center gap-4 mt-2 text-[11px] font-mono text-slate-600">
                  <span>{formatDate(a.created_at)}</span>
                  {a.acknowledged_at && <span className="text-blue-400">Acknowledged {formatDate(a.acknowledged_at)}</span>}
                  {a.resolved_at && <span className="text-success">Resolved {formatDate(a.resolved_at)}</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {!a.acknowledged_at && !a.resolved_at && (
                  <Button variant="secondary" size="sm" loading={actingId === a.id} onClick={() => handleAck(a.id)}>
                    <CheckCheck size={12} /> Acknowledge
                  </Button>
                )}
                {a.acknowledged_at && !a.resolved_at && (
                  <Button variant="success" size="sm" loading={actingId === a.id} onClick={() => handleResolve(a.id)}>
                    <ShieldCheck size={12} /> Resolve
                  </Button>
                )}
                {a.resolved_at && (
                  <span className="text-xs text-success font-mono px-2 py-1 bg-success/10 rounded border border-success/20">Resolved</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
