import React, { useState } from 'react';
import { Card, KPICard, Button, Badge, StatusBadge, RiskBadge, ProgressBar, DataTable, FilterChip, DrawerField } from './components.js';
import { useTrips, useContainers, useLocks, useVehicles, useDrivers, useCustomers, useTransporters, useAlerts, useIncidents, useDocuments, useReports, useAuditLogs, useGeofences, useAcknowledgeAlert } from './hooks.js';
import { useCDSStore } from './store.js';

function PageShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5">
        <h1 className="text-[22px] font-extrabold text-white">{title}</h1>
        <p className="text-xs text-text-2 mt-1 font-mono tracking-[.08em]">{sub}</p>
      </div>
      {children}
    </div>
  );
}

const sevVariant = (s: string): 'ok' | 'warn' | 'bad' | 'neutral' =>
  s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'neutral';

/* 1 ----------------------------------------------------------------- */
export function CDSShipments() {
  const { data } = useTrips();
  const rows = data?.data ?? [];
  const { openDrawer } = useCDSStore();
  return (
    <PageShell title="Shipments" sub="SHIPMENT LIFECYCLE MANAGEMENT">
      <DataTable
        columns={[
          { id: 'ref', header: 'Reference', accessor: (r) => <span className="font-mono">{r.reference}</span> },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'customer', header: 'Customer', accessor: (r) => r.customerName },
          { id: 'driver', header: 'Driver', accessor: (r) => r.driverName ?? '—' },
          { id: 'route', header: 'Origin → Destination', accessor: (r) => `${r.origin} → ${r.destination}` },
          { id: 'eta', header: 'ETA', accessor: (r) => <span className="font-mono">{r.eta ?? '—'}</span> },
          { id: 'progress', header: 'Progress', accessor: (r) => <ProgressBar value={r.progress} /> },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
        onRowClick={(r) => openDrawer(`Shipment ${r.reference}`, (
          <>
            <DrawerField label="Status" value={<StatusBadge status={r.status} />} />
            <DrawerField label="Customer" value={r.customerName} />
            <DrawerField label="Driver" value={r.driverName ?? '—'} />
            <DrawerField label="Origin" value={r.origin} />
            <DrawerField label="Destination" value={r.destination} />
            <DrawerField label="ETA" value={r.eta ?? '—'} />
            <DrawerField label="Commodity" value={r.commodity} />
            <DrawerField label="Weight" value={`${r.weight} kg`} />
          </>
        ))}
      />
    </PageShell>
  );
}

/* 2 ----------------------------------------------------------------- */
export function CDSContainers() {
  const { data } = useContainers();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Containers" sub="CHAIN-OF-CUSTODY TRACKING">
      <DataTable
        columns={[
          { id: 'number', header: 'Number', accessor: (r) => <span className="font-mono">{r.number}</span> },
          { id: 'iso', header: 'ISO Type', accessor: (r) => r.isoType },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'vehicle', header: 'Current Vehicle', accessor: (r) => r.currentVehicleId ?? '—' },
          { id: 'lock', header: 'Current Lock', accessor: (r) => r.currentLockId ?? '—' },
          { id: 'weight', header: 'Weight', accessor: (r) => `${r.maxWeight} kg` },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 3 ----------------------------------------------------------------- */
export function CDSLocks() {
  const { data } = useLocks();
  const rows = data?.data ?? [];
  return (
    <PageShell title="E-Locks" sub="FLEET LOCK HEALTH">
      <DataTable
        columns={[
          { id: 'serial', header: 'Serial', accessor: (r) => <span className="font-mono">{r.serial}</span> },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'battery', header: 'Battery', accessor: (r) => <ProgressBar value={r.batteryLevel} /> },
          { id: 'signal', header: 'Signal Strength', accessor: (r) => r.signalStrength },
          { id: 'container', header: 'Container', accessor: (r) => r.containerNumber ?? '—' },
          { id: 'heartbeat', header: 'Last Heartbeat', accessor: (r) => <span className="font-mono">{r.lastHeartbeat}</span> },
          { id: 'tamper', header: 'Tamper', accessor: (r) => <RiskBadge risk={r.tamperDetected ? 'high' : 'low'} /> },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 4 ----------------------------------------------------------------- */
export function CDSLive() {
  const { data } = useTrips({ status: 'in_transit' });
  const rows = data?.data ?? [];
  return (
    <PageShell title="Live Operations" sub="REAL-TIME FLEET TRACKING">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <Card className="p-8 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <p className="text-text-1 text-sm font-semibold">Live Operations Map</p>
            <p className="text-text-2 text-xs mt-2">Map view &mdash; GPS integration required</p>
          </div>
        </Card>
        <div className="space-y-2 overflow-y-auto max-h-[500px]">
          {rows.map((t) => (
            <Card key={t.id} className="p-3">
              <p className="text-xs font-semibold text-text-0">{t.reference}</p>
              <p className="text-[11px] text-text-2 mt-1">{t.origin} &rarr; {t.destination}</p>
              <div className="mt-1.5"><StatusBadge status={t.status} /></div>
            </Card>
          ))}
          {rows.length === 0 && <p className="text-text-2 text-xs p-3">No active trips.</p>}
        </div>
      </div>
    </PageShell>
  );
}

/* 5 ----------------------------------------------------------------- */
export function CDSVehicles() {
  const { data } = useVehicles();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Vehicles" sub="FLEET VEHICLE MANAGEMENT">
      <DataTable
        columns={[
          { id: 'reg', header: 'Registration', accessor: (r) => <span className="font-mono">{r.registration}</span> },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          { id: 'make', header: 'Make/Model', accessor: (r) => `${r.make} ${r.model}` },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'transporter', header: 'Transporter', accessor: (r) => r.transporterName },
          { id: 'fuel', header: 'Fuel Level', accessor: (r) => <ProgressBar value={r.fuelLevel ?? 0} /> },
          { id: 'odo', header: 'Odometer', accessor: (r) => `${r.odometer.toLocaleString()} km` },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 6 ----------------------------------------------------------------- */
export function CDSDrivers() {
  const { data } = useDrivers();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Drivers" sub="FIELD TEAM ROSTER">
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'phone', header: 'Phone', accessor: (r) => r.phone },
          { id: 'license', header: 'License', accessor: (r) => <span className="font-mono">{r.licenseNumber}</span> },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'transporter', header: 'Transporter', accessor: (r) => r.transporterName },
          { id: 'rating', header: 'Rating', accessor: (r) => <span className="text-cds-amber">{'★'.repeat(Math.round(r.rating))} {r.rating}</span> },
          { id: 'trips', header: 'Total Trips', accessor: (r) => r.totalTrips },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 7 ----------------------------------------------------------------- */
export function CDSTransporters() {
  const { data } = useTransporters();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Transporters" sub="CONTRACTED PARTNERS">
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'contact', header: 'Contact', accessor: (r) => r.contactPerson },
          { id: 'phone', header: 'Phone', accessor: (r) => r.phone },
          { id: 'fleet', header: 'Fleet Size', accessor: (r) => r.totalTrucks },
          { id: 'trips', header: 'Active Trips', accessor: (r) => r.activeTrips },
          { id: 'ontime', header: 'On-Time Rate', accessor: (r) => <ProgressBar value={r.onTimeRate} /> },
          { id: 'rating', header: 'Rating', accessor: (r) => <span className="text-cds-amber">{'★'} {r.rating}</span> },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 8 ----------------------------------------------------------------- */
export function CDSCustomers() {
  const { data } = useCustomers();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Customers" sub="CUSTOMER MANAGEMENT">
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'code', header: 'Code', accessor: (r) => <span className="font-mono">{r.code}</span> },
          { id: 'contact', header: 'Contact Person', accessor: (r) => r.contactPerson },
          { id: 'phone', header: 'Phone', accessor: (r) => r.phone },
          { id: 'active', header: 'Active Shipments', accessor: (r) => r.activeShipments },
          { id: 'sla', header: 'SLA Compliance', accessor: (r) => <ProgressBar value={r.slaCompliance} /> },
          { id: 'rating', header: 'Rating', accessor: (r) => <span className="text-cds-amber">{'★'} {r.rating}</span> },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 9 ----------------------------------------------------------------- */
export function CDSDelivery() {
  const { data } = useTrips();
  const all = data?.data ?? [];
  const rows = all.filter((r) => r.status === 'delivered' || r.status === 'unlock_authorized' || r.status === 'arrived');
  const queue = all.filter((r) => r.status === 'arrived' || r.status === 'unlock_authorized').length;
  const completed = all.filter((r) => r.status === 'delivered').length;
  const returned = all.filter((r) => r.status === 'container_returned').length;
  return (
    <PageShell title="Delivery Operations" sub="PORT & DESTINATION OPERATIONS">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPICard label="QUEUE" value={String(queue)} delta="pending" trend="up" />
        <KPICard label="COMPLETED" value={String(completed)} delta="delivered" trend="up" />
        <KPICard label="RETURNED" value={String(returned)} delta="containers" trend="up" />
      </div>
      <DataTable
        columns={[
          { id: 'ref', header: 'Reference', accessor: (r) => <span className="font-mono">{r.reference}</span> },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'customer', header: 'Customer', accessor: (r) => r.customerName },
          { id: 'dest', header: 'Destination', accessor: (r) => r.destination },
          { id: 'actions', header: 'Actions', accessor: () => <Button size="sm" variant="ghost">View</Button> },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 10 ---------------------------------------------------------------- */
export function CDSGeofences() {
  const { data } = useGeofences();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Geofences" sub="ZONE & CORRIDOR MANAGEMENT">
      <Card className="p-6 mb-4 text-center">
        <p className="text-text-1 text-sm font-semibold">Map View</p>
        <p className="text-text-2 text-xs mt-1">Geofence visualization &mdash; mapping integration required</p>
      </Card>
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          { id: 'cat', header: 'Category', accessor: (r) => r.category },
          { id: 'active', header: 'Active', accessor: (r) => <Badge variant={r.active ? 'ok' : 'bad'}>{r.active ? 'YES' : 'NO'}</Badge> },
          { id: 'created', header: 'Created', accessor: (r) => r.createdAt },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 11 ---------------------------------------------------------------- */
export function CDSInbox() {
  return (
    <PageShell title="AI Inbox" sub="WHATSAPP AI EXTRACTION">
      <Card className="p-8">
        <h2 className="text-base font-bold text-text-0 mb-2">WhatsApp AI Extraction Integration</h2>
        <p className="text-sm text-text-2 leading-relaxed">
          Connect your WhatsApp Business API to enable automatic data extraction from driver messages,
          photos, and location shares. The AI engine parses incoming messages, extracts shipment data,
          and creates or updates records automatically.
        </p>
      </Card>
    </PageShell>
  );
}

/* 12 ---------------------------------------------------------------- */
export function CDSIncidents() {
  const { data } = useIncidents();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Incidents" sub="INCIDENT TRACKING & RESOLUTION">
      <DataTable
        columns={[
          { id: 'num', header: 'Incident #', accessor: (r) => <span className="font-mono">{r.id}</span> },
          { id: 'title', header: 'Title', accessor: (r) => r.title },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          { id: 'severity', header: 'Severity', accessor: (r) => <Badge variant={sevVariant(r.severity)}>{r.severity.toUpperCase()}</Badge> },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'assigned', header: 'Assigned To', accessor: (r) => r.assignedTo ?? '—' },
          { id: 'created', header: 'Created', accessor: (r) => r.createdAt },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 13 ---------------------------------------------------------------- */
export function CDSAlerts() {
  const [sev, setSev] = useState<string | null>(null);
  const { data } = useAlerts();
  const ack = useAcknowledgeAlert();
  const all = data?.data ?? [];
  const rows = sev ? all.filter((r) => r.severity === sev) : all;
  return (
    <PageShell title="Alerts" sub="SYSTEM & OPERATIONAL ALERTS">
      <DataTable
        columns={[
          { id: 'title', header: 'Title', accessor: (r) => r.title },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          { id: 'severity', header: 'Severity', accessor: (r) => <Badge variant={sevVariant(r.severity)}>{r.severity.toUpperCase()}</Badge> },
          { id: 'entity', header: 'Entity', accessor: (r) => `${r.entityType}:${r.entityId}` },
          { id: 'acked', header: 'Acknowledged', accessor: (r) => <Badge variant={r.acknowledged ? 'ok' : 'neutral'}>{r.acknowledged ? 'YES' : 'NO'}</Badge> },
          { id: 'created', header: 'Created', accessor: (r) => r.createdAt },
          { id: 'actions', header: '', accessor: (r) => !r.acknowledged ? (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); ack.mutate(r.id); }}>Ack</Button>
          ) : null },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
        filters={
          <>
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
              <FilterChip key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={sev === s} onClick={() => setSev(sev === s ? null : s)} />
            ))}
          </>
        }
      />
    </PageShell>
  );
}

/* 14 ---------------------------------------------------------------- */
export function CDSReports() {
  const { data } = useReports();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Reports" sub="GENERATE & EXPORT">
      <Card className="p-5 mb-4">
        <h2 className="text-sm font-bold text-text-0 mb-3">Generate Report</h2>
        <div className="flex gap-2 flex-wrap">
          {['Daily Summary', 'Weekly Fleet', 'Monthly Analytics', 'Custom'].map((t) => (
            <Button key={t} size="sm" variant="ghost">{t}</Button>
          ))}
        </div>
      </Card>
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r) => r.name },
          { id: 'type', header: 'Type', accessor: (r) => r.type },
          { id: 'format', header: 'Format', accessor: (r) => r.format.toUpperCase() },
          { id: 'status', header: 'Status', accessor: (r) => <StatusBadge status={r.status} /> },
          { id: 'by', header: 'Generated By', accessor: (r) => r.generatedBy },
          { id: 'date', header: 'Date', accessor: (r) => r.generatedAt },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 15 ---------------------------------------------------------------- */
export function CDSAnalytics() {
  return (
    <PageShell title="Analytics" sub="FLEET PERFORMANCE INSIGHTS">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPICard label="TOTAL TRIPS" value="412" delta="+18%" trend="up" sparkline={[30, 45, 40, 60, 55, 70, 65, 80]} />
        <KPICard label="AVG TRANSIT TIME" value="5h 48m" delta="-22min" trend="up" sparkline={[80, 75, 70, 65, 60, 55, 50, 48]} />
        <KPICard label="ON-TIME RATE" value="91.2%" delta="+2.1%" trend="up" sparkline={[85, 86, 88, 87, 89, 90, 91, 91]} />
        <KPICard label="FLEET UTILIZATION" value="84%" delta="+5%" trend="up" sparkline={[70, 72, 75, 78, 80, 82, 83, 84]} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6 min-h-[200px] flex items-center justify-center">
          <p className="text-text-2 text-sm">Delivery Trends Chart</p>
        </Card>
        <Card className="p-6 min-h-[200px] flex items-center justify-center">
          <p className="text-text-2 text-sm">Fleet Utilization Chart</p>
        </Card>
      </div>
    </PageShell>
  );
}

/* 16 ---------------------------------------------------------------- */
export function CDSDocuments() {
  const { data } = useDocuments();
  const rows = (data?.data ?? []) as Record<string, any>[];
  return (
    <PageShell title="Documents" sub="DOCUMENT MANAGEMENT">
      <DataTable
        columns={[
          { id: 'title', header: 'Title', accessor: (r) => r['title'] ?? r['name'] ?? '—' },
          { id: 'type', header: 'Type', accessor: (r) => r['document_type'] ?? '—' },
          { id: 'entity', header: 'Entity Type', accessor: (r) => r['entity_type'] ?? '—' },
          { id: 'size', header: 'File Size', accessor: (r) => r['file_size'] ? `${Math.round(r['file_size'] / 1024)}KB` : '—' },
          { id: 'by', header: 'Uploaded By', accessor: (r) => r['created_by'] ?? '—' },
          { id: 'created', header: 'Created', accessor: (r) => r['created_at'] ?? '—' },
        ]}
        data={rows}
        keyExtractor={(r) => r['id']}
        searchable
      />
    </PageShell>
  );
}

/* 17 ---------------------------------------------------------------- */
export function CDSAudit() {
  const { data } = useAuditLogs();
  const rows = data?.data ?? [];
  return (
    <PageShell title="Audit Logs" sub="COMPLETE AUDIT TRAIL">
      <DataTable
        columns={[
          { id: 'action', header: 'Action', accessor: (r) => r.action },
          { id: 'entityType', header: 'Entity Type', accessor: (r) => r.entityType },
          { id: 'entityId', header: 'Entity ID', accessor: (r) => <span className="font-mono">{r.entityId}</span> },
          { id: 'user', header: 'User', accessor: (r) => r.userName },
          { id: 'ip', header: 'IP Address', accessor: (r) => <span className="font-mono">{r.ipAddress}</span> },
          { id: 'created', header: 'Created', accessor: (r) => r.createdAt },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
        searchable
      />
    </PageShell>
  );
}

/* 18 ---------------------------------------------------------------- */
export function CDSSettings() {
  return (
    <PageShell title="Settings" sub="ACCOUNT & PLATFORM PREFERENCES">
      <div className="space-y-4">
        {([
          { title: 'Profile', fields: ['Company Name', 'Contact Email', 'Phone', 'Address'] },
          { title: 'Notifications', fields: ['Email Alerts', 'SMS Alerts', 'Push Notifications', 'Alert Threshold'] },
          { title: 'Integrations', fields: ['WhatsApp Business API', 'GPS Provider', 'ERP System', 'Port Systems'] },
          { title: 'Security', fields: ['Two-Factor Auth', 'Session Timeout', 'API Key Management', 'Audit Retention'] },
        ]).map((section) => (
          <Card key={section.title} className="p-5">
            <h2 className="text-sm font-bold text-text-0 mb-3">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {section.fields.map((f) => (
                <div key={f}>
                  <label className="text-[11px] text-text-2 font-mono block mb-1">{f}</label>
                  <div className="h-9 rounded-lg bg-ink-2 border border-[rgba(255,255,255,0.07)] px-3 flex items-center text-text-1 text-xs">&mdash;</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
