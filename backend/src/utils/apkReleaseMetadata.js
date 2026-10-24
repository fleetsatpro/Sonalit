"use strict";

function parseApkReleaseMetadata(body) {
  const releaseBody = typeof body === "string" ? body : "";
  const metadataMatch = releaseBody.match(/<!--\s*SONALIT_APK_METADATA\s+([\s\S]*?)\s*-->/i);
  let raw = {};

  if (metadataMatch) {
    try {
      const parsed = JSON.parse(metadataMatch[1].trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
    } catch (_) {
      // Malformed or absent metadata must never be treated as verified.
    }
  }

  const versionCode = Number(raw.version_code);
  const minSdk = Number(raw.min_sdk);
  const packageName = typeof raw.package_name === "string" &&
    /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(raw.package_name)
    ? raw.package_name : null;
  const sha256 = typeof raw.sha256 === "string" && /^[a-f0-9]{64}$/i.test(raw.sha256)
    ? raw.sha256.toLowerCase() : null;

  return {
    notes: releaseBody.replace(/<!--\s*SONALIT_APK_METADATA[\s\S]*?-->/i, "").trim() || null,
    app_version: typeof raw.version_name === "string" && raw.version_name.trim() ? raw.version_name.trim() : null,
    version_code: Number.isSafeInteger(versionCode) && versionCode > 0 ? versionCode : null,
    package_name: packageName,
    min_sdk: Number.isSafeInteger(minSdk) && minSdk > 0 ? minSdk : null,
    sha256
  };
}

module.exports = { parseApkReleaseMetadata };
