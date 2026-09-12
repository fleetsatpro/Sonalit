import React from 'react';

interface IncidentTypeGridProps {
  selected: string | null;
  onSelect: (type: string) => void;
}

interface IncidentOption {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
}

const INCIDENT_TYPES: IncidentOption[] = [
  {
    id: 'armed_attack',
    icon: '🔫',
    label: 'Armed Attack',
    subtitle: 'Hostile engagement',
    accent: '#ef4444',
    accentBg: 'rgba(239,68,68,0.08)',
    accentBorder: 'rgba(239,68,68,0.30)',
  },
  {
    id: 'robbery_hijack',
    icon: '🎭',
    label: 'Robbery / Hijack',
    subtitle: 'Cargo or vehicle theft',
    accent: '#f97316',
    accentBg: 'rgba(249,115,22,0.08)',
    accentBorder: 'rgba(249,115,22,0.30)',
  },
  {
    id: 'vehicle_breakdown',
    icon: '🔧',
    label: 'Vehicle Breakdown',
    subtitle: 'Mechanical failure',
    accent: '#f59e0b',
    accentBg: 'rgba(245,158,11,0.08)',
    accentBorder: 'rgba(245,158,11,0.30)',
  },
  {
    id: 'medical_emergency',
    icon: '🏥',
    label: 'Medical Emergency',
    subtitle: 'Personnel injury / illness',
    accent: '#38bdf8',
    accentBg: 'rgba(56,189,248,0.08)',
    accentBorder: 'rgba(56,189,248,0.30)',
  },
];

const IncidentTypeGrid: React.FC<IncidentTypeGridProps> = ({ selected, onSelect }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
      }}
    >
      {INCIDENT_TYPES.map((incident) => {
        const isSelected = selected === incident.id;

        return (
          <button
            key={incident.id}
            onClick={() => onSelect(incident.id)}
            style={{
              background: isSelected ? incident.accentBg : '#162019',
              border: `1px solid ${isSelected ? incident.accentBorder : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 12,
              padding: 12,
              cursor: 'pointer',
              textAlign: 'left',
              opacity: selected !== null && !isSelected ? 0.55 : 1,
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* Icon */}
            <span style={{ fontSize: 24, lineHeight: 1 }}>{incident.icon}</span>

            {/* Label */}
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 14,
                fontWeight: 700,
                color: isSelected ? incident.accent : '#d4e8d6',
                letterSpacing: 0.3,
                lineHeight: 1.2,
                transition: 'color 0.2s',
              }}
            >
              {incident.label}
            </div>

            {/* Subtitle */}
            <div
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 9,
                color: '#5a7a5e',
                letterSpacing: 0.5,
                lineHeight: 1.3,
              }}
            >
              {incident.subtitle}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default IncidentTypeGrid;
