import { useRef } from 'react'
import { useRiskTicker } from '../hooks/useRiskTicker.js'
import { levelColor } from '../utils/colors.js'

export default function LiveTicker({ continent }: { continent?: string }) {
  const { data } = useRiskTicker(continent)
  const items = data?.items ?? []
  const tickerRef = useRef<HTMLDivElement>(null)

  // Duration was a fixed 40s regardless of how much text there was to
  // scroll through — fine when there were only a couple of items, but with
  // more OSINT sources feeding the ticker it now has to cover far more
  // characters in the same window, so it visibly speeds up. Scale the
  // scroll duration to content length instead, so the pace (not the time)
  // stays constant.
  const totalChars = items.reduce((sum, item) => sum + item.text.length + 20, 0)
  const durationSec = Math.max(20, Math.min(120, totalChars / 12))

  return (
    <div style={{
      background: '#0d1520',
      borderBottom: '1px solid rgba(255,255,255,.07)',
      padding: '5px 0',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', overflow: 'hidden' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 9,
          letterSpacing: '.1em',
          color: '#F0B429',
          flexShrink: 0,
          textTransform: 'uppercase',
        }}>LIVE</span>
        <div ref={tickerRef} style={{ overflow: 'hidden', flex: 1 }}>
          <div style={{
            display: 'inline-flex',
            gap: 32,
            animation: `risk-ticker-scroll ${durationSec}s linear infinite`,
            whiteSpace: 'nowrap',
          }}>
            {[...items, ...items].map((item, i) => (
              <span key={i} style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 10,
                color: levelColor(item.level),
              }}>
                [{item.zone_code}] {item.text}
              </span>
            ))}
            {items.length === 0 && (
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#6e6c64' }}>
                No recent events — all corridors nominal
              </span>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes risk-ticker-scroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  )
}
