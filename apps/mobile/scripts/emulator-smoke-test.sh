#!/usr/bin/env bash
# Installs the APK on the running Android emulator, opens the app and checks it is still running once it has
# started (no crash). Leaves emulator-screenshot.png and logcat.txt for the workflow to upload.
# Usage: bash apps/mobile/scripts/emulator-smoke-test.sh path/to/app.apk
set -euo pipefail

APK="${1:-stencil-hrms.apk}"
PKG="com.stencilindia.hrms"
WAIT_SECONDS=25

adb wait-for-device
adb install -r "$APK"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
echo "Opened $PKG; waiting ${WAIT_SECONDS}s for it to start…"
sleep "$WAIT_SECONDS"

adb exec-out screencap -p > emulator-screenshot.png || true
adb logcat -d > logcat.txt || true

# A crash in this app (other apps' crashes on the emulator are ignored).
if grep -A2 "FATAL EXCEPTION" logcat.txt | grep -q "Process: $PKG"; then
  echo "::error::The app crashed after opening. First lines of the crash:"
  grep -A30 "FATAL EXCEPTION" logcat.txt | head -60
  exit 1
fi
if ! adb shell pidof "$PKG" > /dev/null; then
  echo "::error::The app is not running ${WAIT_SECONDS}s after opening."
  tail -80 logcat.txt
  exit 1
fi
echo "The app opened and is still running after ${WAIT_SECONDS}s."
