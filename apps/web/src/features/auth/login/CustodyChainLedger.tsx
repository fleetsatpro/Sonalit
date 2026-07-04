import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

// Deterministic hash-of-two-ints, byte-for-byte from the reference HTML.
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }

type LedgerType = { t: string; d: string; w: boolean };
type Block = {
  id: number;
  e: LedgerType;
  time: string;
  hash: string;
  prevHash: string;
};

// Redacted deliberately — pre-auth surface must render zero tenant data.
// The "SIMULATED PREVIEW" badge above the ledger states this in-band.
const LEDGER_TYPES: LedgerType[] = [
  { t: 'SEAL VERIFIED',    d: 'shipment <span class="redact">██████</span> · gate <span class="redact">██</span>',       w: false },
  { t: 'GPS PING',         d: 'asset <span class="redact">████</span> · pos <span class="redact">████████</span>',        w: false },
  { t: 'CUSTODY TRANSFER', d: 'shipment <span class="redact">██████</span> · dual-signed',                                w: false },
  { t: 'GEOFENCE CHECK',   d: 'lane <span class="redact">████</span> · inside bounds',                                    w: false },
  { t: 'REPORT HASHED',    d: 'daily PDF · org <span class="redact">██████</span>',                                       w: false },
  { t: 'ROUTE DEVIATION',  d: 'lane <span class="redact">████</span> · corridor review',                                  w: true  },
  { t: 'COLD-CHAIN READ',  d: 'reefer <span class="redact">████</span> · within range',                                   w: false },
  { t: 'SOS ACKNOWLEDGED', d: 'detail <span class="redact">██████</span> · responded',                                    w: false },
];

function fakeHash(i: number): string {
  const c = '0123456789abcdef';
  let a = '', b = '';
  for (let k = 0; k < 4; k++) {
    a += c[Math.floor(hash2(i, k + 3) * 16)];
    b += c[Math.floor(hash2(i, k + 11) * 16)];
  }
  return a + '…' + b;
}

const START_HEIGHT = 84213;
const MAX_BLOCKS = 9;

function makeBlock(idx: number): Block {
  const e = LEDGER_TYPES[idx % LEDGER_TYPES.length]!;
  const d = new Date();
  return {
    id: idx,
    e,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`,
    hash: fakeHash(idx),
    prevHash: idx === 0 ? 'genesis' : fakeHash(idx - 1),
  };
}

export default function CustodyChainLedger(): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const [blocks, setBlocks] = useState<Block[]>(() =>
    Array.from({ length: 8 }, (_, i) => makeBlock(i))
  );
  const idxRef = useRef<number>(8);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const iv = window.setInterval(() => {
      setBlocks((prev) => {
        const next = [makeBlock(idxRef.current), ...prev];
        idxRef.current += 1;
        return next.slice(0, MAX_BLOCKS);
      });
    }, 3000);
    return () => window.clearInterval(iv);
  }, [reducedMotion]);

  const height = (START_HEIGHT + idxRef.current).toLocaleString();

  return (
    <section className="chain" aria-hidden="true">
      <div className="chain-head">
        <div className="chain-title"><span className="ld" />CUSTODY CHAIN</div>
        <div className="chain-meta">
          <span>SHA-256 LINKED</span><span className="sep" /><span>RFC 3161 STAMPED</span>
        </div>
        <div className="chain-meta" style={{ marginTop: 5 }}>
          <span>HEIGHT</span>
          <span className="chain-height">#{height}</span>
          <span className="sep" />
          <span style={{ color: 'var(--chain)' }}>INTEGRITY OK</span>
        </div>
        <div className="sim-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          SIMULATED PREVIEW — LIVE DATA AFTER SIGN-IN
        </div>
      </div>

      <div className="chain-body">
        <div className="chain-spine" />
        {blocks.map((b) => (
          <div key={b.id} className={'block' + (b.e.w ? ' warn' : '')}>
            <span className="link" />
            <span className="node" />
            <div className="block-card">
              <div className="block-top">
                {b.e.w ? (
                  <svg className="block-check warn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                ) : (
                  <svg className="block-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                )}
                <span className="block-type">{b.e.t}</span>
                <span className="block-time">{b.time}</span>
              </div>
              <div className="block-hash">
                <span className="hx">#{b.hash}</span>
                <span className="arrow">◄</span>
                <span className="prev">#{b.prevHash}</span>
              </div>
              <div className="block-detail" dangerouslySetInnerHTML={{ __html: b.e.d }} />
            </div>
          </div>
        ))}
      </div>

      <div className="chain-foot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" strokeLinecap="round" />
        </svg>
        NO BREAK DETECTED · <b>{(START_HEIGHT + idxRef.current).toLocaleString()} BLOCKS VERIFIED</b>
      </div>
    </section>
  );
}
