---
name: guardian-system
description: Guardian device agent — enrollment, heartbeat, panic escalation, DMS, Knox remote sessions, command signing, capture vision AI, and signal anomaly detection.
triggers:
  - guardian
  - device
  - panic
  - DMS
  - dead man switch
  - Knox
  - enrollment
  - command
  - capture
  - field officer
  - heartbeat
  - signal anomaly
related_skills:
  - multi-tenancy
  - auth-security
  - realtime-events
  - convoy-system
  - backend-patterns
  - testing
---

# Guardian System

## Purpose

Teaches the Guardian device management system — the Android field agent that provides GPS tracking, panic alerts, remote device control, covert surveillance, and Dead Man's Switch safety for convoy field officers.

## When to Activate

Any work involving Guardian devices, panic events, device commands, Knox remote sessions, capture vision, DMS, enrollment, or field officer device operations.

## Device Lifecycle

```
pending → active → revoked | suspended
```

Enrollment via enrollment codes (`enrollment_codes` table) or convoy codes (`convoy_codes` table). Each device has a unique `token` (UUID) used for device-side auth via `deviceAuth` middleware.

Hardware dedup: `imei_hash` + `android_id` unique indexes prevent duplicate registrations (WHERE deleted_at IS NULL).

## Key Tables

| Table | Purpose |
|-------|---------|
| `guardian_devices` | 35+ columns: name, imei, imei_hash, model, os_version, app_version, status, panic_active, last_seen, last_lat/lng, last_speed, fcm_token, org_id, convoy_code, dms_enabled, dms_timeout_minutes, last_checkin_at, android_id, manufacturer |
| `device_locations` | GPS fix log: lat, lng, altitude, heading, speed, accuracy, timestamp |
| `device_health` | Battery, signal, network, storage, RAM snapshots |
| `panic_events` | Panic alerts with escalation: mode, lat/lng, escalation_level, acknowledged_at/by, resolved_at/by, reason_code, event_uuid |
| `device_commands` | Command queue: command_type, payload, status, signature, nonce, expires_at, sent_at, executed_at |
| `device_command_events` | Command lifecycle event log |
| `field_reports` | Field officer reports: category, severity, description, photo_url |
| `guardian_audit_log` | Actor-based audit: actor_type (admin/device/system), action, target, payload |
| `enrollment_codes` | Org-scoped enrollment codes with expiry |
| `convoy_codes` | Group enrollment codes with max_members |
| `guardian_config` | Server-side config/feature flags (key/value_int/value_text) |
| `guardian_command_nonces` | Replay protection: (device_id, nonce) PK enforces uniqueness |
| `guardian_crash_reports` | Device crash reports with stack traces |
| `guardian_captures` | Covert photo captures with AI tags |
| `guardian_voice_messages` | Voice messages with direction (inbound/outbound) and location |

## Panic Workflow

Three-level escalation at 3-minute intervals:

1. **Level 0**: Initial panic trigger — device sends POST to panic endpoint, `panic_active` set true
2. **Level 1**: 3 minutes later, escalation if unacknowledged
3. **Level 2**: 6 minutes later
4. **Level 3**: 9 minutes — maximum escalation

Panic publishes to Centrifugo `org#<orgId>` with `type: 'panic'` payload. FCM push sent via `sendPanicAck()`.

Acknowledge: sets `acknowledged_at`, `acknowledged_by`. Resolve: sets `resolved_at`, `resolved_by`, `reason_code`, `resolution_note`.

Idempotency: `event_uuid` unique index prevents duplicate panic events.

## Dead Man's Switch (DMS)

Server-authoritative: `runDmsMonitorJob()` runs on a cron interval.

If a device with `dms_enabled = true` misses its `dms_timeout_minutes` window (based on `last_checkin_at`), the server auto-fires a silent panic on the device's behalf.

Config: `guardian_config` keys `dms_default_interval_minutes` (60) and `dms_max_interval_minutes` (120).

DMS atomically flips `dms_enabled = false` + `panic_active = true` with a WHERE guard to prevent double-fire.

## Command Types

Defined in `VALID_COMMANDS` in `guardian.js`:

| Command | Integrity Age | Purpose |
|---------|--------------|---------|
| `WIPE` | 5 min | Remote wipe device |
| `LOCKDOWN` | 15 min | Lock device down |
| `UPDATE_PINS` | 15 min | Update device PIN codes |
| `CHANGE_MODE` | 60 min (default) | Switch operating mode |
| `TAKE_PHOTO` | 60 min | Trigger covert photo capture |
| `SEND_MESSAGE` | 60 min | Send message to device |

