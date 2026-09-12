const ICON_FILE: Record<string, string> = {
  'Command Center': 'command-center',
  'GPS Live': 'gps-live',
  'Ops Replay': 'ops-replay',
  'Panic Center': 'panic-center',
  'Messages': 'messages',
  'AI Decision': 'ai-decision',
  'Copilot': 'copilot',
  'Alerts & Incidents': 'alerts-incidents',
  'Signal Integrity': 'signal-integrity',
  'Risk Intel': 'risk-intel',
  'Guardian AI': 'guardian-ai',
  'Geofences': 'geofences',
  '4D Geofence': '4d-geofence',
  'Rules': 'rules',
  'Route Safety': 'route-safety',
  'Covert Captures': 'covert-captures',
  'Incident Replay': 'incident-replay',
  '3D Drive Replay': '3d-drive-replay',
  'Guardian AI Surv': 'guardian-ai-surv',
  'Convoys': 'convoys',
  'Handover': 'handover',
  'Fleet': 'fleet',
  'Drivers': 'drivers',
  'Field Officers': 'field-officers',
  'Devices': 'devices',
  'Fuel': 'fuel',
  'Maintenance': 'maintenance',
  'Shifts': 'settings',
  'Shipments': 'shipments',
  'Cargo Portal': 'cargo-portal',
  'Analytics': 'analytics',
  'Reports': 'reports',
  'Convoy Reports': 'convoy-reports',
  'Finance': 'finance',
  'Claims': 'claims',
  'Executive': 'executive',
  'Settings': 'settings',
  'Container Management': 'container',
};

export function meridianIconSrc(name: string, group: string): string {
  let key = name;
  if (name === 'Guardian AI' && group === 'Surveillance') key = 'Guardian AI Surv';
  const file = ICON_FILE[key] ?? ICON_FILE[name] ?? 'command-center';
  return `/icons/${file}.png`;
}
