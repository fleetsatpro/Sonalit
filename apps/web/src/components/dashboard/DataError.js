import React from 'react';
const DataError = React.memo(function DataError({ section, onRetry }) {
    return (<div style={{
            background: 'var(--d-well)',
            border: '1px solid var(--d-rim2)',
            borderRadius: 12,
            padding: '24px 20px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
        }}>
      <div style={{ fontSize: 24 }}>⚠</div>
      <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, color: 'var(--d-fire)', letterSpacing: '.1em' }}>{section.toUpperCase()}</div>
      <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Failed to load</div>
      {onRetry && (<button onClick={onRetry} style={{
                marginTop: 4,
                padding: '6px 16px',
                background: 'var(--d-sg)',
                border: '1px solid var(--d-sig)',
                borderRadius: 6,
                color: 'var(--d-sig)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'IBM Plex Mono, monospace',
                letterSpacing: '.06em',
            }}>RETRY</button>)}
    </div>);
});
export default DataError;
