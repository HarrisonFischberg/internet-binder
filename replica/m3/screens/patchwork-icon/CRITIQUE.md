Method: dual-agent (A: design review sub-agent · B: detector sub-agent), synthesised in the parent session

# Patchwork app icon: critique of PR #35 (2.2.1)

Scope: the iOS AppIcon and its Appearance picker, the Chrome/Safari toolbar icons
(`keepsake/icons/styles/pantry/*.png`, `dark/`), the Safari for Mac `AppIcon.appiconset`, and the new
sidebar/popup mark (`keepsake/src/shared/looks.css` `.mark` rules). The artwork itself was approved by
Harold. This review covers how the artwork is applied: sizes, themes, naming and code.

## Verification

| Check | Result |
|---|---|
| `npm ci && npm test` | 374 pass, 0 fail, 2 todo (known parsePrice limitations) |
| `npm run test:ios-core` | 4 pass, 0 fail |
| iOS `xcodebuild` (Keepsake scheme, iPhone 18 Pro sim, `CODE_SIGNING_ALLOWED=NO`) | BUILD SUCCEEDED. No asset-catalog warnings. AppIcon light/dark/tinted are 1024 px with no alpha and compiled into Assets.car. The only warnings are pre-existing Swift deprecations. |
| Safari Mac `node safari/build.mjs` + Debug `xcodebuild` | BUILD SUCCEEDED. No asset-catalog warnings. AppIcon.icns produced. All 10 Mac slots filled at the right pixel sizes. Build folder deleted afterwards. Nothing installed or registered. |
| `actool` re-compile of the Mac catalog after the fixes below | Clean, no warnings |

## Screens in this folder

- `home-light.png`: iOS home screen with the Patchwork icon.
- `home-dark.png`: the same in dark mode. **Simulator limit:** this simulator's home screen doesn't draw dark icon variants for any app (Photos and Maps stay light too), and Edit → Customize won't open. So the icon shows its light rendition here.
- `appicon-renditions-light-dark-tinted.png`: proof of the dark and tinted renditions, taken from the compiled catalog's sources.
- `appearance-icon-picker-light.png` / `-dark.png`: Appearance → App icon. The default is labelled **Keepsake**, and the preview follows light/dark.
- `toolbar-and-mac-icons-before.png`: toolbar icons 16/32/48/128, light row then dark row, each at actual size plus a blow-up. Bottom row: the Mac 16/32/128 slots as shipped in the PR.
- `mac-small-sizes-before-after.png`: Mac 16@1x, 32@1x and 32@2x. Top row is before, bottom row after the fix.
- `mark-18px-36px.png`: the sidebar/popup mark rasterised at 1x and 2x.
- `dashboard-mark-dark.png` / `-light.png`: the dashboard sidebar after the fix.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Pickers mark the choice with a ring, a check, bold text and VoiceOver `.isSelected` |
| 2 | Match system / real world | 3 | Scraps plus a bookmark read as "saved bits". "Keepsake" sits slightly oddly among style names |
| 3 | User control and freedom | 3 | One tap reverts. `retireOldIcons` moves retired icons back to the default |
| 4 | Consistency and standards | 2 | Mac small sizes skipped the small variant the toolbar uses (fixed). Dark-mode mark outline was inverted against the icon (fixed). iOS shows 4 icons, Mac shows 5 (Gallery) |
| 5 | Error prevention | 2 | The "Keepsake" label was keyed on array position (fixed) |
| 6 | Recognition rather than recall | 3 | Pickers show the art, not just names |
| 7 | Flexibility and efficiency | n/a | An icon choice has no expert path |
| 8 | Aesthetic and minimalist design | 3 | Strong at 1024, 128 and 48. At 16 px and in the 1x mark the tag turns to mush |
| 9 | Error recovery | n/a | No error states in scope |
| 10 | Help and documentation | n/a | Nothing here needs docs |
| **Total** | | **19/28 (68%, about 27/40)** | **Acceptable, just short of Good.** That's the PR as submitted. The fixes below lift #4 and #5 to 3, giving 21/28 (75%, about 30/40, Good). |

## Design specificity verdict

**LLM assessment:** It's specific and has its own character. Four pastel scraps, a cream bookmark tag, a -6° tilt and a hard offset shadow belong to Keepsake's Pantry Pop world and look like nothing else on the home screen. Where the work fell short was the "everywhere" claim at the smallest sizes: the 16/32 px Mac slots shrank the whole tilted 1024 composition into a 9 px smudge.

**Deterministic scan:** `impeccable detect` on dashboard.html and popup.html found 8 findings: 2 marquee (skeleton shimmer), 2 repeating-stripes, 2 grid-background, 1 icon-tile-stack (popup empty state), 1 broken-image (`#heroImg`, filled by JS). None touch `.mark`, `.mark-patch` or `.mark-glyph`. All 8 are on lines this PR didn't change, so they are pre-existing and false positives for this review. The design hook also ran on the edited looks.css: clean.

