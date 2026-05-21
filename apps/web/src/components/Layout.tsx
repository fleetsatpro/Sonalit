import { Outlet } from '@tanstack/react-router';
import NavSidebar from './NavSidebar.js';
import TopBar from './TopBar.js';
import { useUIStore } from '../stores/ui.js';

export default function Layout() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
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
