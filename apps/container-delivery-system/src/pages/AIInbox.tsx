import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

interface ExtractedField {
  label: string;
  value: string;
  confidence: number;
  missing?: boolean;
}

interface FieldGroup {
  label: string;
  fields: ExtractedField[];
}

interface Message {
  id: string;
  mine: boolean;
  time: string;
  text: string;
}

interface Conversation {
  id: string;
  name: string;
  category: 'ground' | 'port' | 'dispatch' | 'supervisor';
  initials: string;
  color: string;
  phone: string;
  online: boolean;
  status: 'review' | 'synced' | 'pending';
  unread: number;
  time: string;
  preview: string;
  confidence: number;
  messages: Message[];
  groups: FieldGroup[];
}

const conversations: Conversation[] = [
  {
    id: 'c1',
    name: 'John Kamau',
    category: 'ground',
    initials: 'JK',
    color: '#ff7a00',
    phone: '+254 712 •• 214',
    online: true,
    status: 'review',
    unread: 2,
    time: '14:32',
    preview: 'Container TGHU3456789 clamped at Nakuru warehouse. Departing shortly.',
    confidence: 94,
    messages: [
      { id: 'm1', mine: false, time: '14:28', text: 'Arrived at Nakuru WH. Container TGHU3456789 loaded on truck KDK 456P.' },
      { id: 'm2', mine: false, time: '14:30', text: 'E-lock SSL-2218 clamped and confirmed. Seal number KE-2024-88901.' },
      { id: 'm3', mine: true, time: '14:31', text: 'Confirmed. Please verify weight before departure.' },
      { id: 'm4', mine: false, time: '14:32', text: 'Weight confirmed 24.5 tons. Driver license verified. Departing in 10 min. ETA Mombasa 18:40.' },
    ],
    groups: [
      {
        label: 'Shipment',
        fields: [
          { label: 'Container', value: 'TGHU 345678-9', confidence: 98 },
          { label: 'Truck', value: 'KDK 456P', confidence: 97 },
          { label: 'E-Lock', value: 'SSL-2218', confidence: 95 },
          { label: 'Seal No.', value: 'KE-2024-88901', confidence: 92 },
        ],
      },
      {
        label: 'Logistics',
        fields: [
          { label: 'Origin', value: 'Nakuru WH', confidence: 96 },
          { label: 'Destination', value: 'Mombasa Port', confidence: 88 },
          { label: 'Weight', value: '24.5 tons', confidence: 94 },
          { label: 'ETA', value: '18:40', confidence: 91 },
        ],
      },
    ],
  },
  {
    id: 'c2',
    name: 'Grace Wanjiru',
    category: 'ground',
    initials: 'GW',
    color: '#33d6a8',
    phone: '+254 733 •• 021',
    online: true,
    status: 'pending',
    unread: 1,
    time: '13:55',
    preview: 'Checkpoint cleared at Gilgil. Proceeding to Naivasha for pickup.',
    confidence: 72,
    messages: [
      { id: 'm1', mine: false, time: '13:50', text: 'Passed Gilgil checkpoint. All documents verified by KRA officer.' },
      { id: 'm2', mine: false, time: '13:55', text: 'Heading to Naivasha WH for Sian Roses pickup. Container CMAU5581223.' },
    ],
    groups: [
      {
        label: 'Shipment',
        fields: [
          { label: 'Container', value: 'CMAU 558122-3', confidence: 90 },
          { label: 'Truck', value: '', confidence: 0, missing: true },
          { label: 'Checkpoint', value: 'Gilgil', confidence: 85 },
          { label: 'Destination', value: 'Naivasha WH', confidence: 78 },
        ],
      },
    ],
  },
  {
    id: 'c3',
    name: 'Hassan Omar',
    category: 'port',
    initials: 'HO',
    color: '#ffb020',
    phone: '+254 722 •• 400',
    online: false,
    status: 'synced',
    unread: 0,
    time: '12:10',
    preview: 'Container MSCU7712340 unclamped and delivered to EPZ yard.',
    confidence: 98,
    messages: [
      { id: 'm1', mine: false, time: '11:55', text: 'MSCU7712340 arrived at Mombasa Port. Bay 3 assigned.' },
      { id: 'm2', mine: true, time: '12:00', text: 'Proceed with unclamp. Authorization code: UC-8834.' },
      { id: 'm3', mine: false, time: '12:10', text: 'Container unclamped and delivered. Lock SSL-1190 returned to pool. All clear.' },
    ],
    groups: [
      {
        label: 'Delivery',
        fields: [
          { label: 'Container', value: 'MSCU 771234-0', confidence: 99 },
          { label: 'Bay', value: 'Bay 3', confidence: 97 },
          { label: 'Auth Code', value: 'UC-8834', confidence: 100 },
          { label: 'Lock Returned', value: 'SSL-1190', confidence: 96 },
        ],
      },
    ],
  },
  {
    id: 'c4',
    name: 'Samuel Kiptoo',
    category: 'ground',
    initials: 'SK',
    color: '#ff5c5c',
    phone: '+254 701 •• 456',
    online: true,
    status: 'review',
    unread: 3,
    time: '14:45',
    preview: 'Engine warning light on. Stopped at Mtito Andei service center.',
    confidence: 65,
    messages: [
      { id: 'm1', mine: false, time: '14:40', text: 'Boss, engine warning light came on near Mtito Andei. Pulling over.' },
      { id: 'm2', mine: false, time: '14:42', text: 'At Mtito service center now. Mechanic checking the truck KCE 771D.' },
      { id: 'm3', mine: false, time: '14:45', text: 'Container HLXU9903312 is secure. Lock fine. ETA will be delayed 2-3 hours.' },
    ],
    groups: [
      {
        label: 'Incident',
        fields: [
          { label: 'Vehicle', value: 'KCE 771D', confidence: 95 },
          { label: 'Container', value: 'HLXU 990331-2', confidence: 92 },
          { label: 'Issue', value: 'Engine warning', confidence: 78 },
          { label: 'Location', value: 'Mtito Andei', confidence: 88 },
          { label: 'Delay', value: '2-3 hours', confidence: 65 },
        ],
      },
    ],
  },
];

