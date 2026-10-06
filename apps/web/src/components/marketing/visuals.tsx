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
    src: 'https://upload.wikimedia.org/wikipedia/commons/5/50/Yokohama_by_Sentinel-2%2C_2020-10-27.jpg',
    width: 1600,
    height: 900,
    alt: 'Satellite view of Yokohama and its port on Tokyo Bay, captured by Sentinel-2B.',
    credit: 'Copernicus Sentinel-2, ESA / CC BY-SA 3.0 IGO',
    creditHref: 'https://commons.wikimedia.org/wiki/File:Yokohama_by_Sentinel-2,_2020-10-27.jpg',
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
  note?: string | undefined;
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
      note={note ?? 'REFERENCE IMAGERY · SENTINEL-2B · 27 OCT 2020'}
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


/**
 * A semantic system visual rather than a fake dashboard:
 * the geometry expresses how Sonalit relates movement, context and evidence.
 * No values in this illustration are telemetry.
 */
export function WorldFabricVisual({ compact = false }: { compact?: boolean }): React.ReactElement {
  const dimensions = [
    ['SPACE', 112, 84],
    ['TIME', 242, 48],
    ['IDENTITY', 382, 84],
    ['MOTION', 442, 188],
    ['INTEGRITY', 382, 318],
    ['SECURITY', 242, 356],
    ['EVIDENCE', 112, 318],
    ['FUTURE', 52, 188],
  ] as const;

  return (
    <div className={`world-fabric-visual ${compact ? 'is-compact' : ''}`} role="img" aria-label="Illustrative Sonalit world model showing eight operational dimensions around one canonical state">
      <svg viewBox="0 0 500 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <pattern id={`world-grid-${compact ? 'compact' : 'hero'}`} width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M25 0H0V25" fill="none" stroke="rgba(234,242,255,.06)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width="500" height="420" fill={`url(#world-grid-${compact ? "compact" : "hero"})`} opacity=".42" />
        <circle className="world-orbit world-orbit-a" cx="247" cy="202" r="154" fill="none" stroke="rgba(34,232,255,.18)" strokeWidth="1" />
        <circle className="world-orbit world-orbit-b" cx="247" cy="202" r="108" fill="none" stroke="rgba(255,201,63,.16)" strokeWidth="1" strokeDasharray="4 7" />
        <path className="world-route" d="M44 250 C112 226 123 183 181 190 C223 195 237 241 282 236 C336 230 345 156 456 126" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="2" />
        <path className="world-route world-route-hot" d="M44 250 C112 226 123 183 181 190 C223 195 237 241 282 236 C336 230 345 156 456 126" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" />

        <g className="world-core">
          <circle cx="247" cy="202" r="48" fill="rgba(5,8,19,.92)" stroke="rgba(234,242,255,.28)" />
          <circle className="world-core-pulse" cx="247" cy="202" r="62" fill="none" stroke="rgba(34,232,255,.14)" />
          <path d="M230 202h34M247 185v34" stroke="rgba(234,242,255,.58)" strokeWidth="1" />
          <text x="247" y="197" textAnchor="middle" fill="#eaf2ff" fontSize="11" fontFamily="var(--mono)">SONALIT</text>
          <text x="247" y="214" textAnchor="middle" fill="#8795aa" fontSize="7" fontFamily="var(--mono)">CANONICAL STATE</text>
        </g>

        <g className="world-links" stroke="rgba(234,242,255,.13)" strokeWidth="1">
          {dimensions.map(([, x, y]) => <line key={`${x}-${y}`} x1="247" y1="202" x2={x} y2={y} />)}
        </g>

        {dimensions.map(([label, x, y], index) => (
          <g className={`world-dimension world-dimension-${index + 1}`} key={label}>
            <circle className="world-node" cx={x} cy={y} r="6" fill="var(--world-accent, var(--cyan))" />
            <circle className="world-node-ring" cx={x} cy={y} r="11" fill="none" stroke="rgba(255,255,255,.14)" />
            <text x={x + (x < 200 ? 14 : -14)} y={y + 3} textAnchor={x < 200 ? 'start' : 'end'} fill="#dfe8f6" fontSize="8" letterSpacing="1.2" fontFamily="var(--mono)">{label}</text>
          </g>
        ))}

        <g className="world-satellite">
          <circle cx="414" cy="70" r="13" fill="rgba(11,17,32,.96)" stroke="rgba(139,107,255,.65)" />
          <path d="M404 70h20M414 60v20" stroke="rgba(139,107,255,.8)" strokeWidth="1" />
          <path d="M402 56l-12-9M426 84l12 9" stroke="rgba(139,107,255,.55)" strokeWidth="1" />
          <text x="434" y="67" fill="#a894ff" fontSize="7" fontFamily="var(--mono)">MODELLED</text>
          <text x="434" y="78" fill="#68758c" fontSize="6" fontFamily="var(--mono)">ORBITAL CONTEXT</text>
        </g>

        <g className="world-camera">
          <path d="M74 120l20 8-20 8z" fill="rgba(41,255,176,.78)" />
          <path d="M94 128L172 162L94 188Z" fill="rgba(41,255,176,.08)" stroke="rgba(41,255,176,.24)" strokeWidth="1" />
          <text x="52" y="108" fill="#67e9ba" fontSize="7" fontFamily="var(--mono)">GEOMETRIC VIEWSHED</text>
        </g>

        <text x="26" y="396" fill="#53617a" fontSize="7" letterSpacing="1.1" fontFamily="var(--mono)">SPACE · TIME · IDENTITY · MOTION · INTEGRITY · SECURITY · EVIDENCE · FUTURE</text>
      </svg>
    </div>
  );
}

