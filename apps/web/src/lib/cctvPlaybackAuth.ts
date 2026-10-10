/**
 * Only Sonalit's configured CCTV proxy may receive application credentials.
 * Direct source HLS manifests and segments stay unauthenticated.
 */
export function isTrustedCctvApiMediaRequest(
  requestUrl: string,
  configuredApiBase: string,
  pageOrigin: string,
): boolean {
  try {
    const apiBase = new URL(configuredApiBase, pageOrigin);
    const request = new URL(requestUrl, pageOrigin);
    const basePath = apiBase.pathname.replace(/\/+$/, '');
    const cctvPathPrefix = basePath ? basePath + '/cctv/' : '/cctv/';
    return request.origin === apiBase.origin && request.pathname.startsWith(cctvPathPrefix);
  } catch {
    return false;
  }
}
