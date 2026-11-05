import React from 'react';
import { useRouter } from '@tanstack/react-router';
import { useUIStore } from '@/stores/ui.js';

const NAV_ART_SPRITE = '/assets/nav/sonalit-nav-sprite.svg';

function NavArtwork({ name, className }: { name: string; className?: string }) {
  return <svg className={className ?? 'cds-nav-art'} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href={NAV_ART_SPRITE + '#' + name} /></svg>;
}

const navSections = [
  { items: [
    { id: 'dashboard', path: '/cds', art: 'nav-command', title: 'Dashboard' },
    { id: 'shipments', path: '/cds/shipments', art: 'nav-ship', title: 'Shipments' },
    { id: 'live', path: '/cds/live', art: 'nav-gps', title: 'Live Tracking' },
    { id: 'containers', path: '/cds/containers', art: 'nav-ship', title: 'Containers' },
    { id: 'locks', path: '/cds/locks', art: 'nav-shield', title: 'E-Locks' },
    { id: 'drivers', path: '/cds/drivers', art: 'nav-headset', title: 'Drivers' },
    { id: 'vehicles', path: '/cds/vehicles', art: 'nav-sedan', title: 'Vehicles' },
    { id: 'transporters', path: '/cds/transporters', art: 'nav-ship', title: 'Transporters' },
    { id: 'customers', path: '/cds/customers', art: 'nav-headset', title: 'Customers' },
    { id: 'delivery', path: '/cds/delivery', art: 'nav-suv', title: 'Delivery Ops' },
  ]},
  { items: [
    { id: 'geofences', path: '/cds/geofences', art: 'nav-map', title: 'Geofences' },
    { id: 'inbox', path: '/cds/inbox', art: 'nav-headset', title: 'AI Inbox' },
    { id: 'incidents', path: '/cds/incidents', art: 'nav-beacon', title: 'Incidents' },
    { id: 'alerts', path: '/cds/alerts', art: 'nav-beacon', title: 'Alerts' },
  ]},
  { items: [
    { id: 'reports', path: '/cds/reports', art: 'nav-dossier', title: 'Reports' },
    { id: 'analytics', path: '/cds/analytics', art: 'nav-analytics', title: 'Analytics' },
    { id: 'documents', path: '/cds/documents', art: 'nav-dossier', title: 'Documents' },
  ]},
];

const bottomItems = [
  { id: 'audit', path: '/cds/audit', art: 'nav-dossier', title: 'Audit Logs' },
  { id: 'settings', path: '/cds/settings', art: 'nav-command', title: 'Settings' },
];

export function Rail() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const isActive = (path: string) => {
    if (path === '/cds') return currentPath === '/cds';
    return currentPath.startsWith(path);
  };

  const navigate = (path: string) => {
    router.navigate({ to: path });
  };

  const renderItem = (item: typeof navSections[0]['items'][0]) => {
    const active = isActive(item.path);
    const layoutClass = collapsed ? 'w-11 h-11 justify-center' : 'w-full h-9 px-3 gap-2.5 justify-start';
    const stateClass = active ? 'text-cds-orange bg-cds-orange/12' : 'text-text-2 hover:text-text-0 hover:bg-ink-3';
    return (
      <button
        key={item.id}
        className={layoutClass + ' cds-nav-item group rounded-xl flex items-center cursor-pointer relative transition-all border-none bg-transparent ' + stateClass}
        onClick={() => navigate(item.path)}
        title={collapsed ? item.title : undefined}
        aria-label={collapsed ? item.title : undefined}
        aria-current={active ? 'page' : undefined}
      >
        {active && <span className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded bg-cds-orange shadow-glow" />}
        <NavArtwork name={item.art} />
        {!collapsed && <span className="text-[11.5px] font-medium truncate">{item.title}</span>}
      </button>
    );
  };

  const shellClass = collapsed ? 'w-[76px]' : 'w-[200px]';
  const innerPadding = collapsed ? 'px-3.5' : 'px-2.5';

  return (
    <div className={shellClass + ' bg-ink-1 border-r border-hair flex flex-col items-center py-4 gap-0.5 overflow-y-auto scrollbar-thin flex-none transition-all duration-200'}>
      <div className="flex items-center gap-2.5 mb-4 px-3 w-full">
        <div
          className="w-[38px] h-[38px] rounded-[11px] bg-gradient-to-br from-cds-orange/90 to-[#ff9d3d] border border-white/10 shadow-glow flex items-center justify-center cursor-pointer flex-none overflow-hidden"
          onClick={() => navigate('/cds')}
          title="CDS Home"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate('/cds'); }}
        >
          <NavArtwork name="nav-command" className="cds-brand-art" />
        </div>
        {!collapsed && <span className="font-display font-bold text-[13px] text-text-0 truncate">Sonalit CDS</span>}
      </div>

      <button
        onClick={toggleSidebar}
        className={(collapsed ? 'w-11 h-7' : 'w-full h-7 px-3') + ' flex items-center justify-center rounded-lg text-text-2 hover:text-text-0 hover:bg-ink-3 border-none bg-transparent cursor-pointer transition-colors mb-2'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          {collapsed ? <><path d="M9 18l6-6-6-6" /></> : <><path d="M15 18l-6-6 6-6" /></>}
        </svg>
      </button>

      <div className={'w-full ' + innerPadding + ' flex flex-col gap-0.5 flex-1'}>
        {navSections.map((section, si) => (
          <React.Fragment key={si}>
            {si > 0 && <div className={(collapsed ? 'mx-1' : '') + ' h-px bg-hair my-1.5'} />}
            {section.items.map(renderItem)}
          </React.Fragment>
        ))}
      </div>

      <div className={'w-full ' + innerPadding + ' flex flex-col gap-0.5 pt-2 border-t border-hair mt-2'}>
        {bottomItems.map(renderItem)}
      </div>
    </div>
  );
}
