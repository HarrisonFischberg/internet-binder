# Internet Binder

Chrome extension (`keepsake/`), iPhone/iPad app (`ios/`) and Mac Safari app (`safari/`). See `README.md`.
Releases: `release/README.md` (one command, `./release.sh`, dry run unless `--live`).

## Releasing to the App Store

When the owner says the build is good for release ("Internet Binder is good for release, push it to Apple",
"ship it", "release it"), that message is the approval for the whole release. Do it end to end without asking:

1. Merge only the open PRs the owner named into main, then work in a fresh worktree off origin/main.
2. Pick the next version: minor for features, patch for fixes (read `keepsake/manifest.json`, which drives
   MARKETING_VERSION, and the live App Store version; never reuse a version that is already live or in review).
   The version is shared with the Chrome extension, so a bump here is also Chrome's next version.
3. Write `store/ios/metadata/en-US/release_notes.txt` (What's New) from the user-facing changes merged
   since the last commit that changed that file: short, plain sentences a customer understands, no
   internal names, PR numbers or bug jargon, under 4000 characters. Update `description.txt` and
   `promotional_text.txt` if a feature they describe changed, and the captions in
   `store/ios/screenshots.json` if a screen in them changed.
4. Privacy check: if any change sends new data off the device, collects a new data type, or adds an SDK,
   compare it with the published privacy policy and the App Privacy answers in App Store Connect. If they
   no longer cover it, stop and tell the owner, because the policy and the label need their OK.
5. Run `./release.sh --live --track production --version X.Y.Z`. Add `--first` while the app has never
   been on the App Store (true in Nov 2026: its App Store Connect listing was still empty), because
   Apple refuses What's New on a first version. It retakes the screenshots (iPhone and iPad), archives,
   uploads, pushes the listing and screenshots and submits for review with automatic release after
   approval. If a step fails, fix the cause and rerun; don't hand the owner manual steps unless only
   they can do it (an Apple website setting or agreement).
6. Commit the version bump (manifest.json, both Xcode projects, including the build number fastlane wrote),
   notes and screenshots, open a PR and merge it. Tell the owner one line: the version, the build number,
   and that it's waiting for review.
