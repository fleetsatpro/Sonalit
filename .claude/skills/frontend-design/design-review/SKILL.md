---
name: frontend-design/design-review
description: Critique checklist for visual quality — spacing, alignment, color consistency, typography hierarchy, and accessibility.
triggers:
  - design review
  - review UI
  - check design
  - visual QA
  - looks wrong
  - alignment
  - spacing issue
related_skills:
  - frontend-design
  - frontend-design/motion-design
  - frontend-patterns
---

# Design Review

## Purpose

Structured checklist for reviewing visual quality of any Sonalit frontend change. Use after implementing a UI change to catch visual inconsistencies before they ship.

## When to Activate

After any frontend UI change, before declaring the task complete.

## Review Checklist

### 1. Color Consistency
- [ ] Uses design tokens (`var(--p-bg)`, `var(--p-surface)`, etc.) not raw hex
- [ ] Orange accent (`orange-500`) for primary actions only
- [ ] Status colors match semantic meaning (red=critical, amber=warning, emerald=success)
- [ ] Text uses `var(--p-text)` for primary, `var(--p-muted)` for secondary
- [ ] No bright or light backgrounds that break the dark theme

### 2. Typography
- [ ] Archivo for all UI text
- [ ] IBM Plex Mono (`.mono`) for data values, codes, coordinates, timestamps
- [ ] Heading hierarchy: larger/bolder for titles, smaller/lighter for supporting text
- [ ] No font-size below 11px (accessibility)

### 3. Spacing
- [ ] Consistent padding: `p-4` for compact, `p-6` for spacious
- [ ] Card gap: `gap-4` between cards in a grid
- [ ] Section spacing: `space-y-6` between distinct sections
- [ ] No arbitrary pixel values — use Tailwind spacing scale

### 4. Alignment
- [ ] Text left-aligned (not centered unless intentional — e.g., empty states)
- [ ] Numbers right-aligned in tables
- [ ] Icons vertically centered with adjacent text
- [ ] Grid items same height in a row

### 5. Borders & Surfaces
- [ ] Card borders: `var(--p-border)` (1px)
- [ ] Surface colors: `var(--p-surface)` for cards, `var(--p-bg)` for background
- [ ] Border radius: consistent (`rounded-xl` for cards, `rounded-lg` for inputs)

### 6. Interactive States
- [ ] Hover: subtle brightness change, not color shift
- [ ] Focus: `ring-2 ring-orange-500` for keyboard navigation
- [ ] Disabled: reduced opacity (`opacity-50`) + `cursor-not-allowed`
- [ ] Loading: skeleton or spinner, not blank space

### 7. Responsive
- [ ] Works at mobile width (360px)
- [ ] Tables scroll horizontally in containers, page body never scrolls horizontally
- [ ] Stacking behavior: columns on mobile, rows on desktop

### 8. Accessibility
- [ ] Sufficient color contrast (4.5:1 for text, 3:1 for large text)
- [ ] Interactive elements have visible focus indicators
- [ ] Icons accompanied by text labels or `aria-label`
- [ ] Status conveyed by more than color alone (icon + color)

## Do

- Check every item before marking a UI task complete
- Test at both desktop and mobile widths
- Verify dark theme consistency

## Don't

- Skip the checklist for "small" changes
- Approve misaligned or inconsistently spaced components
- Allow raw colors that don't match the design system
