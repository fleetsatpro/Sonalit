---
name: frontend-design/dark-theme-mastery
description: Dark UI science — elevation via luminance layering, surface hierarchy, contrast in dark contexts, depth without shadows, and theming architecture.
triggers:
  - dark theme
  - dark mode
  - dark UI
  - elevation
  - surface
  - depth
  - luminance
  - contrast
  - light theme
  - theming
related_skills:
  - frontend-design
  - frontend-design/design-review
  - frontend-design/ui-ux-pro
  - frontend-patterns
---

# Dark Theme Mastery

## Purpose

Teaches the science of building professional dark UIs — inspired by Linear, Vercel, Discord, and Figma. Sonalit is a dark-first application with a mature theming system. This skill covers the principles that make dark interfaces readable, layered, and beautiful rather than flat and murky.

## When to Activate

When creating any visual component, choosing surface colours, building elevation hierarchies, or working on theming (dark or light mode).

## The Elevation Ladder — Depth via Luminance

In dark UI, elevation is communicated by luminance, not shadow. Higher surfaces are lighter. Sonalit defines a precise 7-step luminance ladder:

File: `apps/web/src/styles/dashboard.css`

```
Layer 0 (void):     #010407   ← deepest background, behind everything
Layer 1 (carbon):   #050910   ← app chrome (Rail, Topbar)
Layer 2 (deep):     #080e18   ← page background
Layer 3 (well):     #0c1522   ← card backgrounds (d-card)
Layer 4 (surf):     #101926   ← elevated surfaces
Layer 5 (lift):     #182030   ← hover states, active elements
Layer 6 (lift2):    #1e2a3e   ← highest elevation, popovers
```

**The rule**: Every nested container is one step lighter than its parent. Never skip steps — going from `void` directly to `lift` creates a floating-island effect that breaks the depth illusion.

### Luminance Steps

Each step adds approximately 4–6 luminance points (in L* from CIELAB). This matches the human eye's JND (just-noticeable difference) at low luminance — any smaller and layers blend together; any larger and the interface feels striped.

### Two-Token Design System

Sonalit runs two parallel token sets:

| System | Token Prefix | Used By |
|--------|-------------|---------|
| Dashboard | `--d-*` | Command Center, dashboard components, Rail, Topbar |
| Primary | `--p-*` | Standard pages, CDS, portal, features |

Dashboard tokens (`dashboard.css`) are more granular (7 depth levels, signal colours, detailed typography). Primary tokens (`index.css`) are simpler (bg, surface, surface2, border, text, muted).

## Border Strategy

Borders define edges between surfaces at similar luminance levels. Three opacity tiers:

```css
--d-rim:   rgba(255,255,255, .05)   /* subtle separator — between same-level surfaces */
--d-rim2:  rgba(255,255,255, .10)   /* standard card border — one level apart */
--d-rim3:  rgba(255,255,255, .22)   /* emphasis border — interactive elements, focus */
```

**Rule**: Use rim for hairline dividers, rim2 for card outlines, rim3 for focus/active states. Never use solid white or coloured borders on cards — they overpower the surface hierarchy.

## Colour on Dark: Vibrancy Rules

### The 60-30-10 Palette

- **60%**: Neutral dark surfaces (the luminance ladder)
- **30%**: Text hierarchy (4 levels: `--d-t1` through `--d-t4`)
- **10%**: Accent/signal colours

### Signal Colour System

File: `apps/web/src/styles/dashboard.css`

Each signal colour has three forms — solid, glass (translucent background), and glow:

| Signal | Solid | Glass | Glow |
|--------|-------|-------|------|
| Green (OK) | `--d-sig` #22c55e | `--d-sg` rgba(34,197,94,.13) | `--d-sglow` rgba(34,197,94,.6) |
| Orange (accent) | `--d-orange` #f97316 | `--d-og` rgba(249,115,22,.13) | `--d-oglow` rgba(249,115,22,.6) |
| Red (fire) | `--d-fire` #ff4422 | `--d-fg` rgba(255,68,34,.15) | `--d-fglow` rgba(255,68,34,.55) |
| Amber (warn) | `--d-warn` #ffbe2e | `--d-wg` rgba(255,190,46,.13) | — |

