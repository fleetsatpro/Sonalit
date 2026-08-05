import { makeCDSPage } from './CDSDataPage.js';

export const CDSShipments = makeCDSPage({
  title: 'Shipments', subtitle: 'SHIPMENT LIFECYCLE MANAGEMENT',
  kpis: [
    { label: 'TOTAL SHIPMENTS', value: '218', delta: '+14 this week', up: true },
    { label: 'IN TRANSIT', value: '54', delta: '+3', up: true },
    { label: 'DELIVERED', value: '156', delta: '+12%', up: true },
    { label: 'DELAYED', value: '8', delta: '-2', up: true },
  ],
  columns: [
    { key: 'id', label: 'SHIPMENT ID', mono: true },
    { key: 'customer', label: 'CUSTOMER' },
    { key: 'container', label: 'CONTAINER', mono: true },
    { key: 'status', label: 'STATUS' },
    { key: 'vehicle', label: 'VEHICLE', mono: true },
    { key: 'driver', label: 'DRIVER' },
    { key: 'destination', label: 'DESTINATION' },
    { key: 'eta', label: 'ETA', mono: true },
  ],
  statusKey: 'status',
  rows: [
    { id: 'SHP-2026-001', customer: 'Kenya Coffee Board', container: 'TGHU3456789', status: 'in_transit', vehicle: 'KDK 456P', driver: 'John Kamau', destination: 'Mombasa Port', eta: '18:40' },
    { id: 'SHP-2026-002', customer: 'KTDA Holdings', container: 'MSCU7712340', status: 'delivered', vehicle: 'KBZ 902L', driver: 'Peter Otieno', destination: 'Mombasa Port', eta: 'Arrived' },
    { id: 'SHP-2026-003', customer: 'Sian Roses', container: 'CMAU5581223', status: 'delayed', vehicle: 'KDA 112B', driver: 'Grace Wanjiru', destination: 'JKIA Cargo', eta: '21:10' },
    { id: 'SHP-2026-004', customer: 'Kakuzi PLC', container: 'HLXU9903312', status: 'in_transit', vehicle: 'KCE 771D', driver: 'Samuel Kiptoo', destination: 'Mombasa Port', eta: '23:05' },
    { id: 'SHP-2026-005', customer: 'EPZ Textiles', container: 'OOCL2261890', status: 'in_transit', vehicle: 'KDG 330F', driver: 'Alice Njeri', destination: 'Mombasa Port', eta: '19:50' },
    { id: 'SHP-2026-006', customer: 'Kenya Coffee Board', container: '—', status: 'created', vehicle: '—', driver: '—', destination: 'Mombasa Port', eta: 'Not dispatched' },
    { id: 'SHP-2026-007', customer: 'Sasini PLC', container: 'CSNU8834221', status: 'closed', vehicle: 'KBW 556J', driver: 'Dennis Mwangi', destination: 'Mombasa Port', eta: 'Arrived' },
    { id: 'SHP-2026-008', customer: 'KTDA Holdings', container: 'EGLV1129003', status: 'in_transit', vehicle: 'KDF 887M', driver: 'Faith Chebet', destination: 'Mombasa Port', eta: '20:30' },
  ],
});

