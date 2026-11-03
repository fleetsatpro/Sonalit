#!/usr/bin/env bash
#
# Sonalit Hybrid Tracking — physical device acceptance harness (spec §41).
#
# This does NOT prove tracking works. It captures the device-side evidence that
# makes the proof auditable, and drives the OS into the states the matrix calls
# for. The actual verdict comes from server rows: pair every run with
# scripts/tracking-acceptance.sql and compare timestamps.
#
# It deliberately refuses to help you cheat (§44): it records battery
# optimisation state rather than silently disabling it, and it never enables
# mock locations.
#
# Usage:
#   ./scripts/tracking-acceptance.sh facts                 # device + build record
#   ./scripts/tracking-acceptance.sh perms [package]       # granted location permissions
#   ./scripts/tracking-acceptance.sh service [package]     # is a location FGS actually running
#   ./scripts/tracking-acceptance.sh lock                  # Test B — screen off
#   ./scripts/tracking-acceptance.sh doze                  # Test E — force Doze
#   ./scripts/tracking-acceptance.sh undoze
#   ./scripts/tracking-acceptance.sh offline               # Test D — kill data + wifi
#   ./scripts/tracking-acceptance.sh online
#   ./scripts/tracking-acceptance.sh watch [package]       # live FGS/location poll
set -euo pipefail

PKG="${2:-io.sonalit.app}"
OUT="${TRACKING_ACCEPTANCE_OUT:-./tracking-acceptance-$(date +%Y%m%d-%H%M%S).log}"

need_device() {
  command -v adb >/dev/null 2>&1 || { echo "adb not found (Android platform-tools)." >&2; exit 1; }
  if [ -z "$(adb devices | sed -n '2p' | grep -w device || true)" ]; then
    echo "No authorised device. Enable USB debugging and accept the RSA prompt." >&2
    adb devices >&2
    exit 1
  fi
}

say() { printf '%s\n' "$*" | tee -a "$OUT"; }

case "${1:-}" in
facts)
  need_device
  say "═══ DEVICE & BUILD RECORD ═══  $(date -u +%FT%TZ)"
  say "model            : $(adb shell getprop ro.product.manufacturer | tr -d '\r') $(adb shell getprop ro.product.model | tr -d '\r')"
  say "android          : $(adb shell getprop ro.build.version.release | tr -d '\r')  (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"
  say "package          : $PKG"
  say "versionName      : $(adb shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r' | xargs || echo 'NOT INSTALLED')"
  say "versionCode      : $(adb shell dumpsys package "$PKG" | grep -m1 versionCode | tr -d '\r' | xargs || echo '-')"
  say "battery          : $(adb shell dumpsys battery | grep -E '^  level' | tr -d '\r' | xargs)"
  say "power save       : $(adb shell settings get global low_power | tr -d '\r')  (1 = battery saver ON)"
  say "location mode    : $(adb shell settings get secure location_mode | tr -d '\r')  (3 = high accuracy)"
  say "location providers: $(adb shell settings get secure location_providers_allowed | tr -d '\r')"
  say "doze whitelisted : $(adb shell dumpsys deviceidle whitelist | grep -c "$PKG" || true)  (1 = exempt from Doze)"
  say "mock location app: $(adb shell settings get secure mock_location | tr -d '\r')  (must be 0 — §44)"
  say "── record these in the report before running any test ──"
  ;;

perms)
  need_device
  say "═══ GRANTED LOCATION PERMISSIONS ═══ $PKG"
  adb shell dumpsys package "$PKG" \
    | grep -E "android.permission.(ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE|FOREGROUND_SERVICE_LOCATION|POST_NOTIFICATIONS)" \
    | sed 's/^[[:space:]]*//' | sort -u | tee -a "$OUT"
  say ""
  say "Expected for the Capacitor shell: FINE + COARSE + FOREGROUND_SERVICE[_LOCATION] granted."
  say "ACCESS_BACKGROUND_LOCATION is NOT required — the plugin holds location via a"
  say "foreground service started while the app is visible (while-in-use exemption)."
  ;;

service)
  need_device
  say "═══ FOREGROUND SERVICE ═══ $(date -u +%FT%TZ)"
  if adb shell dumpsys activity services 2>/dev/null | grep -q "BackgroundGeolocationService"; then
    say "RUNNING — BackgroundGeolocationService is up"
    adb shell dumpsys activity services 2>/dev/null \
      | grep -A3 "BackgroundGeolocationService" | head -12 | tee -a "$OUT"
  else
    say "ABSENT — no BackgroundGeolocationService."
    say "If the journey is supposed to be LIVE, this is a FAILURE, not a delay."
  fi
  ;;

lock)   need_device; adb shell input keyevent 26; say "screen off at $(date -u +%FT%TZ) — now move the device (Test B)";;
doze)
  need_device
  adb shell dumpsys battery unplug >/dev/null
  adb shell dumpsys deviceidle force-idle >/dev/null
  say "Doze FORCED at $(date -u +%FT%TZ) (Test E). Telemetry gaps from here are real Android behaviour — report them, do not hide them."
  ;;
undoze)
  need_device
  adb shell dumpsys deviceidle unforce >/dev/null
  adb shell dumpsys battery reset >/dev/null
  say "Doze released at $(date -u +%FT%TZ)"
  ;;

offline)
  need_device
  adb shell svc data disable || true
  adb shell svc wifi disable || true
  say "NETWORK DOWN at $(date -u +%FT%TZ) (Test D). GPS must continue; the buffer must grow."
  ;;
online)
  need_device
  adb shell svc data enable || true
  adb shell svc wifi enable || true
  say "NETWORK UP at $(date -u +%FT%TZ) — batch sync should follow within seconds."
  ;;

watch)
  need_device
  say "═══ POLLING (Ctrl-C to stop) ═══"
  while true; do
    ts=$(date -u +%T)
    svc=$(adb shell dumpsys activity services 2>/dev/null | grep -c BackgroundGeolocationService || true)
    net=$(adb shell dumpsys connectivity 2>/dev/null | grep -m1 -o "NOT_CONGESTED\|NO_INTERNET" || echo "?")
    say "$ts  fgs=$svc  net=$net"
    sleep 15
  done
  ;;

*)
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac

say ""
say "log: $OUT"
