#!/usr/bin/env bash
# One command for every store this repo ships to. See release/README.md.
#   ./release.sh [ios|mac|chrome|android|firefox|all] [--live] [--track production]
# Without --live nothing is published: it builds and validates only.
# iOS and Mac go to TestFlight with --live, and to App Store review with --live --track production.
set -euo pipefail
cd "$(dirname "$0")"

target=${1:-all}; shift || true
live=0; track=testflight
while [ $# -gt 0 ]; do
  case $1 in
    --live) live=1 ;;
    --track) track=${2:?--track needs a value}; shift ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "Missing env var $v (see release/README.md)" >&2; exit 1; }; done; }
say() { printf '\n== %s\n' "$*"; }

apple() { # $1 = fastlane platform (ios or mac)
  need ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH
  [ "$(uname)" = Darwin ] || { echo "$1 builds need a Mac with Xcode" >&2; exit 1; }
  if [ $live = 0 ]; then say "$1: dry run (build + App Store Connect validation, nothing uploaded)"; fastlane "$1" check
  elif [ "$track" = production ]; then
    say "$1: upload, listing and screenshots, submit for review"; fastlane "$1" release
  else say "$1: upload to TestFlight"; fastlane "$1" beta
  fi
}

chrome() {
  local version zip
  version=$(node -p "require('./keepsake/manifest.json').version")
  zip="build/internet-binder-chrome-$version.zip"
  say "chrome $version: test and package"
  npm ci --silent && npm test && npm run test:ios-core
  mkdir -p build && rm -f "$zip"
  (cd keepsake && zip -qr "../$zip" . -x "README.md" -x "LICENSE" -x "PRIVACY.md" -x ".*" -x "**/.DS_Store")
  echo "Packaged $zip ($(unzip -l "$zip" | tail -1 | awk '{print $2}') files)"
  if [ $live = 0 ]; then echo "Dry run: not uploaded. Add --live to upload and publish."; return; fi
  need CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID CWS_EXTENSION_ID
  say "chrome: upload and publish"
  CLIENT_ID=$CWS_CLIENT_ID CLIENT_SECRET=$CWS_CLIENT_SECRET REFRESH_TOKEN=$CWS_REFRESH_TOKEN PUBLISHER_ID=$CWS_PUBLISHER_ID \
    npx --yes chrome-webstore-upload-cli@4.0.2 --source "$zip" --extension-id "$CWS_EXTENSION_ID"
  echo "Chrome Web Store (live once review passes): https://chromewebstore.google.com/detail/$CWS_EXTENSION_ID"
}

skip() { echo "$1: not shipped from this repo ($2), nothing to do"; }

case $target in
  ios) apple ios ;;
  mac) apple mac ;;
  chrome) chrome ;;
  android) skip android "there is no Android app"; exit 1 ;;
  firefox) skip firefox "the Firefox build is on hold"; exit 1 ;;
  all) chrome; apple ios; apple mac; skip android "there is no Android app"; skip firefox "the Firefox build is on hold" ;;
  *) echo "Usage: ./release.sh [ios|mac|chrome|android|firefox|all] [--live] [--track production]" >&2; exit 2 ;;
esac
