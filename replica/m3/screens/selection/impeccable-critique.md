# Impeccable critique: Select mode, long-press menus, swipe to delete (iOS)

Method: design review only (detector not applicable, native platform). Evidence: Simulator screenshots in
this folder (iPhone 18 Pro, iOS 27, Pantry Pop light and dark; iPad Pro 13" for the collection shot) and
the SwiftUI in `ios/App/Selection.swift` plus the screens that use it.

Target: the new selection UI only (Select / Done, ticks, the bottom selection bar, the long-press menus,
the swipe-to-delete row, the Undo toasts).

## Design Health Score

| # | Heuristic | Before | After | Key issue |
|---|-----------|--------|-------|-----------|
| 1 | Visibility of System Status | 2 | 3 | Move to… and Trash looked enabled with nothing ticked (their own colours hid `.disabled`). Count line and toasts are good. |
| 2 | Match System / Real World | 3 | 3 | Select / Done, Select all / none, a tick in the corner: Photos' language. |
| 3 | User Control and Freedom | 4 | 4 | Every delete, single or bulk, ends in a toast with Undo; no "Are you sure?". |
| 4 | Consistency and Standards | 3 | 3 | Swipe's revealed button was icon-only (the system's says "Delete"); Places' Select is a Pantry capsule while pushed screens use the toolbar button. |
| 5 | Error Prevention | 2 | 3 | A half swipe released over the row counted as a tap and opened it. A full swipe on a wide iPad row needed ~440 pt. |
| 6 | Recognition Rather Than Recall | 3 | 3 | Long-press menu lists the card's own actions plus Select; nothing to remember. |
| 7 | Flexibility and Efficiency | 3 | 3 | ⌘A, Delete key, long-press → Select with that card ticked. No drag-to-select across cards. |
| 8 | Aesthetic and Minimalist Design | 2 | 3 | iPad bar stretched Move to… across ~900 pt; white glyphs on dark mode's coral failed contrast. |
| 9 | Error Recovery | 3 | 3 | Undo covers the common mistake; store failures are swallowed (`try?`) with no message. |
| 10 | Help and Documentation | 3 | 3 | "Tap to select" in the empty bar; VoiceOver hints on Select and each tick. |
| **Total** | | **28/40** | **31/40** | **Good** |

## Design specificity

Authored for this product, not interchangeable: the bar sits on the style's `table` colour with its rule,
Move to… is the style's primary control shape, Trash is the stamp colour on the style's surface, and the
Pantry Pop hard shadow carries through. The menus reuse the card's own verbs ("Mark cooked", "Mark been")
from `KindStyle`, so a long press on a recipe and on a place say different, right things.

## What's working

- **Undo instead of confirms, everywhere.** Bulk trash, bulk collection delete (with its "keep the saves or
  delete them" choice only when a collection isn't empty) and swipe all land on one toast with Undo.
- **Long press → Select** starts Select mode with that card already ticked, which is the fastest path into
  a bulk action and matches the user's expectation from Photos and Files.
- **The count line** ("2 collections selected", "Tap to select") keeps state visible and reads to VoiceOver.

## Priority issues

1. **[P1] Half swipe opened the row.** A sideways drag released short of a full swipe fired the row's
   NavigationLink (a Button fires on touch-up anywhere inside its bounds). Fix: the row's tap is off while a
   sideways swipe is on; with Delete showing, a tap on the row closes it. *Fixed; new UI test
   `testHalfSwipeShowsDeleteWithoutOpeningTheRow`.*
2. **[P1] Disabled bar actions looked live.** `BarLabel` / `BarTrashLabel` draw their own colours, so
   `.disabled(selected.isEmpty)` changed nothing visible. Fix: read `isEnabled` and fade to 40 %. *Fixed.*
3. **[P2] Swipe Delete contrast in dark mode.** White on Pantry Pop's dark-mode danger `#FF8E78` is about
   2.2:1. Fix: the glyph and word use the style's `paper` colour (about 6:1 light, 8:1 dark). *Fixed.*
4. **[P2] iPad: full swipe nearly impossible, bar stretched.** Thresholds were a share of the row's width
   (55 % / 80 %), so ~440 pt on an iPad row; the bar's buttons filled the whole detail pane. Fix: thresholds
   capped at 240 / 360 pt; the bar's contents cap at 600 pt and centre. *Fixed; iPad SelectionTests pass.*
5. **[P3] Revealed swipe button was icon-only.** The system's swipe actions show a word. Fix: trash icon
   over "Delete" (caption, scales down rather than truncating). *Fixed.*

## Persona red flags

- **Sam (VoiceOver):** every swipe has a named action ("Move to Trash") and every tick carries the
  selected trait; fine. The bar's count is marked `updatesFrequently`.
- **Casey (one hand, iPad):** before the fix, full swipe on an iPad row needed a ~440 pt drag; now 240 pt.
- **Alex (power user):** ⌘A selects all and Delete trashes on a hardware keyboard; no shift-click range.

## Left alone, and why

- **Tab bar stays under the selection bar** on Library, Places and pushed views. Photos hides it, but the
  tab bar's visibility is owned by `Stack` in RootView (it hides on a save's page); a second owner risks the
  bar flickering on back navigation. Worth doing as its own change.
- **Bottom padding is a fixed 140 pt** for the bar on every screen; at the largest accessibility sizes the
  bar grows taller than that and can cover the last row. The right fix is `safeAreaInset(edge: .bottom)` on
  each screen, a structural change across five files rather than polish.
- **Places' Select is a Pantry capsule** while pushed screens use the toolbar's button: Places draws its own
  header (no navigation bar), so the capsule is the consistent choice there.
- **Selected cards are marked only by the tick** (unticked ones dim to 85 %). A ring in the accent would
  vanish against Pantry Pop's ink outline; the tick is large and high-contrast in both modes.
- **Silent failures** (`try?` in the store calls) predate this branch and touch every screen.
- **XCUITest waits ~60 s for idle while any context menu is open** on the iOS 27 Simulator (measured with a
  one-button menu too, app at 0 % CPU): a simulator/XCTest behaviour, not this menu. The long-press tests pass,
  just slowly.

## What changed (files)

- `ios/App/Selection.swift`: disabled look for bar actions; bar contents capped at 600 pt; swipe Delete shows
  icon and word in `paper` on `stamp`; tap suppressed during a sideways swipe; tap closes an open row; full
  swipe thresholds capped for wide rows.
- `ios/UITests/SelectionTests.swift`: sections open from the iPad sidebar; new half-swipe test.
- `ios/UITests/OrganiseTests.swift`: `testFilterPurchased` scrolls to the Workouts stack (it sits below
  Collections, out of the lazy grid).
- `ios/UITests/ScreenshotTests.swift`: `testSelectionScreens` and `testSelectionPlacesScreens` write the
  shots in this folder (`KEEPSAKE_SHOTS=<folder>`, optional `KEEPSAKE_SHOT_MODES=light|dark`).

Questions skipped: the brief asked for the clear in-scope fixes to be applied without a round of questions.