/**
 * Decision loop visual: a concise diagram of the platform's operating grammar.
 * It deliberately avoids live-looking metrics or fabricated system states.
 */
export function DecisionLoopVisual(): React.ReactElement {
  const steps = [
    ['01', 'OBSERVE', 'Telemetry · field · source'],
    ['02', 'CONTEXT', 'Route · risk · world'],
    ['03', 'INTERPRET', 'Rules · intelligence · AI'],
    ['04', 'ACT', 'Dispatch · escalate · verify'],
    ['05', 'PROVE', 'Evidence · audit · replay'],
  ] as const;

  return (
    <div className="decision-loop-visual" role="img" aria-label="Illustrative five-stage Sonalit decision loop">
      <svg viewBox="0 0 980 210" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path className="decision-loop-path" d="M72 104H900" fill="none" stroke="rgba(234,242,255,.14)" strokeWidth="1" />
        <path className="decision-loop-path-hot" d="M72 104H900" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" />
        {steps.map(([index, title, detail], i) => {
          const x = 72 + i * 207;
          return (
            <g className={`decision-step decision-step-${i + 1}`} key={index}>
              <circle cx={x} cy="104" r="20" fill="rgba(5,8,19,.96)" stroke="rgba(234,242,255,.2)" />
              <circle className="decision-step-pulse" cx={x} cy="104" r="30" fill="none" stroke="rgba(255,255,255,.08)" />
              <text x={x} y="107" textAnchor="middle" fill="#eaf2ff" fontSize="8" fontFamily="var(--mono)">{index}</text>
              <text x={x} y="52" textAnchor="middle" fill="#edf2fa" fontSize="10" letterSpacing="1.2" fontFamily="var(--mono)">{title}</text>
              <text x={x} y="156" textAnchor="middle" fill="#6f7d93" fontSize="8" fontFamily="var(--mono)">{detail}</text>
              {i < steps.length - 1 ? <path d={`M${x + 20} 104h187`} stroke="none" /> : null}
            </g>
          );
        })}
        <path className="decision-loop-return" d="M900 104 C900 185 80 185 80 104" fill="none" stroke="rgba(34,232,255,.20)" strokeDasharray="3 7" />
        <text x="490" y="198" textAnchor="middle" fill="#53617a" fontSize="7" letterSpacing="1.1" fontFamily="var(--mono)">THE LOOP CLOSES WHEN EVIDENCE SURVIVES THE DECISION</text>
      </svg>
    </div>
  );
}