### Command Signing (HMAC-SHA256)

File: `backend/src/utils/commandSigning.js`

Every command is signed server-side before delivery. The signature covers command_type + device_id + nonce + timestamp. Device verifies signature on receipt.

### Command Lifecycle

`pending` → `sent` (FCM delivered) → `executed` (device confirms) | `expired` (past expires_at)

Background job `runCommandExpiryJob()` expires stale commands and cleans up nonces.

Replay protection: `guardian_command_nonces` table with (device_id, nonce) primary key. `cleanup_command_nonces()` SQL function purges nonces older than 24h.

## Integrity Verification

Middleware: `requireFreshIntegrity`

Uses Play Integrity API. Per-command age thresholds in `INTEGRITY_MAX_AGE`:
- `WIPE`: 5 minutes
- `LOCKDOWN`, `UPDATE_PINS`: 15 minutes
- All others: 60 minutes (default)

## Signal Anomaly Detection

File: `backend/src/services/signal/anomalies.js`

Pure function `classifySignal(dev, now, opts)` — no DB, deterministic, unit-testable.

Two anomaly states:
- **`comms_blackout`**: No contact past threshold (default 6 min). Device dark — jammed, powered off, or battery pulled.
- **`gps_frozen`**: Still heartbeating but no GPS fix (default 5 min). Classic GPS jammer signature.

Severity escalates to `critical` when device is on an active convoy (`on_active_convoy` flag).

## Capture Vision AI

File: `backend/src/utils/captureVision.js`

AI auto-tagging for covert photos using Claude Opus 4.8 (vision + structured outputs).

Returns: `summary`, `labels`, `person_count`, `has_weapon`, `plates` (licence plates), `vehicles`, `threat_level` (low/medium/high).

Anthropic-only — Groq fallback is text-only, no vision. If `ANTHROPIC_API_KEY` not configured, captures stay untagged.

## Knox Remote Sessions

File: `backend/src/routes/guardian-knox.js`

WebRTC signaling for remote device control. Enables touch/key injection and MDM operations on Guardian devices.

## Rate Limiters

| Endpoint | Window | Max |
|----------|--------|-----|
| Enroll | 15 min | 5 |
| Panic | 1 min | 5 per device |
| Heartbeat | 1 min | 6 per device |
| Location | 1 min | 60 per device |
| Report | 1 min | 10 per device |
| Voice message | 1 min | 10 per device |
| Command (admin) | 1 min | 10 per (admin, device) pair |

Key generator: `req.device.id` (set by deviceAuth) with IP fallback.

## APK Version Enforcement

`guardian_config` key `min_apk_version_code`: heartbeat rejects APKs below this version with HTTP 426. Config cached 60 seconds.

## Relevant Files

- `backend/src/routes/guardian.js` — device enrollment, heartbeat, panic, commands, DMS, locations
- `backend/src/routes/guardian-knox.js` — Knox remote WebRTC sessions
- `backend/src/routes/guardian-ops.js` — guardian operations
- `backend/src/routes/guardianCfo.js` — CFO photo uploads, EXIF validation
- `backend/src/routes/guardianConvoy.js` — convoy-specific guardian endpoints
- `backend/src/routes/guardianDayPlan.js` — day plans
- `backend/src/services/signal/anomalies.js` — signal anomaly classification
- `backend/src/utils/captureVision.js` — AI vision tagging
- `backend/src/utils/commandSigning.js` — HMAC-SHA256 command signing
- `backend/src/utils/fcm.js` — FCM push notifications
- `backend/src/middleware/requireFreshIntegrity.js` — Play Integrity verification
- `packages/contracts/src/schemas/guardian.ts` — DeviceStatus, CommandType, PanicTriggerType, IntegrityVerdict schemas

## Do

- Use `deviceAuth` middleware for device-facing endpoints
- Sign all commands with HMAC-SHA256
- Validate Play Integrity age thresholds per command type
- Use `event_uuid` for panic/report idempotency
- Keep signal anomaly detection pure and unit-testable
- Publish panic events to Centrifugo `org#<orgId>` channel

## Don't

- Skip command signing or integrity verification
- Allow duplicate panic events (check event_uuid)
- Use device-side timers for DMS — it must be server-authoritative
- Send vision analysis to Groq (text-only, no image support)
- Expose raw guardian data through portal routes (use portalSanitiser)
