import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Route, Plus, Pencil, Trash2, Loader2, Radio, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import type { Convoy, ConvoyStatus } from '@sonalit/contracts';
import BroadcastPanel from '../components/BroadcastPanel.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConvoyListResponse = NormalizedList<Convoy>;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ConvoyStatus, string> = {
  draft: 'bg-gray-800 text-gray-400 border-gray-600',
  planned: 'bg-blue-900/60 text-orange-300 border-blue-700',
  active: 'bg-green-900/60 text-green-300 border-green-700',
  completed: 'bg-orange-900/60 text-orange-300 border-orange-700',
  cancelled: 'bg-red-900/60 text-red-300 border-red-700',
};

function StatusBadge({ status }: { status: ConvoyStatus }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Convoys(): React.ReactElement {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.org_id);
  const [broadcastConvoy, setBroadcastConvoy] = useState<{ id: string; name: string } | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<ConvoyListResponse>({
    queryKey: ['convoys'],
    queryFn: async () => {
      const res = await api.get('/convoys');
      return normalizeList<Convoy>(res.data);
    },
  });

  // Live status updates — subscribe to org channel for convoy.update events
  useEffect(() => {
    if (!orgId) return;
    return subscribe<{ type?: string }>(`org#${orgId}`, (evt) => {
      if (evt.type === 'convoy.update') {
        void queryClient.invalidateQueries({ queryKey: ['convoys'] });
      }
    });
  }, [orgId, queryClient]);

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete(`/convoys/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['convoys'] });
    },
  });

  const dispatchMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.patch(`/convoys/${id}/status`, { status: 'active' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['convoys'] });
    },
    onSettled: () => setDispatchingId(null),
  });

  const handleDispatch = (id: string, name: string): void => {
    if (!window.confirm(`Dispatch convoy "${name}"? This will mark it as active.`)) return;
    setDispatchingId(id);
    dispatchMutation.mutate(id);
  };

  const handleDelete = (id: string, name: string): void => {
    if (!window.confirm(`Delete convoy "${name}"?`)) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Route className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Convoys</h1>
          {data && (
            <span className="text-sm text-gray-400">{data.total ?? 0} total</span>
          )}
        </div>
        <Link
          to="/convoys/new"
          className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Convoy
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading convoys…
        </div>
      )}
      {isError && (
        <p className="text-red-400 text-sm py-8 text-center">Failed to load convoys.</p>
      )}

      {data && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Start Date</th>
                <th className="px-4 py-3 text-left">End Date</th>
                <th className="px-4 py-3 text-left">Timezone</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    No convoys found.
                  </td>
                </tr>
              )}
              {data.data.map((convoy) => (
                <tr key={convoy.id} className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{convoy.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={convoy.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{convoy.start_date}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{convoy.end_date}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{convoy.timezone}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {convoy.status === 'planned' && (
                        <button
                          type="button"
                          onClick={() => handleDispatch(convoy.id, convoy.name)}
                          disabled={dispatchingId === convoy.id}
                          className="flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-xs font-bold text-white transition-colors"
                          title="Dispatch convoy"
                        >
                          <Zap className="w-3 h-3" />
                          {dispatchingId === convoy.id ? '…' : 'DISPATCH'}
                        </button>
                      )}
                      {convoy.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => setBroadcastConvoy({ id: convoy.id, name: convoy.name })}
                          className="text-orange-400 hover:text-orange-300 transition-colors"
                          title="Broadcast"
                        >
                          <Radio className="w-4 h-4" />
                        </button>
                      )}
                      <Link
                        to="/convoys/$id/edit"
                        params={{ id: convoy.id }}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(convoy.id, convoy.name)}
                        disabled={deleteMutation.isPending}
                        className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {broadcastConvoy && (
        <BroadcastPanel
          convoyId={broadcastConvoy.id}
          convoyName={broadcastConvoy.name}
          onClose={() => setBroadcastConvoy(null)}
        />
      )}
    </div>
  );
}
