#!/bin/bash
# Builds hanu-tv.apk without Gradle: aapt2 + javac + d8 + apksigner.
# Needs a JDK and ANDROID_SDK pointing at an SDK with platforms;android-34 and build-tools;34.0.0.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_SDK:?set ANDROID_SDK to your Android SDK folder}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex"

"$BT/aapt2" compile --dir res -o "$OUT/res/"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml \
  -A assets --java "$OUT/gen" "$OUT"/res/*.flat --min-sdk-version 23 --target-sdk-version 34

javac --release 11 -nowarn -encoding UTF-8 -cp "$JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --min-api 23 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

KS="${HANU_KEYSTORE:-.keystore}"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass hanu-local -keypass hanu-local -alias hanu \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Hanu TV" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:hanu-local --key-pass pass:hanu-local --ks-key-alias hanu \
  --out hanu-tv.apk "$OUT/aligned.apk"
"$BT/apksigner" verify hanu-tv.apk
echo "built: $(pwd)/hanu-tv.apk ($(wc -c < hanu-tv.apk) bytes)"
