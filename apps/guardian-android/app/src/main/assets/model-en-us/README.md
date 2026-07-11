# Vosk model — required before building a release with the voice trigger

This directory must contain the **unzipped contents** of a Vosk speech
model before `VoiceTriggerService` (the "PAN PAN PAN" voice panic trigger)
will work. It is intentionally **not** committed to this repo — it's a
~40-50MB binary model, not source code, and can't be fetched from a
network-restricted environment.

## Setup (one-time, per person building a release)

1. Download `vosk-model-small-en-us-0.15.zip` from
   https://alphacephei.com/vosk/models
2. Unzip it.
3. Copy the **contents** of the unzipped folder (not the folder itself)
   directly into this directory, so you end up with e.g.:
   ```
   app/src/main/assets/model-en-us/am/
   app/src/main/assets/model-en-us/conf/
   app/src/main/assets/model-en-us/graph/
   app/src/main/assets/model-en-us/README
   ...
   ```
4. Build normally — `StorageService.unpack(this, "model-en-us", "model", ...)`
   in `VoiceTriggerService.onCreate()` copies this into app-internal storage
   on first run of the service.

## Why the small model

The "small" (~40MB) English model is intentionally chosen over Vosk's
larger, more accurate models — the recognizer here is grammar-constrained
to a single fixed phrase ("pan pan pan"), so the extra accuracy of a larger
acoustic model isn't needed, and keeping the APK smaller matters more for
field devices on constrained storage/bandwidth.

## If this file is still here at build time

`VoiceTriggerService` will fail to unpack a model (no `am/`, `conf/`, etc.
present) and log an error, then stop itself — the rest of the app is
unaffected, but the voice trigger toggle in Settings will not do anything
even if enabled. This is a deliberate fail-safe: better to silently not
listen than to crash a safety-critical service.
