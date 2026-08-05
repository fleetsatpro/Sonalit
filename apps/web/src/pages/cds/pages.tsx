import React, { useState } from 'react';
import {
  Card,
  KPICard,
  Button,
  StatusBadge,
  DataTable,
  DrawerField,
} from './components.js';
import {
  useTrips,
  useClampTrip,
  useUnclampTrip,
  useTransitionTrip,
  useReports,
} from './hooks.js';
import { useCDSStore } from './store.js';
import type { Shipment } from './types.js';

function PageShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5">
        <h1 className="text-[22px] font-extrabold text-white">{title}</h1>
        <p className="text-xs text-text-2 mt-1 font-mono tracking-[.08em]">
          {sub}
        </p>
      </div>
      {children}
    </div>
  );
}

const CLAMP_FIELDS = [
  { key: 'container_number', label: 'Container Number', placeholder: 'e.g. MAEU1234567' },
  { key: 'lock_serial', label: 'Lock Serial (E-Lock)', placeholder: 'e.g. SL-001' },
  { key: 'host_vehicle', label: 'Host Vehicle Reg', placeholder: 'e.g. KBX 123A' },
  { key: 'trailer_number', label: 'Trailer Number', placeholder: 'e.g. KCT 456B' },
  { key: 'driver_name', label: 'Driver Name', placeholder: 'Full name' },
  { key: 'driver_phone', label: 'Driver Phone', placeholder: '+254...' },
  { key: 'transporter_name', label: 'Transporter', placeholder: 'Company name' },
  { key: 'commodity', label: 'Commodity', placeholder: 'Cargo description' },
  { key: 'seal_number', label: 'Seal Number', placeholder: 'Optional' },
] as const;

function ClampForm({
  tripId,
  tripRef,
  onDone,
}: {
  tripId: string;
  tripRef: string;
  onDone: () => void;
}) {
  const clamp = useClampTrip();
  const { addToast } = useCDSStore();
  const [form, setForm] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    clamp.mutate(
      { id: tripId, ...form },
      {
        onSuccess: () => {
          addToast('Trip clamped successfully');
          onDone();
        },
        onError: () => addToast('Clamp failed', 'error'),
      },
    );
  };

  return (
    <div className="space-y-3">
      {CLAMP_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key}>
          <label className="text-[11px] text-text-2 font-mono block mb-1">
            {label}
          </label>
          <input
            className="w-full h-9 rounded-lg bg-ink-2 border border-[rgba(255,255,255,0.07)] px-3 text-text-0 text-xs outline-none focus:border-cds-orange/40 transition-colors"
            placeholder={placeholder}
            value={form[key] ?? ''}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, [key]: e.target.value }))
            }
          />
        </div>
      ))}
      <Button
        className="w-full mt-2"
        onClick={handleSubmit}
        disabled={clamp.isPending}
      >
        {clamp.isPending ? 'Clamping...' : `Clamp ${tripRef}`}
      </Button>
    </div>
  );
}

