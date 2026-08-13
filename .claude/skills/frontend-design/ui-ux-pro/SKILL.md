---
name: frontend-design/ui-ux-pro
description: UI/UX professional patterns — information architecture, interaction design, component composition, state feedback, accessibility, and ops-focused UX conventions.
triggers:
  - UX
  - user experience
  - usability
  - information architecture
  - navigation
  - empty state
  - error state
  - loading state
  - feedback
  - affordance
  - accessibility
  - a11y
  - responsive
  - mobile
  - drawer
  - modal
  - toast
  - notification
  - form
  - data table
  - KPI
related_skills:
  - frontend-design
  - frontend-design/design-review
  - frontend-design/motion-design
  - frontend-patterns
---

# UI/UX Professional Patterns

## Purpose

Teaches the UI/UX conventions established across Sonalit's codebase — information architecture, state feedback, component composition, interaction design, and accessibility patterns. Where the design skill teaches how it looks, this skill teaches how it works and feels.

## When to Activate

When designing new pages, adding interactive components, handling user flows, creating data displays, or making decisions about navigation, feedback, state management, or mobile responsiveness.

## Information Architecture

### Navigation Model — Rail + Groups

File: `apps/web/src/components/layout/Rail.tsx`

The Rail organises 30+ pages into 5 colour-coded nav groups:

| Group | Hue (RGB) | Purpose |
|-------|-----------|---------|
| Command | `255,178,62` (amber) | Real-time ops: dashboard, GPS, replay, panic, messages, AI |
| Security | `255,59,92` (red) | Alerts, signal health, risk intel, guardian, geofences, corridors |
| Surveillance | `183,157,255` (purple) | Covert captures, incident replay, 3D drive replay |
| Fleet | `55,230,255` (cyan) | Convoys, fleet, drivers, field officers, devices, fuel, maintenance |
| Business | `34,227,154` (green) | Shipments, portal, analytics, reports, finance, claims, settings |
| Container Management | `255,122,0` (orange) | CDS sub-app (own chrome, no Rail) |

**Principle**: Group by colour before label. A user finds a section by its hue, then scans the label. Keep groups under ~8 items.

### Three Shells = Three UX Contexts

| Shell | Chrome | Use Case |
|-------|--------|----------|
| `authRoute` → AppShell | Rail + Topbar + mobile drawer | Standard operational pages |
| `authFullscreenRoute` → FullscreenShell | None (only GlobalPanicAlarm overlay) | Immersive: maps, dashboards, CDS, Drive |
| `portalRootRoute` → PortalLayout | Portal-specific chrome | External cargo owner pages |

Choose the shell by UX need, not by page importance.

## State Feedback Patterns

Every data-driven component MUST handle four states. Sonalit has established patterns for each:

### 1. Loading State

Skeleton or spinner, never blank space. Use `Loader2` from Lucide with spin animation for inline loading:

```tsx
<Loader2 size={16} className="animate-spin text-slate-400" />
```

KPIs use animated count-up (`useCountUp` in `KPIStrip.tsx`) — values visibly sweep from 0 to target on load.

### 2. Empty State

File: `apps/web/src/components/dashboard/CompactEmpty.tsx`

Pattern: icon + title + message + subtle "awaiting data" indicator. Dashboard empty states use section-specific icons, accent colour bar, and animated dot indicators:

```tsx
<CompactEmpty accent={sectionColor} title="DRIVER BEHAVIOR" message="No driving events recorded" />
```

For empty lists: centre-aligned icon + explanation + optional action button. Never show a raw empty `<div>`.

### 3. Error State

File: `apps/web/src/components/dashboard/DataError.tsx`

Pattern: warning icon + section name (uppercase, accent colour) + "Failed to load" message + Retry button:

```tsx
<DataError section="Route Risk Intelligence" onRetry={() => refetch()} />
```

Full-page errors: `RootErrorComponent` in `ErrorBoundary.tsx` — centred card with error message, request ID (for support), Reload button (primary orange), and Report Bug link.

