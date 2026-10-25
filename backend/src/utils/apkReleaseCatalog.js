"use strict";

const { parseApkReleaseMetadata } = require("./apkReleaseMetadata");

const RELEASE_CACHE_MS = 600_000;
const MIN_REFRESH_INTERVAL_MS = 900_000;
const FAILURE_COOLDOWN_MS = 60_000;
const APPS = [
  {
    id: "sonalit",
    filterKey: "operations",
    name: "Sonalit",
    shortName: "Sonalit",
    category: "OPERATIONS",
    audience: "Operations & management",
    description: "Your main Sonalit workspace for fleet coordination, dispatch, monitoring and operational decisions.",
    capabilities: ["Fleet operations", "Dispatch & oversight", "Live operational workspace"],
    packageName: "io.sonalit.app",
    tagPrefix: "sonalit-v",
    assetNames: ["sonalit.apk"],
    downloadPath: null,
    icon: "command",
    accent: "blue",
    minimumSdkFallback: 24,
    minimumAndroidFallback: "Android 7.0+",
    order: 1
  },
  {
    id: "field",
    filterKey: "field",
    name: "Sonalit Field",
    shortName: "Field",
    category: "YARD & PORT",
    audience: "Yard & port teams",
    description: "A focused mobile workflow for container e-lock clamping, arrivals, unclamping and delivery updates.",
    capabilities: ["Clamp e-locks", "Live transit view", "Record delivery"],
    packageName: "io.sonalit.field",
    tagPrefix: "sonalit-field-v",
    assetNames: ["sonalit-field.apk"],
    downloadPath: null,
    icon: "container",
    accent: "mint",
    minimumSdkFallback: 24,
    minimumAndroidFallback: "Android 7.0+",
    order: 2
  },
  {
    id: "handover",
    filterKey: "handover",
    name: "Sonalit Handover",
    shortName: "Handover",
    category: "SECURE HANDOVER",
    audience: "Handover officers",
    description: "Review convoys awaiting handover, complete signed truck or convoy handovers, and submit the required form.",
    capabilities: ["Review pending handovers", "Truck-by-truck or convoy sign-off", "Submit signed forms"],
    packageName: "io.sonalit.handover",
    tagPrefix: "sonalit-handover-v",
    assetNames: ["sonalit-handover.apk"],
    downloadPath: null,
    icon: "file-check",
    accent: "amber",
    minimumSdkFallback: 24,
    minimumAndroidFallback: "Android 7.0+",
    order: 3
  },
  {
    id: "guardian",
    filterKey: "safety",
    name: "Sonalit Guardian",
    shortName: "Guardian",
    category: "FIELD SAFETY",
    audience: "Field officers",
    description: "The native Guardian companion for device enrolment, location and field-safety operations.",
    capabilities: ["Device enrolment", "Field location", "Guardian safety workflows"],
    packageName: "io.sonalit.guardian",
    tagPrefix: "guardian-v",
    assetNames: ["app-release.apk", "app-debug.apk"],
    // The hub uses the exact Guardian release asset selected with its metadata,
    // avoiding a stable redirect/R2 object that may lag the published release.
    downloadPath: null,
    icon: "shield-check",
    accent: "violet",
    minimumSdkFallback: 29,
    minimumAndroidFallback: "Android 10+",
    order: 4
  }
];

let _releasesCache = null;
let _releasesCacheAt = 0;
let _inFlight = null;
let _lastFetchAttemptAt = 0;
let _lastFetchError = null;

function getAppDefinitions() {
  return APPS.map(({ tagPrefix, assetNames, downloadPath, minimumSdkFallback, minimumAndroidFallback, ...publicFields }) => ({
    ...publicFields,
    minimumAndroid: minimumAndroidFallback,
    minimumSdk: minimumSdkFallback,
    status: "unverified",
    statusLabel: "Checking release",
    releaseId: null,
    releaseName: null,
    appVersion: null,
    versionCode: null,
    publishedAt: null,
    sizeBytes: null,
    sizeLabel: null,
    packageId: publicFields.packageName,
    downloadUrl: null,
    releaseNotes: null,
    sha256: null
  }));
}

function formatSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes >= 100 * 1024 * 1024 ? Math.round(bytes / (1024 * 1024)) : (bytes / (1024 * 1024)).toFixed(1)) + " MB";
}

