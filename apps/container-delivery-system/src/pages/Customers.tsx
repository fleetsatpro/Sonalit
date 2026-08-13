import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const customers = [
  { name: 'Kenya Coffee Board', code: 'KCB', contact: 'Dr. Agnes Muthoni', phone: '+254 720 •• 010', email: 'ops@kcb.co.ke', city: 'Nairobi', activeShipments: 3, totalShipments: 245, sla: 97, rating: 4.9, status: 'active' },
  { name: 'KTDA Holdings', code: 'KTDA', contact: 'Wilson Kering', phone: '+254 733 •• 020', email: 'logistics@ktda.com', city: 'Nairobi', activeShipments: 2, totalShipments: 189, sla: 94, rating: 4.7, status: 'active' },
  { name: 'Sian Roses', code: 'SIAN', contact: 'Elena Kipruto', phone: '+254 712 •• 030', email: 'export@sianroses.com', city: 'Naivasha', activeShipments: 1, totalShipments: 78, sla: 91, rating: 4.5, status: 'active' },
  { name: 'Kakuzi PLC', code: 'KAK', contact: 'Robert Maina', phone: '+254 722 •• 040', email: 'shipping@kakuzi.com', city: 'Murang\'a', activeShipments: 1, totalShipments: 134, sla: 96, rating: 4.8, status: 'active' },
  { name: 'EPZ Textiles', code: 'EPZT', contact: 'Patricia Wangari', phone: '+254 745 •• 050', email: 'logistics@epz-text.co.ke', city: 'Athi River', activeShipments: 1, totalShipments: 56, sla: 88, rating: 4.3, status: 'active' },
  { name: 'Sasini PLC', code: 'SAS', contact: 'George Ndegwa', phone: '+254 711 •• 060', email: 'ops@sasini.co.ke', city: 'Nairobi', activeShipments: 0, totalShipments: 167, sla: 95, rating: 4.7, status: 'active' },
];

export default function Customers() {
  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Customers"
        description={`${customers.length} registered customers · ${customers.reduce((a, c) => a + c.activeShipments, 0)} active shipments`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Customer
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Customer', 'Code', 'Contact', 'City', 'Active', 'Total Shipments', 'SLA %', 'Rating', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.code} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 text-text-0 font-semibold">{c.name}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{c.code}</td>
                  <td className="px-3.5 py-3 text-text-0">{c.contact}<div className="text-2xs text-text-2 mt-0.5">{c.phone}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{c.city}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{c.activeShipments}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{c.totalShipments}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{c.sla}%</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{c.rating}</td>
                  <td className="px-3.5 py-3"><Badge variant="ok">ACTIVE</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