### 4. Offline State

File: `apps/web/src/components/OfflineGuard.tsx`

Full-screen takeover: WifiOff icon + "You're offline" + retry button. Wraps the app root — children render only when online.

## Component Composition Patterns

### Stat Cards (KPIs)

File: `apps/web/src/components/portal/PortalPrimitives.tsx`

`StatCard`: label (uppercase, tracking-widest, white/40 opacity) + value (mono font, 2xl, white) + optional sub-text. Accent-tinted border glow:

```tsx
<StatCard label="VEHICLES" value={42} accent="green" />
```

KPI strips: flexbox row, each card `flex: 1 1 140px`, coloured top border (3px) with matching box-shadow glow.

### Badges

`Badge` component: status-semantic colours in dark-theme pill form:

| Status | Style |
|--------|-------|
| `in_transit` | green-900/40 bg, green-400 text |
| `completed` | blue-900/40 bg, blue-400 text |
| `pending` | gray-700/30 bg, gray-400 text |
| `cancelled` / `critical` | red-900/40 bg, red-400 text |
| `warning` | amber-900/40 bg, amber-400 text |
| `intact` | green (same as in_transit) |
| `compromised` | red (same as critical) |

Fallback: gray for unknown variants. Always `rounded-full`, `text-xs`, `font-semibold`.

### Progress Bar

`ProgressBar`: 1.5px height, `bg-white/10` track, `bg-orange-500` fill, clamped 0–100%, `transition-all duration-700`.

### Drawers

Pattern from `VehicleDetailDrawer.tsx`, `AlertsDrawer.tsx`, `MissionControlDrawer.tsx`:
- Fixed position, slides in from right
- Close button (X icon) top-right
- Header with title + optional actions
- Scrollable content area
- Semi-transparent backdrop

### Modals

Pattern from `CreateGeofenceModal.tsx`:
- Centred overlay with backdrop blur
- Card-style container (`rounded-xl`, `var(--p-surface)`)
- Header bar, scrollable body, action footer
- Escape key and backdrop click to close

### Toasts / Notifications

`UpdateAvailableToast.tsx` pattern: `fixed bottom-4 right-4 z-50`, `rounded-lg bg-slate-800`, with action button. Short-lived, non-blocking.

## Quick Actions Pattern

File: `apps/web/src/components/dashboard/QuickActions.tsx`

Grid of action buttons (3 columns): emoji icon + label, coloured top accent bar (2px), hover border transition. Each navigates to a route. Good pattern for "what can I do from here?" affordances.

## Form Patterns

### Input Styling

Inputs follow dark-theme conventions:
- Background: `bg-slate-800` or `var(--p-surface)`
- Border: `border-slate-700` or `var(--p-border)`
- Focus: `ring-2 ring-orange-500`
- Text: `text-white` for values, `text-slate-400` for placeholders
- Labels: `text-xs text-white/40 uppercase tracking-widest`

### Validation Feedback

Inline errors below fields. Error text: `text-red-400 text-xs`. Icon: `AlertCircle` from Lucide.

### Form Actions

Primary button: `bg-orange-600 hover:bg-orange-500`, secondary: `bg-slate-700 hover:bg-slate-600`. Loading state: `Loader2` spinner replaces button text + `disabled`.

## Data Tables

### Column Alignment

- Text: left-aligned
- Numbers: right-aligned
- Status badges: left-aligned
- Actions: right-aligned

### Row Styling

Alternating stripe: `var(--d-lift)` or subtle background variation. Hover: brightness increase. Clickable rows: `cursor-pointer` + full-row highlight.

### Pagination

Standard pattern: `limit` (cap 200, default 50) + `offset`. Show "Showing X–Y of Z" text. Previous/Next buttons.

## Mobile / Responsive

### Breakpoint Strategy