export const CDSLive = makeCDSPage({
  title: 'Live Tracking', subtitle: 'REAL-TIME FLEET TRACKING',
  kpis: [
    { label: 'VEHICLES ONLINE', value: '47', delta: '+5', up: true },
    { label: 'AVG SPEED', value: '62 km/h' },
    { label: 'GEOFENCE ALERTS', value: '3', delta: '-1', up: true },
  ],
  columns: [
    { key: 'vehicle', label: 'VEHICLE', mono: true },
    { key: 'driver', label: 'DRIVER' },
    { key: 'status', label: 'STATUS' },
    { key: 'speed', label: 'SPEED' },
    { key: 'location', label: 'LOCATION' },
    { key: 'heading', label: 'HEADING' },
    { key: 'lastPing', label: 'LAST PING', mono: true },
  ],
  statusKey: 'status',
  rows: [
    { vehicle: 'KDK 456P', driver: 'John Kamau', status: 'active', speed: '78 km/h', location: 'A8, Mariakani', heading: 'SE', lastPing: '12s ago' },
    { vehicle: 'KDA 112B', driver: 'Grace Wanjiru', status: 'active', speed: '45 km/h', location: 'B3, Naivasha', heading: 'E', lastPing: '8s ago' },
    { vehicle: 'KCE 771D', driver: 'Samuel Kiptoo', status: 'active', speed: '82 km/h', location: 'A104, Nakuru', heading: 'S', lastPing: '5s ago' },
    { vehicle: 'KDG 330F', driver: 'Alice Njeri', status: 'active', speed: '65 km/h', location: 'Mombasa Rd', heading: 'SE', lastPing: '15s ago' },
    { vehicle: 'KBZ 902L', driver: 'Peter Otieno', status: 'idle', speed: '0 km/h', location: 'Mombasa Port', heading: '—', lastPing: '2m ago' },
  ],
});

export const CDSContainers = makeCDSPage({
  title: 'Containers', subtitle: 'CHAIN-OF-CUSTODY TRACKING',
  kpis: [
    { label: 'TOTAL CONTAINERS', value: '128' },
    { label: 'IN TRANSIT', value: '54', delta: '+3', up: true },
    { label: 'AT PORT', value: '32' },
    { label: 'AT DEPOT', value: '42' },
  ],
  columns: [
    { key: 'id', label: 'CONTAINER ID', mono: true },
    { key: 'status', label: 'STATUS' },
    { key: 'lock', label: 'E-LOCK', mono: true },
    { key: 'vehicle', label: 'VEHICLE', mono: true },
    { key: 'origin', label: 'ORIGIN' },
    { key: 'destination', label: 'DESTINATION' },
    { key: 'custody', label: 'CUSTODY' },
  ],
  statusKey: 'status',
  rows: [
    { id: 'TGHU3456789', status: 'transit', lock: 'SL23891', vehicle: 'KDK 456P', origin: 'Nakuru WH', destination: 'Mombasa Port', custody: 'Driver' },
    { id: 'MSCU7712340', status: 'delivered', lock: 'SL23881', vehicle: 'KBZ 902L', origin: 'Kericho WH', destination: 'Mombasa Port', custody: 'Port Team' },
    { id: 'CMAU5581223', status: 'delayed', lock: 'SL24410', vehicle: 'KDA 112B', origin: 'Naivasha WH', destination: 'JKIA Cargo', custody: 'Driver' },
    { id: 'HLXU9903312', status: 'transit', lock: 'SL24118', vehicle: 'KCE 771D', origin: 'Eldoret WH', destination: 'Mombasa Port', custody: 'Driver' },
    { id: 'OOCL2261890', status: 'transit', lock: 'SL23977', vehicle: 'KDG 330F', origin: 'Thika WH', destination: 'Mombasa Port', custody: 'Driver' },
    { id: 'CSNU8834221', status: 'closed', lock: 'SL23652', vehicle: 'KBW 556J', origin: "Murang'a WH", destination: 'Mombasa Port', custody: 'Released' },
  ],
});

