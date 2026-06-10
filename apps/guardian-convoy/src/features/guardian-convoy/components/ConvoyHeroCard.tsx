import React from 'react';

interface ConvoyHeroCardProps {
  convoyId: string;
  origin: string;
  destination: string;
  trucks: number;
  seals: number;
  photos: number;
  incidents: number;
  progress: number;
  onUploadPhotos: () => void;
  onCheckSeals: () => void;
}

const ConvoyHeroCard: React.FC<ConvoyHeroCardProps> = ({
  convoyId,
  origin,
  destination,
  trucks,
  seals,
  photos,
  incidents,
  progress,
  onUploadPhotos,
  onCheckSeals,
}) => {
  const metrics = [
    { value: trucks, label: 'TRUCKS' },
    { value: seals, label: 'SEALS' },
    { value: photos, label: 'PHOTOS' },
    { value: incidents, label: 'INCIDENTS' },
  ];

  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, #162019 0%, #1d3022 55%, #0c1a10 100%)',
        border: '1px solid rgba(168,230,61,0.25)',
        borderRadius: 16,
        padding: 15,
        overflow: 'hidden',
      }}
    >
      {/* Radial glow */}
      <div
        style={{
          position: 'absolute',
          top: -50,
          right: -50,
          width: 200,
          height: 200,
          background: 'radial-gradient(circle, rgba(168,230,61,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* LIVE tag */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(168,230,61,0.10)',
              border: '1px solid rgba(168,230,61,0.25)',
              borderRadius: 6,
              padding: '2px 8px',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#a8e63d',
                display: 'inline-block',
                animation: 'livePulse 1.4s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 9,
                letterSpacing: 1.5,
                color: '#a8e63d',
                textTransform: 'uppercase',
              }}
            >
              LIVE
            </span>
          </div>
        </div>
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 9,
            color: '#5a7a5e',
            letterSpacing: 1,
          }}
        >
          CONVOY ID
        </span>
      </div>

      {/* Convoy ID */}
      <div
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 22,
          fontWeight: 800,
          color: '#f0f8f2',
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        {convoyId}
      </div>

      {/* Route */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 14,
          fontFamily: "'Barlow', sans-serif",
          fontSize: 13,
        }}
      >
        <span style={{ color: '#8aaa8e' }}>{origin}</span>
        <span style={{ color: '#a8e63d', fontWeight: 700, fontSize: 14 }}>—→</span>
        <span style={{ color: '#d4e8d6' }}>{destination}</span>
      </div>

      {/* 4-metric grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginBottom: 14,
        }}
      >
        {metrics.map(({ value, label }) => (
          <div
            key={label}
            style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 10,
              padding: '8px 4px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 22,
                fontWeight: 700,
                color: '#a8e63d',
                lineHeight: 1,
                marginBottom: 3,
              }}
            >
              {value}
            </div>
            <div
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                letterSpacing: 1,
                color: '#5a7a5e',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9,
              color: '#5a7a5e',
              letterSpacing: 0.5,
            }}
          >
            Daily report progress
          </span>
          <span
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              color: '#a8e63d',
            }}
          >
            {progress}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: 'rgba(168,230,61,0.12)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, Math.max(0, progress))}%`,
              background: 'linear-gradient(90deg, #a8e63d, #22c55e)',
              borderRadius: 3,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      </div>

      {/* CTA buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onUploadPhotos}
          style={{
            flex: 1,
            background: '#a8e63d',
            border: 'none',
            borderRadius: 10,
            padding: '10px 0',
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: '#060a08',
            letterSpacing: 0.5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          📸 Upload Photos
        </button>
        <button
          onClick={onCheckSeals}
          style={{
            flex: 1,
            background: '#1d2c21',
            border: '1px solid rgba(168,230,61,0.25)',
            borderRadius: 10,
            padding: '10px 0',
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: '#a8e63d',
            letterSpacing: 0.5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          🔒 Check Seals
        </button>
      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default ConvoyHeroCard;
