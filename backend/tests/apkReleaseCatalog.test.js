"use strict";

const originalFetch = global.fetch;

function makeRelease(tag, name, packageId, versionName, versionCode, minSdk, publishedAt, assetName) {
  const checksum = (versionCode.toString(16).padStart(2, "0")).repeat(32).slice(0, 64);
  const metadata = '<!-- SONALIT_APK_METADATA {"version_name":"' + versionName +
    '","version_code":' + versionCode +
    ',"package_name":"' + packageId +
    '","min_sdk":' + minSdk +
    ',"sha256":"' + checksum + '"} -->';
  return {
    tag_name: tag,
    name,
    body: "Verified build metadata\n\n" + metadata,
    draft: false,
    prerelease: false,
    published_at: publishedAt,
    created_at: publishedAt,
    assets: assetName ? [{
      name: assetName,
      size: 2_097_152,
      browser_download_url: "https://github.com/fleetsatpro/Sonalit/releases/download/" + tag + "/" + assetName,
      url: "https://api.github.com/repos/fleetsatpro/Sonalit/releases/assets/" + versionCode
    }] : []
  };
}

describe("Sonalit app-specific APK release catalogue", () => {
  beforeEach(() => {
    // Reset module-scoped cache so tests are isolated from the refresh cooldown.
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test("selects each app's newest matching tag and its own APK asset", async () => {
    const newerDate = "2026-10-24T20:00:00Z";
    const olderDate = "2026-10-10T20:00:00Z";
    const releases = [
      makeRelease("sonalit-v41", "Sonalit v41", "io.sonalit.app", "1.0.41", 41, 24, newerDate, "sonalit.apk"),
      makeRelease("sonalit-field-v26", "Sonalit Field v26", "io.sonalit.field", "1.0.26", 26, 24, newerDate, "sonalit-field.apk"),
      makeRelease("sonalit-handover-v18", "Sonalit Handover v18", "io.sonalit.handover", "1.0.18", 18, 24, newerDate, "sonalit-handover.apk"),
      makeRelease("guardian-v981", "Sonalit Guardian 4.7.0", "io.sonalit.guardian", "4.7.0", 13, 29, newerDate, "app-debug.apk"),
      makeRelease("sonalit-field-v25", "Sonalit Field v25", "io.sonalit.field", "1.0.25", 25, 24, olderDate, "sonalit-field.apk"),
      makeRelease("sonalit-handover-v17", "Sonalit Handover v17", "io.sonalit.handover", "1.0.17", 17, 24, olderDate, "sonalit-handover.apk")
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => releases
    });

    const { getSonalitApkCatalog } = require("../src/utils/apkReleaseCatalog");
    const catalog = await getSonalitApkCatalog({ forceRefresh: true });
    const byId = Object.fromEntries(catalog.apps.map(app => [app.id, app]));

    expect(catalog.source).toBe("github-releases");
    expect(catalog.apps).toHaveLength(4);
    expect(byId.sonalit.releaseId).toBe("sonalit-v41");
    expect(byId.sonalit.appVersion).toBe("1.0.41");
    expect(byId.sonalit.packageId).toBe("io.sonalit.app");
    expect(byId.sonalit.downloadUrl).toContain("/api/v1/guardian/apk/download-app/sonalit/sonalit-v41");

    expect(byId.field.releaseId).toBe("sonalit-field-v26");
    expect(byId.field.appVersion).toBe("1.0.26");
    expect(byId.field.packageId).toBe("io.sonalit.field");
    expect(byId.field.downloadUrl).toContain("/api/v1/guardian/apk/download-app/field/sonalit-field-v26");

    expect(byId.handover.releaseId).toBe("sonalit-handover-v18");
    expect(byId.handover.appVersion).toBe("1.0.18");
    expect(byId.handover.packageId).toBe("io.sonalit.handover");
    expect(byId.handover.downloadUrl).toContain("/api/v1/guardian/apk/download-app/handover/sonalit-handover-v18");

    expect(byId.guardian.releaseId).toBe("guardian-v981");
    expect(byId.guardian.appVersion).toBe("4.7.0");
    expect(byId.guardian.packageId).toBe("io.sonalit.guardian");
    expect(byId.guardian.downloadUrl).toContain("/api/v1/guardian/apk/download-app/guardian/guardian-v981");
    expect(byId.guardian.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("does not create a download link when an app has no published APK asset", async () => {
    const releases = [
      makeRelease("sonalit-v41", "Sonalit v41", "io.sonalit.app", "1.0.41", 41, 24, "2026-10-24T20:00:00Z", "sonalit.apk"),
      makeRelease("sonalit-field-v26", "Sonalit Field v26", "io.sonalit.field", "1.0.26", 26, 24, "2026-10-24T20:00:00Z", null),
      makeRelease("sonalit-handover-v18", "Sonalit Handover v18", "io.sonalit.handover", "1.0.18", 18, 24, "2026-10-24T20:00:00Z", "sonalit-handover.apk"),
      makeRelease("guardian-v981", "Sonalit Guardian 4.7.0", "io.sonalit.guardian", "4.7.0", 13, 29, "2026-10-24T20:00:00Z", "app-debug.apk")
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => releases });

    const catalog = await getSonalitApkCatalog({ forceRefresh: true });
    const field = catalog.apps.find(app => app.id === "field");

    expect(field.status).toBe("unavailable");
    expect(field.downloadUrl).toBeNull();
    expect(field.releaseId).toBeNull();
  });

  test("resolves only the exact requested release for the requested app", async () => {
    const releases = [
      makeRelease("sonalit-v41", "Sonalit v41", "io.sonalit.app", "1.0.41", 41, 24, "2026-10-24T20:00:00Z", "sonalit.apk"),
      makeRelease("sonalit-v40", "Sonalit v40", "io.sonalit.app", "1.0.40", 40, 24, "2026-10-10T20:00:00Z", "sonalit.apk"),
      makeRelease("sonalit-field-v26", "Sonalit Field v26", "io.sonalit.field", "1.0.26", 26, 24, "2026-10-24T20:00:00Z", "sonalit-field.apk")
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => releases });
    const { getAppReleaseById } = require("../src/utils/apkReleaseCatalog");

    const olderExact = await getAppReleaseById("sonalit", "sonalit-v40", { forceRefresh: true });
    expect(olderExact.release.tag_name).toBe("sonalit-v40");
    expect(olderExact.asset.name).toBe("sonalit.apk");

    await expect(getAppReleaseById("field", "sonalit-v40")).rejects.toThrow("Release ID does not belong");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("cooldowns repeated upstream failures when no snapshot exists", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("temporary GitHub outage"));
    const { getSonalitApkCatalog } = require("../src/utils/apkReleaseCatalog");

    await expect(getSonalitApkCatalog({ forceRefresh: true })).rejects.toThrow("temporary GitHub outage");
    await expect(getSonalitApkCatalog({ forceRefresh: true })).rejects.toThrow("temporarily rate-limited");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("coalesces repeated public forced refreshes within the minimum interval", async () => {
    const releases = [
      makeRelease("sonalit-v41", "Sonalit v41", "io.sonalit.app", "1.0.41", 41, 24, "2026-10-24T20:00:00Z", "sonalit.apk"),
      makeRelease("sonalit-field-v26", "Sonalit Field v26", "io.sonalit.field", "1.0.26", 26, 24, "2026-10-24T20:00:00Z", "sonalit-field.apk"),
      makeRelease("sonalit-handover-v18", "Sonalit Handover v18", "io.sonalit.handover", "1.0.18", 18, 24, "2026-10-24T20:00:00Z", "sonalit-handover.apk"),
      makeRelease("guardian-v981", "Sonalit Guardian 4.7.0", "io.sonalit.guardian", "4.7.0", 13, 29, "2026-10-24T20:00:00Z", "app-debug.apk")
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => releases });
    const { getSonalitApkCatalog } = require("../src/utils/apkReleaseCatalog");

    await getSonalitApkCatalog({ forceRefresh: true });
    await getSonalitApkCatalog({ forceRefresh: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("unverified catalog has no fabricated version or download links", () => {
    const { createUnverifiedCatalog } = require("../src/utils/apkReleaseCatalog");
    const catalog = createUnverifiedCatalog();

    expect(catalog.source).toBe("unavailable");
    expect(catalog.apps).toHaveLength(4);
    for (const app of catalog.apps) {
      expect(app.status).toBe("unverified");
      expect(app.releaseId).toBeNull();
      expect(app.appVersion).toBeNull();
      expect(app.downloadUrl).toBeNull();
    }
  });
});
