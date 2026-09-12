# Sonalit login — ops-wall (apps/web)

TypeScript port of the standalone `docs/sonalit-login.html` build for the
Vercel-deployed app at sonalit.vercel.app. Mounted at `/login` via
`src/router.tsx` — the router imports `src/pages/Login.tsx`, which is now
a thin re-export of `./LoginPage`. The previous production login is
preserved as `src/pages/Login.legacy.{tsx,css,enhancements.css}` for
comparison.

## Structure

```
login/
  LoginPage.tsx            — route entry, layout, auth guard, redirect
  Theater.tsx              — left column (globe + HUD + telemetry + stats)
  OperationsGlobe.tsx      — canvas ref + rAF lifecycle around engine.ts
  CustodyChainLedger.tsx   — middle column (simulated hash-chain preview)
  AuthConsole.tsx          — right column (tabs, password, passkey, SSO)
  ForgotPasswordModal.tsx  — reset flow, focus-trapped
  RequestAccessModal.tsx   — sales inbound, focus-trapped
  Toast.tsx                — bespoke toast (route-scoped)
  useModal.ts              — focus trap + Escape + focus restore
  useReducedMotion.ts      — live prefers-reduced-motion
  authApi.ts               — wraps ../../lib/api.ts for the login endpoints
  login.css                — scoped under .sonalit-login-root
  globe/
    engine.ts              — framework-agnostic canvas renderer
    landDots.ts            — LAND array (auto-generated, do not hand-edit)
    geo.ts                 — CITIES, ROUTES, projection, slerp
    vehicles.ts            — plane / ship / truck liveried renderers
```

## Tunables

| Knob                    | Where                              | Default              |
|-------------------------|------------------------------------|----------------------|
| Globe framing R/cx/cy   | `globe/engine.ts#resize()`         | `R = min(W,H)*0.43`, `cx = W*0.57`, `cy = H*0.46` |
| Rotation speed          | `globe/engine.ts#ROT_PER_MS`       | `360/90000` (one turn / 90s) |
| Starting longitude      | `globe/engine.ts#BASE_LON`         | `20` (Africa-centred) |
| Projection tilt         | `globe/geo.ts#LAT0`                | `15°`                |
| Back-hemisphere cutoff  | `engine.ts` `project().vis`        | `cosc >= -0.02`      |
| Vehicle sizes           | `globe/vehicles.ts#VSIZE`          | `{air:0.048, sea:0.058, road:0.044}` |
| Arc traversal (ms)      | `engine.ts` `routeGeo` builder     | `air:5000 · road:13000 · sea:38000` |
| City ping lifetime      | `engine.ts` `drawCities()`         | `1400ms`             |
| Chain block cadence     | `CustodyChainLedger.tsx`           | 3s                   |
| Capability feed rotate  | `Theater.tsx`                      | 4.2s                 |
| Lockout duration        | `AuthConsole.tsx#startLockout()`   | `Retry-After` or 30s |
| Max attempts before lock| `AuthConsole.tsx#MAX_ATTEMPTS`     | `5`                  |

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

- `VITE_API_BASE_URL` — API base. Defaults to `/api/v1` (matches the Vite
  dev proxy in `apps/web/vite.config.ts`).
- `?redirect=<same-origin-path>` — deep-link target honoured after login.
  Cross-origin values are ignored (see `LoginPage.tsx#safeRedirectTarget`).

## Endpoints wired

| Action              | Method | Path                                      | Wired via                             |
|---------------------|--------|-------------------------------------------|---------------------------------------|
| Password login      | POST   | `/auth/login`                             | `passwordLogin()` → `setAuth()`       |
| Passkey options     | GET    | `/auth/webauthn/authenticate-options`     | `getPasskeyOptions()`                 |
| Passkey verify      | POST   | `/auth/webauthn/authenticate`             | `verifyPasskey()` → `setAuth()`       |
| Forgot password     | POST   | `/auth/password/forgot`                   | `requestPasswordReset()` — **TODO(griff)** backend |
| Request access      | POST   | `/auth/request-access`                    | `requestAccess()` — **TODO(griff)** backend |
| SSO Google          | (nav)  | `/api/v1/auth/sso/google`                 | `window.location.href` — **TODO(griff)** backend |
| SSO Microsoft       | (nav)  | `/api/v1/auth/sso/microsoft`              | `window.location.href` — **TODO(griff)** backend |

Password + WebAuthn paths match what production already implements. The
four `TODO(griff)` endpoints don't exist in `backend/src/routes/auth.js`
yet — the frontend fires real POSTs and shows the error toast on
4xx/5xx (no silent stubs).

## Token storage — T1.2

Access tokens live in module scope only (`_accessToken` in `stores/auth.ts`),
NEVER in localStorage — the persist middleware only saves `user`. The
refresh token is issued as an httpOnly cookie by the backend; `api.ts` sets
`withCredentials: true` so it rides along with every request. The
already-authenticated guard in `LoginPage.tsx` checks
`getAccessToken() || useAuthStore.user` — the persisted `user` gives a
one-frame optimistic redirect on refresh; the next API call either
succeeds (refresh cookie valid) or 401 → clearAuth → back to `/login`.

## Accessibility

- ARIA tab pattern with arrow-key navigation and roving `tabindex`.
- Modals: `role="dialog" aria-modal`, focus trap on Tab/Shift-Tab, Escape
  closes, focus restores to the trigger on close, backdrop-click closes.
- `aria-live` on the attempts note and toast; `role="alert"` on field errors.
- `prefers-reduced-motion` disables globe rotation (one static frame),
  headline rise-in, ticker, capability rotator, and count-up stats.
- Under CSP: no eval, no external scripts, no external images. All SVGs
  are inline. Fonts come from `fonts.gstatic.com` which is already on the
  `font-src` allowlist in `apps/web/index.html`.

## Fonts

Barlow Condensed / Inter added to the existing Google Fonts `<link>` in
`apps/web/index.html`. JetBrains Mono is already loaded app-wide. No
per-component `<link>` needed.

## Regenerating LAND data

`globe/landDots.ts` is derived verbatim from `docs/sonalit-login.html`. If
the reference dot matrix changes, re-extract with the Python one-liner from
the commit that added it (grep for `AUTO-GENERATED from Natural Earth`).
