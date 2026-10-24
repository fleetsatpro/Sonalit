"use strict";

const vm = require("node:vm");
const { renderDownloadPage, renderDownloadScript } = require("../src/utils/apkDownloadPage");
const { parseApkReleaseMetadata } = require("../src/utils/apkReleaseMetadata");

describe("Sonalit download hub", () => {
  test("identifies the four apps and exposes discovery controls", () => {
    const html = renderDownloadPage();
    expect(html).toContain("Every tool.");
    expect(html).toContain('id="app-grid"');
    expect(html).toContain('id="app-search"');
    expect(html).toContain('data-filter="operations"');
    expect(html).toContain('data-filter="field"');
    expect(html).toContain('data-filter="handover"');
    expect(html).toContain('data-filter="safety"');
    expect(html).toContain("Sonalit Field");
    expect(html).toContain("Sonalit Handover");
    expect(html).toContain("Sonalit Guardian");
    expect(html).toContain("Official release channel");
    expect(html).toContain('<script src="/download/release.js" defer></script>');
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/i);
  });

  test("download script is valid JavaScript and renders unknown releases safely", () => {
    const script = renderDownloadScript();
    expect(() => new vm.Script(script)).not.toThrow();
    expect(script).toContain("Release check required");
    expect(script).toContain("No published APK available");
    expect(script).toContain('var catalogUrl = "/download/catalog.json"');
    expect(script).toContain('catalogUrl + "?refresh=1"');
    expect(script).toContain('querySelectorAll(".filter-btn[data-filter]")');
    expect(script).toContain('hostname === "github.com"');
  });

  test("reads APK metadata embedded in release notes and removes the comment", () => {
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

  test("does not promote malformed or absent metadata to verified values", () => {
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
