import React, { useState, useEffect } from 'react';
import { Phase } from '../types/ConvoyReport';

interface CameraFrameProps {
  phase: Phase;
  plateNumber: string;
  lat: number | null;
  lng: number | null;
  photoType: string;
  onCapture: () => void;
  onCycleType: () => void;
  disabled?: boolean;
}

const formatTime = (): string => {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
};

const CameraFrame: React.FC<CameraFrameProps> = ({
  phase,
  plateNumber,
  lat,
  lng,
  photoType,
  onCapture,
  onCycleType,
  disabled = false,
}) => {
  const [time, setTime] = useState<string>(formatTime());

  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hasGPS = lat !== null && lng !== null;

  return (
    <div
      style={{
        position: 'relative',
        background: '#000',
        aspectRatio: '4/3',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes scanLine {
          0% { top: 10%; opacity: 0.8; }
          50% { opacity: 0.4; }
          100% { top: 85%; opacity: 0.8; }
        }
      `}</style>

      {/* Scan line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(168,230,61,0.60), transparent)',
          animation: 'scanLine 3s linear infinite',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* Top-left HUD */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {/* REC */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#ef4444',
              display: 'inline-block',
              animation: 'livePulse 1.4s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9,
              color: '#ef4444',
              letterSpacing: 1,
            }}
          >
            REC
          </span>
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9,
              color: 'rgba(255,255,255,0.70)',
              letterSpacing: 0.5,
            }}
          >
            {time}
          </span>
        </div>

        {/* GPS status */}
        <div
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 9,
            color: hasGPS ? '#a8e63d' : '#5a7a5e',
            letterSpacing: 0.5,
          }}
        >
          GPS {hasGPS ? '● LOCKED' : '○ ACQUIRING'}
        </div>

        {/* Plate */}
        <div
          style={{
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 4,
            padding: '2px 6px',
            display: 'inline-block',
          }}
        >
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 10,
              color: '#f0f8f2',
              letterSpacing: 1.5,
              fontWeight: 700,
            }}
          >
            {plateNumber}
          </span>
        </div>
      </div>

      {/* Top-right HUD */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
        }}
      >
        {hasGPS ? (
          <>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 9,
                color: 'rgba(168,230,61,0.85)',
                letterSpacing: 0.5,
              }}
            >
              {lat!.toFixed(5)}°
            </span>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 9,
                color: 'rgba(168,230,61,0.85)',
                letterSpacing: 0.5,
              }}
            >
              {lng!.toFixed(5)}°
            </span>
          </>
        ) : (
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9,
              color: '#3d5442',
              letterSpacing: 0.5,
            }}
          >
            ---.-----°
          </span>
        )}
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 9,
            color: 'rgba(255,255,255,0.40)',
            letterSpacing: 0.5,
          }}
        >
          ISO AUTO
        </span>
      </div>

      {/* Corner brackets */}
      {/* Top-left */}
      <div style={{ position: 'absolute', top: 50, left: 16, zIndex: 3, width: 24, height: 24,
        borderTop: '2px solid rgba(168,230,61,0.70)', borderLeft: '2px solid rgba(168,230,61,0.70)' }} />
      {/* Top-right */}
      <div style={{ position: 'absolute', top: 50, right: 16, zIndex: 3, width: 24, height: 24,
        borderTop: '2px solid rgba(168,230,61,0.70)', borderRight: '2px solid rgba(168,230,61,0.70)' }} />
      {/* Bottom-left */}
      <div style={{ position: 'absolute', bottom: 80, left: 16, zIndex: 3, width: 24, height: 24,
        borderBottom: '2px solid rgba(168,230,61,0.70)', borderLeft: '2px solid rgba(168,230,61,0.70)' }} />
      {/* Bottom-right */}
      <div style={{ position: 'absolute', bottom: 80, right: 16, zIndex: 3, width: 24, height: 24,
        borderBottom: '2px solid rgba(168,230,61,0.70)', borderRight: '2px solid rgba(168,230,61,0.70)' }} />

      {/* Aim reticle */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -60%)',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'relative', width: 40, height: 40 }}>
          {/* Circle */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '1.5px solid rgba(255,255,255,0.45)',
          }} />
          {/* Crosshairs */}
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1,
            background: 'rgba(255,255,255,0.35)', transform: 'translateY(-50%)' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
            background: 'rgba(255,255,255,0.35)', transform: 'translateX(-50%)' }} />
        </div>
      </div>

      {/* Photo type label */}
      <div
        style={{
          position: 'absolute',
          bottom: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 3,
          background: 'rgba(0,0,0,0.50)',
          borderRadius: 6,
          padding: '3px 10px',
        }}
      >
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 9,
            color: 'rgba(255,255,255,0.70)',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          {photoType.replace(/_/g, ' ')} · {phase.toUpperCase()}
        </span>
      </div>

      {/* Bottom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 64,
          background: 'linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingBottom: 8,
          zIndex: 3,
          pointerEvents: disabled ? 'none' : 'auto',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {/* Gallery icon */}
        <button
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          🖼️
        </button>

        {/* Shutter */}
        <button
          onClick={onCapture}
          style={{
            width: 60, height: 60, borderRadius: '50%',
            background: '#f0f8f2',
            border: '3px solid rgba(255,255,255,0.40)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: '#e0f0e4',
            border: '2px solid rgba(0,0,0,0.15)',
          }} />
        </button>

        {/* Cycle type */}
        <button
          onClick={onCycleType}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(168,230,61,0.15)',
            border: '1px solid rgba(168,230,61,0.30)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          🔄
        </button>
      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
};

export default CameraFrame;
