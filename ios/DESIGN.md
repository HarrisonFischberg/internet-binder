# Internet Binder for iPhone and iPad: the design that ships

Direction: **Divider Tabs**. The app is one ring binder. Every page is a punched sheet with a margin
rule, filed behind an index tab; saves and groups are ruled index lines you can scan. The three looks
(Nocturne, Paper & Ink, Chromatic) are unchanged: each still supplies every colour, the display face
and the moving page under the sheet. The direction supplies structure, components and the binder motif.

Code: `KeepsakeKit/Sources/KeepsakeUI/Binder.swift` (the sheet, tabs, lines and their measurements),
`Theme.swift` (the looks, type roles, the page), `Controls.swift` (buttons, chips, motion tokens in
`Haptics.swift`). Colour tokens come from `replica/design/tokens/*.json` through
`ios/tools/make-style-tokens.py`; `tests/design-tokens.test.mjs` checks every text pair for WCAG AA,
including the pairs this direction added (kind text on the sheet, on its soft tint and on its fill;
the accent and the stamp colour on the sheet).

## Structure

| piece | what it is | where |
| --- | --- | --- |
| Page (`TableBackground`) | the look's own material, behind everything | every screen |
| Sheet (`BinderSheet`) | the one container: the card colour, ring holes down a ruled margin | every page of saves |
| Tab (`IndexTab`) | the page's name, joined to the sheet's top left | above every sheet |
| Page (`BinderPage`) | tab + a quiet note + controls beside the tab + the sheet | Library, Search, Review, Collections, a collection, Lifestyle, every save |
| Index line (`SaveRow`, `GroupRow`) | picture 52, whole name, kind and one fact or its state | every list |
| Rule (`SheetRule`) | a hairline from the margin to the sheet's right edge | between lines and under headings |
| Note (`.sheetNote`) | a tinted block set into the sheet, no outline | what needs you, hints, a workout's goal |

Home is the binder's front page: the Recent sheet under a row of tabs (To file, Collections, Lifestyle,
then each kind that has saves, most first). The tabs open the real pages. A kind's pages and every save
of that kind sit behind the kind's **filled** tab (the divider); neutral pages have a **front** tab in
the sheet's own colour; tabs behind the front one take their kind's soft tint.

Nothing is boxed inside the sheet. Sections are a heading (`SheetHeading`) over a rule; the only tinted
blocks are notes. Things that float over other content (the Undo toast, the AI progress bar, the place
card over the map, the docked primary button, glass header buttons) keep their own surfaces.

## Measurements (`KSBinder`)

4 pt grid. Page margin 16. Margin gutter 40, then 12 to the writing; 16 to the sheet's right edge.
Holes 16 across, the first 52 down, then every 208. Index line at least 68 tall, picture 52.
Tabs at least 38 tall, the front and filled ones 44.

Shape rule: tabs round their top corners only (10); the sheet 14, square where the front tab joins it;
pictures 6; notes 10; controls are capsules. Nothing else has a corner of its own.

At accessibility text sizes the punched margin folds away so words get the sheet's full width, names
wrap instead of truncating, notes beside a tab move onto the sheet, a page's controls sit above its
tab, Home's tabs wrap onto rows above Recent, and "File them" drops under its sentence.

## Type

System faces only, all Dynamic Type roles (`KSFont`): the look's display face (SF Rounded for Nocturne
and Chromatic, New York for Paper & Ink) for the wordmark, section headings (`section`, title 2) and a
save's name on its own page (`name(.title)`); SF Pro for everything on a line. A line's name is body
semibold; its kind and fact are footnote; tabs are subheadline semibold; counts use tabular digits.
Sentence case everywhere, no tracked capitals.

## Colour

One accent per look (amber, terracotta, lilac). It is spent on: the one filled control on a page
("File them", the docked primary button), "Needs a collection", the margin rule (40%), and selection.
Kind colours sort content and never mark actions: a kind's symbol and word on its line, its soft tint
on a tab behind, its fill on its divider tab. The stamp colour marks done ("Cooked", "Been", a ticked
ingredient). Every state is a word or a symbol as well as a colour.

Pressed: an index line tints from the margin to the sheet's edge (7% ink) and nothing moves; buttons
and tabs keep the existing 0.97 press.

## States

- Loading: Home and Places draw lines the size of real ones until the library is read.
- Empty: `EmptyNote` on the sheet, one sentence and at most one action.
- Error: the library's problem is said on Home's and the Library's sheet.
- Selecting: lines show a tick at the right; the selection bar floats at the bottom as before.
- Done: the picture is desaturated and the line says the kind's own verb with a check.
- Waiting to be filed: "Needs a collection" on the line, the strip at the top of Home and the Library.

## Motion

Unchanged tokens (`KSMotion`). Tabs are navigation links, so they push with the system transition; a
save still zooms open from its line. Lines answer a press with a tint (no scale), which fades back in
0.2 s. Reordering Recent, collections and Lifestyle views is the same press-hold-and-slide, now up and
down. Reduce Motion needs nothing extra here: the tint is not movement, and the existing fallbacks
(cross-fades for the toast, selection bar and review rows) are untouched.

## What does not carry the binder (on purpose)

- Cooking mode: a full-screen, hands-busy view with its own layout per look.
- Settings and the collection editor: system forms in the look's colours.
- The map (Places and a place's page) and the cards that float over it.
- The Share Extension's sheet and the widgets: compact surfaces that keep the save card and group tiles
  (`SaveObject`, `GroupTile`), which stay in the kit for them and for drag previews.
