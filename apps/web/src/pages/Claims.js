import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { FileText, Plus, XCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
const STATUS_STYLES = {
    draft: 'bg-gray-700 text-gray-300',
    submitted: 'bg-blue-900/60 text-blue-300',
    under_review: 'bg-yellow-900/60 text-yellow-300',
    approved: 'bg-green-900/60 text-green-300',
    rejected: 'bg-red-900/60 text-red-300',
    withdrawn: 'bg-gray-800 text-gray-500',
};
const STATUS_TRANSITIONS = {
    draft: ['submitted', 'withdrawn'],
    submitted: ['under_review', 'withdrawn'],
    under_review: ['approved', 'rejected'],
    approved: [],
    rejected: [],
    withdrawn: [],
};
function StatusIcon({ status }) {
    if (status === 'approved')
        return <CheckCircle className="w-3 h-3"/>;
    if (status === 'rejected')
        return <XCircle className="w-3 h-3"/>;
    if (status === 'under_review')
        return <Clock className="w-3 h-3"/>;
    if (status === 'submitted')
        return <AlertTriangle className="w-3 h-3"/>;
    return null;
}
export default function ClaimsPage() {
    const [showNew, setShowNew] = useState(false);
    const [newClaim, setNewClaim] = useState({ insurer_name: '', policy_number: '', incident_description: '', damage_description: '', estimated_value: '', currency: 'KES' });
    const qc = useQueryClient();
    const claimsQ = useQuery({
        queryKey: ['claims'],
        queryFn: () => api.get('/claims').then(r => r.data),
    });
    const createMut = useMutation({
        mutationFn: (body) => api.post('/claims', body, {
            headers: { 'X-Idempotency-Key': `claim-${Date.now()}` },
        }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); setShowNew(false); },
    });
    const statusMut = useMutation({
        mutationFn: ({ id, status }) => api.patch(`/claims/${id}/status`, { status }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['claims'] }),
    });
    const pdfMut = useMutation({
        mutationFn: (id) => api.post(`/claims/${id}/generate-pdf`, {}),
    });
    return (<div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-400"/>
          <h1 className="text-2xl font-bold text-white">Insurance Claims</h1>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          <Plus className="w-4 h-4"/> New Claim
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        {claimsQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
        {claimsQ.data && (<table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700 text-xs uppercase">
                <th className="p-3 text-left">Claim #</th>
                <th className="p-3 text-left">Insurer</th>
                <th className="p-3 text-left">Vehicle</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-right">Value</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claimsQ.data.data.map(c => (<tr key={c.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="p-3 font-mono text-xs text-gray-300">{c.claim_number ?? c.id.slice(0, 8)}</td>
                  <td className="p-3 text-gray-300">{c.insurer_name ?? '—'}</td>
                  <td className="p-3 text-gray-300 font-mono text-xs">{c.vehicle_reg ?? '—'}</td>
                  <td className="p-3 text-gray-400 text-xs">{c.incident_date ?? '—'}</td>
                  <td className="p-3 text-right text-white">{c.estimated_value != null ? `${c.currency} ${Number(c.estimated_value).toLocaleString()}` : '—'}</td>
                  <td className="p-3">
                    <span className={`flex items-center gap-1 w-fit px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[c.status]}`}>
                      <StatusIcon status={c.status}/> {c.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3 flex items-center gap-2">
                    {STATUS_TRANSITIONS[c.status].map(next => (<button key={next} onClick={() => statusMut.mutate({ id: c.id, status: next })} className="text-xs text-blue-400 hover:text-blue-300 capitalize">
                        {next.replace('_', ' ')}
                      </button>))}
                    <button onClick={() => pdfMut.mutate(c.id)} className="text-xs text-gray-400 hover:text-white">PDF</button>
                  </td>
                </tr>))}
              {claimsQ.data.data.length === 0 && (<tr><td colSpan={7} className="p-8 text-center text-gray-500">No claims yet</td></tr>)}
            </tbody>
          </table>)}
      </div>

      {showNew && (<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div role="dialog" className="bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Insurance Claim</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white"><XCircle className="w-5 h-5"/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Insurer Name" value={newClaim.insurer_name} onChange={e => setNewClaim(p => ({ ...p, insurer_name: e.target.value }))} className="col-span-2 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Policy Number" value={newClaim.policy_number} onChange={e => setNewClaim(p => ({ ...p, policy_number: e.target.value }))} className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Estimated Value" type="number" value={newClaim.estimated_value} onChange={e => setNewClaim(p => ({ ...p, estimated_value: e.target.value }))} className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <textarea placeholder="Incident Description" value={newClaim.incident_description} onChange={e => setNewClaim(p => ({ ...p, incident_description: e.target.value }))} className="col-span-2 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm h-20 resize-none"/>
              <textarea placeholder="Damage Description" value={newClaim.damage_description} onChange={e => setNewClaim(p => ({ ...p, damage_description: e.target.value }))} className="col-span-2 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm h-20 resize-none"/>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={() => createMut.mutate({
                insurer_name: newClaim.insurer_name || undefined,
                policy_number: newClaim.policy_number || undefined,
                incident_description: newClaim.incident_description || undefined,
                damage_description: newClaim.damage_description || undefined,
                estimated_value: newClaim.estimated_value ? parseFloat(newClaim.estimated_value) : undefined,
                currency: newClaim.currency,
            })} disabled={createMut.isPending} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
                {createMut.isPending ? 'Creating...' : 'Create Claim'}
              </button>
            </div>
            {createMut.isError && <p className="text-red-400 text-xs">Failed to create claim</p>}
          </div>
        </div>)}
    </div>);
}
