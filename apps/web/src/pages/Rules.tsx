import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ToggleLeft, ToggleRight } from 'lucide-react';
import { api } from '../lib/api.js';

type RuleTrigger = 'speed_exceeded' | 'geofence_exit' | 'idle_timeout' | 'harsh_braking' | 'after_hours';
type RuleAction = 'alert' | 'notify_driver' | 'notify_manager' | 'create_incident';

type Rule = {
  id: string;
  name: string;
  trigger: RuleTrigger;
  action: RuleAction;
  enabled: boolean;
  threshold: number | null;
  description: string;
};

const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  speed_exceeded: 'Speed Exceeded',
  geofence_exit: 'Geofence Exit',
  idle_timeout: 'Idle Timeout',
  harsh_braking: 'Harsh Braking',
  after_hours: 'After Hours',
};

const ACTION_STYLES: Record<RuleAction, string> = {
  alert: 'bg-amber-900 text-amber-300',
  notify_driver: 'bg-blue-900 text-blue-300',
  notify_manager: 'bg-purple-900 text-purple-300',
  create_incident: 'bg-red-900 text-red-300',
};

export default function RulesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: async () => {
      const { data } = await api.get<Rule[]>('/rules');
      return data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/rules/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Rules</h1>
        {data && <span className="text-sm text-slate-400">{data.filter((r) => r.enabled).length} active rules</span>}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading rules…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load rules.</div>}

      {data && (
        <div className="space-y-3">
          {data.map((rule) => (
            <div key={rule.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{rule.name}</h3>
                  <span className="text-xs text-slate-500">{TRIGGER_LABELS[rule.trigger]}</span>
                  {rule.threshold !== null && (
                    <span className="text-xs text-slate-600">threshold: {rule.threshold}</span>
                  )}
                </div>
                <p className="text-sm text-slate-400">{rule.description}</p>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_STYLES[rule.action]}`}>
                  {rule.action.replace(/_/g, ' ')}
                </span>
              </div>
              <button
                onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                disabled={toggleMutation.isPending}
                className="shrink-0 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
              >
                {rule.enabled
                  ? <ToggleRight size={32} className="text-blue-400" />
                  : <ToggleLeft size={32} />
                }
              </button>
            </div>
          ))}
          {data.length === 0 && (
            <div className="text-slate-400 text-sm py-12 text-center">No rules configured.</div>
          )}
        </div>
      )}
    </div>
  );
}
