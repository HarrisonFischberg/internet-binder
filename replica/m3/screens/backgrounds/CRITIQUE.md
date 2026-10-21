# Themed page backgrounds — critique

Method: design review only (detector not applicable, native platform). /impeccable critique, iOS.

Scope: the new `TableBackground` materials in `ios/KeepsakeKit/Sources/KeepsakeUI/Theme.swift`
(PantryShelf, GraphPaper, AtlasChart, SwissGrid) at commit 23f956b, shot on an iPhone 17 Pro
simulator (iOS 27): Home, Review, Library, Recipe, Cooking, Places and Place in Pantry Pop,
Field Notebook, Night Atlas and Swiss Index, light and dark (`<style>-<mode>-<screen>.png`),
plus the carbonara cooking steps in Field Notebook and Field Notebook at Accessibility L text
(`notebook-light-large-text-cooking-step2.png`).

Note on the first run: the dark shots from `testEveryScreenEveryTheme` came out light, because
the app's own appearance setting overrode XCUIDevice's. The test now passes `-ksMode` the way
`testCookingSteps` already did, and the dark set was re-shot on the unchanged background code.

## Design health score (before)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | The backgrounds stay behind the content and never compete with the review banner, the badges or the selection state |
| 2 | Match system / real world | 3 | Each material belongs to its style (sunny shelf, graph paper, night chart, poster grid); in dark mode Pantry's mustard glow turns olive-brown |
| 3 | User control and freedom | 3 | Increase Contrast gives a plain page; nothing else needed |
| 4 | Consistency and standards | 2 | Hard seams: a horizontal edge under the status-bar scrim, and flat plates under the docked actions, the Select bar and the Places section header |
| 5 | Error prevention | 3 | Tiles and controls keep their hit areas; the page never takes taps |
| 6 | Recognition rather than recall | 3 | You can tell the active style from any screen, not only from the tiles |
| 7 | Flexibility and efficiency | 3 | Drawn once per page, fixed while tiles scroll; no extra cost per scroll |
| 8 | Aesthetic and minimalist design | 2 | Swiss's red disc is too big and the same red as the actions; Notebook's heavy lines fight the ruled rows at large text |
| 9 | Error recovery | 3 | No effect on error states |
| 10 | Help and documentation | 3 | No effect |
| **Total** | | **28/40** | **Good, held back by seams** |

## Design specificity verdict

Specific to this product. These are not generic gradients: each style gets a material that fits its
world. Pantry Pop has warm light from below and a halftone that gets bigger near the shelf, like
a printed jar label. Field Notebook has graph paper that warms and darkens at the edges. Night
Atlas has an amber lamp, sea, a globe graticule and, at night, stars. Swiss Index shows column
hairlines and one red disc. Fading every material out under the top bars is the right call. Where
it falls short is execution at the edges: every place the page meets a bar shows a seam, so the
materials look pasted on rather than like the table itself.

Contrast, measured on the shots (muted text tokens against the page, 6 px box-blurred so tiny
marks don't count): Pantry light 5.70:1 and dark 6.99:1, Notebook light 4.70:1 (6.13:1 on the
plain page) and dark 6.01:1, Atlas light 5.27:1 and dark 6.22:1, Swiss light 5.16:1 and dark
6.24:1. Everything passes AA; only Notebook light's darkened corners come close to the limit.

## What's working

- **Atlas, dark.** This is the best of the set. The amber lamp, the faint globe and the sparse stars
  read as a night chart without competing with a single tile. Light mode (Dawn) stays quiet
  and lets the Places map lead.
- **Pantry, light.** The halftone gets bigger towards the bottom, so the shelf feels weighted
  and the text at the top sits on clean paper.
- **Notebook dark.** Yellow lines on near-black look like a lamp-lit page, and the grid is
  quiet enough to sit behind dense lists.

## Priority issues

- **[P1] Hard seam under the status-bar scrim.** `TopScrim` is opaque table colour down to
  about 86 pt (status bar plus a 24 pt fade). The background mask starts fading in at 5% of the
  page height (about 44 pt), so by 86 pt the material is already partly visible and stops at a
  hard horizontal line. This is clearest on Notebook Home and Library (the grid starts abruptly
  above the large title) and shows on every list screen in every style. *Why it matters:* it
  looks like a rendering bug at the top of the most-seen screens. *Fix:* keep the page plain for
  a fixed 100 pt, then fade in over 180 pt, in points rather than a fraction of the height.
  *Command:* /impeccable polish.
- **[P1] Flat plates under docked bars.** The recipe and place dock (Start cooking, Directions),
  the Select bar and the pinned Places section header ("Portugal") each paint `t.table`. The
  halftone, the grid, the sea and the disc stop dead at the bar's rule, and the bar reads as a
  paler strip of a different paper. *Fix:* give bars a matching piece of the page
  (`TablePatch`): the same material, lined up with the page behind, so the bar still hides the
  tiles under it without leaving a plate. *Command:* /impeccable polish.
- **[P2] Swiss: the disc is too loud and uses the action red.** At 48% of the short side, the disc
  sits behind half of every screen, ingredient table and dock included. Red is Swiss Index's only
  signal colour and it means "act"; a 16% maroon disc in dark mode muddies that, and the red
  Next step button sits right on top of it. *Fix:* make it smaller (34%), push it into the
  corner and lighten it (7% light, 10% dark). *Command:* /impeccable quieter.