export const CDSLocks = makeCDSPage({
  title: 'E-Locks', subtitle: 'FLEET LOCK HEALTH',
  kpis: [
    { label: 'TOTAL LOCKS', value: '112' },
    { label: 'ONLINE', value: '104', delta: '-2', up: false },
    { label: 'LOW BATTERY', value: '6', delta: '+1', up: false },
    { label: 'TAMPER ALERTS', value: '1', delta: '-1', up: true },
  ],
  columns: [
    { key: 'id', label: 'LOCK ID', mono: true },
    { key: 'battery', label: 'BATTERY' },
    { key: 'signal', label: 'SIGNAL' },
    { key: 'container', label: 'CONTAINER', mono: true },
    { key: 'truck', label: 'TRUCK', mono: true },
    { key: 'heartbeat', label: 'HEARTBEAT', mono: true },
    { key: 'location', label: 'LOCATION' },
    { key: 'tamper', label: 'TAMPER' },
  ],
  statusKey: 'signal',
  rows: [
    { id: 'SL23891', battery: '88%', signal: 'strong', container: 'TGHU3456789', truck: 'KDK 456P', heartbeat: '12s ago', location: 'A8, Mariakani', tamper: 'Normal' },
    { id: 'SL23881', battery: '95%', signal: 'strong', container: '—', truck: '—', heartbeat: '2m ago', location: 'Mombasa Port Gate 4', tamper: 'Normal' },
    { id: 'SL24410', battery: '34%', signal: 'weak', container: 'CMAU5581223', truck: 'KDA 112B', heartbeat: '6m ago', location: 'B3, Naivasha', tamper: 'Alert' },
    { id: 'SL24118', battery: '61%', signal: 'strong', container: 'HLXU9903312', truck: 'KCE 771D', heartbeat: '40s ago', location: 'A104, Nakuru', tamper: 'Normal' },
    { id: 'SL23977', battery: '72%', signal: 'medium', container: 'OOCL2261890', truck: 'KDG 330F', heartbeat: '1m ago', location: 'Mombasa Rd', tamper: 'Normal' },
    { id: 'SL23652', battery: '11%', signal: 'offline', container: '—', truck: '—', heartbeat: '3h ago', location: 'Unknown', tamper: 'Normal' },
    { id: 'SL24290', battery: '47%', signal: 'medium', container: 'EGLV1129003', truck: 'KDF 887M', heartbeat: '3m ago', location: 'A8, Voi', tamper: 'Normal' },
    { id: 'SL23555', battery: '100%', signal: 'strong', container: '—', truck: '—', heartbeat: '8s ago', location: 'Nakuru Depot', tamper: 'Normal' },
  ],
});

export const CDSDrivers = makeCDSPage({
  title: 'Drivers', subtitle: 'FIELD TEAM ROSTER',
  kpis: [
    { label: 'TOTAL DRIVERS', value: '86' },
    { label: 'ON DUTY', value: '42' },
    { label: 'AVAILABLE', value: '31' },
    { label: 'OFF DUTY', value: '13' },
  ],
  columns: [
    { key: 'name', label: 'NAME' },
    { key: 'status', label: 'STATUS' },
    { key: 'phone', label: 'PHONE', mono: true },
    { key: 'vehicle', label: 'VEHICLE', mono: true },
    { key: 'license', label: 'LICENSE', mono: true },
    { key: 'trips', label: 'TRIPS' },
    { key: 'rating', label: 'RATING' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'John Kamau', status: 'active', phone: '+254 712 xxx', vehicle: 'KDK 456P', license: 'DL-45891', trips: '342', rating: '4.8' },
    { name: 'Peter Otieno', status: 'idle', phone: '+254 723 xxx', vehicle: 'KBZ 902L', license: 'DL-33210', trips: '289', rating: '4.6' },
    { name: 'Grace Wanjiru', status: 'active', phone: '+254 735 xxx', vehicle: 'KDA 112B', license: 'DL-51024', trips: '198', rating: '4.9' },
    { name: 'Samuel Kiptoo', status: 'active', phone: '+254 741 xxx', vehicle: 'KCE 771D', license: 'DL-28776', trips: '256', rating: '4.7' },
    { name: 'Alice Njeri', status: 'active', phone: '+254 756 xxx', vehicle: 'KDG 330F', license: 'DL-39922', trips: '174', rating: '4.5' },
    { name: 'Dennis Mwangi', status: 'inactive', phone: '+254 768 xxx', vehicle: '—', license: 'DL-42110', trips: '421', rating: '4.4' },
    { name: 'Faith Chebet', status: 'active', phone: '+254 779 xxx', vehicle: 'KDF 887M', license: 'DL-55432', trips: '112', rating: '4.8' },
  ],
});

