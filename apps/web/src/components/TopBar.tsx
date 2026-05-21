import { useAuthStore } from '../stores/auth.js';
import { useUIStore } from '../stores/ui.js';
import { LogOut, Sun, Moon, Menu } from 'lucide-react';

export default function TopBar() {
  const { user, clearAuth } = useAuthStore();
  const { theme, setTheme, toggleSidebar } = useUIStore();
  return (
    <header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-slate-800 bg-slate-900 shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white md:hidden"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="text-sm text-slate-400 hidden sm:block">{user?.org_id}</div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-300">{user?.name}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{user?.role}</span>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-1.5 rounded hover:bg-slate-800"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={clearAuth}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          aria-label="Log out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
