---
name: frontend-design/motion-design
description: Animation and interaction patterns — enter/exit transitions, glow pulses, and motion conventions for Sonalit's operational UI.
triggers:
  - animation
  - transition
  - motion
  - animate
  - fade
  - slide
  - glow
  - pulse
  - interaction
related_skills:
  - frontend-design
  - frontend-design/design-review
  - frontend-patterns
---

# Motion Design

## Purpose

Defines animation and interaction patterns for Sonalit's UI. Operations-focused interfaces need purposeful motion — animations that communicate state changes, not decoration.

## When to Activate

When adding animations, transitions, or interactive feedback to any Sonalit component.

## Established Animation Keyframes

File: `apps/web/src/index.css`

### Entry Animations

```css
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

Utility classes:
- `.animate-fade-in-up` — primary card/content entry, `0.45s cubic-bezier(0.16, 1, 0.3, 1)`

### Alert / Status Pulses

```css
@keyframes glow-pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  50%      { box-shadow: 0 0 14px 3px rgba(239, 68, 68, 0.3); }
}

@keyframes glow-pulse-amber {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
  50%      { box-shadow: 0 0 10px 2px rgba(245, 158, 11, 0.25); }
}
```

- Red glow pulse: critical alerts, active panic
- Amber glow pulse: warnings, attention-needed states

## Motion Principles

### 1. Purpose Over Polish
Every animation should communicate something:
- **Entry**: content is loading or appearing (`fade-in-up`)
- **Attention**: something needs action (`glow-pulse-red/amber`)
- **State change**: status transition (brief color flash)
- **Feedback**: user action registered (button press)

### 2. Duration Guidelines
- Micro-interactions (button hover, toggle): 150-200ms
- Content entry: 300-450ms
- Page transitions: 200-300ms
- Continuous pulses: 2-3s cycle

### 3. Easing
- Entry: `cubic-bezier(0.16, 1, 0.3, 1)` — fast start, gentle settle
- Exit: `cubic-bezier(0.4, 0, 1, 1)` — accelerate out
- Interactive: `ease-out` for most hover/focus states

### 4. Staggering
For lists of items appearing (e.g., cards loading):
```css
.animate-fade-in-up:nth-child(1) { animation-delay: 0ms; }
.animate-fade-in-up:nth-child(2) { animation-delay: 60ms; }
.animate-fade-in-up:nth-child(3) { animation-delay: 120ms; }
```

### 5. Reduced Motion
Respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Sonalit-Specific Patterns

| Context | Animation | Duration |
|---------|-----------|----------|
| Card entry | `fade-in-up` | 450ms |
| Drawer slide | `slide-in-right` or translateX | 300ms |
| Toast notification | `fade-in-up` + auto-dismiss | 3000ms total |
| Panic indicator | `glow-pulse-red` | continuous |
| Warning badge | `glow-pulse-amber` | continuous |
| Map marker appear | scale 0→1 + fade | 200ms |
| Status badge change | background color transition | 200ms |

## Do

- Use established keyframes from `index.css`
- Match duration to the importance of the state change
- Add `prefers-reduced-motion` respect for new animations
- Use glow pulses only for genuine alerts/warnings

## Don't

- Add decorative animations that don't communicate state
- Use bounce or elastic easing in an operations UI
- Animate layout shifts that cause content reflow
- Add animations longer than 500ms for entry (it feels sluggish in ops)
- Use red glow pulse for non-critical states
