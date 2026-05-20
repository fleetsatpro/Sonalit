import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { api } from '../lib/api.js';

type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'overridden';

type AIDecision = {
  id: string;
  title: string;
  description: string;
  confidence: number;
  recommendation: string;
  status: DecisionStatus;
  created_at: string;
  category: string;
};

const STATUS_STYLES: Record<DecisionStatus, string> = {
  pending: 'bg-amber-900 text-amber-300',
  approved: 'bg-green-900 text-green-300',
  rejected: 'bg-red-900 text-red-300',
  overridden: 'bg-slate-700 text-slate-300',
};

function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 0.8 ? 'bg-green-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-10 text-right">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

export default function AIDecisionPage() {
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const { data, isLoading, isError } = useQuery<AIDecision[]>({
    queryKey: ['ai-decisions'],
    queryFn: async () => {
      const { data } = await api.get<AIDecision[]>('/ai/decisions');
      return data;
    },
    refetchInterval: 60_000,
  });

  const categories = ['all', ...Array.from(new Set(data?.map((d) => d.category) ?? []))];

  const filtered = activeCategory === 'all'
    ? (data ?? [])
    : (data ?? []).filter((d) => d.category === activeCategory);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Bot size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">AI Decisions</h1>
        {data && <span className="text-sm text-slate-400">{data.filter((d) => d.status === 'pending').length} pending review</span>}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading AI decisions…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load AI decisions.</div>}

      {data && (
        <>
          <div className="flex gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeCategory === cat ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.map((decision) => (
              <div key={decision.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-slate-500 uppercase">{decision.category}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[decision.status]}`}>
                        {decision.status}
                      </span>
                    </div>
                    <h3 className="font-semibold text-white">{decision.title}</h3>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0 ml-4">
                    {new Date(decision.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-slate-400">{decision.description}</p>
                <div className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300">
                  <span className="text-xs text-slate-500 block mb-1">Recommendation</span>
                  {decision.recommendation}
                </div>
                <div>
                  <span className="text-xs text-slate-500 block mb-1.5">Confidence</span>
                  <ConfidenceMeter value={decision.confidence} />
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-slate-400 text-sm py-12 text-center">No decisions in this category.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
