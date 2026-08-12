---
name: frontend-design
description: Visual quality and art direction for Sonalit — design tokens, color system, typography, spacing, and dark-theme UI conventions.
triggers:
  - design
  - visual
  - UI
  - color
  - theme
  - dark mode
  - typography
  - font
  - spacing
  - layout
  - CSS
  - tailwind
  - style
related_skills:
  - frontend-design/design-review
  - frontend-design/motion-design
  - frontend-patterns
---

# Frontend Design — Visual Quality & Art Direction

## Purpose

Defines the visual language of Sonalit's interfaces. Ensures every new component, page, or modification maintains visual consistency with the established dark-theme, operations-focused aesthetic.

## When to Activate

Any work involving visual output — new components, page layouts, color choices, typography, or CSS modifications.

## Design System Foundation

File: `apps/web/src/index.css`

### Color Tokens (CSS Custom Properties)

```css
:root {
  --p-bg:        #070b16;       /* primary background */
  --p-surface:   #0e1626;       /* card/panel surfaces */
  --p-surface2:  #0b1120;       /* secondary surface */
  --p-border:    rgba(255,255,255,0.07);  /* subtle borders */
  --p-orange:    #f97316;       /* primary accent (orange-500) */
  --p-orange2:   #ea6c10;       /* secondary accent */
  --p-text:      #e2e8f0;       /* primary text (slate-200) */
  --p-muted:     rgba(226,232,240,0.45);  /* muted text */
}
```

### Typography

- **Primary font**: Archivo (400, 500, 700 weights) — `var(--p-sans)`
- **Monospace font**: IBM Plex Mono (400, 500) — `var(--p-mono)`, class `.mono`
- Use Archivo for all UI text
- Use IBM Plex Mono for data values, codes, coordinates, timestamps

### Body Defaults

```css
body {
  background: #050813;
  color: #e2e8f0;
  font-family: var(--p-sans);
}
```

### Accent Colors (Tailwind classes used in components)

- Primary: `orange-500` (#f97316) — buttons, active states, links
- Alert/critical: `red-500` — panic, critical alerts
- Warning: `amber-500` — medium-severity alerts
- Success: `emerald-500` — completed states
- Info: `blue-500` — informational

### Scrollbar Styling

Thin, orange-tinted scrollbars:
```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-thumb { background: rgba(240, 112, 32, 0.25); border-radius: 2px; }
```
Class `.scrollbar-thin` for Firefox.

### Visual Effects

- **Grain texture**: `.portal-grain::after` — SVG fractalNoise overlay at 3% opacity
- **Glow pulses**: `glow-pulse-red` (critical), `glow-pulse-amber` (warning) — used on panic/alert indicators
- **Glass morphism**: `backdrop-blur` + semi-transparent backgrounds on overlays

## Portal-Specific Design

The cargo owner portal (`/portal/*`) has its own visual identity:
- Class `.portal-root` — uses the same tokens but applies `min-height: 100dvh`
- Orange accents throughout
- Heavy use of grain texture
- More formal typography hierarchy

## Patterns to Follow

### Cards / Panels
- Background: `var(--p-surface)` or semi-transparent with blur
- Border: `var(--p-border)` (1px)
- Border radius: `rounded-xl` (12px) for cards, `rounded-lg` (8px) for smaller elements
- Padding: `p-4` to `p-6`

### Data Display
- Mono font for numeric values: `className="mono"` or `font-family: var(--p-mono)`
- Muted labels, bright values
- Status badges: colored pill with semantic color matching status

### Interactive Elements
- Buttons: orange accent for primary, ghost/outline for secondary
- Hover states: subtle brightness increase, not color change
- Focus: orange ring (`ring-orange-500`)

## Relevant Files

- `apps/web/src/index.css` — design tokens, global styles, animations
- `apps/web/src/styles/dashboard.css` — dashboard-specific styles
- `apps/web/src/styles/orbit.css` — Orbit launcher styles
- `apps/web/src/styles/replay.css` — replay view styles
- `apps/web/tailwind.config.*` — Tailwind configuration

## Do

- Use CSS custom properties for colors
- Use Archivo for text, IBM Plex Mono for data
- Maintain the dark theme aesthetic
- Use orange as the primary accent
- Use semantic colors for status (red=critical, amber=warning, emerald=success)

## Don't

- Introduce light-theme components without dark variants
- Use raw hex colors instead of design tokens
- Mix font families (only Archivo and IBM Plex Mono)
- Use bright white backgrounds — darkest is `#050813`
- Add CSS frameworks beyond Tailwind
