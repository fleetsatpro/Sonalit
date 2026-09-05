/**
 * Photography for the public site.
 *
 * All four images are self-hosted under /marketing rather than hot-linked to
 * images.unsplash.com. That is deliberate:
 *   - the CSP is `img-src 'self' …` and does not allow the Unsplash CDN, and
 *     widening it for decorative photography is not a trade worth making;
 *   - hot-linked stock rots (the first draft of this page shipped a URL that
 *     already 404s), and a dead hero image is not a failure mode a marketing
 *     page should have;
 *   - self-hosting means one origin, no third-party request on the public
 *     pages, and no dependency on someone else's uptime.
 *
 * Sourced from Unsplash under the Unsplash License (free for commercial use,
 * attribution not required). Provenance, by CDN photo id:
 *   ops-port-night      photo-1758745791998-11ea5eb5df40
 *   fleet-road-night    photo-1485575301924-6891ef935dcd
 *   convoy-corridor     photo-1629881635342-c1272d45d0fa
 *   container-terminal  photo-1590497008432-598f04441de8  (Timelab)
 *
 * Each was checked for a legible third-party haulier livery before selection —
 * a branded truck on this page reads as a customer Sonalit does not have.
 *
 * Served as WebP at 2x the largest CSS size they render at, with intrinsic
 * width/height so they reserve their box and cannot shift the layout.
 */

interface Photo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

const PHOTOS = {
  ops: {
    src: '/marketing/ops-port-night.webp',
    width: 1200,
    height: 600,
    alt: 'Port cranes working under floodlights at night, reflected in the water below.',
  },
  fleet: {
    src: '/marketing/fleet-road-night.webp',
    width: 1280,
    height: 880,
    alt: 'A heavy goods vehicle on a coastal road at dusk, headlights on.',
  },
  convoy: {
    src: '/marketing/convoy-corridor.webp',
    width: 1280,
    height: 880,
    alt: 'Freight vehicles moving through a lit road tunnel at night.',
  },
  container: {
    src: '/marketing/container-terminal.webp',
    width: 1280,
    height: 880,
    alt: 'A container terminal at dusk, stacked containers and gantry cranes under floodlights.',
  },
} satisfies Record<string, Photo>;

/**
 * `priority` marks the one image above the fold (the hero panel): it loads
 * eagerly and at high fetch priority. Everything else is lazy and async, so
 * the rest of the photography costs nothing until it is scrolled to.
 */
function MarketingPhoto({
  photo,
  priority = false,
}: {
  photo: Photo;
  priority?: boolean;
}): React.ReactElement {
  return (
    <img
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
    />
  );
}

interface VisualProps {
  /** Set on the one visual above the fold so it is not lazy-loaded. */
  priority?: boolean;
}

export function OpsVisual({ priority = false }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.ops} priority={priority} />;
}

export function FleetVisual({ priority = false }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.fleet} priority={priority} />;
}

export function ConvoyVisual({ priority = false }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.convoy} priority={priority} />;
}

export function ContainerVisual({ priority = false }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.container} priority={priority} />;
}
