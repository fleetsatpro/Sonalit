# PEGAGENT Hardening — v1.0.14 (versionCode 16)

Field-officer agent hardening pass. Every touched wire was traced against the
real server contract in `backend/src/routes/guardian.js`. **No ACK reports a
success it did not perform.**

> Build/verification note: this environment has **no Android SDK**, so the APK
> could not be compiled here and the device smoke-matrix (API 26/30/34, DO Knox)
> was **not** run. Backend JS changes pass `node --check`. All Android changes are
> production-intended code pending a device build + the smoke matrix below.

## Server contract verified (from backend source)
- Commands are published to Centrifugo channel **`org#<org_id>`** (org-wide) with
  envelope `{type:"device.command", device_id, command_type, payload, command_id,
  issued_at, expires_at, signature}`. Devices filter by `device_id`.
- Command HMAC: `HMAC_SHA256(secret, id:command_type:sha256(canonicalJson(payload)):issued_at:expires_at)`;
  `command_signing_secret` is returned by enroll + heartbeat.
- `ack-command` accepts `status ∈ {executed,failed}`, detail in `result`.
- Panic modes: `silent|loud|medical|security|hijack`.

## P0
- **P0-1 SOS pipeline** — `PegCommandService` now hosts the `ACTION_SOS` /
  `ACTION_SOS_CANCEL` receiver (`RECEIVER_NOT_EXPORTED` on 33+), fetches a fresh fix
  (3s budget, else last-known + `gps_stale`), calls `sendPanic` with retries/backoff,
  raises a high-importance `peg_sos` full-screen notification, and fires the siren via
  the shared `SirenController`. Button state is authoritative via `ACTION_SOS_RESULT`
  (SENT/RETRY/FAILED/CANCELLED); "TAP TO CANCEL" hits `POST /panic/cancel`. Operator
  `trigger_sos` routes through the same path.
  Files: `services/PegCommandService.java`, `ui/MainActivity.java`, `util/SirenController.java`,
  `network/PegApiClient.java`, `commands/CommandExecutor.java`.
- **P0-2 WS command channel** — subscribe to verified `org#<org_id>`, filter by
  `device_id`, parse `command_id`/`command_type`, handle Centrifugo error frames
  (auth codes → close+backoff, not a blind loop). Enroll + heartbeat now return
  `org_id`/`officer_id`; agent persists them. Silent migration for already-enrolled
  devices via heartbeat backfill **and** new `GET /whoami`, then resubscribe — no
  re-enrollment.
  Files: `network/PegWebSocketClient.java`, `network/PegApiClient.java`,
  `util/PegConfig.java`, `services/PegCommandService.java`, `ui/MainActivity.java`,
  `backend/src/routes/guardian.js`.
- **P0-3 FCM** — Firebase could not be provisioned (no `google-services.json`/project),
  so per the spec's escape hatch the **dead FCM surface was removed**: deleted
  `PegFcmService.java`, its `<service>` + `MESSAGING_EVENT` intent-filter. Three-tier
  wake model is now WS (realtime) + poll (backstop); FCM slot documented as the future
  wake channel.
  Files: deleted `services/PegFcmService.java`, `AndroidManifest.xml`.
- **P0-4 version drift** — removed hardcoded `app_version_code=10` / `"1.0.13"`; all use
  `BuildConfig.VERSION_CODE`/`VERSION_NAME`. Bumped to 16 / 1.0.14.
  Files: `network/PegApiClient.java`, `ui/MainActivity.java`, `app/build.gradle`.

## P1
- **P1-1 force_checkin** — handled in-service: pushes current location, runs a heartbeat
  round-trip + command drain, and ACKs `executed` only on a successful round-trip, else
  `error:checkin_failed`. MainActivity log listener kept cosmetic-only.
  Files: `commands/CommandExecutor.java`, `network/PegApiClient.java`.
- **P1-2 clear_app_data** — real recursive clear. `clear_cache` clears cache dirs;
  `clear_app_data` clears cache+files+databases while **preserving enrollment**;
  `full=true` calls `ActivityManager.clearApplicationUserData()`. Truthful ACKs.
  Files: `commands/CommandExecutor.java`, `commands/PegCommand.java`.
- **P1-3 dedup + TTL** — `CommandGuard`: persisted seen-id ring buffer (survives restart)
  + TTL from `expires_at` (fallback `issued_at + ttl_hours`). Covers WS + poll.
  `error:expired` on stale commands.
  Files: `commands/CommandGuard.java`, `commands/CommandExecutor.java`, `commands/PegCommand.java`.
- **P1-4 coordinate scaling** — `inject_touch`/swipe carry capture resolution; coords are
  scaled from capture-space to the real display via `getRealSize()` before dispatch.
  Files: `services/RemoteControlAccessibilityService.java`, `commands/CommandExecutor.java`, `commands/PegCommand.java`.
- **P1-5 MediaProjection** — **Option A (Device-Owner only)** for the Knox fleet.
  `knox:start_session` ACKs `error:not_device_owner` on non-DO and never starts a blind,
  capture-less service. (See assumptions re: DO silent pixels.)
  Files: `commands/CommandExecutor.java`, `services/ScreenShareService.java`.
- **P1-6 accessibility-gated ACK** — checks `isConnected()` first (`error:accessibility_unavailable`),
  and only ACKs `executed` from the gesture `onCompleted` callback; `error:gesture_cancelled`
  on cancel; unsupported keys ACK `error:unsupported_key:*`.
  Files: `services/RemoteControlAccessibilityService.java`, `commands/CommandExecutor.java`.

