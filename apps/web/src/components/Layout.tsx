import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import NavSidebar from './NavSidebar.js';
import TopBar from './TopBar.js';
import { useUIStore } from '../stores/ui.js';

export default function Layout() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Close sidebar on every route change on mobile
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  return (
    <div
      className="flex h-screen text-gray-100 overflow-hidden"
      style={{ background: '#050813' }}
    >
      <NavSidebar />
      <div className={`flex flex-col flex-1 min-w-0 transition-all duration-200 ${sidebarOpen ? 'md:ml-64' : 'md:ml-16'}`}>
        <TopBar />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
