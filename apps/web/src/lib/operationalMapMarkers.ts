export type OperationalMarkerKind = 'vehicle' | 'guardian' | 'tracker';
export type OperationalMarkerState =
  | 'moving' | 'online' | 'idle' | 'stopped' | 'offline' | 'sos'
  | 'delayed' | 'stale' | 'unavailable' | 'alert' | 'warning' | 'unknown'
  | 'at_port' | 'staged';

export interface OperationalMarkerOptions {
  kind: OperationalMarkerKind;
  identity: string;
  state: string;
  detail?: string | null;
  heading?: number | null;
  selected?: boolean;
  zoom?: number;
  freshness?: string | null;
  accuracyMeters?: number | null;
  latitude?: number | null;
  title?: string;
}

const ICONS: Record<OperationalMarkerKind, string> = {
  vehicle: '<path d="M7.1 3.8h9.8c1.1 0 2.1.7 2.4 1.8l1.5 5.2v7.1c0 .9-.7 1.6-1.6 1.6h-.8v1.4h-2.5v-1.4H8.1v1.4H5.6v-1.4h-.8c-.9 0-1.6-.7-1.6-1.6v-7.1l1.5-5.2c.3-1.1 1.3-1.8 2.4-1.8Zm-.9 2.3-1.2 4.2h13.9l-1.2-4.2a.8.8 0 0 0-.8-.6H7a.8.8 0 0 0-.8.6ZM5.6 12.5v4.3h12.8v-4.3H5.6Zm1.3 1.1a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm10.2 0a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"/>',
  guardian: '<path d="M12 12.1a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8Zm0 2c-4.7 0-8.5 2.4-8.5 5.4v1h17v-1c0-3-3.8-5.4-8.5-5.4Z"/>',
  tracker: '<path d="M12 2.2a7.1 7.1 0 0 0-7.1 7.1c0 5.1 7.1 12.5 7.1 12.5s7.1-7.4 7.1-12.5A7.1 7.1 0 0 0 12 2.2Zm0 10.3a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z"/>',
};

const STATE_META: Record<string, { key: OperationalMarkerState; label: string; color: string }> = {
  move: { key: 'moving', label: 'MOVING', color: '#32d6a0' },
  moving: { key: 'moving', label: 'MOVING', color: '#32d6a0' },
  active: { key: 'online', label: 'ONLINE', color: '#32d6a0' },
  online: { key: 'online', label: 'ONLINE', color: '#32d6a0' },
  live: { key: 'online', label: 'LIVE', color: '#32d6a0' },
  recent: { key: 'delayed', label: 'RECENT', color: '#6fc9dc' },
  idle: { key: 'idle', label: 'IDLE', color: '#e9b85c' },
  stop: { key: 'stopped', label: 'STOPPED', color: '#aab6c5' },
  stopped: { key: 'stopped', label: 'STOPPED', color: '#aab6c5' },
  offline: { key: 'offline', label: 'OFFLINE', color: '#8290a2' },
  sos: { key: 'sos', label: 'SOS', color: '#ff5268' },
  panic: { key: 'sos', label: 'SOS', color: '#ff5268' },
  alert: { key: 'alert', label: 'ALERT', color: '#ff6574' },
  warn: { key: 'warning', label: 'WARNING', color: '#f2b65e' },
  warning: { key: 'warning', label: 'WARNING', color: '#f2b65e' },
  delayed: { key: 'delayed', label: 'DELAYED', color: '#f0bc62' },
  stale: { key: 'stale', label: 'STALE FIX', color: '#ef9a64' },
  expired: { key: 'stale', label: 'STALE FIX', color: '#ef9a64' },
  unavailable: { key: 'unavailable', label: 'NO FIX', color: '#94a3b8' },
  unknown: { key: 'unknown', label: 'UNKNOWN', color: '#94a3b8' },
  at_port: { key: 'at_port', label: 'AT PORT', color: '#4dcce5' },
  staged: { key: 'staged', label: 'STAGED', color: '#e9b85c' },
};

const STYLE_ID = 'sonalit-operational-device-marker-style';

function injectStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sml-device-marker{--sml-accent:#32d6a0;--sml-marker-size:36px;--sml-marker-label-left:45px;position:relative;display:grid;place-items:center;width:42px;height:42px;min-height:42px;max-width:42px;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:#f4f7fb;appearance:none;cursor:pointer;isolation:isolate;outline:none;-webkit-tap-highlight-color:transparent;transition:background .16s ease;white-space:normal}
    .sml-device-marker:hover,.sml-device-marker:focus-visible,.sml-device-marker[data-selected="true"]{z-index:90;transform:translateY(-1px)}
    .sml-device-marker:focus-visible{outline:2px solid var(--sml-accent);outline-offset:3px}
    .sml-device-marker__accuracy{position:absolute;z-index:0;left:50%;top:50%;width:var(--sml-accuracy-diameter,0px);height:var(--sml-accuracy-diameter,0px);box-sizing:border-box;border:1px solid color-mix(in srgb,var(--sml-accent) 78%,white 22%);border-radius:50%;background:color-mix(in srgb,var(--sml-accent) 9%,transparent);box-shadow:0 0 0 1px rgba(3,10,18,.2);transform:translate(-50%,-50%);pointer-events:none;display:none}
    .sml-device-marker[data-accuracy-visible="true"] .sml-device-marker__accuracy{display:block}
    .sml-device-marker__icon-shell{position:relative;z-index:2;display:grid;place-items:center;flex:none;width:var(--sml-marker-size);height:var(--sml-marker-size);border:1.5px solid color-mix(in srgb,var(--sml-accent) 86%,white 14%);border-radius:9px;background:linear-gradient(145deg,rgba(20,34,49,.98),rgba(4,10,18,.98));box-shadow:0 3px 9px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.16),0 0 0 2px color-mix(in srgb,var(--sml-accent) 18%,transparent);pointer-events:none}
    .sml-device-marker[data-density="overview"] .sml-device-marker__icon-shell,.sml-device-marker[data-density="regional"] .sml-device-marker__icon-shell{border:1.5px solid rgba(245,250,255,.9);border-radius:50%;background:var(--sml-accent);box-shadow:0 0 0 2px rgba(4,10,18,.8),0 0 9px color-mix(in srgb,var(--sml-accent) 50%,transparent)}
    .sml-device-marker[data-density="overview"] .sml-device-marker__icon-shell:before,.sml-device-marker[data-density="regional"] .sml-device-marker__icon-shell:before{display:none}
    .sml-device-marker[data-density="overview"] .sml-device-marker__icon,.sml-device-marker[data-density="regional"] .sml-device-marker__icon,.sml-device-marker[data-density="overview"] .sml-device-marker__bearing,.sml-device-marker[data-density="regional"] .sml-device-marker__bearing{display:none}
    .sml-device-marker[data-density="overview"] .sml-device-marker__label,.sml-device-marker[data-density="regional"] .sml-device-marker__label{opacity:0;visibility:hidden;transform:translateY(-50%) translateX(-4px)}
    .sml-device-marker[data-density="overview"]:hover .sml-device-marker__label,.sml-device-marker[data-density="overview"]:focus-visible .sml-device-marker__label,.sml-device-marker[data-density="regional"]:hover .sml-device-marker__label,.sml-device-marker[data-density="regional"]:focus-visible .sml-device-marker__label,.sml-device-marker[data-selected="true"] .sml-device-marker__label{opacity:1;visibility:visible;transform:translateY(-50%)}
    .sml-device-marker[data-selected="true"] .sml-device-marker__icon-shell{box-shadow:0 0 0 3px rgba(255,255,255,.22),0 0 0 5px color-mix(in srgb,var(--sml-accent) 45%,transparent),0 0 18px color-mix(in srgb,var(--sml-accent) 44%,transparent)}
    .sml-device-marker__icon-shell:before{content:"";position:absolute;inset:3px;border:1px solid color-mix(in srgb,var(--sml-accent) 24%,transparent);border-radius:7px}
    .sml-device-marker__icon{position:relative;z-index:2;width:58%;height:58%;display:block;fill:#edf4fa;filter:drop-shadow(0 1px 2px rgba(0,0,0,.52))}
    .sml-device-marker__bearing{position:absolute;z-index:4;left:50%;top:-7px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid var(--sml-accent);filter:drop-shadow(0 1px 2px rgba(0,0,0,.85));transform:translateX(-50%) rotate(var(--sml-heading,0deg));transform-origin:50% var(--sml-bearing-origin,25px);pointer-events:none}
    .sml-device-marker__bearing[hidden]{display:none}
    .sml-device-marker__ring{position:absolute;inset:-4px;border:1px solid color-mix(in srgb,var(--sml-accent) 72%,transparent);border-radius:14px;opacity:0;pointer-events:none}
    .sml-device-marker[data-state="moving"] .sml-device-marker__ring,.sml-device-marker[data-state="online"] .sml-device-marker__ring{animation:sml-device-pulse 2.8s cubic-bezier(.16,1,.3,1) infinite}
    .sml-device-marker[data-state="sos"] .sml-device-marker__ring,.sml-device-marker[data-state="alert"] .sml-device-marker__ring{inset:-5px;border-width:2px;opacity:.7;animation:sml-device-alert .85s ease-in-out infinite}
    .sml-device-marker[data-state="offline"] .sml-device-marker__icon-shell,.sml-device-marker[data-state="stale"] .sml-device-marker__icon-shell,.sml-device-marker[data-state="unavailable"] .sml-device-marker__icon-shell{filter:saturate(.45);box-shadow:0 2px 5px rgba(0,0,0,.38);border-style:dashed}
    .sml-device-marker__label{position:absolute;z-index:4;left:var(--sml-marker-label-left);top:50%;display:flex;min-width:0;max-width:min(150px,46vw);flex-direction:column;gap:2px;padding:5px 8px 5px 9px;border:1px solid color-mix(in srgb,var(--sml-accent) 44%,rgba(255,255,255,.12));border-radius:8px;background:linear-gradient(135deg,rgba(7,15,25,.97),rgba(3,8,15,.97));box-shadow:0 4px 12px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.07);backdrop-filter:blur(10px);text-align:left;pointer-events:none;opacity:1;visibility:visible;transform:translateY(-50%);transition:opacity .14s ease,transform .14s ease}
    .sml-device-marker__identity{display:block;max-width:128px;overflow:hidden;color:#f3f7fc;font:750 10px/1.15 "Inter",ui-sans-serif,system-ui,sans-serif;letter-spacing:.025em;text-overflow:ellipsis;white-space:nowrap}
    .sml-device-marker__detail{display:block;max-width:128px;overflow:hidden;color:var(--sml-accent);font:750 8px/1.15 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.065em;text-overflow:ellipsis;white-space:nowrap}
    .sml-device-marker[data-density="overview"] .sml-device-marker__label{opacity:0;transform:translateY(-50%) translateX(-5px);visibility:hidden}
    .sml-device-marker[data-density="regional"] .sml-device-marker__detail{display:none}
    .sml-device-marker[data-density="overview"]:hover .sml-device-marker__label,.sml-device-marker[data-density="overview"]:focus-visible .sml-device-marker__label,.sml-device-marker[data-selected="true"] .sml-device-marker__label{opacity:1;transform:translateY(-50%);visibility:visible}
    .sml-device-marker[data-density="overview"]:hover .sml-device-marker__detail,.sml-device-marker[data-density="overview"]:focus-visible .sml-device-marker__detail,.sml-device-marker[data-selected="true"] .sml-device-marker__detail{display:block}
    .sml-device-marker[data-selected="true"] .sml-device-marker__icon-shell{box-shadow:0 4px 14px rgba(0,0,0,.52),0 0 0 3px color-mix(in srgb,var(--sml-accent) 25%,transparent),0 0 18px color-mix(in srgb,var(--sml-accent) 30%,transparent)}
    .sml-device-marker[data-density="overview"]:hover,.sml-device-marker[data-selected="true"]{background:rgba(4,10,18,.28);border-color:color-mix(in srgb,var(--sml-accent) 38%,transparent)}
    @keyframes sml-device-pulse{0%{transform:scale(.78);opacity:.42}70%,100%{transform:scale(1.55);opacity:0}}
    @keyframes sml-device-alert{0%,100%{transform:scale(1);opacity:.84}50%{transform:scale(1.26);opacity:.22}}
    @media(prefers-reduced-motion:reduce){.sml-device-marker,.sml-device-marker *{animation:none!important;transition:none!important}.sml-device-marker__ring{display:none}}
  `;
  document.head.appendChild(style);
}

export function operationalMarkerState(status: string): { key: OperationalMarkerState; label: string; color: string } {
  const normalized = status.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return STATE_META[normalized] ?? STATE_META.unknown!;
}

export function operationalMarkerSvg(kind: OperationalMarkerKind, color = '#eaf2f8'): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24">' +
    ICONS[kind].replace('<path d="', '<path fill="' + color + '" d="') + '</svg>';
}

export function createOperationalDeviceMarker(options: OperationalMarkerOptions): HTMLButtonElement {
  injectStyles();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sml-device-marker';
  button.innerHTML = `
    <span class="sml-device-marker__accuracy" aria-hidden="true"></span>
    <span class="sml-device-marker__icon-shell" aria-hidden="true">
      <span class="sml-device-marker__ring"></span>
      <span class="sml-device-marker__bearing" hidden></span>
      <svg class="sml-device-marker__icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[options.kind]}</svg>
    </span>
    <span class="sml-device-marker__label" aria-hidden="true">
      <span class="sml-device-marker__identity"></span>
      <span class="sml-device-marker__detail"></span>
    </span>`;
  updateOperationalDeviceMarker(button, options);
  return button;
}

export function updateOperationalDeviceMarker(button: HTMLButtonElement, options: OperationalMarkerOptions): void {
  injectStyles();
  const status = operationalMarkerState(options.state);
  const freshness = options.freshness ? operationalMarkerState(options.freshness).key : status.key;
  const heading = options.heading == null ? Number.NaN : Number(options.heading);
  button.dataset.kind = options.kind;
  button.dataset.state = status.key;
  button.dataset.freshness = freshness;
  button.dataset.headingAvailable = Number.isFinite(heading) ? 'true' : 'false';
  button.dataset.selected = options.selected ? 'true' : 'false';
  button.dataset.accuracyMeters = Number.isFinite(Number(options.accuracyMeters)) && Number(options.accuracyMeters) >= 0 ? String(Number(options.accuracyMeters)) : '';
  button.dataset.latitude = Number.isFinite(Number(options.latitude)) ? String(Number(options.latitude)) : '';
  button.style.setProperty('--sml-accent', status.color);
  if (Number.isFinite(heading)) button.style.setProperty('--sml-heading', String(((heading % 360) + 360) % 360) + 'deg');
  const bearing = button.querySelector<HTMLElement>('.sml-device-marker__bearing');
  if (bearing) bearing.hidden = !Number.isFinite(heading);
  const identity = button.querySelector<HTMLElement>('.sml-device-marker__identity');
  const detail = button.querySelector<HTMLElement>('.sml-device-marker__detail');
  if (identity) identity.textContent = options.identity.trim() || (options.kind === 'vehicle' ? 'Vehicle' : options.kind === 'guardian' ? 'Field officer' : 'Device');
  if (detail) detail.textContent = options.detail?.trim() || status.label;
  button.title = options.title || [identity?.textContent, status.label, detail?.textContent].filter(Boolean).join(' · ');
  button.setAttribute('aria-label', button.title);
  setOperationalMarkerDensity(button, options.zoom ?? 10, options.selected ?? false);
}

export function setOperationalMarkerDensity(button: HTMLButtonElement, zoom: number, selected = false): void {
  const density = zoom < 7.2 ? 'overview' : zoom < 11.2 ? 'regional' : 'full';
  button.dataset.density = density;
  button.dataset.selected = selected ? 'true' : 'false';
  // At continent/country scale, show a true point, not a miniature vehicle
  // illustration whose screen footprint can imply a false location.
  const markerSize = density === 'overview' ? (selected ? 9 : 7) : density === 'regional' ? (selected ? 13 : 10) : (selected ? 30 : 27);
  button.style.setProperty('--sml-marker-size', markerSize + 'px');
  button.style.setProperty('--sml-marker-label-left', (21 + markerSize / 2 + 6) + 'px');
  button.style.setProperty('--sml-bearing-origin', (markerSize / 2 + 7) + 'px');

  // Draw a geospatial uncertainty radius only when it has a meaningful
  // on-screen size. The true metre value remains in the device detail at all
  // zooms; no accuracy is invented for sources that do not report one.
  const accuracy = Number(button.dataset.accuracyMeters);
  const latitude = Number(button.dataset.latitude);
  const hasAccuracy = button.dataset.accuracyMeters !== '' &&
    Number.isFinite(accuracy) && accuracy > 0 &&
    Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(zoom);
  if (hasAccuracy) {
    const metresPerPixel = (2 * Math.PI * 6378137 * Math.max(0.000001, Math.cos(latitude * Math.PI / 180))) / (512 * Math.pow(2, zoom));
    const radiusPx = accuracy / metresPerPixel;
    if (Number.isFinite(radiusPx) && radiusPx >= 2 && radiusPx <= 180) {
      button.dataset.accuracyVisible = 'true';
      button.style.setProperty('--sml-accuracy-diameter', (radiusPx * 2) + 'px');
    } else {
      button.dataset.accuracyVisible = 'false';
      button.style.setProperty('--sml-accuracy-diameter', '0px');
    }
  } else {
    button.dataset.accuracyVisible = 'false';
    button.style.setProperty('--sml-accuracy-diameter', '0px');
  }
}
