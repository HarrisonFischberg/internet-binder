# M3 decisions

Each decision that isn't obvious, with its trade-off. Newest last.

### D1 · 2026-10-15 · Prototypes live in their own Xcode project
`ios/Prototypes/KeepsakePrototypes.xcodeproj`, separate from the real app (M3.1), so throwaway design
code never ships. Bundle id `com.harrisonfischberg.keepsake.prototypes`, Simulator only, unsigned.
Trade-off: the real app re-implements the chosen direction instead of growing out of the prototype.

### D2 · 2026-10-15 · Hand-written project file with a synchronized folder, no generator
XcodeGen and Tuist aren't installed, and installing tools means downloading them. Xcode 16+ "folder
synchronized" groups keep the `.pbxproj` tiny (files are picked up from disk), so a hand-written project
is maintainable. Revisit if the M3.1 project (app + Share Extension + Widgets + tests) gets unwieldy.

### D3 · 2026-10-15 · Screenshots at half resolution in the repo
Full-size Simulator PNGs were 42 MB for 24 shots. `shoot.sh` scales them to 603 px wide (13 MB).
Full-size shots can be re-rendered at any time.

### D4 · 2026-10-15 · The Maps attribution stays visible
Apple requires the Maps logo and Legal link to be visible. Overlays on maps (photos, stamps) never sit
in the bottom-leading corner.

### D5 · 2026-10-15 · Bottom controls float over a scrim
Floating primary actions (search dock, Directions, Start cooking) sit on a gradient scrim of the table
colour, so scrolled text never runs behind or beside them.

### D6 · 2026-10-15 · Chrome's store runs unchanged on iOS (JavaScriptCore), over a native SQLite backend
`storage.js` already takes pluggable backends (Chrome uses IndexedDB, the tests use memory). iOS gives it
a synchronous SQLite record backend (`ios-bridge.js` → `RecordDatabase`). Import, export, sorting,
duplicates, learning, the Trash and goals therefore follow Chrome's code, not a Swift copy of it.
Trade-off: every write passes through JavaScript (about 1 ms each); reads for the screens go straight to
SQLite in Swift, so scrolling never touches JavaScript. Revisit only if writes show up in profiles.

### D7 · 2026-10-15 · Records are stored as Chrome's JSON, with copied columns
Each SQLite row keeps the exact JSON the shared store wrote (`body`) plus columns copied from it for
queries and sync (`kind`, `collectionId`, `urlKey`, `createdAt`, `updatedAt`, `deletedAt`…). Round trips
are lossless by construction and the content/metadata split sync needs is already there.
Recovery plan for schema changes: migrations are GRDB `DatabaseMigrator` steps that only add tables or
columns, and columns can always be rebuilt from `body`. An unknown future field in `body` is kept.

### D8 · 2026-10-15 · Atomic updates across processes by compare-and-swap
The app and the Share Extension can write at once. `update()` reads, applies the shared store's
function, then swaps only if every row still holds what was read; on a conflict it retries (up to 8).
Tested with 40 concurrent read-modify-writes from two database connections: no lost writes.

### D9 · 2026-10-15 · A small URL polyfill instead of bridging to Foundation's URL
JavaScriptCore has no `URL`. Foundation's `URL` parses differently from WHATWG (Chrome), which would
change `urlKey`s and duplicate detection. `ios/tools/jsc-polyfills.js` implements the WHATWG parts the
rules use and is checked against Node's URL on every URL in the Chrome tests plus edge cases.

### D10 · 2026-10-15 · The bundle is generated and checked in
`ios/tools/bundle-core.mjs` wraps each shared module in a function (the shared code uses only named
imports/exports). The generated `keepsake-core.js` is committed so Xcode builds need no Node; a test
fails if it's older than `keepsake/src/shared` (`npm run test:ios-core`).

### D11 · 2026-10-15 · The AI key lives in the Keychain, never in SQLite
`keepsake_secrets` writes go to the Keychain (this device only, after first unlock); tested that the key
never reaches the SQLite file or an export.

### D12 · 2026-10-15 · Simulator builds sign locally; device builds use team KTV2G3Z883
`CODE_SIGN_IDENTITY[sdk=iphonesimulator*] = "-"` lets the Simulator honour the App Group without any
account change. Device builds use automatic signing with the team, which will register the identifiers
on first device build: that step waits for the owner.

### D13 · 2026-10-15 · Chrome's capture rules moved into `keepsake/src/shared/capture.js` (Chrome code change)
What a page becomes (kind, details, filing, the save) lived in `background.js`, which iOS can't run.
The functions moved verbatim into `src/shared/capture.js`; `saveProduct` in `background.js` is now a
three-line wrapper that passes its after-save queues (AI tidy, Lifestyle fill-in) as hooks. Behaviour is
unchanged: `npm test` 293 pass / 0 fail before and after. The Share Extension runs the same function
(`saveCapture`) in JavaScriptCore, and Safari runs Chrome's `extract.js` on the page through
`NSExtensionJavaScriptPreprocessingFile` (generated `ios/ShareExtension/ShareExtract.js`), so a page
saved from Safari is the same save as from Chrome's toolbar. This touches the shipping extension:
it needs your review before the next Chrome release.

