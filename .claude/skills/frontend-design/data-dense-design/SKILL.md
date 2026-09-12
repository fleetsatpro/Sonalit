---
name: frontend-design/data-dense-design
description: Data-dense UI patterns — KPI strips, gauges, charts, tickers, threat indicators, and real-time operational dashboards optimised for scanning over reading.
triggers:
  - KPI
  - dashboard
  - chart
  - gauge
  - donut
  - ticker
  - strip
  - data display
  - data density
  - metrics
  - stats
  - real-time
  - count-up
  - recharts
  - data visualization
related_skills:
  - frontend-design
  - frontend-design/dark-theme-mastery
  - frontend-design/ui-ux-pro
  - frontend-design/motion-design
  - frontend-patterns
---

# Data-Dense Design

## Purpose

Teaches how Sonalit builds operations dashboards where users scan rather than read. Covers KPI cards, donut gauges, bar charts, event tickers, threat strips, and status composites — all designed for maximum information density with zero visual clutter. Inspired by Bloomberg Terminal, mission control UIs, and Linear's information architecture.

## When to Activate

When building dashboard sections, KPI cards, gauges, charts, data strips, status indicators, or any component whose primary purpose is to communicate a number, trend, or state at a glance.

## The Number Is the Hero

Operations UIs invert the typical web hierarchy. The number (or status) is the largest, brightest element. The label is secondary — small, muted, uppercase. The user's eye finds the value first, then confirms what it measures.

### KPI Card Anatomy

File: `apps/web/src/components/dashboard/KPIStrip.tsx`

```
┌─────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← 3px colour-coded top border
│                                 │
│  VEHICLES                       │  ← 9px IBM Plex Mono, signal colour, uppercase
│  42                             │  ← 40px Orbitron, --d-t1, animated count-up
│                                 │
└─────────────────────────────────┘
```

Key implementation details:

| Property | Value | Reason |
|----------|-------|--------|
| Font (value) | Orbitron 800 / 40px | Heavy weight + display font = scannable from 2m |
| Font (label) | IBM Plex Mono 600 / 9px | Monospace + small caps = unobtrusive label |
| Letter-spacing (label) | `.14em` | Uppercase needs generous tracking to breathe |
| Top border | `3px solid ${card.color}` | Colour codes the metric at a glance |
| Box-shadow | `0 -2px 12px ${card.color}22` | Subtle glow reinforces the colour coding |
| Clip-path | `polygon(0 0, calc(100%-13px) 0, 100% 13px, 100% 100%, 0 100%)` | Chamfered corner — tactical/mil-spec feel |
| Flex | `1 1 140px` + flexWrap | Cards fill available width, wrap at narrow viewports |
| Background | `var(--d-well)` | One step above page bg on the luminance ladder |

### Config-Driven Card Array

```typescript
const CARDS: KPICard[] = [
  { key: 'vehicles_live', label: 'VEHICLES', color: 'var(--d-sig)', path: '/fleet' },
  { key: 'convoys_active', label: 'CONVOYS', color: 'var(--d-ok)', path: '/convoys' },
  ...
];
```

Each card is a `button` — clicking navigates to the detail page. Single config array owns label, colour, path, unit, and precision. Add a new KPI by adding one object.

## Animated Count-Up

File: `apps/web/src/components/dashboard/KPIStrip.tsx` — `useCountUp` hook

Numbers sweep from 0 to target on first render using `requestAnimationFrame`:

```typescript
function useCountUp(target: number, active: boolean): number {
  const dur = Math.min(800, target * 20 + 200);  // dynamic duration
  const ease = 1 - Math.pow(1 - t, 3);            // cubic ease-out
  ...
}
```

- **Duration scales with magnitude**: small numbers animate faster (200ms), large numbers cap at 800ms
- **Cubic ease-out**: most movement happens early, settles gently into final value
- **RAF-based**: smooth 60fps, cancels on unmount via `cancelAnimationFrame`

**Rule**: Every KPI that first appears must animate. Static numbers feel stale in a live operations context.

## Loading State — Skeleton with Pulse

When KPI data hasn't arrived, KPIStrip renders ghost cards:

