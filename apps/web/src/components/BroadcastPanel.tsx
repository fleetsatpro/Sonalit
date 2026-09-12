/**
 * BroadcastPanel — slide-in panel for sending convoy broadcasts.
 * Supports free-text messages and canned message selection.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Send, Radio, XCircle, ChevronDown } from 'lucide-react';

type Channel = 'app' | 'whatsapp' | 'sms' | 'email';

interface CannedMessage { id: string; title: string; body: string; category: string; }

interface Props {
  convoyId: string;
  convoyName: string;
  onClose: () => void;
}

const CHANNEL_LABELS: Record<Channel, string> = {
  app: 'In-App',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

export default function BroadcastPanel({ convoyId, convoyName, onClose }: Props) {
  const [channel, setChannel] = useState<Channel>('app');
  const [message, setMessage] = useState('');
  const [selectedCanned, setSelectedCanned] = useState<string>('');
  const [sent, setSent] = useState<{ recipients: number; status: string } | null>(null);

  const cannedQ = useQuery<{ data: CannedMessage[] }>({
    queryKey: ['canned-messages'],
    queryFn: () => api.get('/canned-messages').then(r => r.data),
  });

  const sendMut = useMutation({
    mutationFn: (body: object) => api.post(`/convoys/${convoyId}/broadcast`, body, {
      headers: { 'X-Idempotency-Key': `broadcast-${convoyId}-${Date.now()}` },
    }),
    onSuccess: (res) => {
      setSent({ recipients: res.data.recipients ?? 0, status: res.data.data?.status ?? 'sent' });
      setMessage('');
      setSelectedCanned('');
    },
  });

  const handleCannedSelect = (id: string) => {
    setSelectedCanned(id);
    const canned = cannedQ.data?.data.find(c => c.id === id);
    if (canned) setMessage(canned.body);
  };

  const handleSend = () => {
    const body = message.trim();
    if (!body) return;
    sendMut.mutate({ message: body, channel, canned_message_id: selectedCanned || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-orange-400" />
            <div>
              <h2 className="text-white font-semibold text-sm">Broadcast to Convoy</h2>
              <p className="text-gray-400 text-xs">{convoyName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Channel selector */}
          <div className="flex gap-2">
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  channel === ch
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                {CHANNEL_LABELS[ch]}
              </button>
            ))}
          </div>

          {/* Canned message picker */}
          {cannedQ.data && cannedQ.data.data.length > 0 && (
            <div className="relative">
              <select
                value={selectedCanned}
                onChange={e => handleCannedSelect(e.target.value)}
                className="w-full bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm appearance-none pr-8"
              >
                <option value="">Use a canned message…</option>
                {cannedQ.data.data.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            </div>
          )}

          {/* Message textarea */}
          <textarea
            value={message}
            onChange={e => { setMessage(e.target.value); setSelectedCanned(''); }}
            placeholder="Type your message…"
            rows={4}
            className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm resize-none placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{message.length}/4000</span>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="text-sm text-gray-400 hover:text-white">Cancel</button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!message.trim() || sendMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Send className="w-4 h-4" />
                {sendMut.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          {/* Result */}
          {sent && (
            <div className="bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-3 text-sm text-green-400">
              Sent to {sent.recipients} recipient{sent.recipients !== 1 ? 's' : ''} — {sent.status}
            </div>
          )}
          {sendMut.isError && (
            <p className="text-red-400 text-xs">Failed to send broadcast.</p>
          )}
        </div>
      </div>
    </div>
  );
}
