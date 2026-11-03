import { useEffect, useRef, useState } from 'react';
import OperationsGlobe from './OperationsGlobe';
import { useReducedMotion } from './useReducedMotion';

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function pad(n) { return n.toString().padStart(2, '0'); }

const ASSET_PREFIX = ['GT', 'KV', 'RD', 'AR', 'SE', 'MB', 'LG'];
const STATES = ['SEALED', 'IN TRANSIT', 'CHECKPOINT', 'GEOFENCE OK', 'COLD-CHAIN OK', 'HANDOFF', 'ETA HOLD'];

function telemetryLine(i) {
  const p  = ASSET_PREFIX[Math.floor(hash2(i, 7) * ASSET_PREFIX.length)];
  const id = `${p}-${1000 + Math.floor(hash2(i, 13) * 8999)}`;
  const st = STATES[Math.floor(hash2(i, 19) * STATES.length)];
  const lat = (hash2(i, 23) * 140 - 50).toFixed(2);
  const lon = (hash2(i, 29) * 340 - 170).toFixed(2);
  return `<span><b>${id}</b> · ${lat}°, ${lon}° · <em>${st}</em></span>`;
}

const FEED = [
  { s: 'ok',   t: 'Every custody handoff cryptographically sealed & chained' },
  { s: 'ok',   t: 'Road, air & sea telemetry in one verified timeline' },
  { s: 'ok',   t: 'SOS pipeline — device to dispatch in seconds' },
  { s: 'warn', t: 'Geofence & route-deviation detection, corridor-aware' },
  { s: 'ok',   t: 'Cold-chain monitoring with tamper-evident records' },
  { s: 'ok',   t: 'Daily reports hashed & timestamped — RFC 3161' },
];

// Ease-out cubic count-up — kept as a mini rAF loop rather than a CSS
// counter() so it can honour reducedMotion by snapping to the target.
function useCountUp(target, duration, enabled) {
  const [val, setVal] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) { setVal(target); return undefined; }
    let raf = 0;
    const start = performance.now();
    const frame = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, enabled]);
  return val;
}

export default function Theater() {
  const reducedMotion = useReducedMotion();

  // Ticker HTML — built once, duplicated for seamless -50% marquee.
  const tickerHtml = (() => {
    let line = '';
    for (let i = 0; i < 14; i++) line += telemetryLine(i);
    return line + line;
  })();

  // Capability feed rotator + UTC minute stamp.
  const [feedIdx, setFeedIdx] = useState(0);
  const [feedTime, setFeedTime] = useState('');
  const [feedFading, setFeedFading] = useState(false);
  const feedRef = useRef(0);

  useEffect(() => {
    const stamp = () => {
      const d = new Date();
      setFeedTime(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`);
    };
    stamp();
    if (reducedMotion) return undefined;
    const iv = setInterval(() => {
      setFeedFading(true);
      setTimeout(() => {
        feedRef.current = (feedRef.current + 1) % FEED.length;
        setFeedIdx(feedRef.current);
        stamp();
        setFeedFading(false);
      }, 260);
    }, 4200);
    return () => clearInterval(iv);
  }, [reducedMotion]);

  const countries = useCountUp(40, 1000, !reducedMotion);
  const events    = useCountUp(12, 1300, !reducedMotion);

  const feed = FEED[feedIdx];

  return (
    <section className="theater" aria-hidden="true">
      <OperationsGlobe />

      <div className="theater-hud">
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 2 3 6v6c0 5 3.8 8.7 9 10 5.2-1.3 9-5 9-10V6l-9-4Z" stroke="#F0B429" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M8.5 12.2l2.3 2.3 4.7-4.9" stroke="#F0B429" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="wm">SON<b>A</b>LIT</span>
          <span className="brand-div" />
          <span className="brand-sub">GLOBAL OPERATIONS<br />SECURITY WALL</span>
        </div>

        <div className="eyebrow">CHAIN OF CUSTODY · ROAD · AIR · SEA</div>

        <h1 className="headline">
          <span className="ln"><span>Every shipment.</span></span>
          <span className="ln"><span className="dim">Every kilometer.</span></span>
          <span className="ln"><span className="stroke">Accounted for.</span></span>
        </h1>

        <div className="modes">
          <div className="mode road"><i /><b>ROAD</b></div>
          <div className="mode air"><i /><b>AIR</b></div>
          <div className="mode sea"><i /><b>SEA</b></div>
        </div>

        <div className="feed">
          <span className={'fd ' + feed.s} />
          <span className="ft" style={{ opacity: feedFading ? 0 : 1 }}>{feed.t}</span>
          <span className="ftime">{feedTime}</span>
        </div>
      </div>

      <div className="telemetry">
        <div className="tlabel"><span className="d" />LIVE FLEET FEED</div>
        <div className="tstream">
          {/* eslint-disable-next-line react/no-danger -- content is built from hash2() with pure numeric fields; no user input reaches innerHTML */}
          <div
            className="trow"
            style={reducedMotion ? { animation: 'none' } : undefined}
            dangerouslySetInnerHTML={{ __html: tickerHtml }}
          />
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-l">TRANSPORT MODES</div>
          <div className="stat-v gold">3</div>
          <div className="stat-s">
            <span className="stat-modes">
              <i style={{ background: 'var(--gold)' }} />
              <i style={{ background: 'var(--air)' }} />
              <i style={{ background: 'var(--sea)' }} />
            </span>MULTIMODAL
          </div>
        </div>
        <div className="stat">
          <div className="stat-l">COUNTRIES COVERED</div>
          <div className="stat-v">{countries}<small>+</small></div>
          <div className="stat-s"><span className="d" />SIX CONTINENTS</div>
        </div>
        <div className="stat">
          <div className="stat-l">EVENTS CHAIN-VERIFIED</div>
          <div className="stat-v">{events}<small>M+</small></div>
          <div className="stat-s"><span className="d" />TAMPER-EVIDENT</div>
        </div>
        <div className="stat">
          <div className="stat-l">PLATFORM UPTIME</div>
          <div className="stat-v">99.99<small>%</small></div>
          <div className="stat-s"><span className="d" />TRAILING 12 MO</div>
        </div>
      </div>
    </section>
  );
}
