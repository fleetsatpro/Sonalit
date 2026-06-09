import React from 'react';
import { Phase } from '../types/ConvoyReport';

interface PhotoItem {
  icon: string;
  label: string;
  uploaded: boolean;
}

interface PhotoGridProps {
  photos: Array<PhotoItem>;
  phase: Phase;
  onAdd: () => void;
}

const PhotoGrid: React.FC<PhotoGridProps> = ({ photos, phase, onAdd }) => {
  const gradientForPhase = (uploaded: boolean): string => {
    if (!uploaded) return 'transparent';
    if (phase === 'sod') {
      return 'linear-gradient(135deg, #162019 0%, #1d3022 100%)';
    }
    return 'linear-gradient(135deg, #1a1810 0%, #2a2012 100%)';
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
      }}
    >
      {photos.map((photo, idx) => {
        const isPendingEod = !photo.uploaded && phase === 'eod';

        return (
          <div
            key={idx}
            style={{
              position: 'relative',
              aspectRatio: '1',
              borderRadius: 12,
              background: photo.uploaded ? gradientForPhase(true) : '#111d16',
              border: isPendingEod
                ? '1.5px dashed rgba(249,115,22,0.45)'
                : photo.uploaded
                ? '1px solid rgba(255,255,255,0.07)'
                : '1px solid rgba(255,255,255,0.07)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              overflow: 'hidden',
            }}
          >
            {/* Icon */}
            <span style={{ fontSize: 22 }}>{photo.icon}</span>

            {/* Label */}
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                color: photo.uploaded ? '#8aaa8e' : '#3d5442',
                letterSpacing: 0.5,
                textAlign: 'center',
                padding: '0 4px',
                lineHeight: 1.3,
                textTransform: 'uppercase',
              }}
            >
              {photo.label}
            </span>

            {/* Status dot */}
            {photo.uploaded && (
              <div
                style={{
                  position: 'absolute',
                  top: 7,
                  right: 7,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 4px rgba(34,197,94,0.60)',
                }}
              />
            )}

            {/* Pending EOD indicator */}
            {isPendingEod && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#f97316',
                  opacity: 0.8,
                }}
              />
            )}
          </div>
        );
      })}

      {/* Add button */}
      <button
        onClick={onAdd}
        style={{
          aspectRatio: '1',
          borderRadius: 12,
          background: 'rgba(168,230,61,0.04)',
          border: '1.5px dashed rgba(168,230,61,0.30)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            fontSize: 22,
            color: '#a8e63d',
            lineHeight: 1,
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 300,
          }}
        >
          +
        </span>
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 8,
            color: '#a8e63d',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          ADD
        </span>
      </button>
    </div>
  );
};

export default PhotoGrid;