**Visual overlays:** skipped, because the detector sub-agent had no browser tool. The mark was checked in the in-app browser by computed style and by a pixel-true canvas raster instead.

## What's working

1. **The small toolbar variant.** At 48 px and under the art sits straight, is scaled ×1.5 and uses heavier strokes (`tools/icons/style-icons.mjs:30-34`). icon32 and icon48 read clearly in both themes.
2. **The tinted rendition drops the shadow** (`noShadow`), so there's no grey halo. The scraps grey into four distinct tones with a white tag.
3. **One generator writes every asset**: iOS AppIcon and preview, toolbar, Mac app icon and picker tile (`make-style-icons.mjs` `writeAppAssets`). That made the P1 fix a two-line change.

## Priority issues

- **[P1] Mac app icon unreadable at 16 and 32 px. FIXED in code.** `renderMac` put the full tilted composition (cream field, tile at about 55%, shadow) inside the 824/1024 squircle, an icon within an icon. Finder list view, Spotlight and the Safari extensions list showed a smudge. Fix: `make-style-icons.mjs` now uses the approved straight, bolder toolbar art for Mac pixel sizes of 64 and under (16@1x/2x, 32@1x/2x). It's the same artwork with the same small treatment as the toolbar. See `mac-small-sizes-before-after.png`. Command: /impeccable polish.
- **[P2] Dark-theme mark outline inverted. FIXED in code.** The mark's border used `var(--c-line)`, which is cream in dark mode, around hard-coded ink seams (`#2A2420`). It read as a cream ring with dark seams inside, the reverse of the dark app icon (ink outline, cream shadow). Fix: `looks.css` now draws the outline in the icon's ink in both themes and keeps the shadow on `--c-line` (ink in light, cream in dark), matching the app icon. Command: /impeccable polish.
- **[P2] Default icon label keyed on array position. FIXED in code.** `ICONS = STYLES.map((s, i) => … i ? s.label : 'Keepsake')` would silently rename the wrong icon if STYLES were reordered. It's now keyed on `s.value === 'pantry'` (storage.js). The iOS core bundle was regenerated with `ios/tools/bundle-core.mjs`. Command: /impeccable harden.
- **[P3] Mark at 1x.** At 18 px inner size the bookmark tag is about 4 px and blurs. The mark is decorative (`aria-hidden`, with the name next to it) and sharp at 2x, which is the normal case on Mac. Possible follow-up: drop the tag below 24 px and let the four scraps carry the mark, as with the 16 px toolbar icon. Command: /impeccable polish.
- **[P3] "Keepsake" option and VoiceOver.** VoiceOver reads "Keepsake, Selected, button". That's fine, but it doesn't say the option is the original icon. A hint such as "The app's original icon" (AppearanceScreen.swift, ViewController.swift) would help. The visible label stays as Harold asked. Command: /impeccable clarify.

## Persona red flags

- **Sam (accessibility):** In forced-colors mode the mark's border becomes CanvasText while the SVG fills stay pastel. That's acceptable for a decorative logo, but there's no `@media (forced-colors)` rule. The VoiceOver hint is covered in P3 above.
- **Casey (mobile):** The iOS icon is solid. Picker targets are 68+8 pt with min-height 44. No issues.
- **Alex (power user):** Before the fix, Alex saw the 16 px smudge in Finder and Spotlight, where they meet the icon most. Also, iOS offers 4 icons and the Mac 5 (Gallery is still on the Mac, `ViewController.swift`). That's pre-existing.

## Minor observations

- The Patchwork SVG appears three times: `dashboard.html`, `popup.html`, and as the source in `style-icons.mjs`. Those copies will drift. The generator could emit the inline mark.
- `base.css` has two `.mark svg` size rules (20 px, then 13 px). The patch overrides both, but this is fragile.
- The Mac app icon has no dark or tinted appearance. Only the in-app picker tile has a dark variant. Consider an Icon Composer `.icon` later.
- Check the cream shadow on the dark iOS icon on a real device, since this simulator won't render dark icons.

## Questions to consider

1. Below 24 px, should "four scraps" alone be the brand, dropping the bookmark tag in both the toolbar 16 and the web mark?
2. Pantry Pop is tomato-bold, but its logo is now pastel. Should the style pick up the Patchwork palette anywhere, or is the contrast intended?
3. Should the art have its own name ("Patchwork") in the pickers, so every option names an icon rather than the product?

_Snapshot not persisted to `.impeccable/critique/`: this is a verification worktree and that folder is not part of the repo._
