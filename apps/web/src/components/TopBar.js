import { useAuthStore } from '../stores/auth.js';
import { useUIStore } from '../stores/ui.js';
import { LogOut, Menu } from 'lucide-react';
export default function TopBar() {
    const { user, clearAuth } = useAuthStore();
    const { toggleSidebar } = useUIStore();
    return (<header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-white/[0.06] shrink-0" style={{ background: 'rgba(5,8,19,0.88)', backdropFilter: 'blur(16px)' }}>
      <div className="flex items-center gap-3">
        <button onClick={toggleSidebar} className="p-1.5 rounded text-gray-600 hover:text-orange-400 transition-colors md:hidden" aria-label="Open menu">
          <Menu size={20}/>
        </button>
        <div className="text-xs text-gray-700 hidden sm:block font-mono tracking-widest uppercase select-none">
          {user?.org_id}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-300">{user?.name}</span>
        <span className="text-xs px-2 py-0.5 rounded font-mono uppercase tracking-wider" style={{
            background: 'rgba(240,112,32,0.08)',
            border: '1px solid rgba(240,112,32,0.25)',
            color: '#ff9040',
        }}>
          {user?.role}
        </span>
        <button onClick={clearAuth} className="p-1.5 rounded text-gray-600 hover:text-orange-400 transition-colors" aria-label="Log out" title="Log out">
          <LogOut size={16}/>
        </button>
      </div>
    </header>);
}
