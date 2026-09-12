import React from 'react';

interface BottomNavProps {
  active: string;
  onNavigate: (s: string) => void;
}

const tabs = [
  { id: 'home', label: 'HOME', icon: '🏠' },
  { id: 'upload', label: 'UPLOAD', icon: '📸' },
  { id: 'report', label: 'REPORT', icon: null },
  { id: 'seals', label: 'SEALS', icon: '🔒' },
  { id: 'sos', label: 'SOS', icon: '🆘' },
];

const ProgressRing: React.FC = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" style={{ display: 'block' }}>
    <circle
      cx={12}
      cy={12}
      r={9}
      fill="none"
      stroke="rgba(168,230,61,0.20)"
      strokeWidth={2.5}
    />
    <circle
      cx={12}
      cy={12}
      r={9}
      fill="none"
      stroke="#a8e63d"
      strokeWidth={2.5}
      strokeDasharray={88}
      strokeDashoffset={35}
      strokeLinecap="round"
      style={{ transform: 'rotate(-90deg)', transformOrigin: '12px 12px' }}
    />
  </svg>
);

const BottomNav: React.FC<BottomNavProps> = ({ active, onNavigate }) => {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 76,
        background: '#0c1410',
        borderTop: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {tabs.map((tab) => {
        const isSos = tab.id === 'sos';
        const isActive = active === tab.id;

        const iconWrapBg = isSos
          ? 'rgba(239,68,68,0.12)'
          : isActive
          ? 'rgba(168,230,61,0.10)'
          : 'transparent';

        const labelColor = isSos
          ? '#ef4444'
          : isActive
          ? '#a8e63d'
          : '#5a7a5e';

        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              cursor: 'pointer',
              padding: '0 10px',
              background: 'none',
              border: 'none',
              outline: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: iconWrapBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              {tab.icon === null ? (
                <ProgressRing />
              ) : (
                <span style={{ fontSize: 18, lineHeight: 1 }}>{tab.icon}</span>
              )}
            </div>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: labelColor,
                transition: 'color 0.2s',
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
