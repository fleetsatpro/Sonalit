import React from 'react';

interface SOSConfirmOverlayProps {
  show: boolean;
  incidentType: string;
  lat: number | null;
  lng: number | null;
  timestamp: string;
  onDismiss: () => void;
}

const formatIncidentLabel = (type: string): string => {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const formatGPS = (lat: number | null, lng: number | null): string => {
  if (lat === null || lng === null) return 'GPS unavailable';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`;
};

const SOSConfirmOverlay: React.FC<SOSConfirmOverlayProps> = ({
  show,
  incidentType,
  lat,
  lng,
  timestamp,
  onDismiss,
}) => {
  if (!show) return null;

  const rows = [
    { key: 'Incident Type', value: formatIncidentLabel(incidentType), ok: false },
    { key: 'GPS Position', value: formatGPS(lat, lng), ok: false },
    { key: 'Timestamp', value: timestamp, ok: false },
    { key: 'Admin Channel', value: '✓ ACKNOWLEDGED', ok: true },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(6,10,8,0.96)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        zIndex: 200,
      }}
    >
      <style>{`
        @keyframes sosPopIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.10); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes sosPulseRing1 {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.0); opacity: 0; }
        }
        @keyframes sosPulseRing2 {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(2.6); opacity: 0; }
        }
      `}</style>

      {/* SOS pulse rings + icon */}
      <div
        style={{
          position: 'relative',
          width: 80,
          height: 80,
          marginBottom: 24,
        }}
      >
        {/* Outer ring 2 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(239,68,68,0.35)',
            animation: 'sosPulseRing2 2s ease-out infinite 0.3s',
          }}
        />
        {/* Outer ring 1 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(239,68,68,0.55)',
            animation: 'sosPulseRing1 2s ease-out infinite',
          }}
        />
        {/* Icon circle */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.18)',
            border: '2px solid rgba(239,68,68,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'sosPopIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
            fontSize: 32,
          }}
        >
          🆘
        </div>
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 32,
          fontWeight: 900,
          color: '#ef4444',
          letterSpacing: 2,
          textAlign: 'center',
          marginBottom: 8,
          textTransform: 'uppercase',
        }}
      >
        PANIC SENT!
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: 10,
          color: '#5a7a5e',
          letterSpacing: 1.5,
          textAlign: 'center',
          marginBottom: 24,
          textTransform: 'uppercase',
        }}
      >
        Emergency services notified
      </div>

      {/* Table */}
      <div
        style={{
          width: '100%',
          background: '#111d16',
          border: '1px solid rgba(239,68,68,0.18)',
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        {rows.map((row, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: idx < rows.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 10,
                color: '#5a7a5e',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              {row.key}
            </span>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 11,
                color: row.ok ? '#22c55e' : '#ef4444',
                letterSpacing: 0.5,
                textAlign: 'right',
                wordBreak: 'break-all',
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        style={{
          width: '100%',
          background: 'rgba(239,68,68,0.18)',
          border: '1.5px solid rgba(239,68,68,0.45)',
          borderRadius: 12,
          padding: '14px 0',
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 13,
          fontWeight: 800,
          color: '#ef4444',
          letterSpacing: 1,
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        STAY ON EMERGENCY SCREEN
      </button>
    </div>
  );
};

export default SOSConfirmOverlay;
