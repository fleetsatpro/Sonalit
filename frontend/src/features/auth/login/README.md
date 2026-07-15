# Sonalit login — ops-wall

React port of the standalone `docs/sonalit-login.html` build. Mounted at
`/login` in `src/App.jsx`.

## Structure

```
login/
  LoginPage.jsx            — route entry, layout, auth guard, redirect
  Theater.jsx              — left column (globe + HUD + telemetry + stats)
  OperationsGlobe.jsx      — canvas ref + rAF lifecycle around engine.js
  CustodyChainLedger.jsx   — middle column (simulated hash-chain preview)
  AuthConsole.jsx          — right column (tabs, password, passkey, SSO)
  ForgotPasswordModal.jsx  — reset flow, focus-trapped
  RequestAccessModal.jsx   — sales inbound, focus-trapped
  Toast.jsx                — bespoke toast (route-scoped)
  useModal.js              — focus trap + Escape + focus restore
  useReducedMotion.js      — live prefers-reduced-motion
  authApi.js               — wraps ../../services/api.js for the four new paths
  login.css                — scoped under .sonalit-login-root
  globe/
    engine.js              — framework-agnostic canvas renderer
    landDots.js            — LAND array (auto-generated, do not hand-edit)
    geo.js                 — CITIES, ROUTES, projection, slerp
    vehicles.js            — plane / ship / truck liveried renderers
```

## Tunables

Every knob Griff tunes lives at the top of one file. Change them there; don't
scatter overrides.

| Knob                   | Where                              | Default              |
|------------------------|------------------------------------|----------------------|
| Globe framing R/cx/cy  | `globe/engine.js#resize()`         | `R = min(W,H)*0.43`, `cx = W*0.57`, `cy = H*0.46` |
| Rotation speed         | `globe/engine.js#ROT_PER_MS`       | `360/90000` (one turn / 90s) |
| Starting longitude     | `globe/engine.js#BASE_LON`         | `20` (Africa-centred) |
| Projection tilt        | `globe/geo.js#LAT0`                | `15°`                |
| Back-hemisphere cutoff | `engine.js` `project().vis`        | `cosc >= -0.02`      |
| Vehicle sizes          | `globe/vehicles.js#VSIZE`          | `{air:0.048, sea:0.058, road:0.044}` |
| Arc traversal (ms)     | `engine.js` `routeGeo` builder     | `air:5000 · road:13000 · sea:38000` |
| City ping lifetime     | `engine.js` `drawCities()`         | `1400ms`             |
| Chain block cadence    | `CustodyChainLedger.jsx`           | 3s                   |
| Capability feed rotate | `Theater.jsx`                      | 4.2s                 |
| Lockout duration       | `AuthConsole.jsx#startLockout()`   | `Retry-After` or 30s |
| Max attempts before lock | `AuthConsole.jsx#MAX_ATTEMPTS`   | `5`                  |

## Simulated preview — security posture

**Nothing on this page may call a tenant-scoped endpoint or render real
organisation data before authentication.** The middle Custody Chain ledger,
the LIVE FLEET FEED ticker, and the capability feed are all client-side and
fictional — hashes come from a deterministic `hash2(i,k)` PRNG, detail spans
are `██████`-redacted, and the "SIMULATED PREVIEW — LIVE DATA AFTER SIGN-IN"
badge is rendered in-band.

Consistent with the platform's RLS / tenant-isolation posture. Do not
"upgrade" this to real data.

## Config

- `VITE_API_URL` — API base. Defaults to `/api/v1` (matches the Vite dev
  proxy in `frontend/vite.config.js`).
- `?redirect=<same-origin-path>` — deep-link target honoured after login.
  Cross-origin values are ignored to prevent open-redirects (see
  `LoginPage.jsx#safeRedirectTarget`).

## Endpoints wired

| Action              | Method   | Path                        | Wired via                     |
|---------------------|----------|-----------------------------|-------------------------------|
| Password login      | POST     | `/auth/login`               | `useAuthStore.login()` (existing store) |
| Passkey options     | POST     | `/auth/passkey/options`     | `authApi.getPasskeyOptions()` — **TODO(griff)** backend |
| Passkey verify      | POST     | `/auth/passkey/verify`      | `authApi.verifyPasskey()` — **TODO(griff)** backend |
| Forgot password     | POST     | `/auth/password/forgot`     | `authApi.requestPasswordReset()` — **TODO(griff)** backend |
| Request access      | POST     | `/auth/request-access`      | `authApi.requestAccess()` — **TODO(griff)** backend |
| SSO Google          | GET (nav)| `/auth/sso/google`          | `window.location.href` — **TODO(griff)** backend |
| SSO Microsoft       | GET (nav)| `/auth/sso/microsoft`       | `window.location.href` — **TODO(griff)** backend |

The four `TODO(griff)` endpoints currently don't exist in
`backend/src/routes/auth.js`. The frontend fires real POSTs and shows the
error toast on 4xx/5xx — no silent stubs. When the backend adds them, no
frontend changes are needed.

## Fonts

Barlow Condensed / Inter / JetBrains Mono are loaded once from `index.html`
so no per-component `<link>` is needed. If we ever add a
CSP `font-src`, keep `https://fonts.gstatic.com` on the allowlist.

## Accessibility

- ARIA tab pattern with arrow-key navigation and roving `tabindex`.
- Modals: `role="dialog" aria-modal`, focus trap on Tab/Shift-Tab, Escape
  closes, focus restores to the trigger on close, backdrop-click closes.
- `aria-live` on the attempts note and toast; `role="alert"` on field errors.
- `prefers-reduced-motion` disables globe rotation (one static frame),
  headline rise-in, ticker, capability rotator, and count-up stats.

## Regenerating LAND data

`globe/landDots.js` is derived from `docs/sonalit-login.html`. If Griff
retunes the reference dot matrix, re-extract with the Python one-liner from
the commit that added it (grep for `AUTO-GENERATED from Natural Earth`).
