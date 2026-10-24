"use strict";

const vm = require("node:vm");
const { renderDownloadPage, renderDownloadScript } = require("../src/utils/apkDownloadPage");
const { parseApkReleaseMetadata } = require("../src/utils/apkReleaseMetadata");

describe("Sonalit Guardian download experience", () => {
  test("clearly identifies the exact app and its release fields", () => {
    const html = renderDownloadPage();
    expect(html).toContain("Sonalit Guardian");
    expect(html).toContain("io.sonalit.guardian");
    expect(html).toContain('href="/api/v1/guardian/apk/download"');
    expect(html).toContain('id="app-version"');
    expect(html).toContain('id="release-version"');
    expect(html).toContain('id="published"');
    expect(html).toContain('id="size"');
    expect(html).toContain('id="android-requirement"');
    expect(html).toContain('<script src="/download/release.js" defer></script>');
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/i);
  });

  test("download script is valid JavaScript and does not claim latest on missing metadata", () => {
    const script = renderDownloadScript();
    expect(() => new vm.Script(script)).not.toThrow();
    expect(script).toContain("Latest status unconfirmed");
    expect(script).toContain("latest version is unconfirmed");
    expect(script).toContain('cache: "no-store"');
  });

  test("reads APK metadata from the published release comment and removes it from notes", () => {
    const fingerprint = "a".repeat(64);
    const metadataComment = '<!-- SONALIT_APK_METADATA {"version_name":"4.7.0","version_code":13,"package_name":"io.sonalit.guardian","min_sdk":29,"sha256":"' + fingerprint + '"} -->';
    const body = "Sonalit Guardian release notes\n\n" + metadataComment;
    const parsed = parseApkReleaseMetadata(body);
    expect(parsed).toEqual({
      notes: "Sonalit Guardian release notes",
      app_version: "4.7.0",
      version_code: 13,
      package_name: "io.sonalit.guardian",
      min_sdk: 29,
      sha256: fingerprint
    });
  });

  test("does not mark malformed or absent APK metadata as verified", () => {
    expect(parseApkReleaseMetadata("Release notes only")).toEqual({
      notes: "Release notes only",
      app_version: null,
      version_code: null,
      package_name: null,
      min_sdk: null,
      sha256: null
    });
    const parsed = parseApkReleaseMetadata('<!-- SONALIT_APK_METADATA {"version_code":0,"package_name":"not a package","sha256":"bad"} -->');
    expect(parsed.version_code).toBeNull();
    expect(parsed.package_name).toBeNull();
    expect(parsed.sha256).toBeNull();
  });
});
