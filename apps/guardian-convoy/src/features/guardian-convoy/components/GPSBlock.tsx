import React from 'react';

interface GPSBlockProps {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  label?: string;
}

const GPSBlock: React.FC<GPSBlockProps> = ({ lat, lng, accuracy, label }) => {
  const hasGPS = lat !== null && lng !== null;

  const formatCoord = (val: number, isLat: boolean): string => {
    const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${Math.abs(val).toFixed(5)}° ${dir}`;
  };

  return (
    <div
      style={{
        background: '#162019',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <style>{`
        @keyframes gpsPulse {
          0% { box-shadow: 0 0 0 0 rgba(168,230,61,0.50); }
          70% { box-shadow: 0 0 0 10px rgba(168,230,61,0); }
          100% { box-shadow: 0 0 0 0 rgba(168,230,61,0); }
        }
        @keyframes gpsAcquire {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* GPS icon box */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: hasGPS ? 'rgba(168,230,61,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${hasGPS ? 'rgba(168,230,61,0.30)' : 'rgba(255,255,255,0.10)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          animation: hasGPS ? 'gpsPulse 2s ease-out infinite' : 'gpsAcquire 1.5s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: 20 }}>📍</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && (
          <div
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9,
              letterSpacing: 1.5,
              color: '#3d5442',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {label}
          </div>
        )}

        {hasGPS ? (
          <>
            <div
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 13,
                color: '#a8e63d',
                letterSpacing: 0.5,
                marginBottom: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {formatCoord(lat!, true)}
            </div>
            <div
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 13,
                color: '#a8e63d',
                letterSpacing: 0.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {formatCoord(lng!, false)}
            </div>
            {accuracy !== null && (
              <div
                style={{
                  fontFamily: "'Share Tech Mono', monospace",
                  fontSize: 9,
                  color: '#5a7a5e',
                  letterSpacing: 0.5,
                  marginTop: 3,
                }}
              >
                ±{accuracy.toFixed(0)}m accuracy
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              fontFamily: "'Barlow', sans-serif",
              fontSize: 13,
              color: '#3d5442',
              fontStyle: 'italic',
            }}
          >
            Acquiring GPS...
          </div>
        )}
      </div>

      {/* Badge */}
      <div
        style={{
          flexShrink: 0,
          background: hasGPS ? 'rgba(168,230,61,0.10)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${hasGPS ? 'rgba(168,230,61,0.25)' : 'rgba(255,255,255,0.10)'}`,
          borderRadius: 6,
          padding: '3px 7px',
        }}
      >
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 9,
            letterSpacing: 1.5,
            color: hasGPS ? '#a8e63d' : '#3d5442',
            textTransform: 'uppercase',
          }}
        >
          {hasGPS ? 'LIVE' : 'LOCKED'}
        </span>
      </div>
    </div>
  );
};

export default GPSBlock;
