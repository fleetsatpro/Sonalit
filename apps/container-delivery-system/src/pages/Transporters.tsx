import React from 'react';
import { Button } from '@/components/ui/Button.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const transporters = [
  { name: 'Kentrans Logistics', trucks: 24, onTime: 94, avgClamp: '6m 40s', trips: 412, rating: 4.8, contact: 'James Kinuthia', phone: '+254 720 •• 100', status: 'active' },
  { name: 'Swift Cargo', trucks: 18, onTime: 87, avgClamp: '7m 55s', trips: 301, rating: 4.5, contact: 'Mary Wambui', phone: '+254 733 •• 200', status: 'active' },
  { name: 'Rift Transporters', trucks: 15, onTime: 96, avgClamp: '5m 58s', trips: 268, rating: 4.9, contact: 'David Kibet', phone: '+254 712 •• 300', status: 'active' },
  { name: 'Coastal Movers', trucks: 9, onTime: 79, avgClamp: '9m 20s', trips: 140, rating: 4.1, contact: 'Hassan Omar', phone: '+254 722 •• 400', status: 'active' },
];

export default function Transporters() {
  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Transporters"
        description={`Performance across ${transporters.length} contracted transport companies.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Transporter
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Transporter', 'Contact', 'Active Trucks', 'On-Time Rate', 'Avg Clamp Time', 'Trips (30d)', 'Rating'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transporters.map((t) => (
                <tr key={t.name} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 text-text-0 font-semibold">{t.name}</td>
                  <td className="px-3.5 py-3 text-text-0">{t.contact}<div className="text-2xs text-text-2 mt-0.5">{t.phone}</div></td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{t.trucks}</td>
                  <td className="px-3.5 py-3">
                    <ProgressBar value={t.onTime} width="w-[70px]" color={t.onTime >= 90 ? 'bg-cds-teal' : t.onTime >= 80 ? 'bg-cds-amber' : 'bg-cds-red'} showLabel />
                  </td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{t.avgClamp}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{t.trips}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{t.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
