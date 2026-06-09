import React from 'react';

type ItemState = 'done' | 'warn' | 'locked';

interface ChecklistItem {
  icon: string;
  label: string;
  meta: string;
  state: ItemState;
}

interface UploadChecklistProps {
  items: Array<ChecklistItem>;
  onTap: (idx: number) => void;
}

const StateIndicator: React.FC<{ state: ItemState }> = ({ state }) => {
  if (state === 'done') {
    return (
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'rgba(34,197,94,0.15)',
          border: '1.5px solid #22c55e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: '#22c55e', lineHeight: 1 }}>✓</span>
      </div>
    );
  }

  if (state === 'warn') {
    return (
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'rgba(249,115,22,0.15)',
          border: '1.5px solid #f97316',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: '#f97316', lineHeight: 1, fontWeight: 700 }}>!</span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.05)',
        border: '1.5px solid rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, color: '#3d5442', lineHeight: 1 }}>—</span>
    </div>
  );
};

const itemBorderColor = (state: ItemState): string => {
  if (state === 'done') return 'rgba(34,197,94,0.18)';
  if (state === 'warn') return 'rgba(249,115,22,0.18)';
  return 'rgba(255,255,255,0.07)';
};

const itemBg = (state: ItemState): string => {
  if (state === 'done') return 'rgba(34,197,94,0.04)';
  if (state === 'warn') return 'rgba(249,115,22,0.04)';
  return '#162019';
};

const UploadChecklist: React.FC<UploadChecklistProps> = ({ items, onTap }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={() => onTap(idx)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: itemBg(item.state),
            border: `1px solid ${itemBorderColor(item.state)}`,
            borderRadius: 12,
            padding: '10px 12px',
            cursor: item.state === 'locked' ? 'default' : 'pointer',
            opacity: item.state === 'locked' ? 0.55 : 1,
            textAlign: 'left',
            width: '100%',
            transition: 'opacity 0.2s',
          }}
        >
          {/* Icon box */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 18,
            }}
          >
            {item.icon}
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Barlow', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: '#d4e8d6',
                marginBottom: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 10,
                color: '#5a7a5e',
                letterSpacing: 0.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.meta}
            </div>
          </div>

          {/* Status indicator */}
          <StateIndicator state={item.state} />
        </button>
      ))}
    </div>
  );
};

export default UploadChecklist;
