"use strict";

function renderDownloadPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080d15">
  <meta name="description" content="Official Sonalit Guardian Android download. Check the app version and release details before installing.">
  <meta name="robots" content="noindex,nofollow">
  <title>Download Sonalit Guardian for Android | Sonalit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080d15;
      --panel: rgba(17, 25, 38, .88);
      --panel-soft: rgba(255,255,255,.035);
      --line: rgba(192, 208, 229, .13);
      --text: #f3f6fb;
      --muted: #a1aec0;
      --quiet: #748398;
      --gold: #f1b955;
      --mint: #63e6b1;
      --blue: #90c8ff;
      --warning: #f5c56f;
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--bg); }
    body {
      margin: 0; min-height: 100vh; padding: clamp(18px, 4.2vw, 46px);
      color: var(--text);
      background:
        radial-gradient(ellipse at 8% 0%, rgba(39, 86, 133, .28), transparent 36rem),
        radial-gradient(ellipse at 95% 20%, rgba(196, 137, 46, .11), transparent 34rem),
        linear-gradient(155deg, #0a111c 0%, #080d15 54%, #0b121c 100%);
      font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    body::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .13;
      background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: linear-gradient(to bottom, black, transparent 78%);
    }
    button, a { font: inherit; }
    a { color: inherit; }
    .page { position: relative; width: 100%; max-width: 1080px; margin: 0 auto; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: clamp(36px, 6vw, 70px); }
    .brand { display: inline-flex; align-items: center; gap: 12px; min-width: 0; text-decoration: none; }
    .brand-mark {
      display: grid; place-items: center; width: 42px; height: 42px; flex: 0 0 42px;
      border-radius: 13px; color: #10151c; background: linear-gradient(140deg, #ffe1a0, #d99a37);
      box-shadow: 0 8px 28px rgba(217,154,55,.19);
    }
    .brand-word { font-size: 14px; font-weight: 850; letter-spacing: .22em; line-height: 1.2; }
    .brand-caption { margin-top: 5px; color: var(--quiet); font-size: 10px; font-weight: 750; letter-spacing: .16em; }
    .distribution-note { display: inline-flex; align-items: center; gap: 9px; color: #aebacc; font-size: 12px; }
    .distribution-note svg { color: var(--mint); flex: 0 0 auto; }
    .main-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, .92fr); align-items: center; gap: clamp(28px, 5vw, 64px); }
    .eyebrow { display: flex; align-items: center; gap: 10px; color: var(--gold); font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    .eyebrow-line { width: 23px; height: 1px; background: currentColor; opacity: .85; }
    h1 { max-width: 580px; margin: 20px 0 17px; font-size: clamp(38px, 5.2vw, 63px); font-weight: 780; letter-spacing: -.055em; line-height: 1.03; }
    h1 span { color: #92caff; }
    .intro { max-width: 480px; margin: 0; color: var(--muted); font-size: clamp(15px, 1.65vw, 17px); line-height: 1.8; }
    .app-identity {
      display: flex; align-items: center; gap: 16px; margin-top: 31px; padding: 17px;
      border: 1px solid var(--line); border-radius: 18px;
      background: linear-gradient(125deg, rgba(255,255,255,.06), rgba(255,255,255,.018));
      box-shadow: inset 0 1px rgba(255,255,255,.035);
    }
    .app-icon {
      display: grid; place-items: center; width: 62px; height: 62px; flex: 0 0 62px;
      border: 1px solid rgba(241,185,85,.3); border-radius: 18px;
      color: var(--gold); background: linear-gradient(145deg, rgba(241,185,85,.14), rgba(241,185,85,.045));
    }
    .app-title { margin: 0; font-size: 19px; font-weight: 760; letter-spacing: -.025em; }
    .app-subtitle { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .package-id { margin-top: 7px; color: #788ba2; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .apk-label { align-self: flex-start; margin-left: auto; padding: 5px 8px; border: 1px solid rgba(144,200,255,.22); border-radius: 8px; color: var(--blue); font-size: 10px; font-weight: 850; letter-spacing: .1em; }
    .identity-note { display: flex; align-items: flex-start; gap: 10px; max-width: 490px; margin: 18px 0 0; color: var(--quiet); font-size: 12px; }
    .identity-note svg { margin-top: 2px; flex: 0 0 auto; color: var(--mint); }
    .release-card {
      padding: clamp(20px, 3vw, 30px); border: 1px solid rgba(186,205,229,.17); border-radius: 24px;
      background: linear-gradient(155deg, rgba(19,29,43,.97), rgba(12,19,29,.97));
      box-shadow: 0 28px 80px rgba(0,0,0,.34), inset 0 1px rgba(255,255,255,.045);
    }
    .release-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 21px; border-bottom: 1px solid var(--line); }
    .release-head .eyebrow { color: #9caec2; font-size: 10px; letter-spacing: .15em; }
    .status-pill { display: inline-flex; align-items: center; gap: 7px; max-width: 58%; padding: 6px 9px; border: 1px solid rgba(192,208,229,.15); border-radius: 999px; color: #c2ccd9; background: rgba(255,255,255,.035); font-size: 10px; font-weight: 800; line-height: 1.3; }
    .status-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #9aa7b7; }
    .status-pill.is-live { color: var(--mint); border-color: rgba(99,230,177,.28); background: rgba(99,230,177,.075); }
    .status-pill.is-live .status-dot { background: var(--mint); box-shadow: 0 0 12px rgba(99,230,177,.65); }
    .status-pill.is-warning { color: var(--warning); border-color: rgba(245,197,111,.3); background: rgba(245,197,111,.065); }
    .status-pill.is-warning .status-dot { background: var(--warning); }
    .version-block { padding: 25px 0 23px; }
    .field-label { color: #8c9bb0; font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .app-version { margin-top: 7px; font-size: clamp(30px, 4vw, 43px); font-weight: 780; letter-spacing: -.045em; line-height: 1.1; overflow-wrap: anywhere; }
    .version-code { margin-top: 7px; color: #a0afc2; font-size: 12px; }
    .release-id { display: flex; align-items: baseline; gap: 7px; margin-top: 13px; color: #8494a8; font-size: 12px; }
    .release-id code { padding: 3px 7px; border: 1px solid rgba(192,208,229,.14); border-radius: 6px; color: #d2dbe6; background: rgba(255,255,255,.03); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 22px; border-top: 1px solid var(--line); }
    .meta-item { min-width: 0; padding: 15px 12px 14px 0; border-bottom: 1px solid var(--line); }
    .meta-item:nth-child(2n) { padding-left: 12px; padding-right: 0; border-left: 1px solid var(--line); }
    .meta-item span { display: block; color: var(--quiet); font-size: 11px; }
    .meta-item strong { display: block; margin-top: 4px; color: #e0e7f0; font-size: 12px; font-weight: 670; overflow-wrap: anywhere; }
    .meta-item strong.mono { font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .download-button {
      display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 58px;
      padding: 15px 18px; border: 0; border-radius: 14px; color: #17130b; background: linear-gradient(105deg, #ffdc91, #f1b955 64%, #d99936);
      box-shadow: 0 10px 30px rgba(217,153,54,.18), inset 0 1px rgba(255,255,255,.48);
      text-align: center; text-decoration: none; font-size: 14px; font-weight: 850; transition: transform .18s ease, filter .18s ease, box-shadow .18s ease;
    }
    .download-button:hover { filter: brightness(1.05); transform: translateY(-1px); box-shadow: 0 14px 34px rgba(217,153,54,.25); }
    .download-button:active { transform: translateY(1px); }
    .download-button:focus-visible, a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid #92caff; outline-offset: 3px; }
    .download-button svg { flex: 0 0 auto; }
    .download-caption { display: flex; justify-content: center; align-items: center; gap: 7px; margin-top: 12px; color: var(--quiet); font-size: 10px; text-align: center; }
    .download-caption svg { color: var(--mint); flex: 0 0 auto; }
    .release-warning { margin-top: 15px; padding: 12px 13px; border: 1px solid rgba(245,197,111,.22); border-radius: 11px; color: #e3c891; background: rgba(245,197,111,.06); font-size: 12px; line-height: 1.65; }
    .release-warning[hidden], .verification[hidden], .release-notes[hidden] { display: none; }
    .secondary-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 15px; color: #73869c; font-size: 11px; }
    .text-button { padding: 5px 0; border: 0; color: #a9c6e6; background: transparent; cursor: pointer; font-size: 11px; font-weight: 700; }
    .text-button:hover { color: white; }
    .text-button:disabled { cursor: wait; opacity: .6; }
    .info-sections { display: grid; grid-template-columns: .82fr 1.18fr; gap: clamp(22px, 4vw, 46px); margin-top: clamp(38px, 6vw, 68px); padding-top: 27px; border-top: 1px solid var(--line); }
    .section-title { margin: 0; font-size: 15px; font-weight: 750; letter-spacing: -.02em; }
    .section-copy { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .steps { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-top: 17px; }
    .step { min-width: 0; padding: 13px; border: 1px solid var(--line); border-radius: 13px; background: rgba(255,255,255,.022); }
    .step-no { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; color: var(--gold); background: rgba(241,185,85,.1); font-size: 10px; font-weight: 850; }
    .step strong { display: block; margin-top: 10px; font-size: 12px; }
    .step p { margin: 5px 0 0; color: var(--quiet); font-size: 11px; line-height: 1.65; }
    .release-notes, .verification { margin-top: 14px; padding: 13px 0 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    details summary { width: fit-content; color: #a9c6e6; cursor: pointer; font-size: 12px; font-weight: 700; }
    .notes-body { margin: 10px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #aab7c8; font-size: 12px; line-height: 1.8; }
    .verification-row { display: flex; align-items: center; gap: 10px; margin-top: 11px; }
    .checksum { min-width: 0; flex: 1; padding: 10px; border: 1px solid var(--line); border-radius: 8px; color: #aebed1; background: rgba(0,0,0,.2); font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .copy-button { padding: 9px 11px; border: 1px solid rgba(144,200,255,.22); border-radius: 8px; color: #bcdcff; background: rgba(144,200,255,.07); cursor: pointer; font-size: 11px; font-weight: 700; }
    .copy-status { min-height: 18px; margin-top: 6px; color: var(--mint); font-size: 11px; }
    .footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 38px; padding-top: 17px; border-top: 1px solid rgba(192,208,229,.09); color: #69798e; font-size: 10px; }
    .footer a { color: #a4b8cf; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    @media (max-width: 800px) {
      body { padding: 23px 18px 25px; }
      .topbar { margin-bottom: 36px; }
      .main-grid { grid-template-columns: minmax(0,1fr); gap: 29px; }
      h1 { max-width: 600px; font-size: clamp(39px, 9.3vw, 58px); }
      .intro { max-width: 600px; }
      .release-card { max-width: none; }
      .info-sections { grid-template-columns: minmax(0,1fr); gap: 24px; margin-top: 34px; }
      .steps { gap: 9px; }
    }
    @media (max-width: 480px) {
      body { padding: 18px 14px 22px; }
      .topbar { align-items: flex-start; margin-bottom: 32px; }
      .distribution-note { max-width: 130px; align-items: flex-start; font-size: 10px; line-height: 1.5; }
      .brand-mark { width: 38px; height: 38px; flex-basis: 38px; }
      .brand { gap: 9px; }
      .brand-word { font-size: 12px; }
      .brand-caption { font-size: 8px; letter-spacing: .12em; }
      .app-identity { gap: 12px; padding: 13px; }
      .app-icon { width: 51px; height: 51px; flex-basis: 51px; border-radius: 15px; }
      .app-title { font-size: 16px; }
      .app-subtitle { font-size: 12px; }
      .apk-label { padding: 4px 6px; font-size: 9px; }
      .release-card { padding: 19px 16px; border-radius: 19px; }
      .status-pill { max-width: 60%; font-size: 9px; }
      .meta-item strong { font-size: 11px; }
      .steps { grid-template-columns: minmax(0,1fr); }
      .step { display: grid; grid-template-columns: 26px minmax(0,1fr); column-gap: 10px; align-items: start; padding: 12px; }
      .step-no { grid-row: span 2; }
      .step strong { margin-top: 0; }
      .step p { margin-top: 3px; }
      .secondary-actions { align-items: flex-start; }
      .footer { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }
  </style>
  <script src="/download/release.js" defer></script>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="https://sonalit.com" aria-label="Sonalit official website">
        <span class="brand-mark" aria-hidden="true">
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none">
            <path d="M19.5 5.5C15.5 4.1 8.2 4.4 5.2 8.1 2.1 12 5.9 15.7 9.7 14.1c2.8-1.2 3.5-4.5 1.7-5.8-1.3-1.3-3.5-.8-4.1.7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
            <path d="M4.5 18.5c4.1 1.2 10.9.9 14-3.2 2.5-3.3.3-6.1-2.3-6.1" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
          </svg>
        </span>
        <span><span class="brand-word">SONALIT</span><span class="brand-caption" style="display:block">OFFICIAL APP DISTRIBUTION</span></span>
      </a>
      <div class="distribution-note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6v5.3c0 4.4-2.9 7.8-7 9.7-4.1-1.9-7-5.3-7-9.7V6l7-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.8 12 2.1 2.1 4.3-4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Official Sonalit download channel</span>
      </div>
    </header>

    <main>
      <div class="main-grid">
        <section aria-labelledby="page-title">
          <div class="eyebrow"><span class="eyebrow-line"></span> SONALIT GUARDIAN / ANDROID</div>
          <h1 id="page-title">The right app.<br><span>The right release.</span></h1>
          <p class="intro">Get the official field officer app with the app identity, version and release status clearly shown before you install.</p>

          <div class="app-identity">
            <div class="app-icon" aria-hidden="true">
              <svg width="31" height="31" viewBox="0 0 24 24" fill="none">
                <path d="M12 2.8 20 6v5.1c0 4.8-3.3 8.3-8 10.1-4.7-1.8-8-5.3-8-10.1V6l8-3.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M8.1 15.6V8.4h2.1l3.6 4.1V8.4h2.1v7.2h-2l-3.7-4.2v4.2H8.1Z" fill="currentColor"/>
              </svg>
            </div>
            <div style="min-width:0">
              <h2 class="app-title">Sonalit Guardian</h2>
              <p class="app-subtitle">Field officer app · Android package</p>
              <div class="package-id">io.sonalit.guardian</div>
            </div>
            <span class="apk-label">APK</span>
          </div>
          <p class="identity-note">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.1 4L19 6.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>This page downloads Sonalit Guardian—not the Sonalit web dashboard or a different mobile app. Check the release details on the right before installing.</span>
          </p>
        </section>

        <section class="release-card" aria-labelledby="release-card-title">
          <div class="release-head">
            <div class="eyebrow" id="release-card-title">CURRENT RELEASE</div>
            <div class="status-pill" id="release-status" aria-live="polite"><span class="status-dot"></span><span id="release-status-text">Checking release…</span></div>
          </div>

          <div class="version-block">
            <div class="field-label">Android app version</div>
            <div class="app-version" id="app-version">Checking…</div>
            <div class="version-code" id="version-code">Reading release metadata</div>
            <div class="release-id"><span>Release ID</span><code id="release-version">Checking…</code></div>
          </div>

          <div class="meta-grid" aria-label="Download details">
            <div class="meta-item"><span>Published</span><strong id="published">Checking…</strong></div>
            <div class="meta-item"><span>APK size</span><strong id="size">Checking…</strong></div>
            <div class="meta-item"><span>Android requirement</span><strong id="android-requirement">Checking…</strong></div>
            <div class="meta-item"><span>Package ID</span><strong class="mono" id="package-name">io.sonalit.guardian</strong></div>
          </div>

          <a class="download-button" id="download-apk" href="/api/v1/guardian/apk/download" aria-label="Download Sonalit Guardian Android APK">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.8v10.1m0 0 4-4m-4 4-4-4M4.5 16.5v2.2c0 .8.6 1.4 1.4 1.4h12.2c.8 0 1.4-.6 1.4-1.4v-2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Download Sonalit Guardian APK</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
          <div class="download-caption">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6v5c0 4.7-3.2 8.2-7 10-3.8-1.8-7-5.3-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <span>Direct APK · Release status checked against the release feed</span>
          </div>

          <div class="release-warning" id="release-warning" role="status" aria-live="polite" hidden>
            The download link is available, but the latest release and app version could not be confirmed. Recheck the details before installing if you need the exact current version.
          </div>

          <div class="secondary-actions">
            <span id="metadata-source">Release metadata is loading.</span>
            <button class="text-button" id="refresh-release" type="button">Recheck release ↻</button>
          </div>

          <details class="release-notes" id="release-notes" hidden>
            <summary>Release notes &amp; install information</summary>
            <p class="notes-body" id="release-notes-body"></p>
          </details>

          <details class="verification" id="verification" hidden>
            <summary>APK integrity · SHA-256</summary>
            <div class="verification-row">
              <input class="checksum" id="checksum" aria-label="APK SHA-256 checksum" readonly>
              <button class="copy-button" id="copy-checksum" type="button">Copy</button>
            </div>
            <div class="copy-status" id="copy-status" aria-live="polite"></div>
            <p class="section-copy">Compare this fingerprint with the installed or downloaded APK using a trusted SHA-256 tool.</p>
          </details>
        </section>
      </div>

      <div class="info-sections">
        <section>
          <h2 class="section-title">A clear install. No guesswork.</h2>
          <p class="section-copy">This is a direct Android APK download, not a Google Play Store listing. The release ID identifies the published build; the app version and version code identify the Android package itself.</p>
          <p class="section-copy">Install only on organisation-authorised devices. If the release information cannot be confirmed, the page will say so rather than label an unknown build as latest.</p>
        </section>
        <section>
          <h2 class="section-title">Install in three steps</h2>
          <div class="steps">
            <div class="step"><span class="step-no">01</span><strong>Download</strong><p>Tap the button to save the Sonalit Guardian APK.</p></div>
            <div class="step"><span class="step-no">02</span><strong>Install</strong><p>Open the file. Android may ask you to allow installs from your browser.</p></div>
            <div class="step"><span class="step-no">03</span><strong>Enrol</strong><p>Open Sonalit Guardian and use your assigned operator code.</p></div>
          </div>
        </section>
      </div>
    </main>

    <footer class="footer">
      <span>SONALIT · Official Android distribution</span>
      <span>For organisation-issued devices · <a href="https://sonalit.com">sonalit.com</a></span>
    </footer>
  </div>
</body>
</html>`;
}

function renderDownloadScript() {
  return `(function () {
  "use strict";

  var infoUrl = "/api/v1/guardian/apk/info";
  var statusPill = document.getElementById("release-status");
  var statusText = document.getElementById("release-status-text");
  var warning = document.getElementById("release-warning");
  var refreshButton = document.getElementById("refresh-release");
  var checksumInput = document.getElementById("checksum");
  var copyButton = document.getElementById("copy-checksum");
  var copyStatus = document.getElementById("copy-status");

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value == null || value === "" ? "Not recorded" : String(value);
  }

  function formatSize(value) {
    var bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "Unavailable";
    if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
    return (bytes >= 104857600 ? Math.round(bytes / 1048576) : (bytes / 1048576).toFixed(1)) + " MB";
  }

  function formatDate(value) {
    if (!value) return "Unavailable";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unavailable";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function androidRequirement(minSdk) {
    var api = Number(minSdk);
    if (!Number.isInteger(api) || api < 1) return "Not recorded";
    var names = {
      29: "Android 10+", 30: "Android 11+", 31: "Android 12+", 32: "Android 12L+",
      33: "Android 13+", 34: "Android 14+", 35: "Android 15+", 36: "Android 16+"
    };
    return names[api] || ("Android API " + api + "+");
  }

  function setStatus(label, state) {
    statusText.textContent = label;
    statusPill.className = "status-pill " + state;
  }

  function showUnconfirmed(message) {
    setStatus("Latest status unconfirmed", "is-warning");
    warning.style.borderColor = "";
    warning.style.color = "";
    warning.style.background = "";
    warning.hidden = false;
    if (message) warning.textContent = message;
    setText("metadata-source", "Could not verify release metadata.");
  }

  async function loadReleaseInfo() {
    refreshButton.disabled = true;
    refreshButton.textContent = "Checking…";
    setStatus("Checking release…", "");
    warning.hidden = true;
    setText("metadata-source", "Contacting release feed…");

    try {
      var response = await fetch(infoUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Release feed returned HTTP " + response.status);
      var data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Release metadata was not valid JSON");

      var releaseId = typeof data.version === "string" ? data.version.trim() : "";
      var parsedDate = data.published_at ? new Date(data.published_at) : null;
      var dateIsValid = parsedDate && !Number.isNaN(parsedDate.getTime());
      var size = Number(data.size);
      var sizeIsValid = Number.isFinite(size) && size > 0;
      var latestConfirmed = Boolean(releaseId && dateIsValid && sizeIsValid);

      setText("release-version", releaseId || "Unavailable");
      setText("published", dateIsValid ? formatDate(data.published_at) : "Unavailable");
      setText("size", sizeIsValid ? formatSize(size) : "Unavailable");
      setText("package-name", data.package_name || "io.sonalit.guardian");
      setText("android-requirement", androidRequirement(data.min_sdk));

      if (data.app_version) {
        setText("app-version", "v" + String(data.app_version));
        setText("version-code", data.version_code != null ? "Android version code " + data.version_code : "Version code not recorded");
      } else {
        setText("app-version", "Not recorded");
        setText("version-code", "This release does not expose the APK's internal version metadata.");
      }

      if (data.notes && String(data.notes).trim()) {
        setText("release-notes-body", String(data.notes).trim().slice(0, 5000));
        document.getElementById("release-notes").hidden = false;
      } else {
        document.getElementById("release-notes").hidden = true;
      }

      if (typeof data.sha256 === "string" && /^[a-f0-9]{64}$/i.test(data.sha256.trim())) {
        checksumInput.value = data.sha256.trim().toLowerCase();
        document.getElementById("verification").hidden = false;
        copyStatus.textContent = "";
      } else {
        checksumInput.value = "";
        document.getElementById("verification").hidden = true;
      }

      if (latestConfirmed) {
        setStatus("Latest release confirmed", "is-live");
        warning.hidden = Boolean(data.app_version);
        warning.style.borderColor = "";
        warning.style.color = "";
        warning.style.background = "";
        if (!data.app_version) {
          warning.textContent = "The latest published release is identified, but its internal Android app version is not recorded. The release ID above is the published release identifier.";
        }
        setText("metadata-source", "Loaded from Sonalit's latest published release.");
      } else {
        showUnconfirmed("The download link is available, but the latest release details are incomplete. Do not treat an unverified version as the latest build.");
      }
    } catch (error) {
      setText("app-version", "Unavailable");
      setText("version-code", "Could not read release metadata");
      setText("release-version", "Unavailable");
      setText("published", "Unavailable");
      setText("size", "Unavailable");
      setText("android-requirement", "Unavailable");
      showUnconfirmed("The download link remains available, but release metadata could not be checked. The latest version is unconfirmed—please retry before installing.");
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Recheck release ↻";
    }
  }

  refreshButton.addEventListener("click", loadReleaseInfo);

  copyButton.addEventListener("click", async function () {
    if (!checksumInput.value) return;
    try {
      await navigator.clipboard.writeText(checksumInput.value);
      copyStatus.textContent = "SHA-256 copied.";
    } catch (_) {
      checksumInput.focus();
      checksumInput.select();
      var copied = false;
      try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
      copyStatus.textContent = copied ? "SHA-256 copied." : "Select the fingerprint above and copy it.";
    }
  });

  loadReleaseInfo();
})();`;
}

module.exports = { renderDownloadPage, renderDownloadScript };
