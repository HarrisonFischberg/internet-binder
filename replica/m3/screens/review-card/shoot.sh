#!/bin/bash
# Review card mockup shots: both variants, light and dark, then one accessibility-XL libraries screen each.
# Usage: shoot.sh <simulator udid> <output folder> <derived data folder>
# Needs a scheme named ReviewMockShots that tests KeepsakeUITests (not committed).
set -e
SIM=$1; OUT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); DD=$3
cd "$(dirname "$0")/../../../.."
mkdir -p "$OUT"
build() { xcodebuild -project ios/Keepsake.xcodeproj -scheme ReviewMockShots -destination "id=$SIM" -derivedDataPath "$DD" "$@" 2>&1 | grep -E "error:|SUCCEEDED|passed \(|failed \(" || true; }
run() { build test-without-building -only-testing:KeepsakeUITests/ScreenshotTests/testReviewCardMock; }
build build-for-testing
xcrun simctl ui "$SIM" content_size large
for m in light dark; do
  xcrun simctl ui "$SIM" appearance $m
  TEST_RUNNER_KEEPSAKE_SHOTS=$OUT TEST_RUNNER_KEEPSAKE_SHOT_MODES=$m run
done
xcrun simctl ui "$SIM" appearance light
# Large text: the test opens the card at the default size, then waits for the host to turn Dynamic Type up.
(
  for v in A B; do
    until [ -f "$OUT/.xl-ready" ]; do sleep 1; done; rm "$OUT/.xl-ready"
    xcrun simctl ui "$SIM" content_size accessibility-extra-large; touch "$OUT/.xl-go"
    until [ -f "$OUT/.xl-done" ]; do sleep 1; done
    xcrun simctl ui "$SIM" content_size large; rm "$OUT/.xl-done"
  done
) &
TEST_RUNNER_KEEPSAKE_SHOTS=$OUT TEST_RUNNER_KEEPSAKE_SHOT_MODES=light TEST_RUNNER_KEEPSAKE_SHOT_LIBRARIES_ONLY=1 run
wait
ls "$OUT"
