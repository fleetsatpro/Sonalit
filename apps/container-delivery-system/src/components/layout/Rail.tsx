import React from 'react';
import { useRouter } from '@tanstack/react-router';

const navSections = [
  { items: [
    { id: 'dashboard', path: '/cds', icon: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>, title: 'Dashboard' },
    { id: 'shipments', path: '/cds/shipments', icon: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M12 11v4"/></>, title: 'Shipments' },
    { id: 'live', path: '/cds/live', icon: <><circle cx="12" cy="12" r="3"/><path d="M4 12a8 8 0 0 1 8-8M20 12a8 8 0 0 1-8 8"/></>, title: 'Live Tracking' },
    { id: 'containers', path: '/cds/containers', icon: <><rect x="3" y="7" width="18" height="12" rx="1.5"/><path d="M3 12h18M9 7v12M15 7v12"/></>, title: 'Containers' },
    { id: 'locks', path: '/cds/locks', icon: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>, title: 'E-Locks' },
    { id: 'drivers', path: '/cds/drivers', icon: <><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></>, title: 'Drivers' },
    { id: 'vehicles', path: '/cds/vehicles', icon: <><rect x="1" y="9" width="13" height="8" rx="1.5"/><path d="M14 12h4l3 3v2h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="17.5" cy="19" r="1.6"/></>, title: 'Vehicles' },
    { id: 'transporters', path: '/cds/transporters', icon: <><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22V8"/><path d="m3 3 18 18"/></>, title: 'Transporters' },
    { id: 'customers', path: '/cds/customers', icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>, title: 'Customers' },
    { id: 'delivery', path: '/cds/delivery', icon: <><path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/></>, title: 'Delivery Ops' },
  ]},
  { items: [
    { id: 'geofences', path: '/cds/geofences', icon: <><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><path d="M12 22V15.5"/><path d="M22 8.5l-10 7-10-7"/></>, title: 'Geofences' },
    { id: 'inbox', path: '/cds/inbox', icon: <><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.1a8.4 8.4 0 1 1 16.1-4.4z"/><circle cx="8.5" cy="12" r=".6" fill="currentColor"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="15.5" cy="12" r=".6" fill="currentColor"/></>, title: 'AI Inbox' },
    { id: 'incidents', path: '/cds/incidents', icon: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>, title: 'Incidents' },
    { id: 'alerts', path: '/cds/alerts', icon: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>, title: 'Alerts' },
  ]},
  { items: [
    { id: 'reports', path: '/cds/reports', icon: <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9 13h6M9 17h6"/></>, title: 'Reports' },
    { id: 'analytics', path: '/cds/analytics', icon: <><path d="M4 20V10M12 20V4M20 20v-7"/></>, title: 'Analytics' },
    { id: 'documents', path: '/cds/documents', icon: <><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><path d="M14 2v6h6"/><path d="m3 15 2 2 4-4"/></>, title: 'Documents' },
  ]},
];

const bottomItems = [
  { id: 'audit', path: '/cds/audit', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></>, title: 'Audit Logs' },
  { id: 'settings', path: '/cds/settings', icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>, title: 'Settings' },
];

export function Rail() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;

  const isActive = (path: string) => {
    if (path === '/cds') return currentPath === '/cds';
    return currentPath.startsWith(path);
  };

  const navigate = (path: string) => {
    router.navigate({ to: path });
  };

  return (
    <div className="w-[76px] bg-ink-1 border-r border-[rgba(255,255,255,0.07)] flex flex-col items-center py-5 gap-1.5 overflow-y-auto scrollbar-thin flex-none">
      <div
        className="w-[38px] h-[38px] rounded-[11px] bg-gradient-to-br from-cds-orange to-[#ff9d3d] flex items-center justify-center font-display font-extrabold text-[15px] text-[#0a0a0a] shadow-[0_0_0_1px_rgba(255,255,255,0.13)_inset,0_8px_24px_-8px_rgba(255,122,0,0.35)] mb-5 cursor-pointer flex-none"
        onClick={() => navigate('/cds')}
        title="CDS Home"
      >
        S
      </div>

      {navSections.map((section, si) => (
        <React.Fragment key={si}>
          {si > 0 && <div className="w-8 h-px bg-[rgba(255,255,255,0.07)] my-1" />}
          {section.items.map((item) => (
            <button
              key={item.id}
              className={`w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer relative transition-all border-none bg-transparent ${isActive(item.path) ? 'text-cds-orange bg-cds-orange/15' : 'text-text-2 hover:text-text-0 hover:bg-ink-3'}`}
              onClick={() => navigate(item.path)}
              title={item.title}
            >
              {isActive(item.path) && (
                <span className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded bg-cds-orange shadow-[0_0_12px_rgba(255,122,0,0.35)]" />
              )}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                {item.icon}
              </svg>
            </button>
          ))}
        </React.Fragment>
      ))}

      <div className="mt-auto flex flex-col items-center gap-3.5 pt-2">
        {bottomItems.map((item) => (
          <button
            key={item.id}
            className={`w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer relative transition-all border-none bg-transparent ${isActive(item.path) ? 'text-cds-orange bg-cds-orange/15' : 'text-text-2 hover:text-text-0 hover:bg-ink-3'}`}
            onClick={() => navigate(item.path)}
            title={item.title}
          >
            {isActive(item.path) && (
              <span className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded bg-cds-orange shadow-[0_0_12px_rgba(255,122,0,0.35)]" />
            )}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              {item.icon}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
