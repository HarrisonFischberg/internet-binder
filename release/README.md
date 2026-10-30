# Releasing

One command, from the repo root:

| What | Command |
|---|---|
| Dry run everything (builds and validates, publishes nothing) | `./release.sh all` |
| iPhone/iPad build to TestFlight | `./release.sh ios --live` |
| iPhone/iPad to App Store review (build, listing, screenshots, age rating, submit) | `./release.sh ios --live --track production` |
| Mac Safari app build to TestFlight | `./release.sh mac --live` |
| Mac Safari app to App Store review | `./release.sh mac --live --track production` |
| Everything at once (iPhone/iPad, Mac, Chrome) | `./release.sh all --live --track production` |
| Chrome Web Store upload and publish | `./release.sh chrome --live` |

Each `--live` run ends by printing where it went: the TestFlight page, the App Store link (works once Apple approves) or the Chrome Web Store page.

Without `--live` nothing leaves the machine except App Store Connect's validation check of the build.
`ios` and `mac` need a Mac with Xcode signed in to team KTV2G3Z883. `chrome` runs anywhere with Node 20+.
`android` and `firefox` are accepted and do nothing: this repo has no Android app, and the Firefox build is on hold.

Each `--live` iOS or Mac run bumps `CURRENT_PROJECT_VERSION` in both Xcode projects to one above the
newest TestFlight build. Commit that change afterwards. Bump the version itself (`keepsake/manifest.json`,
then `python3 ios/tools/make-xcodeproj.py`) before a new App Store version.

The Chrome Web Store refuses an upload while the previous one is still in review: cancel that review in
the dashboard first. Pushing a `v*.*.*` tag still publishes Chrome through `.github/workflows/release.yml`;
`./release.sh chrome --live` is the same thing from your own machine.

## Where things live

- `fastlane/` – Appfile (bundle id, team) and Fastfile (lanes `check`, `beta`, `release` for iOS and for Mac).
- `store/ios/metadata/` – App Store text: name, subtitle, description, keywords, promo text, URLs, categories,
  copyright, App Review contact and notes. Add `en-US/release_notes.txt` for every version after the first.
- `store/ios/age-rating.json` – age rating answers (all "none", result 4+).
- `store/ios/screenshots/en-US/` – iPhone 6.9" (1320×2868), iPhone 6.3" (1206×2622) and iPad 13" (2064×2752).
  fastlane sorts them by size; the number prefix sets the order.
- `store/mac/` – the Mac App Store text (Safari-specific description, review notes) and 2880×1800 screenshots. Name, subtitle, categories and age rating are shared with iOS.
- `store/chrome/` – what the Chrome listing needs (edited by hand, see its README).

## Secrets (env vars, never committed)

Put these in `~/.zshrc` (or a file you `source` that is not in the repo).

| Var | For | Where it comes from |
|---|---|---|
| `ASC_KEY_ID` | ios, mac | App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys |
| `ASC_ISSUER_ID` | ios, mac | Shown above the Team Keys list |
| `ASC_KEY_PATH` | ios, mac | Path to the downloaded `AuthKey_XXXX.p8`, e.g. `~/.appstoreconnect/AuthKey_XXXX.p8` |
| `CWS_CLIENT_ID` | chrome | Google Cloud OAuth client (Desktop app) with the Chrome Web Store API enabled |
| `CWS_CLIENT_SECRET` | chrome | Same OAuth client |
| `CWS_REFRESH_TOKEN` | chrome | Made once from that client; guide: https://github.com/fregante/chrome-webstore-upload-keys |
| `CWS_PUBLISHER_ID` | chrome | Chrome Web Store developer dashboard → Account |
| `CWS_EXTENSION_ID` | chrome | `akekjlfpdbkghhopdkgnfnkcibonaiom` |

## One-time setup

1. `brew install fastlane`
2. App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → "+", access **App Manager**.
   Download the `.p8` (Apple lets you download it once), then
   `mkdir -p ~/.appstoreconnect && mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/`
3. Add the `ASC_*` lines to `~/.zshrc`, open a new Terminal window.
4. Chrome: create the OAuth client and refresh token (guide above), add the `CWS_*` lines.
5. Check it all with a dry run: `cd ~/projects/internet-binder && ./release.sh all`

## Steps that can't be automated (once, in App Store Connect)

- **Agreements**: Business → accept the latest Apple Developer Program License Agreement (and Paid Apps only if you ever charge).
- **EU trader status**: Business → Digital Services Act → **trader**, as Rare Creatures LLC. Apple verifies, then shows the address, phone and email you give on the App Store page in the EU. Without it the app can't be offered there.
- **App Privacy**: App → App Privacy → "No, we do not collect data from this app", then Publish. The API can't set it; it carries over between versions.
- **App Review phone number**: App → version page → App Review Information → phone. Kept out of git on purpose; fastlane leaves it alone.
- **Content Rights**: App Information → "Yes, it contains, shows or accesses third-party content" and that you have the rights to use it (it reads the pages people share to it).
- **Price and availability**: Free, all countries (first time only).
- **Chrome listing**: description and screenshots in the developer dashboard (see `store/chrome/README.md`). The $5 developer fee is already paid.
