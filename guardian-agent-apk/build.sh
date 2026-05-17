#!/bin/bash
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
BUILD=/tmp/guardian-build
ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
AAPT2=/usr/lib/android-sdk/build-tools/29.0.3/aapt2
DX=/usr/lib/android-sdk/build-tools/debian/dx
ZIPALIGN=/usr/lib/android-sdk/build-tools/29.0.3/zipalign
APKSIGNER=/usr/lib/android-sdk/build-tools/29.0.3/apksigner
OUT="$SRC/../backend/static/guardian-agent.apk"

echo "==> Cleaning build dir"
rm -rf "$BUILD" && mkdir -p "$BUILD"/{compiled_res,gen,classes}

echo "==> Compiling resources"
for f in "$SRC"/res/drawable/*.xml "$SRC"/res/layout/*.xml "$SRC"/res/values/*.xml; do
  $AAPT2 compile "$f" -o "$BUILD/compiled_res/"
done

echo "==> Linking resources"
$AAPT2 link \
  -o "$BUILD/unaligned.apk" \
  --manifest "$SRC/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  --java "$BUILD/gen" \
  --min-sdk-version 21 \
  --target-sdk-version 23 \
  --version-code 1 \
  --version-name "1.0.0" \
  "$BUILD"/compiled_res/*.flat

echo "==> Compiling Java sources"
javac -source 8 -target 8 \
  -classpath "$ANDROID_JAR" \
  -sourcepath "$SRC/src" \
  "$SRC"/src/com/fleetops/guardian/*.java \
  "$BUILD"/gen/com/fleetops/guardian/R.java \
  -d "$BUILD/classes"

echo "==> Converting to DEX"
$DX --dex --output="$BUILD/classes.dex" "$BUILD/classes"

echo "==> Packaging APK"
cd "$BUILD"
zip -j unaligned.apk classes.dex

echo "==> Generating debug keystore"
if [ ! -f ~/.android/debug.keystore ]; then
  mkdir -p ~/.android
  keytool -genkeypair -v \
    -keystore ~/.android/debug.keystore \
    -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=FleetOps,C=US" \
    -storepass android -keypass android 2>/dev/null
fi

echo "==> Aligning"
$ZIPALIGN -v 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk" > /dev/null

echo "==> Signing"
mkdir -p "$(dirname "$OUT")"
$APKSIGNER sign \
  --ks ~/.android/debug.keystore \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$OUT" \
  "$BUILD/aligned.apk"

echo ""
echo "✓ APK built: $OUT ($(du -sh "$OUT" | cut -f1))"
