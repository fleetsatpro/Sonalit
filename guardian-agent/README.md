# FleetOps Guardian Agent — Android App

Enterprise field device management app. Pairs with the FleetOps backend `/guardian` API routes.

## Build

Requirements: Android Studio Hedgehog (2023.1+) or the Android SDK CLI.

```bash
# Debug APK
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk

# Release APK (requires signing config)
./gradlew assembleRelease
```

## Configuration

Edit `app/build.gradle` → `defaultConfig` → `buildConfigField`:

```groovy
buildConfigField "String", "SERVER_URL", '"https://your-backend-url.com"'
```

## Enrollment Flow

1. Install the APK on the field device
2. Open the app — the Enrollment screen appears on first launch
3. Enter the server URL and organisation token (`GUARDIAN_ORG_TOKEN` env var on the backend, default: `fleet-guardian-2024`)
4. Tap **ENROLL DEVICE** — the device receives a token and starts the tracking service

## Features

- Continuous GPS heartbeat (ForegroundService + WorkManager for reliability after reboot/kill)
- PANIC / SOS button with 5 modes: Silent, Loud, Medical, Security, Hijack
- Field report submission with category + description
- Offline queue — reports and panics are queued to Room DB and synced when connectivity returns
- Battery, signal, and network status reporting
- BootReceiver — service restarts automatically after device reboot
- Device admin policies for enterprise MDM integration
