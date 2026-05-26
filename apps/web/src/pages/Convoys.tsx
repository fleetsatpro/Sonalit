import React, { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Route, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import type { Convoy, ConvoyStatus } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConvoyListResponse = NormalizedList<Convoy>;

type ConvoyStatusEvent = { convoy_id: string; status: ConvoyStatus };

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

  const { data, isLoading, isError } = useQuery<ConvoyListResponse>({
    queryKey: ['convoys'],
    queryFn: async () => {
      const res = await api.get('/convoys');
      return normalizeList<Convoy>(res.data);
    },
  });

  // Live status updates per convoy
  useEffect(() => {
    if (!data?.data) return;
    const unsubscribers = data.data.map((convoy) =>
      subscribe<ConvoyStatusEvent>(`convoy#${convoy.id}`, () => {
        void queryClient.invalidateQueries({ queryKey: ['convoys'] });
      }),
    );
    return () => { for (const unsub of unsubscribers) unsub(); };
  }, [data?.data, queryClient]);

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete(`/convoys/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['convoys'] });
    },
  });

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
                      <Link
                        to="/convoys/$id/edit"
                        params={{ id: convoy.id }}
                        className="text-orange-400 hover:text-orange-300 transition-colors"
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
    </div>
  );
}
