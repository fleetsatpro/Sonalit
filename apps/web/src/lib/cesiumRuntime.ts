type CesiumRuntimeWindow = Window & {
  Cesium?: unknown;
  CESIUM_BASE_URL?: string;
};

let runtimeLoad: Promise<void> | null = null;
let widgetsStylesheetLoad: Promise<void> | null = null;

function loadCesiumWidgetsStylesheet(baseUrl: URL): Promise<void> {
  if (widgetsStylesheetLoad) return widgetsStylesheetLoad;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('Widgets/widgets.css', baseUrl).href;
  stylesheet.dataset.sonalitCesiumWidgets = 'true';

  widgetsStylesheetLoad = new Promise<void>((resolve, reject) => {
    stylesheet.addEventListener('load', () => resolve(), { once: true });
    stylesheet.addEventListener('error', () => {
      reject(new Error('Cesium widget styles failed to load. Check the connection and retry.'));
    }, { once: true });
    document.head.appendChild(stylesheet);
  }).catch((error: unknown) => {
    stylesheet.remove();
    widgetsStylesheetLoad = null;
    throw error;
  });

  return widgetsStylesheetLoad;
}

/**
 * Load the legacy CesiumJS global and its widget styles only for routes that
 * still consume the externalized cesium package. The SJM globe uses
 * @cesium/engine and remains independently code-split behind its Airspace tab.
 */
export function loadCesiumRuntime(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('CesiumJS can only be loaded in a browser.'));
  }

  const runtimeWindow = window as CesiumRuntimeWindow;
  const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  const cesiumBaseUrl = new URL('cesium/', appBaseUrl);
  runtimeWindow.CESIUM_BASE_URL = cesiumBaseUrl.href;

  const stylesheetLoad = loadCesiumWidgetsStylesheet(cesiumBaseUrl);
  if (runtimeWindow.Cesium) return stylesheetLoad;
  if (runtimeLoad) return runtimeLoad;

  const script = document.createElement('script');
  script.src = new URL('Cesium.js', cesiumBaseUrl).href;
  script.async = true;
  script.dataset.sonalitCesiumRuntime = 'true';

  const scriptLoad = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      reject(new Error('CesiumJS runtime failed to load. Check the connection and retry.'));
    }, { once: true });
    document.head.appendChild(script);
  });

  runtimeLoad = Promise.all([stylesheetLoad, scriptLoad]).then(() => {
    if (!runtimeWindow.Cesium) {
      throw new Error('CesiumJS loaded without exposing its global runtime.');
    }
  }).catch((error: unknown) => {
    script.remove();
    runtimeLoad = null;
    throw error;
  });

  return runtimeLoad;
}