async function fetchReleases(forceRefresh = false) {
  const now = Date.now();
  if (_inFlight) return _inFlight;

  // Apply failure cooldowns even when a stale snapshot exists and its normal TTL
  // has expired; otherwise each request would retry a failing upstream API.
  if (_lastFetchError && now - _lastFetchAttemptAt < FAILURE_COOLDOWN_MS) {
    if (_releasesCache) return _releasesCache;
    throw new Error("Release catalogue refresh is temporarily rate-limited after a previous failure");
  }

  if (_releasesCache) {
    const age = now - _releasesCacheAt;
    if (!forceRefresh && age < RELEASE_CACHE_MS) return _releasesCache;

    // A public refresh parameter must not let every visitor bypass the shared
    // GitHub API budget. Reuse the current release snapshot until the minimum
    // refresh interval has elapsed, even when the caller explicitly rechecks.
    if (forceRefresh && now - _lastFetchAttemptAt < MIN_REFRESH_INTERVAL_MS) {
      return _releasesCache;
    }
  } else if (_lastFetchError && now - _lastFetchAttemptAt < FAILURE_COOLDOWN_MS) {
    // Avoid hammering GitHub when its API is unavailable and no snapshot exists.
    throw new Error("Release catalogue refresh is temporarily rate-limited after a previous failure");
  }

  _lastFetchAttemptAt = now;
  const request = (async () => {
    const repo = process.env.APK_RELEASE_REPO || "fleetsatpro/Sonalit";
    const headers = {
      "User-Agent": "Sonalit-Download-Catalog",
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = "Bearer " + token;

    // Releases across multiple Sonalit apps share one repository-level list.
    // Continue through additional pages only when an app-specific APK is still
    // missing, up to a bounded limit to avoid unbounded API traffic.
    const collected = [];
    for (let page = 1; page <= 5; page++) {
      const releasesUrl = "https://api.github.com/repos/" + repo + "/releases?per_page=100&page=" + page;
      let response = await fetch(releasesUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(12_000)
      });
      // The catalogue is public data. A stale/revoked Railway token must not
      // make the app hub appear empty when the unauthenticated public endpoint
      // is still available. Fall back once on 401 and keep using the public
      // endpoint for subsequent pages in this refresh.
      if (response.status === 401 && headers.Authorization) {
        delete headers.Authorization;
        response = await fetch(releasesUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(12_000)
        });
      }
      if (!response.ok) throw new Error("GitHub release catalog returned HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("GitHub release catalog had an unexpected shape");
      collected.push(...data);

      const everyAppFound = APPS.every(definition => collected.some(release =>
        release &&
        typeof release.tag_name === "string" &&
        release.tag_name.startsWith(definition.tagPrefix) &&
        release.draft !== true &&
        release.prerelease !== true &&
        Array.isArray(release.assets) &&
        release.assets.some(asset =>
          asset &&
          /\.apk$/i.test(String(asset.name || "")) &&
          Number(asset.size) > 0 &&
          typeof asset.browser_download_url === "string"
        )
      ));
      if (everyAppFound || data.length < 100) break;
    }

    _releasesCache = collected;
    _releasesCacheAt = Date.now();
    _lastFetchError = null;
    return collected;
  })();

  _inFlight = request;
  try {
    return await request;
  } catch (error) {
    _lastFetchError = error;
    // Serve the last known-good snapshot on transient upstream errors; never
    // replace it with fabricated data or make a burst of retries.
    if (_releasesCache) return _releasesCache;
    throw error;
  } finally {
    if (_inFlight === request) _inFlight = null;
  }
}
function pickRelease(releases, definition) {
  const candidates = releases.filter(release =>
    release &&
    typeof release.tag_name === "string" &&
    release.tag_name.startsWith(definition.tagPrefix) &&
    release.draft !== true &&
    release.prerelease !== true &&
    Array.isArray(release.assets) &&
    release.assets.some(asset => asset && /\.apk$/i.test(String(asset.name || "")))
  );

  candidates.sort((a, b) => {
    const aTime = Date.parse(a.published_at || a.created_at || "") || 0;
    const bTime = Date.parse(b.published_at || b.created_at || "") || 0;
    return bTime - aTime;
  });
  if (!candidates.length) return null;

  for (const release of candidates) {
    const preferred = definition.assetNames
      .map(name => release.assets.find(asset => asset && asset.name === name))
      .find(Boolean);
    const asset = preferred || release.assets.find(item => item && /\.apk$/i.test(String(item.name || "")));
    if (asset && Number(asset.size) > 0 && typeof asset.browser_download_url === "string") {
      return { release, asset };
    }
  }
  return null;
}

