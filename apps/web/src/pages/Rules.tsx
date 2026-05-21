import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { BookOpen, Plus, X, ToggleLeft, ToggleRight } from 'lucide-react';

type ConditionType = 'speed' | 'geofence' | 'idle';
type ActionType = 'alert' | 'notify';

interface Rule {
  id: string;
  name: string;
  description: string;
  condition: string;
  condition_type: ConditionType;
  threshold: number | null;
  action: string;
  action_type: ActionType;
  enabled: boolean;
}

interface CreateRulePayload {
  name: string;
  description: string;
  condition_type: ConditionType;
  threshold: string;
  action_type: ActionType;
  enabled: boolean;
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  speed: 'Speed Exceeded',
  geofence: 'Geofence Violation',
  idle: 'Idle Timeout',
};

const ACTION_STYLES: Record<ActionType, string> = {
  alert: 'bg-amber-800 text-amber-200',
  notify: 'bg-blue-800 text-blue-200',
};

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateRulePayload>({
    name: '',
    description: '',
    condition_type: 'speed',
    threshold: '',
    action_type: 'alert',
    enabled: true,
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateRulePayload) =>
      api.post('/rules', {
        ...payload,
        threshold: payload.threshold ? Number(payload.threshold) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onClose();
    },
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">New Rule</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Speed Alert"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Condition Type</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={form.condition_type}
            onChange={(e) => setForm((f) => ({ ...f, condition_type: e.target.value as ConditionType }))}
          >
            <option value="speed">Speed</option>
            <option value="geofence">Geofence</option>
            <option value="idle">Idle</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Threshold</label>
          <input
            type="number"
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="e.g. 120 for km/h"
            value={form.threshold}
            onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Action Type</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={form.action_type}
            onChange={(e) => setForm((f) => ({ ...f, action_type: e.target.value as ActionType }))}
          >
            <option value="alert">Alert</option>
            <option value="notify">Notify</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Description</label>
          <input
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Brief description of this rule"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="rule-enabled"
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            className="w-4 h-4"
          />
          <label htmlFor="rule-enabled" className="text-sm text-slate-300">
            Enable immediately
          </label>
        </div>
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to create rule.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending || !form.name}
        className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Creating…' : 'Create Rule'}
      </button>
    </div>
  );
}

export default function Rules() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: async () => {
      const res = await api.get<Rule[] | { data: Rule[] }>('/rules');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/rules/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Rules</h1>
          {data && (
            <span className="text-slate-400 text-sm">
              ({data.filter((r) => r.enabled).length} active)
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          New Rule
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading rules…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load rules.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Condition</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {data.map((rule) => (
                <tr key={rule.id} className="border-t border-slate-700">
                  <td className="px-4 py-3">
                    <p className="font-medium">{rule.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">
                      {CONDITION_LABELS[rule.condition_type] ?? rule.condition}
                    </span>
                    {rule.threshold !== null && (
                      <p className="text-xs text-slate-500 mt-1">threshold: {rule.threshold}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_STYLES[rule.action_type] ?? 'bg-slate-700 text-slate-200'}`}>
                      {rule.action_type ?? rule.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                      disabled={toggleMutation.isPending}
                      className="text-slate-400 hover:text-white disabled:opacity-50"
                      aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      {rule.enabled
                        ? <ToggleRight size={28} className="text-blue-400" />
                        : <ToggleLeft size={28} />}
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No rules configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
