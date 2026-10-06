/**
 * Real-world photography for the public site.
 *
 * These are deliberately external, stable source images from Wikimedia Commons
 * and NASA Earth Observatory instead of generated/decorative pseudo-operations
 * graphics. Every image carries its provenance in the rendered credit.
 *
 * The public homepage must never imply that a stock or archival image is live
 * telemetry. Satellite imagery is explicitly labelled as reference imagery.
 */

interface Photo {
  src: string;
  width: number;
  height: number;
  alt: string;
  credit: string;
  creditHref: string;
}

const PHOTOS = {
  ops: {
    src: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/148000/148956/longbeach_oli_2021283_lrg.jpg',
    width: 1600,
    height: 900,
    alt: 'Satellite view of cargo ships waiting offshore near the Port of Los Angeles and Port of Long Beach.',
    credit: 'NASA Earth Observatory / Landsat 8 OLI',
    creditHref: 'https://earthobservatory.nasa.gov/images/148956/waiting-to-unload',
  },
  fleet: {
    src: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Semi_truck_carrying_freight.jpg',
    width: 3264,
    height: 1836,
    alt: 'Freight truck carrying a shipping container along a road in Cameroon.',
    credit: 'Tontonjer / CC BY-SA 4.0',
    creditHref: 'https://commons.wikimedia.org/wiki/File:Semi_truck_carrying_freight.jpg',
  },
  convoy: {
    src: 'https://upload.wikimedia.org/wikipedia/commons/6/67/Truck_convoy-08.jpg',
    width: 1280,
    height: 960,
    alt: 'A line of freight trucks travelling together on a public road in Canberra.',
    credit: 'A. Tsirekas / CC BY 3.0',
    creditHref: 'https://commons.wikimedia.org/wiki/File:Truck_convoy-08.jpg',
  },
  container: {
    src: 'https://upload.wikimedia.org/wikipedia/commons/8/88/Container_ship_exiting_Mombasa_port.jpg',
    width: 1600,
    height: 1200,
    alt: 'Container ship leaving Mombasa Port, Kenya.',
    credit: 'Ian Kiptoo / CC BY 4.0',
    creditHref: 'https://commons.wikimedia.org/wiki/File:Container_ship_exiting_Mombasa_port.jpg',
  },
} satisfies Record<string, Photo>;

function MarketingPhoto({
  photo,
  priority = false,
  framing = 'landscape',
  note,
}: {
  photo: Photo;
  priority?: boolean;
  framing?: 'landscape' | 'portrait' | 'wide';
  note?: string;
}): React.ReactElement {
  return (
    <div className={`marketing-photo-frame frame-${framing}`}>
      <img
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
      {note ? <span className="photo-note mono">{note}</span> : null}
      <a
        className="photo-credit mono"
        href={photo.creditHref}
        target="_blank"
        rel="noreferrer"
        aria-label={`Image credit: ${photo.credit}`}
      >
        {photo.credit}
      </a>
    </div>
  );
}

interface VisualProps {
  priority?: boolean;
  note?: string;
}

export function OpsVisual({ priority = false, note }: VisualProps): React.ReactElement {
  return (
    <MarketingPhoto
      photo={PHOTOS.ops}
      priority={priority}
      framing="wide"
      note={note ?? 'REFERENCE IMAGERY · LANDSAT 8 · 10 OCT 2021'}
    />
  );
}

export function FleetVisual({ priority = false, note }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.fleet} priority={priority} note={note} />;
}

export function ConvoyVisual({ priority = false, note }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.convoy} priority={priority} note={note} />;
}

export function ContainerVisual({ priority = false, note }: VisualProps): React.ReactElement {
  return <MarketingPhoto photo={PHOTOS.container} priority={priority} note={note} />;
}