const categoryLabels: Record<string, string> = { ground: 'GROUND', port: 'PORT', dispatch: 'DISPATCH', supervisor: 'SUPERVISOR' };
const statusVariants: Record<string, 'warn' | 'ok' | 'neutral'> = { review: 'warn', synced: 'ok', pending: 'neutral' };

function ConfidenceRing({ value, size = 32 }: { value: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = Math.PI * 2 * r;
  const offset = c * (1 - value / 100);
  const color = value >= 90 ? '#33d6a8' : value >= 70 ? '#ffb020' : '#ff5c5c';
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

export default function AIInbox() {
  const [selectedId, setSelectedId] = useState(conversations[0].id);
  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];

  return (
    <div className="p-6 pb-10 animate-fade-in h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">AI Inbox</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">WhatsApp intake · Auto-extraction · Field verification</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="warn">{conversations.filter((c) => c.status === 'review').length} NEEDS REVIEW</Badge>
          <Badge variant="ok">{conversations.filter((c) => c.status === 'synced').length} SYNCED</Badge>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr_320px] gap-0 h-[calc(100%-48px)]">
        {/* Conversation List */}
        <Card className="p-0 rounded-r-none border-r border-hair overflow-y-auto">
          <div className="px-3 py-2.5 border-b border-hair">
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full bg-ink-2 border-none rounded-md px-3 py-1.5 text-[12px] placeholder:text-text-2"
            />
          </div>
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`flex gap-2.5 px-3 py-3 cursor-pointer transition-colors border-b border-hair ${selectedId === c.id ? 'bg-ink-3' : 'hover:bg-ink-2'}`}
            >
              <div
                className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-[12px] font-bold flex-none"
                style={{ background: `${c.color}22`, color: c.color }}
              >
                {c.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-text-0 truncate">{c.name}</span>
                  <span className="text-[10px] font-mono text-text-2 flex-none ml-1">{c.time}</span>
                </div>
                <div className="text-[10.5px] text-text-2 truncate mt-0.5">{c.preview}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[9px] font-mono text-text-2 bg-ink-3 px-1.5 py-0.5 rounded">{categoryLabels[c.category]}</span>
                  <Badge variant={statusVariants[c.status]}>{c.status.toUpperCase()}</Badge>
                  {c.unread > 0 && (
                    <span className="ml-auto bg-cds-orange text-white text-[9px] font-bold w-[16px] h-[16px] rounded-full flex items-center justify-center">{c.unread}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* Thread View */}
        <Card className="p-0 rounded-none flex flex-col">
          <div className="px-4 py-3 border-b border-hair flex items-center gap-3">
            <div
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[11px] font-bold"
              style={{ background: `${selected.color}22`, color: selected.color }}
            >
              {selected.initials}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-text-0">{selected.name}</div>
              <div className="text-[10.5px] text-text-2 font-mono">{selected.phone} · {selected.online ? <span className="text-cds-teal">Online</span> : 'Offline'}</div>
            </div>
            <Badge variant={statusVariants[selected.status]}>{selected.status.toUpperCase()}</Badge>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {selected.messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3.5 py-2.5 rounded-xl text-[12.5px] ${m.mine ? 'bg-cds-orange text-white rounded-br-md' : 'bg-ink-3 text-text-0 rounded-bl-md'}`}>
                  <div>{m.text}</div>
                  <div className={`text-[10px] mt-1 ${m.mine ? 'text-white/60' : 'text-text-2'} font-mono text-right`}>{m.time}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-hair">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type a reply..."
                className="flex-1 bg-ink-2 border-none rounded-lg px-3.5 py-2 text-[12.5px] placeholder:text-text-2"
              />
              <Button>Send</Button>
            </div>
          </div>
        </Card>

        {/* Extraction Panel */}
        <Card className="p-0 rounded-l-none border-l border-hair overflow-y-auto">
          <div className="px-4 py-3 border-b border-hair">
            <div className="flex items-center justify-between">
              <span className="font-display font-bold text-[13px]">AI Extraction</span>
              <div className="flex items-center gap-1.5">
                <ConfidenceRing value={selected.confidence} size={28} />
                <span className="font-mono text-[11px] text-text-1">{selected.confidence}%</span>
              </div>
            </div>
            <div className="text-[10.5px] text-text-2 mt-0.5 font-mono">
              {selected.groups.reduce((a, g) => a + g.fields.length, 0)} fields extracted · {selected.groups.reduce((a, g) => a + g.fields.filter((f) => f.missing).length, 0)} missing
            </div>
          </div>

          <div className="px-4 py-3 space-y-4">
            {selected.groups.map((group) => (
              <div key={group.label}>
                <div className="text-[10px] font-mono text-text-2 uppercase tracking-wider mb-2">{group.label}</div>
                <div className="space-y-2">
                  {group.fields.map((field) => (
                    <div key={field.label} className="flex items-center gap-2">
                      <ConfidenceRing value={field.confidence} size={22} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-text-2">{field.label}</div>
                        {field.missing ? (
                          <div className="text-[12px] text-cds-red italic">Missing — ask driver</div>
                        ) : (
                          <div className="text-[12.5px] text-text-0 font-mono">{field.value}</div>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-text-2 flex-none">{field.confidence}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-hair space-y-2">
            {selected.status === 'review' && (
              <>
                <Button className="w-full" variant="success">Approve & Sync to CDS</Button>
                <Button className="w-full" variant="ghost">Request Corrections</Button>
              </>
            )}
            {selected.status === 'synced' && (
              <div className="text-center text-[12px] text-cds-teal font-medium py-2">Synced to CDS</div>
            )}
            {selected.status === 'pending' && (
              <Button className="w-full">Review Extraction</Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