**Glass backgrounds**: 10-15% opacity of the signal colour. Used for badge backgrounds, status tints, threat-level strips. Never use solid signal colour as a background — it overwhelms text readability.

**Glows**: 50-60% opacity. Used sparingly for active indicators, pulse animations, and shadow effects. Applied as `box-shadow`, never as `background`.

### Text Hierarchy

4 levels of text in dark UI:

```
--d-t1: #edf3ff   ← primary text, headings, values    (contrast ~13:1)
--d-t2: #8595b4   ← secondary text, labels             (contrast ~4.5:1)
--d-t3: #374c6a   ← tertiary, timestamps, metadata     (contrast ~2:1, decorative only)
--d-t4: #1c2a3e   ← quaternary, subtle dividers         (below WCAG, non-informational only)
```

**Rule**: `--d-t3` and `--d-t4` are decorative — never carry critical information at these levels. Use `--d-t1` for anything a user must read, `--d-t2` for supporting context.

## Light Theme Override

File: `apps/web/src/styles/dashboard.css` (`:root[data-theme="light"]`)

The light theme inverts the entire ladder by redefining every `--d-*` variable. Components that use variables adapt automatically. Components using hardcoded Tailwind classes (`bg-slate-800`) do NOT adapt — that's a known migration gap.

### Light Theme Colour Adjustments

Signal colours shift to darker variants in light mode to maintain contrast:

| Signal | Dark Mode | Light Mode |
|--------|-----------|------------|
| Green | #22c55e | #16a34a |
| Orange | #f97316 | #ea580c |
| Red | #ff4422 | #dc2626 |
| Warn | #ffbe2e | #b45309 |
| Purple | #a855f7 | #7e22ce |

Glass opacities stay similar but over a light base.

## Implementation Patterns

### Threat-Level Tinting

File: `apps/web/src/components/dashboard/ThreatStrip.tsx`

Three-state strip with layered backgrounds:

```css
/* Opaque base UNDER the translucent threat tint */
background: linear-gradient(${style.bg}, ${style.bg}), var(--d-carbon);
```

Compositing a translucent tint over an opaque base prevents content bleed-through when the strip is `position: sticky`.

### Security Level Colour Config

File: `apps/web/src/components/portal/SecurityStatusBar.tsx`

Each level defines solid, glass (bg), border, and Tailwind dot class. This pattern — one config object per severity level — keeps colour consistency across icon, background, border, and indicator.

### Severity Colour Maps

Multiple components share severity → colour mappings. The canonical map pattern:

```typescript
const SEV_COLOR: Record<string, string> = {
  critical: 'var(--d-fire)',
  high: 'var(--d-fire)',
  medium: 'var(--d-warn)',
  low: 'var(--d-ok)',
};
```

### Global Font Override

`dashboard.css` applies `font-family: var(--d-font) !important` on `*` to enforce Inter across ~60 components that previously set inline fonts. `font-variant-numeric: tabular-nums` ensures numeric columns align.

## Relevant Files

- `apps/web/src/styles/dashboard.css` — dashboard token ladder, light theme overrides, animations
- `apps/web/src/index.css` — primary design tokens (--p-*)
- `apps/web/src/components/dashboard/ThreatStrip.tsx` — threat-level tinting pattern
- `apps/web/src/components/portal/SecurityStatusBar.tsx` — security level colour config
- `apps/web/src/components/dashboard/EventsTicker.tsx` — severity colour maps
- `apps/web/src/components/dashboard/OpsSidebar.tsx` — severity colours, donut gauges

## Do

- Follow the luminance ladder — each nested level one step lighter
- Use the three-form colour pattern (solid, glass, glow) for signal colours
- Test new components in both dark AND light themes
- Use CSS custom properties for all colours — never hardcode
- Keep glass backgrounds at 10-15% opacity
- Maintain the 4-level text hierarchy

## Don't

- Skip luminance steps (void → lift creates floating islands)
- Use solid signal colours as backgrounds — use glass (10-15% opacity)
- Use `--d-t3` / `--d-t4` for text the user must read
- Add new colours without defining all three forms (solid, glass, glow)
- Hardcode Tailwind colour classes instead of `var(--d-*)` — they won't theme
- Use `box-shadow` for elevation in dark UI — use luminance