export const CDSVehicles = makeCDSPage({
  title: 'Vehicles', subtitle: 'FLEET VEHICLE MANAGEMENT',
  kpis: [
    { label: 'TOTAL VEHICLES', value: '64' },
    { label: 'OPERATIONAL', value: '54' },
    { label: 'MAINTENANCE', value: '7' },
    { label: 'DECOMMISSIONED', value: '3' },
  ],
  columns: [
    { key: 'reg', label: 'REGISTRATION', mono: true },
    { key: 'status', label: 'STATUS' },
    { key: 'type', label: 'TYPE' },
    { key: 'driver', label: 'ASSIGNED DRIVER' },
    { key: 'mileage', label: 'MILEAGE' },
    { key: 'service', label: 'NEXT SERVICE' },
  ],
  statusKey: 'status',
  rows: [
    { reg: 'KDK 456P', status: 'active', type: 'Trailer', driver: 'John Kamau', mileage: '142,300 km', service: 'Aug 20' },
    { reg: 'KBZ 902L', status: 'idle', type: 'Trailer', driver: 'Peter Otieno', mileage: '198,500 km', service: 'Aug 15' },
    { reg: 'KDA 112B', status: 'active', type: 'Flatbed', driver: 'Grace Wanjiru', mileage: '87,200 km', service: 'Sep 1' },
    { reg: 'KCE 771D', status: 'active', type: 'Trailer', driver: 'Samuel Kiptoo', mileage: '156,800 km', service: 'Aug 25' },
    { reg: 'KDG 330F', status: 'active', type: 'Trailer', driver: 'Alice Njeri', mileage: '91,100 km', service: 'Sep 10' },
    { reg: 'KBW 556J', status: 'inactive', type: 'Flatbed', driver: '—', mileage: '234,000 km', service: 'Overdue' },
  ],
});

export const CDSTransporters = makeCDSPage({
  title: 'Transporters', subtitle: 'CONTRACTED PARTNERS',
  columns: [
    { key: 'name', label: 'COMPANY' },
    { key: 'status', label: 'STATUS' },
    { key: 'vehicles', label: 'VEHICLES' },
    { key: 'drivers', label: 'DRIVERS' },
    { key: 'activeTrips', label: 'ACTIVE TRIPS' },
    { key: 'onTime', label: 'ON-TIME %' },
    { key: 'rating', label: 'RATING' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'Kentrans Logistics', status: 'active', vehicles: '18', drivers: '24', activeTrips: '12', onTime: '94%', rating: '4.7' },
    { name: 'Swift Cargo', status: 'active', vehicles: '22', drivers: '30', activeTrips: '15', onTime: '91%', rating: '4.5' },
    { name: 'Rift Transporters', status: 'active', vehicles: '14', drivers: '18', activeTrips: '8', onTime: '88%', rating: '4.3' },
    { name: 'Coastal Freight', status: 'active', vehicles: '10', drivers: '14', activeTrips: '6', onTime: '96%', rating: '4.8' },
  ],
});

