import { IconExternalLink, IconRss } from '@tabler/icons-react'
import { useLiveFeed } from '../hooks/useLiveFeed.js'
import { levelColor, levelBg, levelBorder } from '../utils/colors.js'
import type { LiveFeedItem } from '../types/risk.js'

const SOURCE_LABELS: Record<string, string> = {
  'osint:gdelt': 'GDELT',
  'osint:reliefweb': 'ReliefWeb',
  'osint:claude': 'Claude',
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/^osint:/, '')
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function FeedRow({ item }: { item: LiveFeedItem }) {
  const color = levelColor(item.level)
  const Wrapper = item.external_url ? 'a' : 'div'
  return (
    <Wrapper
      {...(item.external_url ? { href: item.external_url, target: '_blank', rel: 'noopener noreferrer' } : {})}
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 1fr',
        background: '#111927',
        border: '1px solid rgba(255,255,255,.06)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 6,
        textDecoration: 'none',
        color: 'inherit',
        cursor: item.external_url ? 'pointer' : 'default',
      }}
    >
      <div style={{ background: color }} />
      <div style={{ padding: '9px 10px 8px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#6e6c64' }}>{item.zone_code}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e8e6de', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.zone_name}</span>
          <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: levelBg(item.level), color, border: `1px solid ${levelBorder(item.level)}`, textTransform: 'uppercase', flexShrink: 0 }}>{item.level}</span>
        </div>
        <div style={{ fontSize: 11, color: '#c8c6bf', lineHeight: 1.45, marginBottom: 6 }}>{item.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(255,255,255,.06)', color: '#9a9890', fontFamily: 'IBM Plex Mono, monospace' }}>
            {sourceLabel(item.source)}
          </span>
          <span style={{ fontSize: 9, color: '#6e6c64', fontFamily: 'IBM Plex Mono, monospace' }}>{relTime(item.occurred_at)}</span>
          {item.external_url && (
            <IconExternalLink size={11} color="#6e6c64" style={{ marginLeft: 'auto', flexShrink: 0 }} />
          )}
        </div>
      </div>
    </Wrapper>
  )
}

export default function LiveFeedPanel() {
  const { data, isLoading, dataUpdatedAt } = useLiveFeed()
  const items = data?.items ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconRss size={12} color="#F0B429" />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#F0B429' }}>
            Live Feed
          </span>
        </div>
        <div style={{ fontSize: 9, color: '#6e6c64', marginTop: 2 }}>
          {dataUpdatedAt ? `Updated ${relTime(new Date(dataUpdatedAt).toISOString())} · auto-refreshes every 30s` : 'World OSINT, most recent first'}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 11, color: '#4e4c44' }}>Loading feed…</div>
        )}
        {!isLoading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 8px', fontSize: 11, color: '#4e4c44' }}>
            No recent events — all corridors nominal.
          </div>
        )}
        {items.map(item => <FeedRow key={item.id} item={item} />)}
      </div>
    </div>
  )
}
