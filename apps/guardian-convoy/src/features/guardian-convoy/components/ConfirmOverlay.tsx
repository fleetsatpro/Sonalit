import React from 'react';

interface ConfirmRow {
  key: string;
  value: string;
  ok?: boolean;
}

interface ConfirmOverlayProps {
  show: boolean;
  title?: string;
  subtitle?: string;
  rows: Array<ConfirmRow>;
  onDone: () => void;
}

const ConfirmOverlay: React.FC<ConfirmOverlayProps> = ({
  show,
  title = 'Submitted!',
  subtitle,
  rows,
  onDone,
}) => {
  if (!show) return null;

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
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.10); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Success icon */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'rgba(34,197,94,0.15)',
          border: '2px solid rgba(34,197,94,0.40)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          animation: 'popIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          fontSize: 36,
        }}
      >
        ✅
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 28,
          fontWeight: 800,
          color: '#f0f8f2',
          letterSpacing: 1,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 10,
            color: '#5a7a5e',
            letterSpacing: 1,
            textAlign: 'center',
            marginBottom: 24,
            textTransform: 'uppercase',
          }}
        >
          {subtitle}
        </div>
      )}

      {!subtitle && <div style={{ marginBottom: 24 }} />}

      {/* Confirmation table */}
      <div
        style={{
          width: '100%',
          background: '#111d16',
          border: '1px solid rgba(255,255,255,0.07)',
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
                color: row.ok ? '#22c55e' : '#a8e63d',
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

      {/* Back button */}
      <button
        onClick={onDone}
        style={{
          width: '100%',
          background: '#a8e63d',
          border: 'none',
          borderRadius: 12,
          padding: '14px 0',
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 15,
          fontWeight: 800,
          color: '#060a08',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        BACK TO DASHBOARD
      </button>
    </div>
  );
};

export default ConfirmOverlay;
