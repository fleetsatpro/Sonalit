/**
 * The public site's own navigation graph. Header, footer and the related-page
 * links at the bottom of each service page all read this, so every public page
 * is reachable from every other one with descriptive anchor text.
 */
export interface NavLink {
  href: string;
  label: string;
  /** One line used by the footer and the related-pages strip. */
  blurb: string;
}

export const PLATFORM_LINKS: NavLink[] = [
  {
    href: '/fleet-management',
    label: 'Fleet Management',
    blurb: 'Live vehicle and driver visibility, maintenance, fuel and shift operations.',
  },
  {
    href: '/convoy-management',
    label: 'Convoy Management',
    blurb: 'Convoy planning, field officer coordination, corridor risk and reporting.',
  },
  {
    href: '/container-delivery',
    label: 'Container Delivery',
    blurb: 'Bookings, container movements, e-lock workflows and proof of delivery.',
  },
  {
    href: '/security-operations',
    label: 'Security Operations',
    blurb: 'Alerting, panic escalation, geofencing and incident response.',
  },
];

export const COMPANY_LINKS: NavLink[] = [
  { href: '/about', label: 'About Sonalit', blurb: 'What Sonalit is and who it is built for.' },
  { href: '/contact', label: 'Contact', blurb: 'Talk to the Sonalit team or request platform access.' },
];

export const NAV_LINKS: NavLink[] = [...PLATFORM_LINKS, ...COMPANY_LINKS];

/** Related public pages, excluding the one currently being viewed. */
export function relatedLinks(currentPath: string, limit = 3): NavLink[] {
  return NAV_LINKS.filter((l) => l.href !== currentPath).slice(0, limit);
}
