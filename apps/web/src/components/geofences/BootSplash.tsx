import { MapPin } from 'lucide-react';

// Progress reflects the real fraction of initial queries that have settled —
// not a timer or fabricated animation. `loaded`/`total` come from the actual
// useQuery isLoading flags in the parent page.
export default function BootSplash({ loaded, total }: { loaded: number; total: number }) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return (
    <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-2 text-white">
        <MapPin className="w-7 h-7 text-cyan-400" />
        <span className="text-2xl font-bold tracking-wide">SONALIT</span>
      </div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
        Loading live vehicles, devices &amp; geofences… ({loaded}/{total})
      </div>
      <div className="w-64 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
