---
name: frontend-design/accessibility
description: Accessibility patterns — WCAG compliance, axe-core testing, keyboard navigation, ARIA, focus management, colour contrast, screen readers, and reduced motion.
triggers:
  - accessibility
  - a11y
  - WCAG
  - ARIA
  - screen reader
  - keyboard navigation
  - focus
  - contrast
  - axe-core
  - reduced motion
  - prefers-reduced-motion
  - semantic HTML
  - tab order
related_skills:
  - frontend-design
  - frontend-design/ui-ux-pro
  - frontend-design/dark-theme-mastery
  - testing
---

# Accessibility

## Purpose

Defines the accessibility baseline for Sonalit's frontend — WCAG 2.1 AA compliance targets, automated testing with axe-core, keyboard navigation patterns, ARIA usage, focus management, colour contrast requirements, and reduced motion support. Operations dashboards serve users who may rely on keyboard navigation, screen readers, or high-contrast modes.

## When to Activate

When creating any interactive component, form, modal, drawer, navigation element, or data display. Also when reviewing existing components for accessibility compliance.

## Testing Infrastructure

### axe-core via Playwright

File: `apps/web/tests/e2e/accessibility.spec.ts`

E2E accessibility auditing using `@axe-core/playwright`:

```typescript
import AxeBuilder from '@axe-core/playwright';

const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .analyze();
```

Run with: `cd apps/web && pnpm test:e2e -- accessibility`

### axe-core via Vitest

For component-level accessibility testing:

```typescript
import { axe, toHaveNoViolations } from 'vitest-axe';
import { render } from '@testing-library/react';

expect.extend(toHaveNoViolations);

test('Button is accessible', async () => {
  const { container } = render(<Button>Click me</Button>);
  expect(await axe(container)).toHaveNoViolations();
});
```

## WCAG 2.1 AA Targets

### Colour Contrast

The dark theme must maintain these ratios:

