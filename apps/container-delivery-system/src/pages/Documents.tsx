import React, { useState } from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

type DocFilter = 'all' | 'shipping' | 'customs' | 'inspection' | 'insurance';

const documents = [
  { id: 'DOC-001', name: 'Bill of Lading — TGHU3456789', type: 'shipping', format: 'PDF', size: '245 KB', shipment: 'SHP-2024-1001', uploadedBy: 'System', uploadedAt: '2024-01-15 14:00', status: 'verified' },
  { id: 'DOC-002', name: 'Customs Declaration — KCB Export', type: 'customs', format: 'PDF', size: '180 KB', shipment: 'SHP-2024-1001', uploadedBy: 'Dr. Agnes Muthoni', uploadedAt: '2024-01-15 10:30', status: 'verified' },
  { id: 'DOC-003', name: 'Container Inspection — CMAU5581223', type: 'inspection', format: 'PDF', size: '1.2 MB', shipment: 'SHP-2024-0998', uploadedBy: 'Grace Wanjiru', uploadedAt: '2024-01-14 16:45', status: 'pending' },
  { id: 'DOC-004', name: 'Insurance Certificate — Kentrans Fleet', type: 'insurance', format: 'PDF', size: '320 KB', shipment: null, uploadedBy: 'James Kinuthia', uploadedAt: '2024-01-14 09:00', status: 'verified' },
  { id: 'DOC-005', name: 'Phytosanitary Certificate — Sian Roses', type: 'customs', format: 'PDF', size: '156 KB', shipment: 'SHP-2024-0995', uploadedBy: 'Elena Kipruto', uploadedAt: '2024-01-13 14:20', status: 'verified' },
  { id: 'DOC-006', name: 'Delivery Note — MSCU7712340', type: 'shipping', format: 'PDF', size: '98 KB', shipment: 'SHP-2024-0990', uploadedBy: 'Hassan Omar', uploadedAt: '2024-01-13 12:10', status: 'verified' },
  { id: 'DOC-007', name: 'Weight Certificate — Kakuzi PLC', type: 'shipping', format: 'PDF', size: '67 KB', shipment: 'SHP-2024-0988', uploadedBy: 'Robert Maina', uploadedAt: '2024-01-12 11:30', status: 'expired' },
  { id: 'DOC-008', name: 'Vehicle Inspection — KDK 456P', type: 'inspection', format: 'PDF', size: '2.1 MB', shipment: null, uploadedBy: 'John Kamau', uploadedAt: '2024-01-12 08:00', status: 'verified' },
];

const typeIcons: Record<string, string> = { shipping: 'S', customs: 'C', inspection: 'I', insurance: 'N' };
const typeColors: Record<string, string> = { shipping: '#ff7a00', customs: '#33d6a8', inspection: '#ffb020', insurance: '#6b7380' };
const statusVariants: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = { verified: 'ok', pending: 'warn', expired: 'bad', rejected: 'bad' };

export default function Documents() {
  const [filter, setFilter] = useState<DocFilter>('all');
  const filtered = filter === 'all' ? documents : documents.filter((d) => d.type === filter);

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Documents"
        description={`${documents.length} documents · ${documents.filter((d) => d.status === 'pending').length} pending verification`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}>
            Upload Document
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: documents.length },
          { id: 'shipping', label: 'Shipping' },
          { id: 'customs', label: 'Customs' },
          { id: 'inspection', label: 'Inspection' },
          { id: 'insurance', label: 'Insurance' },
        ]}
        activeId={filter}
        onChange={(id) => setFilter(id as DocFilter)}
        variant="pills"
      />

      <div className="glass p-0 mt-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Document', 'Type', 'Shipment', 'Size', 'Uploaded By', 'Date', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr key={doc.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-[28px] h-[28px] rounded-lg flex items-center justify-center text-2xs font-bold flex-none"
                        style={{ background: `${typeColors[doc.type]}18`, color: typeColors[doc.type] }}
                      >
                        {typeIcons[doc.type]}
                      </div>
                      <div>
                        <div className="text-text-0 font-medium">{doc.name}</div>
                        <div className="text-2xs text-text-2 font-mono mt-0.5">{doc.id} · {doc.format}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 text-text-1 capitalize">{doc.type}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{doc.shipment ?? <span className="text-text-2">—</span>}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{doc.size}</td>
                  <td className="px-3.5 py-3 text-text-0">{doc.uploadedBy}</td>
                  <td className="px-3.5 py-3 font-mono text-text-2 text-2xs">{doc.uploadedAt}</td>
                  <td className="px-3.5 py-3"><Badge variant={statusVariants[doc.status] ?? 'neutral'}>{doc.status.toUpperCase()}</Badge></td>
                  <td className="px-3.5 py-3">
                    <Button size="sm" variant="ghost">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