- **[P2] Pantry dark: the glows go muddy.** Mustard at 16% over the warm near-black turns
  olive-brown at the right edge of Library, Places and Recipe; it looks like a stain, not
  light. *Fix:* in dark mode, lighten the mustard (9%) and slightly lighten tomato and teal,
  and leave the halftone to carry the style. *Command:* /impeccable quieter.
- **[P2] Notebook: the grid competes with ruled rows and nearly breaks muted-text contrast.**
  At Accessibility L text, the major lines (15%) run through the struck-through ingredients and
  look the same as the list's own row dividers, so it is harder to see where a row ends. The
  edge vignette (11%) takes muted text from 6.1:1 to 4.7:1 in the lower corners. *Fix:* lighter
  lines (minor 6%, major 11%; dark 6% and 10%) and a 7% vignette. *Command:* /impeccable quieter.

## Persona red flags

**Sam (low vision, Accessibility L text, Field Notebook):** on Cooking step 2, the major grid
lines are as strong as the ingredient dividers, so struck-through lines and empty rows run
together. Increase Contrast fixes it, but Sam may not have it on.

**Riley (Swiss Index, dark mode, cooking in a dim kitchen):** the large maroon disc behind the
ingredient table and the red Next step button make the one red action less clear.

**Jordan (first-timer, Pantry Pop):** opens a recipe and sees the dock as a separate cream
strip cutting through the halftone, so it reads as an unfinished screen.

## Minor observations

- [P3] Atlas light (Dawn) is very faint; the globe is close to invisible. That is fine for a
  daytime mode, so it stays.
- [P3] Atlas dark stars can land under small text (1 px, about 2:1 locally). They are too small
  to affect reading.
- [P3] Chrome dashboard (`looks.css`): the Swiss disc and the dark Pantry glows have the same
  imbalance and should mirror the iOS fixes.

## Questions to consider

- Should the Swiss disc move by section (Places low left, Library low right) like a poster
  series, or does one fixed disc read better as a system?
- Would Pantry's halftone be better aligned to the tile grid, so dots never sit half under a
  tile edge?

Questions skipped: the brief already says to fix every P1 and P2.

---

## After the fixes

All P1 and P2 findings are fixed. The screens above were re-shot over the earlier ones: every
screen in all four styles, light and dark, plus the Field Notebook cooking steps and large text.

What changed:

- **Top seam (P1).** `TableSurface` keeps the page plain for a fixed 100 pt, below the status bar
  and `TopScrim` (about 86 pt), then fades the material in over 180 pt, in points instead of a
  fraction of the page height. The grid no longer starts at a hard line above the large title.
- **Flat plates (P1).** New `TablePatch`: every page background and every bar is a clipped window
  onto one surface the size of the app's window. `keepsakeAppearance` measures the window into
  `ksTableFrame`, so iPad columns, sheets and the Share extension line up too. The recipe and
  place dock, the Select bar and the pinned Places section header use it instead of `t.table`.
  The halftone, grid, sea and disc now continue under them, and the docks keep their top rule.
- **Swiss disc (P2).** The radius drops from 48% to 34% of the short side and the disc is tucked
  into the corner. Opacity is 7% in light and 10% in dark (was 10% and 16%), so it no longer
  sits behind the ingredient table or competes with the red actions.
- **Pantry dark (P2).** Mustard 16% → 9%, tomato 13% → 10%, teal 10% → 8%. The page reads warm,
  not olive.
- **Notebook (P2).** Minor lines 8%/7% → 6%, major lines 15%/13% → 11%/10% (light/dark), and the
  light vignette 11% → 7%. At large text the ruled ingredient rows now read above the grid.
- **Chrome dashboard (`looks.css`).** The same changes mirrored: Notebook lines 11%/6% →
  8%/4.5% and vignette 10% → 6%; the Swiss disc 26vmin at 9% → 18vmin at 6% (9% dark); and the
  Pantry glows drop to 12%/10% in dark through `--page-glow`, `--page-glow-2` and `--page-disc`.

Muted-text contrast after the fixes (same method as above): Pantry 5.67/7.98, Notebook 5.01/6.16,
Atlas 5.31/6.31, Swiss 5.40/6.68 (light/dark). Notebook light's worst spot went from 4.70:1 to
5.01:1.

## Design health score (after)

| # | Heuristic | Before | After | Note |
|---|-----------|--------|-------|------|
| 1 | Visibility of system status | 3 | 3 | |
| 2 | Match system / real world | 3 | 4 | The dark Pantry glow now reads as warm light |
| 3 | User control and freedom | 3 | 3 | |
| 4 | Consistency and standards | 2 | 4 | No seams under the scrim, the docks, the Select bar or the section headers |
| 5 | Error prevention | 3 | 3 | |
| 6 | Recognition rather than recall | 3 | 3 | |
| 7 | Flexibility and efficiency | 3 | 3 | |
| 8 | Aesthetic and minimalist design | 2 | 3 | The Swiss disc is a mark, not a block; the Notebook grid sits behind the rows |
| 9 | Error recovery | 3 | 3 | |
| 10 | Help and documentation | 3 | 3 | |
| **Total** | | **28/40** | **32/40** | **Excellent band** |

Left as P3: Atlas Dawn stays very faint on purpose, and the stars can still land under small
text. During a push transition, the page behind a sliding screen stays fixed to the window rather
than sliding with it; this reads as one table under moving content.
