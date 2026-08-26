const SYM: Record<string, string> = {
  'Command Center': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'GPS Live': '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill-opacity=".3"/>',
  'Ops Replay': '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>',
  'Panic Center': '<path d="M1 21h22L12 2 1 21z"/><rect x="11" y="9" width="2" height="5" rx=".5" fill="#000" fill-opacity=".5"/><circle cx="12" cy="16.5" r="1.2" fill="#000" fill-opacity=".5"/>',
  'Messages': '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
  'AI Decision': '<path d="M12 2C8.69 2 6 4.69 6 8c0 2.62 1.69 4.87 4 5.66V16h4v-2.34c2.31-.79 4-3.04 4-5.66 0-3.31-2.69-6-6-6z"/><rect x="9" y="17" width="6" height="2" rx="1"/><rect x="10" y="20" width="4" height="2" rx="1"/>',
  'Copilot': '<circle cx="12" cy="9" r="5.5"/><rect x="10" y="16" width="1.5" height="4" rx=".5"/><rect x="12.5" y="16" width="1.5" height="4" rx=".5"/><rect x="8" y="20" width="8" height="2" rx="1"/>',
  'Alerts & Incidents': '<path d="M12 2C9 2 6 4.5 6 8c0 6-3 8-3 8h18s-3-2-3-8c0-3.5-3-6-6-6z"/><circle cx="18" cy="5" r="3.5"/>',
  'Signal Integrity': '<rect x="2" y="16" width="3" height="5" rx=".7"/><rect x="7" y="13" width="3" height="8" rx=".7"/><rect x="12" y="9" width="3" height="12" rx=".7"/><rect x="17" y="5" width="3" height="16" rx=".7"/>',
  'Risk Intel': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5" fill-opacity=".25"/><circle cx="12" cy="12" r="3" fill-opacity=".4"/><circle cx="12" cy="12" r="1" fill="#fff"/>',
  'Guardian AI': '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z"/><path d="M10 12l2 2 4-4" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="1.5" stroke-linecap="round"/>',
  'Geofences': '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z"/><circle cx="12" cy="11" r="3" fill-opacity=".3"/>',
  '4D Geofence': '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 22V13" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".8"/>',
  'Rules': '<path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M14 2v6h6" fill-opacity=".2"/><rect x="7" y="12" width="9" height="1.5" rx=".5" fill="#000" fill-opacity=".25"/><rect x="7" y="15.5" width="5" height="1.5" rx=".5" fill="#000" fill-opacity=".25"/>',
  'Route Safety': '<circle cx="7" cy="7" r="3.5"/><circle cx="17" cy="17" r="3.5"/><path d="M17 7L7 17" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1.5"/>',
  'Covert Captures': '<path d="M2 7a2 2 0 012-2h4l2-3h6l2 3h2a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/><circle cx="12" cy="13" r="4"/><circle cx="12" cy="13" r="2" fill-opacity=".3"/>',
  'Incident Replay': '<path d="M5 3v18l14-9L5 3z"/>',
  '3D Drive Replay': '<rect x="2" y="2" width="20" height="20" rx="3"/><path d="M10 8v8l6-4-6-4z" fill="#000" fill-opacity=".4"/>',
  'Guardian AI Surv': '<path d="M1 12C1 12 5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.5" fill-opacity=".35"/><circle cx="12" cy="12" r="1.5" fill="#fff"/>',
  'Convoys': '<rect x="1" y="9" width="9" height="7" rx="1.5"/><rect x="13" y="9" width="9" height="7" rx="1.5"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><rect x="10" y="11.5" width="3" height="2" rx=".5" fill-opacity=".5"/>',
  'Handover': '<path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  'Fleet': '<path d="M1 6.5A1.5 1.5 0 012.5 5h13A1.5 1.5 0 0117 6.5V16H1V6.5z"/><path d="M17 10h3.5l3 3.5V16h-6.5V10z" fill-opacity=".7"/><circle cx="6" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/>',
  'Drivers': '<circle cx="12" cy="7" r="4.5"/><path d="M4 21c0-4.42 3.58-8 8-8s8 3.58 8 8"/>',
  'Field Officers': '<circle cx="12" cy="7" r="4"/><path d="M5 21c0-3.87 3.13-7 7-7s7 3.13 7 7"/><rect x="10" y="15" width="4" height="3.5" rx="1" fill-opacity=".5"/>',
  'Devices': '<rect x="5" y="2" width="14" height="20" rx="2.5"/><rect x="7" y="4" width="10" height="14" rx="1" fill="#000" fill-opacity=".2"/><circle cx="12" cy="20" r="1" fill="#000" fill-opacity=".3"/>',
  'Fuel': '<path d="M4 22V5a2 2 0 012-2h5a2 2 0 012 2v17H4z"/><rect x="6" y="6" width="5" height="4" rx="1" fill="#000" fill-opacity=".2"/><path d="M13 10h2a2 2 0 012 2v4a2 2 0 002 2 2 2 0 002-2V8l-2.5-2.5" fill-opacity=".5"/>',
  'Maintenance': '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.7 4.7C.6 7.1 1 10.1 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1 0-1.4z"/>',
  'Shifts': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="7.5" fill-opacity=".2"/><path d="M12 7v5l3.5 2" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="1.5" stroke-linecap="round"/>',
  'Shipments': '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 22V13" fill="none" stroke="#000" stroke-opacity=".2" stroke-width=".8"/>',
  'Cargo Portal': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M13 9l4 3-4 3" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  'Analytics': '<rect x="4" y="14" width="4" height="7" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="16" y="3" width="4" height="18" rx="1"/>',
  'Reports': '<path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M14 2v6h6" fill-opacity=".15"/><rect x="7" y="10" width="9" height="1.3" rx=".5" fill="#000" fill-opacity=".2"/><rect x="7" y="13" width="7" height="1.3" rx=".5" fill="#000" fill-opacity=".2"/>',
  'Convoy Reports': '<path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M14 2v6h6" fill-opacity=".15"/><rect x="7" y="12" width="10" height="5" rx="1" fill="#000" fill-opacity=".15"/>',
  'Finance': '<circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 8.5c0-1.5-1.34-2.5-3-2.5s-3 1-3 2.5 1.34 2.5 3 2.5 3 1 3 2.5-1.34 2.5-3 2.5" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.3"/>',
  'Claims': '<path d="M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z"/><rect x="8" y="1" width="8" height="4" rx="1.5" fill-opacity=".4"/><path d="M9 13l2 2 4-4" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  'Executive': '<rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M16 7V5a4 4 0 00-8 0v2" fill-opacity=".3"/><circle cx="12" cy="14" r="2.5" fill-opacity=".35"/>',
  'Settings': '<circle cx="12" cy="12" r="3.5"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.32V21a2 2 0 01-4 0v-.68A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15 1.65 1.65 0 003.17 14H3a2 2 0 010-4h.17A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68V3a2 2 0 014 0v.68a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.68a1.65 1.65 0 00-1.51 1z"/>',
  'Container Management': '<rect x="1" y="6" width="22" height="14" rx="1.5"/><rect x="5.5" y="6" width="1.5" height="14" fill="#000" fill-opacity=".12"/><rect x="11" y="6" width="1.5" height="14" fill="#000" fill-opacity=".12"/><rect x="16.5" y="6" width="1.5" height="14" fill="#000" fill-opacity=".12"/><path d="M8 3h8l1.5 3H6.5z" fill-opacity=".5"/>',
};

