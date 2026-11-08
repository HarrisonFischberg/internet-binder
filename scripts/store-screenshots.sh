#!/bin/bash
# Retakes the App Store screenshots from the current code: runs the screenshot UI test
# (SCREENSHOT_TEST in release/config.sh) on a 6.9-inch iPhone and a 13-inch iPad simulator with a clean
# 9:41 status bar, saving raw PNGs to store/ios/raw/<iphone|ipad>, then frames them into
# store/ios/screenshots/en-US.
set -euo pipefail
cd "$(dirname "$0")/.."
source release/config.sh
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
if [ -n "${XCODE_WORKSPACE:-}" ]; then where=(-workspace "$XCODE_WORKSPACE"); else where=(-project "$XCODE_PROJECT"); fi
rm -rf store/ios/raw
mkdir -p store/ios/raw build
touch store/ios/raw/.capture # the UI test skips itself unless this file exists
booted_here=()
cleanup() {
  rm -f store/ios/raw/.capture
  # Leave simulators that were already running (another session may be using them) as they were.
  for u in "${booted_here[@]+"${booted_here[@]}"}"; do xcrun simctl shutdown "$u" 2>/dev/null || true; done
}
trap cleanup EXIT

shoot() { # $1 = simulator name filter, $2 = raw subfolder the test writes
  local udid
  udid=$(xcrun simctl list devices available | grep -m1 "$1" | grep -oE '[0-9A-F-]{36}') || true
  [ -n "$udid" ] || { echo "No simulator matching '$1'." >&2; exit 1; }
  if ! xcrun simctl list devices | grep "$udid" | grep -q Booted; then
    xcrun simctl boot "$udid"; booted_here+=("$udid")
  fi
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl status_bar "$udid" override --time "9:41" --batteryState charged --batteryLevel 100 \
    --cellularBars 4 --wifiBars 3
  xcodebuild "${where[@]}" -scheme "$SCHEME" -destination "id=$udid" \
    -only-testing:"$SCREENSHOT_TEST" \
    -resultBundlePath "build/store-screenshots-$2-$(date +%s).xcresult" test -quiet
  xcrun simctl status_bar "$udid" clear
  ls store/ios/raw/"$2"/*.png >/dev/null 2>&1 || { echo "The UI test wrote no screenshots to store/ios/raw/$2." >&2; exit 1; }
}

shoot "${SCREENSHOT_SIMULATOR:-Pro Max}" iphone
[ -z "${SCREENSHOT_IPAD:-}" ] || shoot "$SCREENSHOT_IPAD" ipad
python3 scripts/frame_store_shots.py
echo "Screenshots written to store/ios/screenshots/en-US."