export const CDSCustomers = makeCDSPage({
  title: 'Customers', subtitle: 'CUSTOMER MANAGEMENT',
  columns: [
    { key: 'name', label: 'CUSTOMER' },
    { key: 'status', label: 'STATUS' },
    { key: 'shipments', label: 'SHIPMENTS' },
    { key: 'containers', label: 'CONTAINERS' },
    { key: 'commodity', label: 'COMMODITY' },
    { key: 'contact', label: 'CONTACT' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'Kenya Coffee Board', status: 'active', shipments: '48', containers: '52', commodity: 'Coffee', contact: '+254 20 xxx' },
    { name: 'KTDA Holdings', status: 'active', shipments: '36', containers: '40', commodity: 'Tea', contact: '+254 20 xxx' },
    { name: 'Sian Roses', status: 'active', shipments: '24', containers: '28', commodity: 'Cut Flowers', contact: '+254 50 xxx' },
    { name: 'Kakuzi PLC', status: 'active', shipments: '18', containers: '20', commodity: 'Avocado', contact: '+254 67 xxx' },
    { name: 'EPZ Textiles', status: 'active', shipments: '12', containers: '14', commodity: 'Textiles', contact: '+254 20 xxx' },
    { name: 'Sasini PLC', status: 'active', shipments: '30', containers: '34', commodity: 'Macadamia', contact: '+254 60 xxx' },
  ],
});

export const CDSDelivery = makeCDSPage({
  title: 'Delivery Operations', subtitle: 'PORT & DESTINATION OPERATIONS',
  kpis: [
    { label: 'PENDING DELIVERIES', value: '12' },
    { label: 'COMPLETED TODAY', value: '8', delta: '+3', up: true },
    { label: 'AVG TURNAROUND', value: '45 min', delta: '-8 min', up: true },
  ],
  columns: [
    { key: 'id', label: 'DELIVERY ID', mono: true },
    { key: 'container', label: 'CONTAINER', mono: true },
    { key: 'status', label: 'STATUS' },
    { key: 'destination', label: 'DESTINATION' },
    { key: 'gate', label: 'GATE' },
    { key: 'arrivalTime', label: 'ARRIVAL', mono: true },
    { key: 'unclampTime', label: 'UNCLAMP', mono: true },
  ],
  statusKey: 'status',
  rows: [
    { id: 'DEL-001', container: 'TGHU3456789', status: 'pending', destination: 'Mombasa Port', gate: 'Gate 4', arrivalTime: '—', unclampTime: '—' },
    { id: 'DEL-002', container: 'MSCU7712340', status: 'completed', destination: 'Mombasa Port', gate: 'Gate 2', arrivalTime: '13:20', unclampTime: '13:54' },
    { id: 'DEL-003', container: 'CMAU5581223', status: 'delayed', destination: 'JKIA Cargo', gate: 'Bay 7', arrivalTime: '—', unclampTime: '—' },
  ],
});

export const CDSGeofences = makeCDSPage({
  title: 'Geofences', subtitle: 'ZONE & CORRIDOR MANAGEMENT',
  columns: [
    { key: 'name', label: 'ZONE NAME' },
    { key: 'type', label: 'TYPE' },
    { key: 'status', label: 'STATUS' },
    { key: 'radius', label: 'RADIUS' },
    { key: 'vehicles', label: 'INSIDE' },
    { key: 'alerts', label: 'ALERTS TODAY' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'Mombasa Port', type: 'Destination', status: 'active', radius: '500m', vehicles: '3', alerts: '0' },
    { name: 'JKIA Cargo', type: 'Destination', status: 'active', radius: '1km', vehicles: '1', alerts: '1' },
    { name: 'Nakuru Depot', type: 'Origin', status: 'active', radius: '200m', vehicles: '5', alerts: '0' },
    { name: 'Mariakani Checkpoint', type: 'Waypoint', status: 'active', radius: '100m', vehicles: '0', alerts: '0' },
    { name: 'A8 Corridor', type: 'Corridor', status: 'active', radius: '2km', vehicles: '8', alerts: '2' },
  ],
});

