import { useQuery } from '@tanstack/react-query';
import { Shield } from 'lucide-react';
import { api } from '../lib/api.js';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type RiskItem = {
  id: string;
  title: string;
  description: string;
  level: RiskLevel;
  region: string;
  source: string;
  published_at: string;
  expires_at: string | null;
};

const RISK_STYLES: Record<RiskLevel, { badge: string; bar: string }> = {
  low: { badge: 'bg-green-900 text-green-300', bar: 'bg-green-500' },
  medium: { badge: 'bg-yellow-900 text-yellow-300', bar: 'bg-yellow-500' },
  high: { badge: 'bg-orange-900 text-orange-300', bar: 'bg-orange-500' },
  critical: { badge: 'bg-red-900 text-red-300', bar: 'bg-red-500' },
};

const RISK_SCORE: Record<RiskLevel, number> = { low: 25, medium: 50, high: 75, critical: 100 };

export default function RiskIntelPage() {
  const { data, isLoading, isError } = useQuery<RiskItem[]>({
    queryKey: ['risk-intel'],
    queryFn: async () => {
      const { data } = await api.get<RiskItem[]>('/risk-intel');
      return data;
    },
    refetchInterval: 120_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Shield size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Risk Intelligence</h1>
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading risk intelligence…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load risk data.</div>}

      {data && (
        <div className="space-y-3">
          {data.map((item) => {
            const styles = RISK_STYLES[item.level];
            const score = RISK_SCORE[item.level];
            return (
              <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${styles.badge}`}>
                        {item.level}
                      </span>
                      <span className="text-xs text-slate-500">{item.region}</span>
                      <span className="text-xs text-slate-600">via {item.source}</span>
                    </div>
                    <h3 className="font-semibold text-white">{item.title}</h3>
                    <p className="text-sm text-slate-400 mt-1">{item.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold text-white">{score}</p>
                    <p className="text-xs text-slate-500">risk score</p>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${score}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Published: {new Date(item.published_at).toLocaleDateString()}</span>
                  {item.expires_at && (
                    <span>Expires: {new Date(item.expires_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div className="text-slate-400 text-sm py-12 text-center">No risk intelligence items.</div>
          )}
        </div>
      )}
    </div>
  );
}
