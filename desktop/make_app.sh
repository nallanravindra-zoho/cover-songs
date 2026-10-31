#!/bin/bash
# Makes two Mac apps in this folder to try the desktop idea (both open the same settings page):
#   "Cover Songs.app"           Electron: its own app with Mac menus; starts and stops the page's server itself
#   "Cover Songs (Chrome).app"  a Chrome window without the browser's tabs and address bar (no download needed)
# Run once after "npm install" (and "node node_modules/electron/install.js" if npm skipped Electron's download).
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

APP="Cover Songs.app"
rm -rf "$APP"
cp -R node_modules/electron/dist/Electron.app "$APP"
mkdir -p "$APP/Contents/Resources/app"
cp main.js package.json icon.png "$APP/Contents/Resources/app/"
echo "$ROOT" > "$APP/Contents/Resources/app/root.txt"
cp icon.icns "$APP/Contents/Resources/electron.icns"
P="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "Cover Songs" "$P"
plutil -replace CFBundleDisplayName -string "Cover Songs" "$P"
plutil -replace CFBundleIdentifier -string "local.coversongs.app" "$P"
codesign --force --deep --sign - "$APP" 2>/dev/null
echo "made $APP"

CAPP="Cover Songs (Chrome).app"
rm -rf "$CAPP"
osacompile -o "$CAPP" -e "do shell script \"cd '$ROOT' && (curl -s -o /dev/null http://127.0.0.1:8766/ || (nohup .venv/bin/python settings.py --no-open > /tmp/coversongs.log 2>&1 &)) && for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://127.0.0.1:8766/ && break; sleep 0.5; done\"" \
  -e "do shell script \"open -na 'Google Chrome' --args --app=http://127.0.0.1:8766/ --user-data-dir=\$HOME/Library/Application\\\\ Support/CoverSongsChrome --window-size=1500,960\""
cp icon.icns "$CAPP/Contents/Resources/applet.icns"
echo "made $CAPP"
