#!/bin/zsh
# Screenshots every direction × screen × appearance on the booted simulator.
# Usage: shoot.sh <path-to-KeepsakePrototypes.app> [out-dir]
set -e
APP="$1"
OUT="${2:-$(dirname $0)/../../../replica/m3/prototypes}"
BUNDLE=com.harrisonfischberg.keepsake.prototypes
mkdir -p "$OUT"
xcrun simctl install booted "$APP"
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
for mode in light dark; do
  xcrun simctl ui booted appearance $mode
  for d in ${=DIRECTIONS:-postcard cabinet daylight}; do
    for s in ${=SCREENS:-library place recipe share}; do
      xcrun simctl terminate booted $BUNDLE 2>/dev/null || true
      xcrun simctl launch booted $BUNDLE -direction $d -screen $s -shot YES >/dev/null
      sleep ${WAIT:-3}
      xcrun simctl io booted screenshot --type=png "$OUT/$d-$s-$mode.png" 2>/dev/null
      sips --resampleWidth 603 "$OUT/$d-$s-$mode.png" >/dev/null
      echo "$d-$s-$mode"
    done
  done
done
xcrun simctl ui booted appearance light
