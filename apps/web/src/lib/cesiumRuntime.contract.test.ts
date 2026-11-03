import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripCesiumGlobalHtmlAssets } from '../../scripts/cesiumHtmlAssets.js';
import { loadCesiumRuntime } from './cesiumRuntime.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('on-demand Cesium runtime', () => {
  it('removes only the global Cesium script and shell stylesheet from generated HTML', () => {
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="/cesium/Widgets/widgets.css">',
      '<script src="/cesium/Cesium.js"></script>',
      '<script type="module" src="/assets/main.js"></script>',
      '<link rel="stylesheet" href="/assets/main.css">',
      '</head><body></body></html>',
    ].join('');

    const output = stripCesiumGlobalHtmlAssets(html);

    expect(output).not.toContain('/cesium/Cesium.js');
    expect(output).not.toContain('/cesium/Widgets/widgets.css');
    expect(output).toContain('/assets/main.js');
    expect(output).toContain('/assets/main.css');
  });

  it('loads one same-origin runtime script and waits for the Cesium global', async () => {
    const listeners = new Map<string, (event?: Event) => void>();
    const script = {
      dataset: {} as DOMStringMap,
      src: '',
      async: false,
      addEventListener: vi.fn((type: string, listener: (event?: Event) => void) => {
        listeners.set(type, listener);
      }),
      remove: vi.fn(),
    } as unknown as HTMLScriptElement;
    const documentStub = {
      createElement: vi.fn(() => script),
      head: { appendChild: vi.fn() },
    } as unknown as Document;
    const windowStub = {
      location: { origin: 'https://app.sonalit.test' },
      Cesium: undefined as unknown,
      CESIUM_BASE_URL: undefined as string | undefined,
    } as unknown as Window;

    vi.stubGlobal('window', windowStub);
    vi.stubGlobal('document', documentStub);

    const first = loadCesiumRuntime();
    const concurrent = loadCesiumRuntime();

    expect(concurrent).toBe(first);
    expect(script.src).toBe('https://app.sonalit.test/cesium/Cesium.js');
    expect(script.dataset.sonalitCesiumRuntime).toBe('true');
    expect((windowStub as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL)
      .toBe('https://app.sonalit.test/cesium/');
    expect(documentStub.head.appendChild).toHaveBeenCalledTimes(1);

    (windowStub as Window & { Cesium?: unknown }).Cesium = {};
    listeners.get('load')?.(new Event('load'));
    await expect(first).resolves.toBeUndefined();
  });

  it('gates only the legacy 3D routes behind the runtime and leaves SJM independently lazy', () => {
    const router = readFileSync(new URL('../router.tsx', import.meta.url), 'utf8');
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

    expect(router).toContain('function loadCesiumRoute<T>');
    expect(router).toContain("lazyRouteComponent(loadCesiumRoute(()=>import('./pages/GodsEyeView.js')))");
    expect(router).toContain("lazyRouteComponent(loadCesiumRoute(()=>import('./pages/DriveReplay.js')))");
    expect(router).toContain("lazyRouteComponent(()=>import('./pages/SecureJourneyManagement.js'))");
    expect(viteConfig).toContain('deferCesiumGlobalAssets()');
    expect(viteConfig).toContain("order: 'post'");
  });
});
