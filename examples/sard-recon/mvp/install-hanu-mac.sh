#!/bin/bash
# Hanu for macOS: puts hanu.html in ~/Hanu and a one-click "هنو" app on the Desktop.
# Run once from Terminal:  bash ~/Downloads/install-hanu-mac.sh
# For the TV app:          bash ~/Downloads/install-hanu-mac.sh tv   (serves hanu-tv.apk to the TV's Downloader app)
set -e

if [ "${1:-}" = "tv" ]; then
  APK="$(ls -t "$HOME"/Downloads/hanu-tv*.apk 2>/dev/null | head -1 || true)"
  if [ -z "$APK" ]; then echo "لم أجد hanu-tv.apk في التنزيلات. نزّله ثم أعد الأمر."; exit 1; fi
  mkdir -p "$HOME/Hanu/tv" && cp "$APK" "$HOME/Hanu/tv/h.apk"
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  echo ""
  echo "  في التلفزيون افتح Downloader واكتب هذا العنوان بالضبط ثم Go:"
  echo ""
  echo "      http://${IP:-عنوان-الماك}:8000/h.apk"
  echo ""
  echo "  اترك هذه النافذة مفتوحة حتى يكتمل التثبيت في التلفزيون، ثم اضغط Ctrl + C."
  cd "$HOME/Hanu/tv" && exec python3 -m http.server 8000
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# the newest download wins: browsers rename repeats to hanu (1).html, hanu-2.html ...
SRC="$(ls -t "$HERE"/hanu*.html "$HOME"/Downloads/hanu*.html 2>/dev/null | head -1 || true)"
[ -z "$SRC" ] && [ -f "$HERE/index.html" ] && SRC="$HERE/index.html"
if [ -z "$SRC" ]; then
  echo "لم أجد ملف hanu.html. نزّله في مجلد التنزيلات (Downloads) ثم شغّل الأمر من جديد."
  exit 1
fi

mkdir -p "$HOME/Hanu"
cp "$SRC" "$HOME/Hanu/hanu.html"

APP="$HOME/Desktop/هنو.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>هنو</string>
  <key>CFBundleDisplayName</key><string>هنو</string>
  <key>CFBundleIdentifier</key><string>local.hanu.launcher</string>
  <key>CFBundleExecutable</key><string>hanu</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/hanu" <<'RUN'
#!/bin/bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  osascript -e 'display alert "هنو يحتاج Google Chrome" message "ثبّت Chrome ثم اضغط هنو من جديد."'
  open "https://www.google.com/chrome/"
  exit 1
fi
# 1. open PS Remote Play (it reconnects to your PS5)
if ! pgrep -xq "PS Remote Play"; then
  open -a "PS Remote Play" 2>/dev/null || osascript -e 'display alert "لم أجد PS Remote Play" message "ثبّته من موقع PlayStation ثم أعد المحاولة."'
  sleep 6
fi
# 2. open Hanu in its own Chrome window: full screen, shares the PS Remote Play window by itself, starts translating.
#    caffeinate keeps the Mac awake while Hanu runs; the three --disable flags keep it reading when its window is covered.
exec caffeinate -dis "$CHROME" \
  --user-data-dir="$HOME/Library/Application Support/Hanu-Chrome" \
  --no-first-run --no-default-browser-check --start-fullscreen \
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --auto-select-desktop-capture-source="PS Remote Play" \
  --app="file://$HOME/Hanu/hanu.html?auto=1"
RUN
chmod +x "$APP/Contents/MacOS/hanu"
xattr -cr "$APP" 2>/dev/null || true

echo "تم. على سطح المكتب الآن: هنو"
echo "أول مرة: إذا طلب macOS إذن تسجيل الشاشة لـ Google Chrome، وافق ثم اضغط هنو مرة ثانية."
