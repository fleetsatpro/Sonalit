/**
 * The public site's own navigation graph. Header, footer, the capability grid
 * and the related-page strips all read this, so every public page is reachable
 * from every other one with descriptive anchor text and nothing drifts.
 */
export interface NavLink {
  href: string;
  /** Full descriptive label — footer, mobile menu, related-page cards. */
  label: string;
  /** Compact label for the desktop nav bar. */
  short: string;
  /** Glyph used by the capability cards. */
  icon: string;
  /** One line used by the footer, capability cards and related-page strips. */
  blurb: string;
}

export const PLATFORM_LINKS: NavLink[] = [
  {
    href: '/fleet-management',
    label: 'Fleet Management',
    short: 'Fleet',
    icon: '◈',
    blurb:
      'Real-time vehicle visibility, GPS tracking, driver operations and maintenance awareness across the whole fleet.',
  },
  {
    href: '/convoy-management',
    label: 'Convoy Management',
    short: 'Convoy',
    icon: '⬡',
    blurb:
      'Plan, monitor and secure multi-vehicle movements with corridor awareness and field coordination.',
  },
  {
    href: '/container-delivery',
    label: 'Container Delivery',
    short: 'Container',
    icon: '▣',
    blurb:
      'End-to-end container delivery: bookings, e-lock operations, yard and port coordination and proof of delivery.',
  },
  {
    href: '/security-operations',
    label: 'Security Operations',
    short: 'Security',
    icon: '◎',
    blurb:
      'Situational awareness, alerting, geofencing, panic escalation and field officer coordination.',
  },
];

export const COMPANY_LINKS: NavLink[] = [
  {
    href: '/about',
    label: 'About Sonalit',
    short: 'About',
    icon: '◇',
    blurb: 'What Sonalit is, who it is built for and how it is engineered.',
  },
  {
    href: '/contact',
    label: 'Contact',
    short: 'Contact',
    icon: '✉',
    blurb: 'Talk to the Sonalit team or request access to the platform.',
  },
];

export const NAV_LINKS: NavLink[] = [...PLATFORM_LINKS, ...COMPANY_LINKS];

/** Related public pages, excluding the one currently being viewed. */
export function relatedLinks(currentPath: string, limit = 3): NavLink[] {
  return NAV_LINKS.filter((l) => l.href !== currentPath).slice(0, limit);
}
