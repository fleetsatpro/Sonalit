import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, FileCheck2, Loader2, AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { api } from '../lib/api.js';

interface HandoverQueueItem {
  id: string;
  name: string;
  region: string;
  route_origin: string;
  route_destination: string;
  truck_count: number;
  trucks_handed_over: number;
  convoy_wide_handover: boolean;
}

interface HandoverTruck {
  id: string;
  position: number;
  plate_number: string | null;
  driver_name: string | null;
}

interface HandoverRecord {
  id: string;
  convoy_truck_id: string | null;
  handed_over_by_role: 'cfo' | 'handover_officer';
  form_url: string;
  notes: string | null;
  signed_off_at: string;
}

interface HandoverDetail {
  convoy: { id: string; name: string; region: string; route_origin: string; route_destination: string; status: string };
  trucks: HandoverTruck[];
  handovers: HandoverRecord[];
}

const CARD = 'bg-[#0a0f18] border border-[#1c2a3a] rounded-lg';

function UploadRow({
  convoyId,
  truckId,
  label,
  alreadyDone,
  onDone,
}: {
  convoyId: string;
  truckId: string | null;
  label: string;
  alreadyDone: boolean;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async (file: File) => {
      const content_type = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
      const { data: presign } = await api.post<{ upload_url: string; public_url: string; key: string }>(
        `/convoy-handovers/${convoyId}/upload-url`,
        { truck_id: truckId, content_type }
      );
      const put = await fetch(presign.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': content_type } });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const { data } = await api.post<{ data: HandoverRecord; convoy_completed: boolean }>(
        `/convoy-handovers/${convoyId}/commit`,
        { truck_id: truckId, form_key: presign.key, form_url: presign.public_url, notes: notes || undefined }
      );
      return data;
    },
    onSuccess: () => onDone(),
    onError: (err: Error) => setError(err.message || 'Upload failed'),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { setError(null); submit.mutate(file); }
  };

  if (alreadyDone) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs font-mono text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> {label} — handed over
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-mono text-[#c3d3e3]">{label}</span>
        <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#1c2a3a] text-[10px] font-mono uppercase tracking-wide cursor-pointer hover:border-orange-500/50 ${submit.isPending ? 'opacity-50 pointer-events-none' : ''}`}>
          {submit.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          {submit.isPending ? 'Uploading…' : 'Upload form'}
          <input type="file" accept="image/jpeg,application/pdf" className="hidden" onChange={onFile} disabled={submit.isPending} />
        </label>
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full bg-[#050810] border border-[#1c2a3a] rounded px-2.5 py-1.5 text-xs font-mono text-[#c3d3e3] placeholder:text-[#3a4a5c] focus:outline-none focus:border-orange-500/50"
      />
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-red-400">
          <AlertCircle className="w-3 h-3 flex-shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

function ConvoyDetail({ convoyId, onCompleted }: { convoyId: string; onCompleted: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['convoy-handover-detail', convoyId],
    queryFn: async () => (await api.get<{ data: HandoverDetail }>(`/convoy-handovers/${convoyId}`)).data.data,
    refetchInterval: 5000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-detail', convoyId] });
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-queue'] });
  };

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-12 text-[#607890]"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  if (data.convoy.status !== 'completing') {
    onCompleted();
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm font-mono text-emerald-400">
        <CheckCircle2 className="w-4 h-4" /> {data.convoy.name} is fully handed over.
      </div>
    );
  }

  const convoyWide = data.handovers.find((h) => h.convoy_truck_id === null) ?? null;
  const truckDone = (truckId: string) => data.handovers.some((h) => h.convoy_truck_id === truckId);

  return (
    <div className={`${CARD} divide-y divide-[#1c2a3a]`}>
      <div className="px-4 py-3">
        <div className="text-sm font-bold text-[#c3d3e3]">{data.convoy.name}</div>
        <div className="text-[11px] font-mono text-[#607890] mt-0.5">{data.convoy.route_origin} → {data.convoy.route_destination}</div>
      </div>
      <UploadRow convoyId={convoyId} truckId={null} label="Whole convoy" alreadyDone={!!convoyWide} onDone={refresh} />
      {!convoyWide && data.trucks.length > 0 && (
        <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wide text-[#607890]">— or hand over truck-by-truck —</div>
      )}
      {!convoyWide && data.trucks.map((t) => (
        <UploadRow
          key={t.id}
          convoyId={convoyId}
          truckId={t.id}
          label={`Truck ${t.position} — ${t.plate_number ?? 'unregistered'}${t.driver_name ? ` (${t.driver_name})` : ''}`}
          alreadyDone={truckDone(t.id)}
          onDone={refresh}
        />
      ))}
    </div>
  );
}

export default function Handover() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: queue, isLoading } = useQuery({
    queryKey: ['convoy-handover-queue'],
    queryFn: async () => (await api.get<{ data: HandoverQueueItem[] }>('/convoy-handovers/queue')).data.data,
    refetchInterval: 10000,
  });

  return (
    <div className="min-h-full bg-[#04070d] p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-lg font-bold text-[#c3d3e3] flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-orange-500" /> Handover Queue
          </h1>
          <p className="text-xs font-mono text-[#607890] mt-1">
            Convoys awaiting a signed handover form. Local-consignment convoys hand over through their CFO and don't appear here.
          </p>
        </div>

        {isLoading && <div className="flex items-center justify-center py-12 text-[#607890]"><Loader2 className="w-4 h-4 animate-spin" /></div>}

        {!isLoading && queue?.length === 0 && (
          <div className={`${CARD} px-4 py-8 text-center text-sm font-mono text-[#607890]`}>
            Nothing awaiting handover right now.
          </div>
        )}

        {!isLoading && queue && queue.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-[280px_1fr]">
            <div className={`${CARD} divide-y divide-[#1c2a3a] overflow-hidden`}>
              {queue.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-3.5 py-3 hover:bg-white/5 transition-colors ${selected === c.id ? 'bg-white/5' : ''}`}
                >
                  <div className="text-xs font-bold text-[#c3d3e3]">{c.name}</div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#607890] mt-1">
                    <Truck className="w-3 h-3" /> {c.trucks_handed_over}/{c.truck_count} trucks handed over
                    {c.convoy_wide_handover && <span className="text-emerald-400">· whole-convoy done</span>}
                  </div>
                </button>
              ))}
            </div>
            <div>
              {selected
                ? <ConvoyDetail convoyId={selected} onCompleted={() => setSelected(null)} />
                : <div className={`${CARD} px-4 py-8 text-center text-sm font-mono text-[#607890]`}>Select a convoy from the queue.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