```tsx
<div style={{ flex: '1 1 140px', height: 96, background: 'var(--d-well)',
  border: '1px solid var(--d-rim)', animation: 'd-pulse-warn 1.5s ease-in-out infinite' }} />
```

Same dimensions as the real cards so layout doesn't shift. The `d-pulse-warn` animation (opacity pulse) tells the user data is in flight.

## Donut Gauge

File: `apps/web/src/components/dashboard/OpsSidebar.tsx` — `DonutGauge`

SVG-based arc gauge for percentage values:

```
         ╭─────╮
        ╱  87%  ╲      ← centre value (Orbitron, large)
       │         │
        ╲       ╱      ← coloured arc (strokeDasharray)
         ╰─────╯
        RESPONSE        ← label below (IBM Plex Mono)
```

Implementation pattern:

```typescript
const C = 2 * Math.PI * 38;  // circumference of r=38 circle
const offset = C - (C * pct / 100);  // how much to hide

<circle r={38} cx={50} cy={50}
  stroke={color}
  strokeWidth={6}
  strokeDasharray={C}
  strokeDashoffset={offset}
  strokeLinecap="round"
  transform="rotate(-90 50 50)"  // start at 12 o'clock
  style={{ transition: 'stroke-dashoffset .8s ease-out' }}
/>
```

- **Rotate -90°**: CSS circles start at 3 o'clock; rotate so the arc begins at 12
- **Transition on offset**: arc animates when value changes
- **Track behind**: a second circle at `stroke: var(--d-rim)` shows the unfilled portion
- **Colour by severity**: uses the same `SEV_COLOR` map as alerts (`critical → --d-fire`, `high → --d-fire`, `medium → --d-warn`, `low → --d-ok`)

## Bar Charts — Recharts Integration

File: `apps/web/src/components/dashboard/PerformanceChart.tsx`

Lazy-loaded via `React.lazy` to avoid a 200KB synchronous bundle hit:

```typescript
const { BarChart, Bar, ... } = await import('recharts');
```

### Dynamic Bar Colouring

Each bar is coloured by its value:

```typescript
const barColor = (v: number) =>
  v >= 95 ? '#16c784' :   // green — excellent
  v >= 85 ? 'var(--d-sig)' : // signal green — good
  v >= 75 ? 'var(--d-warn)' : // amber — needs attention
  'var(--d-fire)';            // red — critical
```

**Rule**: Colour encodes severity, not identity. The user glances at the chart and instantly knows which metrics need attention.

### Dark-Themed Tooltip

```tsx
<Tooltip contentStyle={{
  background: 'var(--d-carbon)',
  border: '1px solid var(--d-rim2)',
  borderRadius: 8,
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 11,
}} />
```

Tooltips blend into the dark UI — no white flash.

## Event Ticker — Infinite Scroll

File: `apps/web/src/components/dashboard/EventsTicker.tsx`

Continuously scrolling horizontal strip of recent events:

### Seamless Loop Technique

```typescript
const doubled = [...events, ...events];  // duplicate array
```

CSS animation scrolls the full width of the original array, then jumps back. Because the array is doubled, the jump is invisible — the second copy is already in position.

### Mask-Image Fade Edges

```css
mask-image: linear-gradient(90deg, transparent, #000 60px, #000 calc(100% - 60px), transparent);
```

Fades events at both edges, so they appear to emerge from and dissolve into the background. No hard clip.

### Hover Pause

```css
.d-ticker-track:hover { animation-play-state: paused; }
```

The user can freeze the ticker to read an event, then release.

### Severity Colour Map

Each event is tinted by severity:

```typescript
const SEV: Record<string, { bg: string; dot: string }> = {
  critical: { bg: 'rgba(255,68,34,.12)', dot: 'var(--d-fire)' },
  high:     { bg: 'rgba(255,68,34,.08)', dot: 'var(--d-fire)' },
  medium:   { bg: 'rgba(255,190,46,.08)', dot: 'var(--d-warn)' },
  low:      { bg: 'rgba(34,197,94,.08)', dot: 'var(--d-ok)' },
};
```

Glass backgrounds (8-12% opacity) — never solid.

## Threat Strip — Three-Level Indicator

