/**
 * vite-plugin-cesium still copies and serves the static runtime assets, but
 * its default HTML transform eagerly injects the global script and widget
 * stylesheet into every entry point. Those assets are imported by the
 * actual Cesium consumers and should load with their lazy route chunks.
 */
export function stripCesiumGlobalHtmlAssets(html: string): string {
  return html
    .replace(
      /<script\b(?=[^>]*\bsrc=["'][^"']*\/cesium\/Cesium\.js(?:\?[^"']*)?["'])[^>]*>\s*<\/script>\s*/gi,
      '',
    )
    .replace(
      /<link\b(?=[^>]*\bhref=["'][^"']*\/cesium\/Widgets\/widgets\.css(?:\?[^"']*)?["'])[^>]*\/?>\s*/gi,
      '',
    );
}
