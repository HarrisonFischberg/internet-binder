# Internet Binder rename: /impeccable critique

Method: design review only (detector not applicable, native platform). Scope: what the rename from Keepsake
and the new binder icon changed on iOS Home, Settings, the Appearance icon picker and the springboard. The
Mac window could not be captured on the review machine (no Screen Recording permission), so it is reviewed
from its build only (name, bundle, fonts), not visually.

Screens: this folder (`iphone-home-screen-icon.png` 17 Pro Max, `iphone-17-home-screen-icon.png` 402pt,
`iphone-*.png`, `ipad-*.png`), and the App Store set in `replica/release/app-store-screenshots/`.

## Design health

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | Version row reads "Internet Binder 2.2.1 (1)"; Review nudge count is clear |
| 2 | Match system / real world | 3 | "Binder" fits keeping things from the internet; tabs on the icon echo the coloured shelves |
| 3 | User control and freedom | 3 | Unchanged by the rename |
| 4 | Consistency and standards | 3 | Icon picker: the default tile is named after the app, the other three after styles |
| 5 | Error prevention | 3 | Unchanged |
| 6 | Recognition rather than recall | 3 | New icon is distinct on the springboard: cream tile, blue cover, three tabs |
| 7 | Flexibility and efficiency | 3 | Unchanged |
| 8 | Aesthetic and minimalist design | 3 | Two-word name made the Review nudge wrap to 3 lines (fixed) |
| 9 | Error recovery | 3 | Error copy reads naturally with the longer name |
| 10 | Help and documentation | 2 | Privacy and Settings footers repeat the full name many times |
| **Total** | | **29/40** | **Good** (after the fixes below; 26/40 before) |

## Design specificity

The binder icon belongs to this product: a sticker-outlined binder with a bookmark and Pantry Pop's
terracotta, butter and mint tabs, the same outline weight as the in-app cards. On the springboard it's the
only cream tile among Apple's white and gradient icons, so it is easy to find. The name in the Home header,
set in Bricolage ExtraBold, still looks like the app's own title rather than a nav bar title.

## What's working

- The springboard label fits in full on the 17 Pro Max and on the 402pt iPhone 17 (with almost no room left).
- The Home title wraps between words, never inside one, at every size from XXXL to AX5 in all four styles
  (`ScreenHeader` lets a title with a space wrap and shrinks a one-word title instead).
- The selected default tile in the picker (thick outline plus check) shows the new icon clearly; its label
  "Internet Binder" fits on one line under it.

## Priority issues

- **[P1] iPad sidebar title truncated.** The sidebar's title row shared its width with Appearance, Settings
  and the sidebar toggle, so it read "Internet Bin…" on every iPad screen, all seven iPad App Store shots
  included. A large sidebar title had no effect on iPadOS 27. **Fixed:** Appearance and Settings moved to the
  sidebar's bottom bar (same labels, ⌘, still opens Settings); the title now reads in full
  (`ipad-home-sidebar.png`).
- **[P2] Review nudge wrapped to three lines.** "One tap each, and Internet Binder learns." pushed Home's
  yellow banner to 3 lines on the largest iPhone, which is App Store screenshot 1. **Fixed:** "One tap each,
  and it learns." (shorter than the Keepsake line, so 1 line again).
- **[P2] The project generator broke the display name.** `make-xcodeproj.py` wrote
  `INFOPLIST_KEY_CFBundleDisplayName = Internet Binder` without quotes, so regenerating the project gave a
  pbxproj that differs from the committed one and isn't valid. **Fixed:** the generator quotes the value; it
  now regenerates the committed file byte for byte.
- **[P3] Springboard label has no slack.** "Internet Binder" fills the icon column on a 402pt iPhone. On a
  375pt-wide phone or with the home screen's large icons and text it will likely truncate ("Internet Bi…").
  Fix if wanted: a shorter `CFBundleDisplayName` (e.g. "Binder") while the app keeps the full name inside.
  That's a naming decision, so it's not changed here.
- **[P3] Icon picker naming mixes app and style.** The default tile says "Internet Binder", its neighbours
  say "Field Notebook", "Night Atlas", "Swiss Index". The other three icons still use the bookmark motif, so
  the binder lives only in the default. Fix: call the default "Pantry Pop" (or give the alternates a binder
  silhouette) in a later icon pass.

## Persona red flags

- **Jordan (first-timer):** finds the app by its icon, not its name; the cream binder stands out. Nothing new breaks.
- **Sam (accessibility, AX5):** title wraps to "Internet / Binder" and the Appearance and Settings buttons drop
  under it, as designed. Those two header glyphs look broken up at AX5 (dots), which predates the rename.

## Minor observations

- Settings footers say "Internet Binder" up to three times in one section (Privacy); "it" would read lighter.
- Mac: product is `Internet Binder.app` with `Internet Binder Extension.appex`, fonts in the appex's
  `Contents/Resources/fonts/` as `ViewController.swift` expects. Window not seen.

## Questions to consider

- Should the springboard name be shorter than the brand ("Binder"), the way many apps shorten theirs?
- Should every alternate icon carry the binder, so changing style doesn't change what the app is?
