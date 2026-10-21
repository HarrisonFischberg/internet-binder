# Impeccable critique: Select mode, right-click menus, bulk delete (Chrome dashboard)

Method: design review of the committed screenshots in this folder (Pantry Pop, light and dark) and the code
in `keepsake/src/dashboard`: the selection section of `dashboard.js` (`enterSelection`, `updateBulkbar`,
`selectBox`, `bulkDelete`), `bindContextMenu`, `itemMenu`, `collectionMenu`, `deleteCollections`, and the
`.select-toggle` and selection CSS at the end of `dashboard.css`.

The mechanical detector (`impeccable detect`) and the live overlay weren't run: the dashboard is an extension
page that needs Chrome's extension APIs to render, and there's no Chrome on this Mac to load it. The
screenshots were the visual evidence instead. ⚠️ Single context: no separate detector pass.

## Design Health Score

| # | Heuristic | Before | After | Key issue |
|---|-----------|--------|-------|-----------|
| 1 | Visibility of System Status | 3 | 3 | The bar's count ("2 collections selected", "Tick saves to move or delete") and Delete N keep state visible; disabled actions are visibly dimmed. |
| 2 | Match System / Real World | 3 | 3 | Select / Done beside the title, Select all / none, right-click = the card's ⋯ menu: Finder / Photos conventions. |
| 3 | User Control and Freedom | 4 | 4 | Every delete goes to an 8 s Undo toast; Escape leaves Select mode; Delete with saves inside asks keep-or-delete in a menu, not a modal. |
| 4 | Consistency and Standards | 3 | 3 | Right-click and long-press open the exact ⋯ menu; Select appears in it only where Select mode exists. |
| 5 | Error Prevention | 3 | 3 | Delete is disabled until something is ticked; the long press swallows the click that follows it. |
| 6 | Recognition Rather Than Recall | 3 | 3 | Menu verbs name their action ("Delete them and their 3 saves"). |
| 7 | Flexibility and Efficiency | 4 | 4 | ⌘A / Ctrl+A, Delete / Backspace, Escape, right-click Select to start with one ticked. |
| 8 | Aesthetic and Minimalist Design | 2 | 3 | On a card without a photo the tick box sat on top of the kind-icon tile and looked doubled (Library grid and collection pages, light and dark). |
| 9 | Error Recovery | 2 | 3 | The toast's Undo was the highlight colour: about 3:1 on the light toast and about 1.5:1 (yellow on cream) on the dark one, so the recovery path was the hardest thing to read. |
| 10 | Help and Documentation | 3 | 3 | The empty bar tells you what to do; checkboxes carry "Select <title>" labels. |
| **Total** | | **30/40** | **32/40** | **Good** |

## Design specificity

It belongs to this product: the bar's pills are Pantry Pop's outlined pills, Delete N uses the danger
tint, selected collection tiles take the accent ring with an offset, and the menus reuse the same icons
and order as each card's ⋯ menu. Nothing in it reads as generic.

## What's working

- **One menu, three ways in.** The ⋯ button, right-click and press-and-hold all open the same menu. The
  long press swallows the click that follows it, so a save isn't opened as well.
- **The delete choice only appears when it matters.** Deleting empty collections happens straight away with
  Undo; collections with saves offer "keep the saves" or "delete them and their N saves" in a menu anchored
  to the button.
- **Keyboard first.** ⌘A, Delete and Escape cover the whole flow without a pointer.

## Priority issues

1. **[P1] Undo was hard to read.** `.toast-action` used `--brass` (the highlight colour) on the toast's ink
   background: about 3:1 in light mode and about 1.5:1 in dark, where the toast turns cream and the yellow
   all but disappears. Fix: the action uses the toast's own text colour (`--paper`), bold, with a 45 %
   outline; hover tints with the same colour. *Fixed.* This applies to every toast action (Undo, Open…).
2. **[P2] Doubled tick box on cards without a photo.** The 22 px tick sat over the 30 px kind-icon tile in
   the same corner. Fix: while selecting, the kind-icon tile is hidden (`.card.selecting .pic-kind-icon`),
   so the tick stands alone. *Fixed.*
3. **[P3] Selected yellow cards in dark mode.** The accent ring is yellow, the same as a product card; the
   2 px offset against the dark page keeps it readable. *Left alone.*

## Persona red flags

- **Alex (power user):** fine. ⌘A, Delete and Escape work, and so does right-click → Select. There's no
  shift-click to tick a range.
- **Sam (keyboard / screen reader):** checkboxes are labelled; the long-press path is touch-only, and the ⋯
  button is its keyboard alternative.

## Left alone, and why

- **No shift-click range selection.** That's new behaviour, not polish.
- **Native checkboxes** (tinted with `accent-color`) rather than drawn ones. They're reliable, follow the
  accent in every style and come with keyboard support for free.
- **Selected ring on yellow cards in dark mode:** readable thanks to the offset gap (see 3 above).

## What changed

- `keepsake/src/dashboard/dashboard.css`: `.toast-action` colour, weight, outline and hover; while
  selecting, `.card.selecting .pic-kind-icon` is hidden.
- npm test after the changes: 376 tests, 374 pass, 0 fail, 2 todo (known `parsePrice` limitations).
- The screenshots in this folder show the UI **before** these two CSS fixes. With no Chrome on this Mac
  I couldn't load the extension to retake them.

Questions skipped: the brief asked for the clear in-scope fixes to be applied without a round of questions.
