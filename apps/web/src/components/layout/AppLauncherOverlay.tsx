import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Home, X, LayoutDashboard, ShieldAlert, Truck, Briefcase, type LucideIcon } from 'lucide-react';
import { NAV_GROUPS } from './Rail.js';
import '../../styles/orbit.css';

// The Orbit folder launcher, reused as an on-demand overlay on deep pages so
// switching apps never brings back the old rigid rail. Same folders → apps →
// open flow as the home surface, over a blurred scrim.

const GROUP_COVER: Record<string, LucideIcon> = {
  Command: LayoutDashboard, Security: ShieldAlert, Fleet: Truck, Business: Briefcase,
};

interface Props { open: boolean; onClose: () => void }

export default function AppLauncherOverlay({ open, onClose }: Props) {
  const nav = useNavigate();
  const [group, setGroup] = useState<number | null>(null);

  useEffect(() => {
    if (!open) { setGroup(null); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (group != null) setGroup(null); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, group, onClose]);

  if (!open) return null;

  const go = (path: string) => { onClose(); nav({ to: path }); };
  const home = () => { onClose(); nav({ to: '/' }); };

  return (
    <div className="o-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="o-lhome" onClick={home}><Home size={15} /> Home</button>
      <button className="o-lclose" onClick={onClose} aria-label="Close"><X size={18} /></button>

      {group == null ? (
        <div className="o-launch">
          <div className="o-lh"><b>Mission apps</b><span>· tap a folder to open its apps</span></div>
          <div className="o-groups">
            {NAV_GROUPS.map((gr, gi) => {
              const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
              return (
                <button key={gr.label} className="o-grp" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => setGroup(gi)}>
                  <span className="o-folder"><Cover size={28} /></span>
                  <h3>{gr.label}</h3>
                  <p>{gr.items.length} apps</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : (() => {
        const gr = NAV_GROUPS[group]!;
        const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
        return (
          <div className="o-folderpanel" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={(e) => e.stopPropagation()}>
            <div className="o-fp-head">
              <span className="o-fi"><Cover size={22} /></span>
              <div><h2>{gr.label}</h2><div className="o-fsub">{gr.items.length} apps</div></div>
              <button className="o-x" onClick={() => setGroup(null)} aria-label="Back"><X size={18} /></button>
            </div>
            <div className="o-apps">
              {gr.items.map((it) => { const Icon = it.icon; return (
                <button key={it.path} className="o-app" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => go(it.path)}>
                  <span className="o-aic"><Icon size={22} /></span>
                  <span className="o-atl">{it.label}</span>
                </button>
              ); })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