| Element | Minimum Ratio | Sonalit Token | Actual |
|---------|--------------|---------------|--------|
| Body text | 4.5:1 | `--d-t1` (#edf3ff) on `--d-deep` (#080e18) | ~13:1 |
| Secondary text | 4.5:1 | `--d-t2` (#8595b4) on `--d-deep` | ~4.5:1 |
| Large text (18px+) | 3:1 | Same tokens | Passes |
| Decorative text | No minimum | `--d-t3`, `--d-t4` | Below WCAG |

**Rule**: `--d-t3` and `--d-t4` are decorative only — never use them for text the user must read.

### Interactive Elements

- Minimum touch target: **44x44px** on mobile
- All buttons, links, and controls must be keyboard-reachable
- All interactive elements must have visible focus indicators

## Keyboard Navigation

### Focus Indicators

```css
/* Standard focus ring */
:focus-visible { outline: 2px solid var(--d-orange); outline-offset: 2px; }

/* Tailwind equivalent */
className="focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
```

- Use `:focus-visible`, not `:focus` — avoids showing focus rings on mouse clicks
- Orange ring matches the brand accent
- 2px offset prevents the ring from overlapping content

### Tab Order

- Natural DOM order = tab order. Don't use `tabindex > 0`
- `tabindex="0"` to make non-interactive elements focusable (use sparingly)
- `tabindex="-1"` for programmatic focus (e.g., after closing a modal, return focus to trigger)

### Keyboard Patterns

| Component | Keys | Implementation |
|-----------|------|----------------|
| Modal/Dialog | Escape closes | `useEffect` with `keydown` listener |
| Drawer | Escape closes | Same pattern (see DrawerNav.tsx) |
| Dropdown | Escape closes, Arrow keys navigate | Per component |
| Tabs | Arrow keys switch tabs | `role="tablist"` + `role="tab"` |
| Data table | Arrow keys navigate cells (optional) | Not required for basic tables |

### Focus Trapping

Modals and drawers must trap focus:

```typescript
useEffect(() => {
  if (!open) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [open, onClose]);
```

For full focus trapping (Tab cycles within modal), use `inert` on background content or manage first/last focusable elements.

## Semantic HTML

### Prefer Native Elements

| Need | Use | Don't Use |
|------|-----|-----------|
| Navigation | `<nav>` | `<div role="navigation">` |
| Main content | `<main>` | `<div role="main">` |
| Header | `<header>` | `<div role="banner">` |
| Button | `<button>` | `<div onClick>` |
| Link | `<a href>` | `<span onClick>` |
| List | `<ul>/<li>` | `<div>/<div>` |
| Table | `<table>/<tr>/<td>` | `<div>` grid |
| Heading | `<h1>`–`<h6>` | `<div class="heading">` |

### Heading Hierarchy

- One `<h1>` per page
- Don't skip levels (`<h1>` → `<h3>` without `<h2>`)
- Section headers in dashboard components use visual styling (Orbitron, uppercase) but should still be semantic headings when they label a content section

## ARIA — Use Sparingly

### When to Use ARIA

Only when semantic HTML is insufficient:

| Situation | ARIA |
|-----------|------|
| Live-updating data (KPIs, tickers) | `aria-live="polite"` |
| Status messages (toasts) | `role="status"` + `aria-live="polite"` |
| Loading states | `aria-busy="true"` |
| Icon-only buttons | `aria-label="Close"` |
| Expandable content | `aria-expanded="true/false"` |
| Progress (gauges, bars) | `role="progressbar"` + `aria-valuenow` |
| Alerts (panic, critical) | `role="alert"` + `aria-live="assertive"` |

### Sonalit-Specific ARIA

```tsx
{/* KPI that updates in real time */}
<div role="status" aria-live="polite" aria-label={`${card.label}: ${value}`}>
  {display}
</div>

{/* Donut gauge */}
<svg role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
     aria-label={`${label}: ${pct}%`}>

{/* Toast notification */}
<div role="status" aria-live="polite">
  Update available — click to reload
</div>

{/* Global panic alarm */}
<div role="alert" aria-live="assertive">
  PANIC ALERT — Vehicle ABC123
</div>
```

### Common ARIA Mistakes

- Adding `role="button"` to a `<button>` — redundant
- Using `aria-label` on elements that already have visible text — redundant
- Adding ARIA to decorative elements — noise for screen readers
- Using `aria-live="assertive"` for non-urgent updates — use `polite`

## Status Communication

**Rule**: Never communicate status by colour alone.

| Good | Bad |
|------|-----|
| Red dot + "CRITICAL" text + AlertTriangle icon | Red dot only |
| Green badge "ACTIVE" | Green dot only |
| Amber pulse + "WARNING" label | Yellow background only |

Every status indicator in Sonalit uses at least two channels: colour + text, or colour + icon.

## Reduced Motion

File: `apps/web/src/styles/dashboard.css`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This disables ALL animations and transitions for users who prefer reduced motion. New animations must be defined in `dashboard.css` where this media query will catch them — inline `animation` styles bypass it.

## Image and Media Accessibility

- **Decorative images**: `alt=""` (empty alt, not missing)
- **Informative images**: descriptive alt text
- **SVG icons**: `aria-hidden="true"` when paired with text, `aria-label` when standalone
- **Maps**: provide text alternative or summary of displayed data

## Form Accessibility

```tsx
{/* Label + input association */}
<label htmlFor="convoy-name" className="text-xs text-white/40 uppercase tracking-widest">
  Convoy Name
</label>
<input id="convoy-name" type="text" aria-required="true" />

{/* Error message association */}
<input id="speed" aria-invalid="true" aria-describedby="speed-error" />
<span id="speed-error" className="text-red-400 text-xs">Speed must be positive</span>
```

- Every input needs a visible `<label>` with matching `htmlFor`/`id`
- Error messages linked via `aria-describedby`
- Required fields marked with `aria-required="true"`

## Relevant Files

- `apps/web/tests/e2e/accessibility.spec.ts` — Playwright + axe-core E2E audit
- `apps/web/src/styles/dashboard.css` — prefers-reduced-motion media query
- `apps/web/src/components/layout/DrawerNav.tsx` — Escape key dismiss pattern
- `apps/web/src/components/layout/GlobalPanicAlarm.tsx` — role="alert" for panic
- `apps/web/src/components/UpdateAvailableToast.tsx` — role="status" for toasts
- `apps/web/src/components/dashboard/KPIStrip.tsx` — live-updating values

## Do

- Use semantic HTML before reaching for ARIA
- Test with axe-core (`pnpm test:e2e -- accessibility`)
- Add `aria-label` to icon-only buttons
- Use `aria-live="polite"` for KPIs and status updates
- Use `role="alert"` only for urgent notifications (panic)
- Add visible focus indicators (`:focus-visible` + orange ring)
- Respect `prefers-reduced-motion` for all animations
- Communicate status with colour + text/icon (never colour alone)
- Test keyboard navigation: Tab, Escape, Enter, Space, Arrow keys

## Don't

- Add ARIA roles that duplicate native semantics (`role="button"` on `<button>`)
- Use `<div onClick>` when `<button>` works
- Skip heading levels (`<h1>` → `<h3>`)
- Use `tabindex > 0` — it disrupts natural tab order
- Use `aria-live="assertive"` for routine updates
- Put critical info in `--d-t3` or `--d-t4` text colours (below WCAG contrast)
- Define inline animations that bypass the reduced-motion media query
- Use `outline: none` without providing an alternative focus indicator