let uid = 0;
export function meridianIcon(name: string, color: string): string {
  const key = name === 'Guardian AI' ? 'Guardian AI Surv' : name;
  const sym = SYM[key] ?? SYM[name] ?? SYM['Command Center']!;
  const isHandover = key === 'Handover';
  const id = `mi${++uid}`;

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const dark = `#${Math.round(r * 0.45).toString(16).padStart(2, '0')}${Math.round(g * 0.45).toString(16).padStart(2, '0')}${Math.round(b * 0.45).toString(16).padStart(2, '0')}`;
  const light = `#${Math.min(255, r + 60).toString(16).padStart(2, '0')}${Math.min(255, g + 60).toString(16).padStart(2, '0')}${Math.min(255, b + 60).toString(16).padStart(2, '0')}`;

  return `<svg class="m-icon-tile" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${dark}"/></linearGradient>
      <linearGradient id="gl${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity=".45"/><stop offset="45%" stop-color="#fff" stop-opacity=".08"/><stop offset="46%" stop-color="#fff" stop-opacity="0"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <filter id="ds${id}"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity=".55"/></filter>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#bg${id})" filter="url(#ds${id})"/>
    <rect width="40" height="40" rx="10" fill="url(#gl${id})"/>
    <rect x=".5" y=".5" width="39" height="39" rx="9.5" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
  </svg><svg class="m-icon-sym" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="${isHandover ? 'none' : '#fff'}" ${isHandover ? '' : 'stroke="none"'}>${sym}</g></svg>`;
}