export function CDSClamp() {
  const { data } = useTrips();
  const transition = useTransitionTrip();
  const { openDrawer, closeDrawer, addToast } = useCDSStore();
  const clampStatuses = [
    'created',
    'vehicle_assigned',
    'driver_assigned',
    'awaiting_lock',
  ];
  const pending = (data?.data ?? []).filter((r) =>
    clampStatuses.includes(r.status),
  );
  const locked = (data?.data ?? []).filter((r) => r.status === 'locked');
  const rows = [...pending, ...locked];

  const openClampForm = (trip: Shipment) => {
    openDrawer(
      `Clamp — ${trip.reference}`,
      <ClampForm tripId={trip.id} tripRef={trip.reference} onDone={closeDrawer} />,
    );
  };

  return (
    <PageShell title="Clamping" sub="GROUND TEAM — LOCK & DISPATCH">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPICard
          label="PENDING"
          value={String(pending.length)}
          delta="awaiting clamp"
          trend="up"
        />
        <KPICard
          label="LOCKED"
          value={String(locked.length)}
          delta="ready to dispatch"
          trend="up"
        />
        <KPICard
          label="TOTAL QUEUE"
          value={String(rows.length)}
          delta="in pipeline"
          trend="up"
        />
      </div>
      <DataTable
        columns={[
          {
            id: 'ref',
            header: 'Trip #',
            accessor: (r) => (
              <span className="font-mono font-bold text-cds-orange text-xs">
                {r.reference}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            accessor: (r) => <StatusBadge status={r.status} />,
          },
          {
            id: 'customer',
            header: 'Customer',
            accessor: (r) => r.customerName ?? '—',
          },
          {
            id: 'origin',
            header: 'Origin',
            accessor: (r) => r.origin ?? '—',
          },
          {
            id: 'dest',
            header: 'Destination',
            accessor: (r) => r.destination ?? '—',
          },
          {
            id: 'actions',
            header: 'Action',
            accessor: (r) => {
              if (r.status === 'locked')
                return (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={(e) => {
                      e.stopPropagation();
                      transition.mutate(
                        { id: r.id, to_status: 'dispatched' },
                        {
                          onSuccess: () => addToast('Dispatched'),
                          onError: () => addToast('Failed', 'error'),
                        },
                      );
                    }}
                  >
                    Dispatch
                  </Button>
                );
              return (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openClampForm(r);
                  }}
                >
                  Clamp
                </Button>
              );
            },
          },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
        onRowClick={openClampForm}
      />
    </PageShell>
  );
}

export function CDSUnclamp() {
  const { data } = useTrips();
  const unclamp = useUnclampTrip();
  const transition = useTransitionTrip();
  const { openDrawer, addToast } = useCDSStore();
  const unclampStatuses = ['at_port', 'delivered', 'lock_removed'];
  const rows = (data?.data ?? []).filter((r) =>
    unclampStatuses.includes(r.status),
  );

  return (
    <PageShell title="Unclamping" sub="PORT TEAM — LOCK REMOVAL">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPICard
          label="AT PORT"
          value={String(rows.filter((r) => r.status === 'at_port').length)}
          delta="arrived"
          trend="up"
        />
        <KPICard
          label="DELIVERED"
          value={String(rows.filter((r) => r.status === 'delivered').length)}
          delta="awaiting unclamp"
          trend="up"
        />
        <KPICard
          label="UNCLAMPED"
          value={String(
            rows.filter((r) => r.status === 'lock_removed').length,
          )}
          delta="locks removed"
          trend="up"
        />
      </div>
      <DataTable
        columns={[
          {
            id: 'ref',
            header: 'Trip #',
            accessor: (r) => (
              <span className="font-mono font-bold text-cds-orange text-xs">
                {r.reference}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            accessor: (r) => <StatusBadge status={r.status} />,
          },
          {
            id: 'customer',
            header: 'Customer',
            accessor: (r) => r.customerName ?? '—',
          },
          {
            id: 'dest',
            header: 'Destination',
            accessor: (r) => r.destination ?? '—',
          },
          {
            id: 'arrived',
            header: 'Arrived',
            accessor: (r) =>
              r.deliveredAt
                ? new Date(r.deliveredAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—',
          },
          {
            id: 'actions',
            header: 'Action',
            accessor: (r) => {
              if (r.status === 'delivered')
                return (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      unclamp.mutate(
                        { id: r.id },
                        {
                          onSuccess: () => addToast('Lock removed'),
                          onError: () => addToast('Failed', 'error'),
                        },
                      );
                    }}
                  >
                    Unclamp
                  </Button>
                );
              if (r.status === 'lock_removed')
                return (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={(e) => {
                      e.stopPropagation();
                      transition.mutate(
                        { id: r.id, to_status: 'completed' },
                        {
                          onSuccess: () => addToast('Completed'),
                          onError: () => addToast('Failed', 'error'),
                        },
                      );
                    }}
                  >
                    Complete
                  </Button>
                );
              return <span className="text-text-2 text-xs">—</span>;
            },
          },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
        onRowClick={(r) =>
          openDrawer(`Trip ${r.reference}`, (
            <>
              <DrawerField
                label="Status"
                value={<StatusBadge status={r.status} />}
              />
              <DrawerField label="Customer" value={r.customerName ?? '—'} />
              <DrawerField label="Driver" value={r.driverName ?? '—'} />
              <DrawerField label="Vehicle" value={r.vehicleReg ?? '—'} />
              <DrawerField label="Origin" value={r.origin ?? '—'} />
              <DrawerField
                label="Destination"
                value={r.destination ?? '—'}
              />
            </>
          ))
        }
      />
    </PageShell>
  );
}

export function CDSReports() {
  const { data } = useReports();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Reports" sub="GENERATE & EXPORT">
      <Card className="p-5 mb-4">
        <h2 className="text-sm font-bold text-text-0 mb-3">Generate Report</h2>
        <div className="flex gap-2 flex-wrap">
          {['Daily Summary', 'Weekly Fleet', 'Monthly Analytics', 'Custom'].map(
            (t) => (
              <Button key={t} size="sm" variant="ghost">
                {t}
              </Button>
            ),
          )}
        </div>
      </Card>
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          {
            id: 'format',
            header: 'Format',
            accessor: (r) => r.format.toUpperCase(),
          },
          {
            id: 'status',
            header: 'Status',
            accessor: (r) => <StatusBadge status={r.status} />,
          },
          {
            id: 'by',
            header: 'Generated By',
            accessor: (r) => r.generatedBy,
          },
          { id: 'date', header: 'Date', accessor: (r) => r.generatedAt },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

export function CDSSettings() {
  return (
    <PageShell title="Settings" sub="ACCOUNT & PLATFORM PREFERENCES">
      <div className="space-y-4">
        {[
          {
            title: 'Profile',
            fields: ['Company Name', 'Contact Email', 'Phone', 'Address'],
          },
          {
            title: 'Notifications',
            fields: [
              'Email Alerts',
              'SMS Alerts',
              'Push Notifications',
              'Alert Threshold',
            ],
          },
          {
            title: 'Integrations',
            fields: [
              'WhatsApp Business API',
              'GPS Provider',
              'ERP System',
              'Port Systems',
            ],
          },
          {
            title: 'Security',
            fields: [
              'Two-Factor Auth',
              'Session Timeout',
              'API Key Management',
              'Audit Retention',
            ],
          },
        ].map((section) => (
          <Card key={section.title} className="p-5">
            <h2 className="text-sm font-bold text-text-0 mb-3">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {section.fields.map((f) => (
                <div key={f}>
                  <label className="text-[11px] text-text-2 font-mono block mb-1">
                    {f}
                  </label>
                  <div className="h-9 rounded-lg bg-ink-2 border border-[rgba(255,255,255,0.07)] px-3 flex items-center text-text-1 text-xs">
                    &mdash;
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