export const CDSInbox = makeCDSPage({
  title: 'AI Inbox', subtitle: 'WHATSAPP INTAKE · AUTO-EXTRACTION',
  kpis: [
    { label: 'MESSAGES TODAY', value: '47', delta: '+12', up: true },
    { label: 'AUTO-EXTRACTED', value: '38', delta: '81%', up: true },
    { label: 'NEEDS REVIEW', value: '6' },
    { label: 'FAILED', value: '3' },
  ],
  columns: [
    { key: 'time', label: 'TIME', mono: true },
    { key: 'from', label: 'FROM' },
    { key: 'type', label: 'TYPE' },
    { key: 'status', label: 'STATUS' },
    { key: 'confidence', label: 'CONFIDENCE' },
    { key: 'extract', label: 'EXTRACTED DATA' },
  ],
  statusKey: 'status',
  rows: [
    { time: '13:40', from: 'John Kamau', type: 'Clamp photo', status: 'verified', confidence: '99%', extract: 'Lock SL23891 on TGHU3456789' },
    { time: '13:22', from: 'Supervisor', type: 'Status update', status: 'review', confidence: '64%', extract: 'Delayed — road works near Voi' },
    { time: '12:58', from: 'Grace Wanjiru', type: 'GPS share', status: 'verified', confidence: '100%', extract: '-1.28, 36.82 — Naivasha bypass' },
    { time: '12:00', from: 'System', type: 'Excel sync', status: 'completed', confidence: '100%', extract: '14 records synchronized' },
    { time: '11:42', from: 'Port Team A', type: 'Arrival photo', status: 'verified', confidence: '98%', extract: 'MSCU7712340 at Gate 4' },
  ],
});

export const CDSIncidents = makeCDSPage({
  title: 'Incidents', subtitle: 'INCIDENT TRACKING & RESOLUTION',
  kpis: [
    { label: 'OPEN INCIDENTS', value: '4' },
    { label: 'RESOLVED TODAY', value: '2', delta: '+1', up: true },
    { label: 'CRITICAL', value: '1' },
  ],
  columns: [
    { key: 'id', label: 'INCIDENT ID', mono: true },
    { key: 'type', label: 'TYPE' },
    { key: 'status', label: 'STATUS' },
    { key: 'severity', label: 'SEVERITY' },
    { key: 'vehicle', label: 'VEHICLE', mono: true },
    { key: 'description', label: 'DESCRIPTION' },
    { key: 'reported', label: 'REPORTED', mono: true },
  ],
  statusKey: 'status',
  rows: [
    { id: 'INC-041', type: 'Tamper alert', status: 'active', severity: 'critical', vehicle: 'KDA 112B', description: 'Lock SL24410 tamper detected', reported: '11:30' },
    { id: 'INC-040', type: 'Route deviation', status: 'active', severity: 'medium', vehicle: 'KDF 887M', description: 'Deviated 4km from planned route', reported: '10:15' },
    { id: 'INC-039', type: 'Late delivery', status: 'resolved', severity: 'low', vehicle: 'KBZ 902L', description: '45min late — traffic on Mombasa Rd', reported: '09:22' },
    { id: 'INC-038', type: 'Lock offline', status: 'resolved', severity: 'medium', vehicle: '—', description: 'SL23652 no heartbeat for 3h', reported: '08:00' },
  ],
});

export const CDSAlerts = makeCDSPage({
  title: 'Alerts', subtitle: 'SYSTEM & OPERATIONAL ALERTS',
  columns: [
    { key: 'time', label: 'TIME', mono: true },
    { key: 'type', label: 'TYPE' },
    { key: 'severity', label: 'SEVERITY' },
    { key: 'status', label: 'STATUS' },
    { key: 'source', label: 'SOURCE' },
    { key: 'message', label: 'MESSAGE' },
  ],
  statusKey: 'severity',
  rows: [
    { time: '13:41', type: 'Tamper', severity: 'critical', status: 'Active', source: 'SL24410', message: 'Tamper sensor triggered on active lock' },
    { time: '12:30', type: 'Geofence', severity: 'warning', status: 'Active', source: 'KDF 887M', message: 'Exited A8 Corridor geofence' },
    { time: '11:00', type: 'Battery', severity: 'warning', status: 'Active', source: 'SL23652', message: 'Battery at 11% — no solar charging' },
    { time: '09:15', type: 'ETA', severity: 'info', status: 'Resolved', source: 'KBZ 902L', message: 'ETA revised — 45min delay' },
    { time: '08:30', type: 'System', severity: 'info', status: 'Resolved', source: 'Platform', message: 'Scheduled sync completed' },
  ],
});

