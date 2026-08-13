import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const vehicles = [
  { reg: 'KDK 456P', type: 'Truck', make: 'Scania', model: 'R450', year: 2023, transporter: 'Kentrans Logistics', driver: 'John Kamau', status: 'in_use', odometer: 142500, fuelLevel: 72 },
  { reg: 'KBZ 902L', type: 'Truck', make: 'Volvo', model: 'FH16', year: 2022, transporter: 'Swift Cargo', driver: 'Peter Otieno', status: 'available', odometer: 198200, fuelLevel: 45 },
  { reg: 'KDA 112B', type: 'Truck', make: 'MAN', model: 'TGX', year: 2024, transporter: 'Kentrans Logistics', driver: 'Grace Wanjiru', status: 'in_use', odometer: 67800, fuelLevel: 88 },
  { reg: 'KCE 771D', type: 'Truck', make: 'Scania', model: 'S500', year: 2023, transporter: 'Rift Transporters', driver: 'Samuel Kiptoo', status: 'in_use', odometer: 112000, fuelLevel: 61 },
  { reg: 'KDG 330F', type: 'Truck', make: 'Mercedes', model: 'Actros', year: 2022, transporter: 'Swift Cargo', driver: 'Alice Njeri', status: 'in_use', odometer: 155600, fuelLevel: 54 },
  { reg: 'KBW 556J', type: 'Truck', make: 'Volvo', model: 'FM', year: 2021, transporter: 'Rift Transporters', driver: 'Dennis Mwangi', status: 'available', odometer: 234000, fuelLevel: 38 },
  { reg: 'KDF 887M', type: 'Truck', make: 'DAF', model: 'XF', year: 2023, transporter: 'Swift Cargo', driver: 'Faith Chebet', status: 'in_use', odometer: 89400, fuelLevel: 77 },
  { reg: 'KCH 221A', type: 'Truck', make: 'Scania', model: 'R500', year: 2024, transporter: 'Kentrans Logistics', driver: null, status: 'maintenance', odometer: 45200, fuelLevel: 90 },
];

export default function Vehicles() {
  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Vehicles"
        description={`${vehicles.length} vehicles in fleet · ${vehicles.filter((v) => v.status === 'in_use').length} active · ${vehicles.filter((v) => v.status === 'maintenance').length} in maintenance`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Vehicle
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Registration', 'Make / Model', 'Year', 'Transporter', 'Driver', 'Odometer', 'Fuel', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.reg} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{v.reg}</td>
                  <td className="px-3.5 py-3 text-text-0">{v.make} {v.model}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{v.year}</td>
                  <td className="px-3.5 py-3 text-text-0">{v.transporter}</td>
                  <td className="px-3.5 py-3 text-text-0">{v.driver ?? <span className="text-text-2">Unassigned</span>}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{v.odometer.toLocaleString()} km</td>
                  <td className="px-3.5 py-3">
                    <ProgressBar value={v.fuelLevel} color={v.fuelLevel >= 50 ? 'bg-cds-teal' : v.fuelLevel >= 25 ? 'bg-cds-amber' : 'bg-cds-red'} showLabel />
                  </td>
                  <td className="px-3.5 py-3">
                    {v.status === 'in_use' ? <Badge variant="ok">IN USE</Badge> : v.status === 'available' ? <Badge variant="neutral">AVAILABLE</Badge> : <Badge variant="warn">MAINTENANCE</Badge>}
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
