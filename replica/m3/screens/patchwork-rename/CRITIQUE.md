⚠️ DEGRADED: single-context (this was a quick critique of the rename only, run inside a verification pass. The detector ran, but no separate design-review agent was used.)

# Patchwork rename: verification and critique

Harold, this checks that the Keepsake → Patchwork rename (PR #35, 2.2.1) holds up everywhere people see the name. The name is two letters longer than Keepsake, so most of the checks look for text that overflows, gets cut off or breaks in the wrong place.

## What was checked

| Surface | How | Result |
|---|---|---|
| iOS home screen icon label | XCUITest on an iPhone 17e simulator, light and dark | "Patchwork" in full, not cut off (`ios-*-springboard.png`) |
| iOS Home header | Default, XXXL and AX5 text sizes | Fine up to XXXL. **At AX5 the name broke mid-word, "Patchw / ork". Fixed** (see below) |
| iOS Settings bottom | XCUITest | "Patchwork 2.2.1 (1)" (`ios-*-settings-bottom.png`) |
| iOS share sheet | Existing `testShareCard` | Patchwork shows in Safari's share row (the test checks this). The card itself doesn't show the name (`pantry-*-share-*.png`) |
| iOS widgets | Built Info.plist and source | CFBundleDisplayName is Patchwork. The empty Latest-save widget says "Patchwork" and "Share something to Patchwork…" at headline size in a small widget, where the word fits |
| Chrome dashboard sidebar | Headless Comet with the unpacked extension, all 5 styles × light/dark, 1280 and 820 px | No overflow: the brand is 103 px wide inside a 223 px sidebar in its widest font (`dashboard-sidebar-all-styles.png`, `dashboard-820px-all-styles.png`) |
| Chrome popup (400 px) | Same, all 5 styles × light/dark | No overflow. In Swiss's condensed type the brand is 73 px wide; the widest is 104 px (`popup-all-styles.png`) |
| Mac app window | The Debug build's `-snapshot` flag, with the extension on and off | Title "Patchwork" at 38 pt fits in the 460 pt window. Steps and footnote read correctly (`mac-app-window-*.png`) |

In every dashboard and popup view, a DOM measurement compared scrollWidth with clientWidth on the brand, the title and the sidebar brand. None overflowed.

## Design Health Score (rename scope)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | The Mac window's On/Off sticker is clear |
| 2 | Match system / real world | 4 | The name is the same everywhere: icon label, header, share row, Safari steps |
| 3 | User control and freedom | n/a | Not touched by a rename |
| 4 | Consistency and standards | 3 | One mid-word break at AX5 (fixed) |
| 5 | Error prevention | n/a | Not touched by a rename |
| 6 | Recognition rather than recall | 4 | "Turn on Patchwork" in the Safari steps matches what Safari's list shows |
| 7 | Flexibility and efficiency | n/a | Not touched by a rename |
| 8 | Aesthetic and minimalist design | 3 | The brand fits each style's type without crowding |
| 9 | Error recovery | n/a | Not touched by a rename |
| 10 | Help and documentation | 3 | Settings and privacy footers say Patchwork |
| **Total** | | **23/24** | Excellent for the scope reviewed |

## Design specificity verdict

**LLM assessment:** The rename keeps each style's voice. Bricolage in Pantry, Instrument Serif in Notebook and Gallery, condensed type in Swiss. The longer word sits well in each one. The Patchwork quilt mark next to the name reads as one brand.

**Deterministic scan** (`impeccable detect` on dashboard.html and popup.html): 8 findings, all from before the rename, none about the name. They are the skeleton shimmer (marquee rule) ×2, decorative stripes ×2, the Notebook graph-paper grid ×2 (deliberate in that style, a false positive), the popup's empty-state icon tile ×1, and the popup `<img>` with no src ×1 (filled by JS at runtime, a false positive). Out of scope here.

## Priority issues

- **[P1] FIXED: the Home header broke "Patchwork" mid-word at accessibility text sizes.**
  - **Why it matters:** At AX5 the name rendered as "Patchw" / "ork" next to the two round header buttons. The title is the brand, and that's the one place it shouldn't break. Keepsake broke the same way, but the extra letters made it happen at a smaller size.
  - **Fix:** `HomeScreen` now uses an `AnyLayout`. At accessibility sizes the header stacks (name first, buttons trailing underneath), so the name gets the full width. `ScreenHeader` now keeps one-word titles on one line and scales them down (minimum 0.5) instead of breaking them mid-word. Titles with more than one word still wrap at spaces. This also covers "Collections" and "Lifestyle" at large sizes. See `ios-home-header-ax5-before.png` and `ios-home-header-ax5-after.png`.
  - **Suggested command:** /impeccable adapt

No P2 issues came from the rename.

## Minor observations (not changed, from before the rename)

- **[P3]** On the very first launch, iOS asks for notification permission before the person has saved anything. The baseline is to ask in context, for example after the first share. This is unrelated to the rename.
- **[P3]** `testShareCard` ends with 2 failures after the "Saved to…" banner tap: the app didn't come to the front with the save open in time. Everything up to that point passed, including the check that "Patchwork is in the share sheet". This looks like a timing flake in that last step, not something the rename caused.
- Bundle identifiers, the database folder (`Keepsake`) and the Xcode target names still say Keepsake. That's correct: changing them would orphan installed libraries and break updates.

## Questions to consider

- Should the iPad sidebar title (`SplitRootView`, a `navigationTitle`) also be checked at AX5? The system handles that one, so it truncates rather than breaking mid-word.