- Mobile: `< 768px` → single column, bottom nav, drawers instead of sidebars
- Tablet: `768–1024px` → collapsed Rail, adaptive layouts
- Desktop: `> 1024px` → full Rail, multi-column layouts

### Mobile Navigation

File: `apps/web/src/components/layout/DrawerNav.tsx`

On mobile: Rail collapses to a hamburger-triggered drawer. Bottom nav for primary actions.

### Touch Targets

Minimum 44×44px for interactive elements on mobile. Button padding: `py-2 px-4` minimum.

### Horizontal Overflow

Tables and wide content: `overflow-x: auto` on a container. Page body MUST never scroll horizontally.

## Ops-UI Specific UX

### Real-Time Data

- Stale data: show last-updated timestamp, muted style
- Live updates: subtle flash or pulse on value change
- Connection status: indicator in UI when WebSocket disconnects

### Severity Escalation

Visual severity MUST escalate predictably:

| Level | Colour | Animation | Sound |
|-------|--------|-----------|-------|
| Info | blue | none | none |
| Warning | amber | `glow-pulse-amber` (optional) | none |
| Critical | red | `glow-pulse-red` | browser notification |
| Panic | red | continuous pulse + full-screen overlay | alarm |

### Data Density

Operations users scan dashboards, not read them. Optimise for:
- Monospace numbers for scannable alignment
- Uppercase section headers (Orbitron/system font, letter-spacing)
- KPI-first: the number is the hero, the label is secondary
- Compact empty states that don't waste vertical space

## Accessibility Baseline

- Colour contrast: 4.5:1 for text, 3:1 for large text
- Focus indicators: `ring-2 ring-orange-500` on keyboard navigation
- Icons: always pair with `aria-label` or visible text label
- Status: convey by icon + colour, never colour alone
- `role="status"` + `aria-live="polite"` on toasts/alerts
- `prefers-reduced-motion`: respect in all animations

## Relevant Files

- `apps/web/src/components/layout/Rail.tsx` — navigation groups, rail structure
- `apps/web/src/components/layout/AppShell.tsx` — app chrome
- `apps/web/src/components/layout/DrawerNav.tsx` — mobile navigation
- `apps/web/src/components/layout/GlobalPanicAlarm.tsx` — panic overlay
- `apps/web/src/components/dashboard/CompactEmpty.tsx` — empty state pattern
- `apps/web/src/components/dashboard/DataError.tsx` — error state pattern
- `apps/web/src/components/dashboard/KPIStrip.tsx` — KPI cards with count-up
- `apps/web/src/components/dashboard/QuickActions.tsx` — action grid
- `apps/web/src/components/portal/PortalPrimitives.tsx` — StatCard, Badge, ProgressBar
- `apps/web/src/components/ErrorBoundary.tsx` — full-page error
- `apps/web/src/components/OfflineGuard.tsx` — offline state
- `apps/web/src/components/UpdateAvailableToast.tsx` — toast pattern
- `apps/web/src/components/VehicleDetailDrawer.tsx` — drawer pattern
- `apps/web/src/components/geofences/CreateGeofenceModal.tsx` — modal pattern

## Do

- Handle all four states (loading, empty, error, data) in every data component
- Use established component patterns (CompactEmpty, DataError, StatCard, Badge)
- Group nav items by colour — keep groups under 8 items
- Use monospace for numbers, uppercase tracking-widest for section labels
- Pair icons with text labels or aria-labels
- Test at mobile (360px), tablet (768px), and desktop widths
- Use drawers for detail views, modals for creation/confirmation

## Don't

- Show blank space instead of a loading or empty state
- Display raw error messages to users — use DataError or RootErrorComponent
- Create new nav groups without a distinct colour hue
- Put more than ~8 items in a nav group
- Use modals for content that needs scrolling — use drawers instead
- Ignore keyboard navigation and focus management
- Skip the severity escalation ladder (info → warning → critical → panic)
- Make touch targets smaller than 44px on mobile
