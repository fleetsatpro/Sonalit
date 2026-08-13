import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const drivers = [
  { name: 'John Kamau', phone: '+254 712 •• 214', transporter: 'Kentrans Logistics', trips: 186, rating: 4.9, status: 'active', truck: 'KDK 456P' },
  { name: 'Peter Otieno', phone: '+254 720 •• 887', transporter: 'Swift Cargo', trips: 142, rating: 4.7, status: 'idle', truck: 'KBZ 902L' },
  { name: 'Grace Wanjiru', phone: '+254 733 •• 021', transporter: 'Kentrans Logistics', trips: 98, rating: 4.6, status: 'active', truck: 'KDA 112B' },
  { name: 'Samuel Kiptoo', phone: '+254 701 •• 456', transporter: 'Rift Transporters', trips: 211, rating: 4.95, status: 'active', truck: 'KCE 771D' },
  { name: 'Alice Njeri', phone: '+254 745 •• 903', transporter: 'Swift Cargo', trips: 77, rating: 4.5, status: 'active', truck: 'KDG 330F' },
  { name: 'Dennis Mwangi', phone: '+254 722 •• 340', transporter: 'Rift Transporters', trips: 159, rating: 4.8, status: 'idle', truck: 'KBW 556J' },
  { name: 'Faith Chebet', phone: '+254 711 •• 668', transporter: 'Swift Cargo', trips: 64, rating: 4.3, status: 'active', truck: 'KDF 887M' },
];

export default function Drivers() {
  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Drivers"
        description={`${drivers.length} registered drivers across all transporters.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Driver
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Driver', 'Transporter', 'Current Truck', 'Trips', 'Rating', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.name} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 text-text-0">{d.name}<div className="text-2xs text-text-2 mt-0.5">{d.phone}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{d.transporter}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{d.truck}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{d.trips}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{d.rating}</td>
                  <td className="px-3.5 py-3">{d.status === 'active' ? <Badge variant="ok">ACTIVE</Badge> : <Badge variant="neutral">IDLE</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