function serializeApp(definition, selected) {
  const { tagPrefix, assetNames, downloadPath, minimumSdkFallback, minimumAndroidFallback, ...publicFields } = definition;
  if (!selected) {
    return {
      ...publicFields,
      minimumAndroid: minimumAndroidFallback,
      minimumSdk: minimumSdkFallback,
      status: "unavailable",
      statusLabel: "No published APK found",
      releaseId: null,
      releaseName: null,
      appVersion: null,
      versionCode: null,
      publishedAt: null,
      sizeBytes: null,
      sizeLabel: null,
      packageId: publicFields.packageName,
      downloadUrl: null,
      releaseNotes: null,
      sha256: null
    };
  }

  const { release, asset } = selected;
  const metadata = parseApkReleaseMetadata(release.body);
  const minimumSdk = metadata.min_sdk || minimumSdkFallback;
  const minimumAndroid = ({
    24: "Android 7.0+",
    25: "Android 7.1+",
    26: "Android 8.0+",
    27: "Android 8.1+",
    28: "Android 9+",
    29: "Android 10+",
    30: "Android 11+",
    31: "Android 12+",
    32: "Android 12L+",
    33: "Android 13+",
    34: "Android 14+",
    35: "Android 15+",
    36: "Android 16+"
  })[minimumSdk] || ("Android API " + minimumSdk + "+");

  return {
    ...publicFields,
    minimumSdk,
    minimumAndroid,
    status: "available",
    statusLabel: metadata.app_version ? "Latest release · verified app version" : "Latest published release",
    releaseId: release.tag_name,
    releaseName: release.name || release.tag_name,
    appVersion: metadata.app_version,
    versionCode: metadata.version_code,
    publishedAt: release.published_at || release.created_at || null,
    sizeBytes: Number(asset.size) || null,
    sizeLabel: formatSize(asset.size) || "Unavailable",
    packageId: metadata.package_name || publicFields.packageName,
    downloadUrl: `/api/v1/guardian/apk/download-app/${publicFields.id}/${encodeURIComponent(release.tag_name)}`,
    releaseNotes: metadata.notes ? metadata.notes.slice(0, 5000) : null,
    sha256: metadata.sha256 || null
  };
}

async function getSonalitApkCatalog({ forceRefresh = false } = {}) {
  const releases = await fetchReleases(forceRefresh);
  const sourceStale = Date.now() - _releasesCacheAt > RELEASE_CACHE_MS;
  const apps = APPS
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(definition => serializeApp(definition, pickRelease(releases, definition)))
    .map(app => sourceStale && app.status === "available"
      ? { ...app, status: "stale", statusLabel: "Last known release" }
      : app);

  return {
    source: "github-releases",
    checkedAt: new Date().toISOString(),
    sourceCheckedAt: _releasesCacheAt ? new Date(_releasesCacheAt).toISOString() : null,
    stale: sourceStale,
    apps
  };
}

function createUnverifiedCatalog() {
  return {
    source: "unavailable",
    checkedAt: new Date().toISOString(),
    apps: getAppDefinitions()
  };
}

async function getAppReleaseById(appId, releaseId, { forceRefresh = false } = {}) {
  const definition = APPS.find(app => app.id === appId);
  if (!definition) throw new Error("Unknown Sonalit APK application: " + appId);
  if (typeof releaseId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(releaseId) ||
      !releaseId.startsWith(definition.tagPrefix)) {
    throw new Error("Release ID does not belong to the requested Sonalit app");
  }

  const releases = await fetchReleases(forceRefresh);
  const release = releases.find(item =>
    item &&
    item.tag_name === releaseId &&
    item.tag_name.startsWith(definition.tagPrefix) &&
    item.draft !== true &&
    item.prerelease !== true &&
    Array.isArray(item.assets)
  );
  if (!release) throw new Error("Published release was not found for " + appId);

  const preferred = definition.assetNames
    .map(name => release.assets.find(asset => asset && asset.name === name))
    .find(Boolean);
  const asset = preferred || release.assets.find(item => item && /\.apk$/i.test(String(item.name || "")));
  if (!asset || !(Number(asset.size) > 0) ||
      typeof asset.browser_download_url !== "string" ||
      typeof asset.url !== "string") {
    throw new Error("Release does not contain a downloadable APK asset");
  }

  return {
    release,
    asset,
    definition,
    metadata: parseApkReleaseMetadata(release.body)
  };
}

async function getLatestAppRelease(appId, { forceRefresh = false } = {}) {
  const definition = APPS.find(app => app.id === appId);
  if (!definition) throw new Error("Unknown Sonalit APK application: " + appId);
  const releases = await fetchReleases(forceRefresh);
  const selected = pickRelease(releases, definition);
  if (!selected) throw new Error("No published APK was found for " + appId);
  return {
    ...selected,
    metadata: parseApkReleaseMetadata(selected.release.body),
    definition
  };
}

module.exports = {
  getAppDefinitions,
  getSonalitApkCatalog,
  createUnverifiedCatalog,
  getLatestAppRelease,
  getAppReleaseById,
  fetchReleases,
  formatSize
};
