#!/bin/bash
# Design exploration (branch design/explore): captures the baseline and directions A, B, C on a simulator.
# usage: scripts/design-shots.sh <simulator udid> <built Keepsake.app> <output folder> [name ...]
# A name is <baseline|A|B|C>-<1|2>[-paper|-chromatic]: 1 = Home, 2 = the shakshuka recipe with three ingredients ticked.
set -euo pipefail
cd "$(dirname "$0")/.."
udid=$1 app=$2 out=$3; shift 3
names=("$@"); [ ${#names[@]} -gt 0 ] || names=(baseline-1 baseline-2 A-1 A-2 B-1 B-2 C-1 C-2)
bundle=com.harrisonfischberg.keepsake
mkdir -p "$out"
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$app"
xcrun simctl status_bar "$udid" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
# The first launch after an install is thrown away: the simulator draws the Dynamic Island as busy over it.
SIMCTL_CHILD_KEEPSAKE_DB="design-warmup-$RANDOM" xcrun simctl launch "$udid" $bundle >/dev/null; sleep 6
for name in "${names[@]}"; do
  IFS=- read -r variant screen theme <<<"$name"
  args=(-importOnLaunch "$PWD/ios/demo/store-demo.json" -ksTheme "${theme:-nocturne}" -ks.appleAIStatus unsupported
        -designDone "Lemony spaghetti")
  [ "$variant" = baseline ] || args+=(-design "$variant")
  [ "$screen" = 1 ] || args+=(-designOpen "Smoky shakshuka" -designChecked 3)
  xcrun simctl terminate "$udid" $bundle 2>/dev/null || true
  # A fresh library each time (KEEPSAKE_DB), so nothing carries over and onboarding never shows.
  SIMCTL_CHILD_KEEPSAKE_DB="design-$name-$RANDOM" xcrun simctl launch "$udid" $bundle "${args[@]}" >/dev/null
  sleep "${DESIGN_WAIT:-9}"
  xcrun simctl io "$udid" screenshot "$out/$name.png" >/dev/null 2>&1
  echo "$out/$name.png"
done
xcrun simctl terminate "$udid" $bundle 2>/dev/null || true
xcrun simctl status_bar "$udid" clear
