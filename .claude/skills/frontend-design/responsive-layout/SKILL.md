---
name: frontend-design/responsive-layout
description: Responsive layout architecture — viewport shells, flex/grid composition, mobile drawer navigation, definite-height patterns, and adaptive component strategies.
triggers:
  - responsive
  - mobile
  - layout
  - flexbox
  - grid
  - breakpoint
  - drawer
  - sidebar
  - viewport
  - shell
  - dvh
  - overflow
related_skills:
  - frontend-design
  - frontend-design/ui-ux-pro
  - frontend-design/dark-theme-mastery
  - frontend-patterns
---

# Responsive Layout

## Purpose

Teaches Sonalit's layout architecture — the shell system, definite-height viewport patterns, flex/grid composition, mobile navigation, and the responsive strategies that let 30+ pages work from 360px phones to 2560px ultrawide monitors. Inspired by Linear's adaptive layout, VS Code's panel system, and Bloomberg Terminal's grid density.

## When to Activate

When building page layouts, choosing between flex and grid, handling mobile breakpoints, creating panel/drawer systems, debugging height collapse, or making components work across viewport sizes.

## Three Shells — Three Layout Contexts

File: `apps/web/src/components/layout/AppShell.tsx`

Sonalit routes render inside one of three shell layouts:

| Shell | Route Helper | Chrome | Use Case |
|-------|-------------|--------|----------|
| AppShell | `authRoute` | Topbar + AppLauncherOverlay + GlobalPanicAlarm | Standard pages (fleet, alerts, settings) |
| FullscreenShell | `authFullscreenRoute` | GlobalPanicAlarm only | Immersive views (maps, dashboards, CDS, Drive) |
| PortalLayout | `portalRootRoute` | Portal-specific chrome | External cargo owner pages |

**Decision rule**: If the page needs edge-to-edge rendering (maps, dashboards, reports), use fullscreen. If it needs standard navigation chrome, use AppShell. Portal pages always use PortalLayout.

## The Definite-Height Pattern

File: `apps/web/src/components/layout/AppShell.tsx`

The most important layout rule in the codebase:

```tsx
<div style={{
  display: 'flex',
  flexDirection: 'column',
  height: '100dvh',     // NOT minHeight
  width: '100%',
  minWidth: 0,
  overflowX: 'clip',
  overscrollBehavior: 'contain',
}}>
  <Topbar />
  <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
    <Outlet />
  </main>
</div>
```

### Why `height: 100dvh`, not `minHeight`

Pages like GPS Live Fleet contain maps with `height: 100%`. Percentage heights only resolve against a **definite** parent height. With `minHeight: 100dvh`, the parent's height is `auto` (content-driven), and `100%` children collapse to zero.

### Why `100dvh`, not `100vh`

On mobile browsers, the URL bar shows/hides dynamically. `100vh` is the height with the bar hidden (larger), so content extends under it. `100dvh` (dynamic viewport height) adjusts automatically.

### The `flex: 1` + `minHeight: 0` Pair

```css
main { flex: 1; min-height: 0; overflow-y: auto; }
```

- `flex: 1`: claim all remaining vertical space after Topbar
- `min-height: 0`: override the default `min-height: auto` that prevents flex children from shrinking below content size — without this, a tall page pushes the container past viewport height
- `overflow-y: auto`: scrolling happens inside `<main>`, not on `<body>`

This is the single most common flex layout bug. If a child overflows its flex parent, add `min-height: 0` (or `min-width: 0` for horizontal overflow).

## Topbar — Sticky Header

File: `apps/web/src/components/dashboard/Topbar.tsx`

```tsx
<header style={{
  position: 'sticky',
  top: 0,
  zIndex: 200,
  height: 'var(--d-top-h)',
  background: 'rgba(5,9,16,.92)',
  backdropFilter: 'blur(30px)',
  borderBottom: '1px solid var(--d-rim)',
}}>
```

- **Sticky, not fixed**: stays in the document flow so `<main>` below doesn't need a top offset
- **`--d-top-h` token**: shared height variable so other components can calculate available space
- **Translucent + blur**: content scrolling behind is dimly visible — depth cue without a hard edge
- **z-index 200**: below the Rail (300) and DrawerNav overlay (400), above page content

## Mobile Navigation — Drawer

File: `apps/web/src/components/layout/DrawerNav.tsx`

On mobile, the Rail slides in from the left as a drawer:

```tsx
{/* Scrim overlay */}
<div style={{
  position: 'fixed', inset: 0, zIndex: 299,
  background: 'rgba(0,0,0,.55)',
  backdropFilter: 'blur(4px)',
  opacity: open ? 1 : 0,
  pointerEvents: open ? 'all' : 'none',
  transition: 'opacity .25s',
}} />

{/* Drawer panel */}
<div style={{
  position: 'fixed',
  left: 0, top: 0, bottom: 0,
  width: 272,
  zIndex: 400,
  transform: open ? 'translateX(0)' : 'translateX(-100%)',
  transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
}}>
  <Rail onClose={onClose} />
</div>
```

### Drawer Pattern

- **Scrim**: `rgba(0,0,0,.55)` + `backdrop-filter: blur(4px)` — dims and blurs background
- **Pointer-events toggle**: `none` when closed prevents click interception without removing from DOM
- **Transform animation**: `translateX` (not `left`) for GPU-accelerated slide
- **Escape key**: `useEffect` with `keydown` listener for keyboard dismiss
- **Reuses Rail**: the drawer renders the same `<Rail>` component — one nav, two contexts

