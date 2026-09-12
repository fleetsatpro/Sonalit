import React from 'react';

interface SealRow {
  badge: string;
  location: string;
  sodOk: boolean;
  eodDone: boolean;
}

interface SealQuickViewProps {
  seals: Array<SealRow>;
}

const SealQuickView: React.FC<SealQuickViewProps> = ({ seals }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {seals.map((seal, idx) => (
        <div
          key={idx}
          style={{
            background: '#162019',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* Badge */}
          <div
            style={{
              background: '#1d2c21',
              border: '1px solid rgba(168,230,61,0.20)',
              borderRadius: 8,
              padding: '4px 8px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 11,
                color: '#a8e63d',
                letterSpacing: 1,
                fontWeight: 700,
              }}
            >
              {seal.badge}
            </span>
          </div>

          {/* Location */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Barlow', sans-serif",
                fontSize: 13,
                color: '#8aaa8e',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {seal.location}
            </div>
          </div>

          {/* SOD status */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                letterSpacing: 1,
                color: '#3d5442',
                textTransform: 'uppercase',
              }}
            >
              SOD
            </span>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: seal.sodOk ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1.5px solid ${seal.sodOk ? '#22c55e' : 'rgba(255,255,255,0.12)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: seal.sodOk ? '#22c55e' : '#3d5442',
                  lineHeight: 1,
                }}
              >
                {seal.sodOk ? '✓' : '·'}
              </span>
            </div>
          </div>

          {/* EOD status */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                letterSpacing: 1,
                color: '#3d5442',
                textTransform: 'uppercase',
              }}
            >
              EOD
            </span>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: seal.eodDone ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1.5px solid ${seal.eodDone ? '#22c55e' : 'rgba(255,255,255,0.12)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: seal.eodDone ? '#22c55e' : '#3d5442',
                  lineHeight: 1,
                }}
              >
                {seal.eodDone ? '✓' : '·'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SealQuickView;
