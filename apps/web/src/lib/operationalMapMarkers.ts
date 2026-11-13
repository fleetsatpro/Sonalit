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
    .sml-device-marker{--sml-accent:#32d6a0;position:relative;display:flex;align-items:center;gap:6px;min-height:42px;max-width:190px;padding:2px 5px 2px 2px;border:1px solid transparent;border-radius:12px;background:transparent;color:#f4f7fb;appearance:none;cursor:pointer;isolation:isolate;outline:none;-webkit-tap-highlight-color:transparent;transition:transform .16s ease,background .16s ease,border-color .16s ease;white-space:normal}
    .sml-device-marker:hover,.sml-device-marker:focus-visible,.sml-device-marker[data-selected="true"]{z-index:90;transform:translateY(-1px)}
    .sml-device-marker:focus-visible{outline:2px solid var(--sml-accent);outline-offset:3px}
    .sml-device-marker__icon-shell{position:relative;display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border:1.5px solid color-mix(in srgb,var(--sml-accent) 86%,white 14%);border-radius:11px;background:linear-gradient(145deg,rgba(20,34,49,.98),rgba(4,10,18,.98));box-shadow:0 3px 9px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.16),0 0 0 2px color-mix(in srgb,var(--sml-accent) 18%,transparent);pointer-events:none}
    .sml-device-marker__icon-shell:before{content:"";position:absolute;inset:3px;border:1px solid color-mix(in srgb,var(--sml-accent) 24%,transparent);border-radius:7px}
    .sml-device-marker__icon{position:relative;z-index:2;width:21px;height:21px;display:block;fill:#edf4fa;filter:drop-shadow(0 1px 2px rgba(0,0,0,.52))}
    .sml-device-marker__bearing{position:absolute;z-index:4;left:50%;top:-7px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid var(--sml-accent);filter:drop-shadow(0 1px 2px rgba(0,0,0,.85));transform:translateX(-50%) rotate(var(--sml-heading,0deg));transform-origin:50% 25px;pointer-events:none}
    .sml-device-marker__bearing[hidden]{display:none}
    .sml-device-marker__ring{position:absolute;inset:-4px;border:1px solid color-mix(in srgb,var(--sml-accent) 72%,transparent);border-radius:14px;opacity:0;pointer-events:none}
    .sml-device-marker[data-state="moving"] .sml-device-marker__ring,.sml-device-marker[data-state="online"] .sml-device-marker__ring{animation:sml-device-pulse 2.8s cubic-bezier(.16,1,.3,1) infinite}
    .sml-device-marker[data-state="sos"] .sml-device-marker__ring,.sml-device-marker[data-state="alert"] .sml-device-marker__ring{inset:-5px;border-width:2px;opacity:.7;animation:sml-device-alert .85s ease-in-out infinite}
    .sml-device-marker[data-state="offline"] .sml-device-marker__icon-shell,.sml-device-marker[data-state="stale"] .sml-device-marker__icon-shell,.sml-device-marker[data-state="unavailable"] .sml-device-marker__icon-shell{filter:saturate(.45);box-shadow:0 2px 5px rgba(0,0,0,.38);border-style:dashed}
    .sml-device-marker__label{display:flex;min-width:0;max-width:145px;flex-direction:column;gap:2px;padding:5px 8px 5px 9px;border:1px solid color-mix(in srgb,var(--sml-accent) 44%,rgba(255,255,255,.12));border-radius:8px;background:linear-gradient(135deg,rgba(7,15,25,.97),rgba(3,8,15,.97));box-shadow:0 4px 12px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.07);backdrop-filter:blur(10px);text-align:left;pointer-events:none;transition:opacity .14s ease,transform .14s ease}
    .sml-device-marker__identity{display:block;max-width:128px;overflow:hidden;color:#f3f7fc;font:750 10px/1.15 "Inter",ui-sans-serif,system-ui,sans-serif;letter-spacing:.025em;text-overflow:ellipsis;white-space:nowrap}
    .sml-device-marker__detail{display:block;max-width:128px;overflow:hidden;color:var(--sml-accent);font:750 8px/1.15 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.065em;text-overflow:ellipsis;white-space:nowrap}
    .sml-device-marker[data-density="overview"] .sml-device-marker__label{opacity:0;transform:translateX(-5px);visibility:hidden}
    .sml-device-marker[data-density="regional"] .sml-device-marker__detail{display:none}
    .sml-device-marker[data-density="overview"]:hover .sml-device-marker__label,.sml-device-marker[data-density="overview"]:focus-visible .sml-device-marker__label,.sml-device-marker[data-selected="true"] .sml-device-marker__label{opacity:1;transform:none;visibility:visible}
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
  button.dataset.density = zoom < 7.2 ? 'overview' : zoom < 11.2 ? 'regional' : 'full';
  button.dataset.selected = selected ? 'true' : 'false';
}
