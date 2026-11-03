type CesiumRuntimeWindow = Window & {
  Cesium?: unknown;
  CESIUM_BASE_URL?: string;
};

let runtimeLoad: Promise<void> | null = null;

/**
 * Load the legacy CesiumJS global only for routes that still consume the
 * externalized cesium package. The SJM globe uses @cesium/engine and remains
 * independently code-split behind its Airspace workspace tab.
 */
export function loadCesiumRuntime(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('CesiumJS can only be loaded in a browser.'));
  }

  const runtimeWindow = window as CesiumRuntimeWindow;
  if (runtimeWindow.Cesium) return Promise.resolve();
  if (runtimeLoad) return runtimeLoad;

  const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  const cesiumBaseUrl = new URL('cesium/', appBaseUrl);
  runtimeWindow.CESIUM_BASE_URL = cesiumBaseUrl.href;

  const script = document.createElement('script');
  script.src = new URL('Cesium.js', cesiumBaseUrl).href;
  script.async = true;
  script.dataset.sonalitCesiumRuntime = 'true';

  runtimeLoad = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => {
      if (runtimeWindow.Cesium) {
        resolve();
      } else {
        reject(new Error('CesiumJS loaded without exposing its global runtime.'));
      }
    }, { once: true });
    script.addEventListener('error', () => {
      reject(new Error('CesiumJS runtime failed to load. Check the connection and retry.'));
    }, { once: true });
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    script.remove();
    runtimeLoad = null;
    throw error;
  });

  return runtimeLoad;
}