## Sidebar Default by Viewport

File: `apps/web/src/stores/ui.ts`

```typescript
const defaultSidebarOpen = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 768px)').matches
  : false;
```

Sidebar starts open on `md+` (desktop), closed on mobile. This is evaluated once at store creation, not reactively — avoids layout jumps during session.

### Theme Persistence

```typescript
partialize: (s) => ({ theme: s.theme }),
```

Only `theme` is persisted to localStorage. `sidebarOpen` re-derives from viewport width on each load — prevents a mobile user who closed sidebar on desktop from getting stuck with it open.

## Grid Composition

### KPI Strip — Flex Wrap

File: `apps/web/src/components/dashboard/KPIStrip.tsx`

```tsx
<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
  {CARDS.map(card => (
    <KPICardComp style={{ flex: '1 1 140px' }} />
  ))}
</div>
```

- `flex: 1 1 140px`: grow to fill, shrink to fit, but never narrower than 140px
- `flexWrap: wrap`: cards wrap to next row at narrow viewports
- Result: 5 cards in a row on desktop, 3+2 on tablet, 2+2+1 on mobile

### Quick Actions — CSS Grid

File: `apps/web/src/components/dashboard/QuickActions.tsx`

```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
```

Fixed 3-column grid — action buttons are small enough that 3 columns work even on 360px.

### When to Use Grid vs Flex

| Pattern | Tool | Example |
|---------|------|---------|
| Cards that wrap and stretch | `flex` + `flex-wrap` + `flex: 1 1 <min>` | KPIStrip |
| Fixed column count | `grid` + `repeat(n, 1fr)` | QuickActions |
| Stack with one growing child | `flex-direction: column` + `flex: 1` | AppShell |
| Sidebar + main | `grid` + `grid-template-columns: auto 1fr` | Dashboard |

## Overflow Handling

### Horizontal Overflow

Tables, code blocks, and wide content MUST scroll in their own container:

```css
.table-container { overflow-x: auto; }
```

The page body must **never** scroll horizontally. `overflowX: 'clip'` on the shell prevents it.

### Vertical Overflow

Each page manages its own vertical scroll inside `<main>`. The shell's `<main>` has `overflow-y: auto`. Nested scroll areas (sidebars, panels) also need explicit `overflow-y: auto` + a definite height.

### Overscroll Containment

```css
overscroll-behavior: contain;
```

Prevents scroll chaining — scrolling to the end of a panel doesn't start scrolling the page behind it. Applied on both the shell column and `<main>`.

## CSS Custom Property Layout Tokens

File: `apps/web/src/styles/dashboard.css`

```css
:root {
  --d-rail-w: 220px;   /* Rail width */
  --d-top-h: 48px;     /* Topbar height */
}
```

Components reference these tokens to calculate available space without magic numbers.

## Z-Index Hierarchy

| Layer | z-index | Component |
|-------|---------|-----------|
| Page content | auto | Regular components |
| Topbar | 200 | Sticky header |
| Rail | 300 | Fixed side navigation |
| Drawer scrim | 299 | Dark overlay behind drawer |
| DrawerNav | 400 | Slide-in mobile nav |
| Modals | 500+ | Dialogs, confirmation overlays |

**Rule**: Use the established z-index bands. Don't create z-indexes above 500 without checking for conflicts.

## Relevant Files

- `apps/web/src/components/layout/AppShell.tsx` — definite-height shell, flex column, overflow
- `apps/web/src/components/layout/DrawerNav.tsx` — mobile drawer, scrim, transform animation
- `apps/web/src/components/dashboard/Topbar.tsx` — sticky header, blur, z-index
- `apps/web/src/components/layout/Rail.tsx` — fixed sidebar, nav groups
- `apps/web/src/stores/ui.ts` — sidebar default, theme persistence, viewport detection
- `apps/web/src/components/dashboard/KPIStrip.tsx` — flex-wrap card grid
- `apps/web/src/components/dashboard/QuickActions.tsx` — CSS grid 3-column
- `apps/web/src/styles/dashboard.css` — layout tokens (--d-rail-w, --d-top-h)

## Do

- Use `height: 100dvh` (not `minHeight`) on the outer shell when children need percentage heights
- Pair `flex: 1` with `min-height: 0` on flex children that might overflow
- Use `transform: translateX` for drawer/panel animations (GPU-accelerated)
- Add `overscroll-behavior: contain` on scrollable panels to prevent scroll chaining
- Reference `--d-rail-w` and `--d-top-h` tokens for layout calculations
- Use `flex: 1 1 <min>px` + `flex-wrap` for cards that should fill and wrap
- Use `overflow-x: auto` on wide-content containers (tables, code blocks)
- Default sidebar open on `md+`, closed on mobile

## Don't

- Use `minHeight: 100vh` when children need `height: 100%` — it won't resolve
- Use `100vh` on mobile — use `100dvh` to account for browser chrome
- Forget `min-height: 0` on flex children — the #1 cause of overflow bugs
- Animate `left`/`width` for panels — use `transform` for smooth 60fps
- Create z-indexes outside the established bands (200/300/400/500)
- Persist sidebar open/close state — re-derive from viewport width on load
- Let `<body>` scroll horizontally — use `overflow-x: clip` on the shell