### D14 · 2026-10-15 · Identity direction: Postcard objects, quiet native chrome (owner's choice)
Saves are drawn as the objects of their kind (postcard, recipe card, ticket stub, book, swing tag,
clipping, training card). Controls, sheets and navigation stay quiet and native (Daylight's restraint),
so the objects are the only ornament. Cabinet's uniform tray grid becomes the Compact density option.

### D15 · 2026-10-15 · iCloud registration deferred; naming to settle first
The CloudKit experiments wait until M4 is near. Bundle ids and the container id are permanent and
public-readable (the container id also appears in the Chrome extension's code once it talks to
CloudKit); the App Store shows an individual developer's legal name as the seller regardless.
If the owner prefers neutral identifiers, change the prefix in `ios/tools/make-xcodeproj.py` and
`Config/*.entitlements` before any registration.

### D16 · 2026-10-15 · The share card fills the sheet iOS gives it
iOS always presents a share extension as a full-height sheet (a transparent overlay isn't honoured), so
the whole sheet is the table: status and Undo at the top, the save drawn large as its object, and the
destination slip and actions at the bottom under the thumb. Auto-closes 2 s after saving unless touched.

### D17 · 2026-10-15 · Paste-a-link uses the system Paste button
Reading `UIPasteboard` from code makes iOS ask "Allow paste?" every time. The system `PasteButton`
reads only when tapped and never prompts, at the cost of its own glyph instead of a "+". Its white glyph
sits on the light-mode accent in both modes, keeping 9:1 contrast.

### D18 · 2026-10-15 · Card facts are stored beside each save
Chrome's `keyFact` decides the line under each card ("9 ingredients · 25 min"). It is computed by the
shared code whenever a save is written and kept in a derived `fact` column (not synced, back-filled
when missing), so scrolling 5,000 saves never calls JavaScript.

### D19 · 2026-10-15 · Identifiers stay com.harrisonfischberg.* (owner's choice); M3.2 approved

### D20 · 2026-10-15 · Three tabs: Home, Library, Places; search lives in the Library
`ia.md` lists a Search tab. Search already sits at the bottom of the Library under the thumb (the
Library's one primary action), so a fourth tab would only repeat it. Places gets the third tab because
its map is a destination of its own. Review shows as Home's badge and banner.

### D21 · 2026-10-15 · Widgets read a snapshot the app writes
Widgets have a small memory budget, so they never open the library or run the shared code. The app
writes `widgets.json` (active goals with Chrome's `goalProgress`, the latest save) to the App Group
whenever the library or a goal changes, then reloads timelines. Links back in use `keepsake://save/<id>`.

### D22 · 2026-10-15 · One network door, behind an allowlist built from settings
The shared code reaches the network only through a native `fetch` (`Network.swift`). Each request is
checked against hosts allowed by the person's settings at that moment: their AI provider while AI is
on and a key is set, and each Lookup they turned on. HTTPS only, ephemeral session, no cookies, no
cache. Tested with a fake transport: nothing leaves with everything off; with Places on only
`nominatim.openstreetmap.org` is contacted. Remote images (AsyncImage) and MapKit are the other paths,
both disclosed in the Privacy screen and `ios/PRIVACY-iOS.md`.

### D23 · 2026-10-15 · Chrome's fill-in and AI tidy moved to `keepsake/src/shared/fill.js` (Chrome code change)
`fillKind` and `enrichItem` moved verbatim from `background.js` (now `fillSave`/`tidySave`), with the
network, the Lookup permission check and OpenStreetMap's pace passed in. `npm test` 293/0 before and
after. iOS runs the same functions when the app opens (`views.finishSaves`), once per save.
This touches the shipping extension: review with D13 before the next Chrome release.

### D24 · 2026-10-15 · Masonry in lazy blocks of 24
Two lazy columns nested in a plain row made SwiftUI build every card. The grid is now a lazy stack of
blocks (each block a small masonry), so only what's on screen is built; columns even out at each
block's end. Measured at 5,000 saves (Simulator, Debug): tab switch to the Library on screen 89 ms;
database open + first read 77 ms; search 36 ms.

### D25 · 2026-10-15 · Themes, icons, cards, density
Three themes (Postcard, Linen, Ink: Chrome's styles rethought), all AA in light and dark
(`tokens/make_tokens.py`, 260/260). Alternate app icons generated from the bookmark mark on a stamp
(`ios/tools/make-icons.swift`). Cards: Objects or Plain. Density: Comfortable or Compact (Cabinet's even
grid, per D14). Haptics on by default; Sound off by default, using a system tick (no recorded sounds yet).
Stored in the App Group so the Share Extension and widgets match.