export const CDSDocuments = makeCDSPage({
  title: 'Documents', subtitle: 'DOCUMENT MANAGEMENT',
  columns: [
    { key: 'name', label: 'DOCUMENT' },
    { key: 'type', label: 'TYPE' },
    { key: 'status', label: 'STATUS' },
    { key: 'shipment', label: 'SHIPMENT', mono: true },
    { key: 'uploaded', label: 'UPLOADED', mono: true },
    { key: 'uploadedBy', label: 'BY' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'Bill of Lading — SHP-001', type: 'BOL', status: 'verified', shipment: 'SHP-2026-001', uploaded: 'Aug 5', uploadedBy: 'System' },
    { name: 'Customs Declaration — SHP-002', type: 'Customs', status: 'verified', shipment: 'SHP-2026-002', uploaded: 'Aug 4', uploadedBy: 'Port Team' },
    { name: 'Weight Certificate — SHP-003', type: 'Certificate', status: 'pending', shipment: 'SHP-2026-003', uploaded: 'Aug 5', uploadedBy: 'Grace W.' },
    { name: 'Insurance Certificate', type: 'Insurance', status: 'approved', shipment: 'SHP-2026-004', uploaded: 'Aug 3', uploadedBy: 'Admin' },
    { name: 'Phytosanitary Cert — SHP-005', type: 'Certificate', status: 'verified', shipment: 'SHP-2026-005', uploaded: 'Aug 5', uploadedBy: 'KEPHIS' },
  ],
});

export const CDSReports = makeCDSPage({
  title: 'Reports', subtitle: 'GENERATE & EXPORT',
  columns: [
    { key: 'name', label: 'REPORT' },
    { key: 'type', label: 'TYPE' },
    { key: 'period', label: 'PERIOD' },
    { key: 'status', label: 'STATUS' },
    { key: 'generated', label: 'GENERATED', mono: true },
    { key: 'format', label: 'FORMAT' },
  ],
  statusKey: 'status',
  rows: [
    { name: 'Daily Operations Summary', type: 'Operations', period: 'Aug 5', status: 'completed', generated: '06:00', format: 'PDF' },
    { name: 'Weekly Fleet Report', type: 'Fleet', period: 'Jul 29 — Aug 4', status: 'completed', generated: 'Aug 4', format: 'PDF' },
    { name: 'Monthly Analytics', type: 'Analytics', period: 'July 2026', status: 'completed', generated: 'Aug 1', format: 'Excel' },
    { name: 'Customer Billing', type: 'Finance', period: 'July 2026', status: 'processing', generated: '—', format: 'PDF' },
    { name: 'Incident Report', type: 'Security', period: 'Aug 5', status: 'draft', generated: '—', format: 'PDF' },
  ],
});