File: `apps/web/src/components/dashboard/ThreatStrip.tsx`

Full-width strip that communicates the current threat level:

| Level | Colour | Animation |
|-------|--------|-----------|
| Secure | Green (`--d-sig`) | Static green bar |
| Elevated | Amber (`--d-warn`) | None |
| Critical | Red (`--d-fire`) | `d-crit` pulse animation |

### Composited Background

```css
background: linear-gradient(${tint}, ${tint}), var(--d-carbon);
```

Translucent threat tint OVER an opaque base. This prevents content bleed-through when the strip is `position: sticky` — a pure `rgba()` background would show whatever scrolls behind it.

### Shift Timer

The strip includes a hook that calculates elapsed shift time. Shift awareness (how long the operator has been working) is an ops-UI convention — fatigue affects judgment.

## Quick Actions Grid

File: `apps/web/src/components/dashboard/QuickActions.tsx`

3-column grid of action buttons:

```
┌──────────┬──────────┬──────────┐
│▓▓ orange │▓▓ red    │▓▓ green  │  ← 2px colour accent bar
│ 🚛       │ 🔔       │ 📡       │
│New Convoy│ Alerts   │ GPS Live │
└──────────┴──────────┴──────────┘
```

- Config array: `{ icon, label, path, color }`
- Each button is a `<button>` with `onClick → navigate`
- 2px colour-coded accent bar at `position: absolute; top: 0`
- Label in IBM Plex Mono 11px — consistent with KPI labels

## Section Headers

The `SH` (Section Header) pattern used across dashboard components:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
  <div style={{ width: 3, height: 14, background: 'var(--d-orange)', borderRadius: 2 }} />
  <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11,
    letterSpacing: '.12em', color: 'var(--d-t1)' }}>SECTION TITLE</span>
</div>
```

- 3×14px coloured accent bar (left-aligned, `--d-orange` by default)
- Orbitron 700 / 11px — display font for headers
- `.12em` letter-spacing — generous tracking for uppercase display text

## Portal Stat Cards

File: `apps/web/src/components/portal/PortalPrimitives.tsx`

Simpler stat card for the cargo owner portal:

```tsx
<StatCard label="VEHICLES" value={42} accent="green" />
```

- Label: `text-xs text-white/40 uppercase tracking-widest`
- Value: `font-mono text-2xl text-white`
- Accent: coloured border glow via `box-shadow`

## Relevant Files

- `apps/web/src/components/dashboard/KPIStrip.tsx` — KPI cards, count-up hook, skeleton loading
- `apps/web/src/components/dashboard/OpsSidebar.tsx` — DonutGauge, severity feed, slide-in animation
- `apps/web/src/components/dashboard/PerformanceChart.tsx` — Recharts bar chart, dynamic colouring
- `apps/web/src/components/dashboard/EventsTicker.tsx` — infinite scroll ticker, severity map
- `apps/web/src/components/dashboard/ThreatStrip.tsx` — threat level strip, composited backgrounds
- `apps/web/src/components/dashboard/QuickActions.tsx` — action grid, section header pattern
- `apps/web/src/components/portal/PortalPrimitives.tsx` — StatCard, Badge, ProgressBar
- `apps/web/src/styles/dashboard.css` — animation keyframes (d-pulse-warn, d-count-in, d-bar-grow)

## Do

- Make the number the largest element — label is secondary
- Animate value transitions with count-up or strokeDashoffset
- Use config arrays for homogeneous card/button sets
- Colour-code by severity, not identity — red=critical, amber=warning, green=ok
- Use glass backgrounds (8-15% opacity) for severity tints
- Lazy-load heavy chart libraries (`React.lazy` / dynamic `import()`)
- Show skeleton/pulse loading states that match final card dimensions
- Use monospace (IBM Plex Mono) for all numeric values — tabular-nums for column alignment

## Don't

- Make labels bigger than values — the number is the hero
- Use solid signal colours as backgrounds — glass only
- Static-render numbers on first load — always animate
- Import Recharts synchronously — it's 200KB+
- Skip loading states — blank cards break the scanning rhythm
- Mix serif/sans-serif fonts in data displays
- Use different severity colour maps across components — share the canonical map