## P2
- **P2-1 SecureStore** — `EncryptedSharedPreferences` + Keystore master key, with a hard
  **fallback to plaintext on any Throwable** (the earlier crash mode) and one-time
  migration of legacy plaintext values. Same `PegConfig` API.
  Files: `util/SecureStore.java`, `app/build.gradle`.
- **P2-2 Doze survival** — WakeLock renews every 18 min (bounded, non-infinite) and a
  `ConnectivityManager` default-network callback kicks an immediate WS reconnect on
  network regain. Service is now `START_STICKY`.
  Files: `services/PegCommandService.java`, `network/PegWebSocketClient.java`.
- **P2-3 telemetry signal** — dead `TelemetryService` removed; signal sampling folded into
  `TelemetryEngine` via `TelephonyCallback` (31+) / `PhoneStateListener` (26-30). Real
  `signal_pct` + `speed` in the heartbeat.
  Files: deleted `services/TelemetryService.java`, `telemetry/TelemetryEngine.java`,
  `network/PegApiClient.java`, `AndroidManifest.xml`.
- **P2-4 single Centrifugo connection** — app-scoped shared `PegWebSocketClient`
  (`PegAgentApp.sharedWs`); `ScreenShareService` reuses it instead of opening a second.
  Files: `PegAgentApp.java`, `services/PegCommandService.java`, `services/ScreenShareService.java`.
- **P2-5 keepalive / token** — library `setConnectionLostTimeout(15)` for half-open
  detection + error-frame-driven reconnect. Token-mint endpoint N/A (see assumptions).
  Files: `network/PegWebSocketClient.java`.
- **P2-6 screen transport** — adaptive: single-flight frame skip under backpressure +
  dynamic interval (66–500ms) and JPEG quality (35–72); `session_active`/`session_ended`
  frames. WebRTC not implemented this pass (adaptive fallback shipped).
  Files: `services/ScreenShareService.java`.
- **P2-7 command signature** — `CommandSignature` verifies the server HMAC (canonical-JSON
  reproduced byte-faithfully from the raw payload). Destructive commands (`remote_wipe`,
  `lock_screen`, `clear_app_data full`) reject `error:bad_signature` on mismatch. Backend
  now includes `expires_at` in the WS publish so the signature is verifiable over WS.
  Files: `commands/CommandSignature.java`, `commands/CommandExecutor.java`,
  `util/PegConfig.java`, `network/PegApiClient.java`, `backend/src/routes/guardian.js`.

## P3
- **P3-1 wipe flags** — `remote_wipe` uses `WIPE_RESET_PROTECTION_DATA`, adding
  `WIPE_EXTERNAL_STORAGE` behind payload `wipe_external`.
- **P3-2 QR** — real QR needs the removed CameraX/MLKit (startup-crash risk); deleted
  `ScanQrActivity` + its manifest entry + the dead `REQ_QR` result branch.
- **P3-3 default URL** — single source of truth `PegConfig.DEFAULT_SERVER_URL`
  (Railway); enrollment field reads it.
- **P3-4 signing** — enabled v1+v2+v3 signing in the release config.
- **P3-5 OTA** — `update_app` downloads a signed APK → `FileProvider` content URI →
  install intent (`REQUEST_INSTALL_PACKAGES` retained + `xml/file_paths.xml`).
- **P3-6 siren** — interruptible `SirenController` loop + `stop_siren` command + SOS-cancel hook.
- **P3-7 location** — fresh `getCurrentLocation` (30+) with network fallback; kept
  `LocationManager` (not Fused) to avoid re-introducing the GMS ContentProvider crash.

## Backend changes (additive, backward-compatible) — `backend/src/routes/guardian.js`
- Enroll (v4 + legacy) and heartbeat responses now include `org_id`/`officer_id`
  (via `resolveOrgOfficer`) so agents can subscribe to `org#<org_id>`.
- `GET /whoami` (deviceAuth) for org/officer backfill migration.
- `POST /panic/cancel` (deviceAuth) resolves the device's active panics + broadcasts cancel.
- WS command publish now includes `expires_at` (needed to verify the signature over WS).
- `ack-command` accepts `pending` (WS-delivered) in addition to `sent`; duplicate ack is
  idempotent 200 instead of 409.

## Assumptions to reconcile with infra/backend
1. **Centrifugo connect token & framing.** The agent sends the raw device token as the
   Centrifugo connect token using the `{id,method,params}` frame style already present.
   If Centrifugo requires a signed JWT and/or the newer command-object frame format, a
   server-side **token-mint endpoint** and a frame-format update are required. Channel
   **name** `org#<org_id>` and the `device.command` payload shape are verified from
   backend source.
2. **DO silent screen capture.** Option A refuses non-DO. Standard AOSP Device Owner still
   needs the **Knox EnterpriseDeviceManager SDK** (or a MediaProjection consent token) to
   produce pixels; this pass wires the DO-gated service + adaptive transport but not the
   Knox SDK binding.
3. **Panic mode.** SOS button uses mode `security`. Confirm the desired default
   (`security` vs `loud`/`hijack`) with dispatch.
4. **jsonb payload fidelity for signatures.** Signature is verified against the payload as
   re-read from the DB; if Postgres jsonb normalization diverges from the originally-signed
   bytes for exotic number formats, verification of those (rare) payloads could fail —
   coordinate/flag payloads are unaffected.

## Smoke matrix (must be run on a device build — NOT run here)
Cold launch API 26/30/34 · enrolled-device migration (no re-enroll) · SOS with UI closed →
server + idempotency key · WS command <1s · remote-wipe confirm+signature · screen-share on
the DO device · corner-tap accuracy on 1440×3088 · encrypted-store fallback on One UI.