export const CDSAnalytics = makeCDSPage({
  title: 'Analytics', subtitle: 'FLEET PERFORMANCE, LAST 30 DAYS',
  kpis: [
    { label: 'TOTAL DELIVERIES', value: '412', delta: '+18%', up: true },
    { label: 'ON-TIME RATE', value: '91.2%', delta: '+2.1%', up: true },
    { label: 'AVG TRANSIT TIME', value: '5h 48m', delta: '-22min', up: true },
    { label: 'INCIDENTS', value: '14', delta: '-3', up: true },
  ],
  columns: [
    { key: 'metric', label: 'METRIC' },
    { key: 'current', label: 'CURRENT' },
    { key: 'previous', label: 'PREVIOUS' },
    { key: 'change', label: 'CHANGE' },
    { key: 'trend', label: 'TREND' },
  ],
  statusKey: 'trend',
  rows: [
    { metric: 'Deliveries per day', current: '13.7', previous: '11.6', change: '+18%', trend: 'active' },
    { metric: 'On-time delivery rate', current: '91.2%', previous: '89.1%', change: '+2.1%', trend: 'active' },
    { metric: 'Average transit time', current: '5h 48m', previous: '6h 10m', change: '-22min', trend: 'active' },
    { metric: 'Lock tamper events', current: '2', previous: '5', change: '-60%', trend: 'active' },
    { metric: 'Customer satisfaction', current: '4.6/5', previous: '4.4/5', change: '+0.2', trend: 'active' },
    { metric: 'Fuel efficiency', current: '8.2 km/L', previous: '7.9 km/L', change: '+3.8%', trend: 'active' },
  ],
});

export const CDSAudit = makeCDSPage({
  title: 'Audit Logs', subtitle: 'COMPLETE AUDIT TRAIL',
  columns: [
    { key: 'timestamp', label: 'TIMESTAMP', mono: true },
    { key: 'user', label: 'USER' },
    { key: 'action', label: 'ACTION' },
    { key: 'resource', label: 'RESOURCE' },
    { key: 'details', label: 'DETAILS' },
    { key: 'ip', label: 'IP', mono: true },
  ],
  rows: [
    { timestamp: '13:54:22', user: 'Port Team A', action: 'Lock removed', resource: 'SL23881', details: 'Unclamp at Gate 4', ip: '41.89.xx' },
    { timestamp: '13:40:11', user: 'AI Extract v4', action: 'Data extracted', resource: 'MSG-4721', details: 'WhatsApp message parsed', ip: 'System' },
    { timestamp: '13:20:05', user: 'System', action: 'Geofence enter', resource: 'MSCU7712340', details: 'Entered Mombasa Port zone', ip: 'System' },
    { timestamp: '12:00:00', user: 'System', action: 'Sync completed', resource: 'Excel Import', details: '14 records synchronized', ip: 'System' },
    { timestamp: '11:42:33', user: 'GPS Beacon', action: 'Checkpoint', resource: 'KDK 456P', details: 'A8, Mariakani waypoint', ip: 'System' },
    { timestamp: '09:18:12', user: 'System', action: 'Trip started', resource: 'KDK 456P', details: 'Auto-logged departure', ip: 'System' },
    { timestamp: '09:17:44', user: 'John Kamau', action: 'Lock clamped', resource: 'SL23891', details: '99% confidence via WhatsApp', ip: '41.89.xx' },
  ],
});

export const CDSSettings = makeCDSPage({
  title: 'Settings', subtitle: 'ACCOUNT & PLATFORM PREFERENCES',
  columns: [
    { key: 'setting', label: 'SETTING' },
    { key: 'category', label: 'CATEGORY' },
    { key: 'value', label: 'CURRENT VALUE' },
    { key: 'status', label: 'STATUS' },
  ],
  statusKey: 'status',
  rows: [
    { setting: 'WhatsApp AI extraction', category: 'AI', value: 'Enabled', status: 'active' },
    { setting: 'Auto-sync interval', category: 'Integration', value: 'Every 60 min', status: 'active' },
    { setting: 'Lock heartbeat threshold', category: 'Alerts', value: '5 minutes', status: 'active' },
    { setting: 'Tamper alert escalation', category: 'Security', value: 'Immediate', status: 'active' },
    { setting: 'Geofence buffer', category: 'Tracking', value: '100m', status: 'active' },
    { setting: 'Report auto-generation', category: 'Reports', value: 'Daily at 06:00', status: 'active' },
    { setting: 'Customer portal access', category: 'Access', value: 'Enabled', status: 'active' },
  ],
});
