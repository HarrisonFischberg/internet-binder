# Review card mockup: /impeccable critique

Method: design review only (detector not applicable, native platform). /impeccable's detector reads only web
markup, so on iOS the critique is the design review alone. I made it from the real SwiftUI rendered in an
iPhone 18 Pro simulator: Pantry Pop, light and dark, the demo library with 4 saves waiting in Review (3 of them pictured).

This is the throwaway branch `claude/review-card-mockup`. It is not for merging.

## What was built

The Share Extension's "Where does it live?" screen gets a full-width **Review** card under Collections and
Lifestyle. It uses the same card style (surface, radius, padding, title type) and replaces the dashed "Not sure?
Put it in Review" row. The card shows a fan of what's already waiting. That comes from `Library.waiting`, which
uses SQL like `Library.shelf`: no collection, no Lifestyle view, not purchased, pictures first, then newest.

- **A, one tap.** Tapping the card files the save in Review. The card then gets the ink outline and check, like a
  picked library card. Caption: "N waiting · Keepsake suggests a home later". When picked: "Waiting here with N others".
- **B, opens a page.** The card says "Not sure yet? Pick a home later" and "N waiting ›". Tapping it opens a Review
  page styled like a library's groups page: Back, "Review", and the subtitle "Not sure yet? It waits here until you
  pick a home". The page shows up to 6 tiles of what's waiting ("+N more" past 6) and a full-width "Put it in
  Review" button above Done. When the save is already in Review, the button reads "Waiting in Review" with a check.

The variant is picked with `-ksReviewCard A|B` on the app (Debug only). That writes `ks.mock.reviewCard` to the
App Group for the extension. `-ksShareMode light|dark` sets Appearance's mode, because the simulator's Safari keeps
its share sheet light whatever the device is set to. To shoot everything, run `shoot.sh` (it needs a local
`ReviewMockShots` scheme that tests KeepsakeUITests).

## Scores (Nielsen, 0 to 4)

"Before" scores the first build, at default text size and at accessibility XL. "After" scores the shots in this folder.

| # | Heuristic | A before | A after | B before | B after |
|---|---|---|---|---|---|
| 1 | Visibility of system status | 3 | 3 | 3 | 3 |
| 2 | Match with the real world | 3 | 3 | 3 | 3 |
| 3 | User control and freedom | 3 | 3 | 3 | 3 |
| 4 | Consistency and standards | 2 | 3 | 2 | 3 |
| 5 | Error prevention | 3 | 3 | 2 | 3 |
| 6 | Recognition rather than recall | 2 | 3 | 3 | 3 |
| 7 | Flexibility and efficiency | 2 | 3 | 1 | 2 |
| 8 | Aesthetic and minimalist design | 3 | 3 | 2 | 3 |
| 9 | Error recovery | 3 | 3 | 3 | 3 |
| 10 | Help and documentation | 2 | 3 | 2 | 3 |
| | **Total** | **26/40 Acceptable** | **30/40 Good** | **24/40 Acceptable** | **29/40 Good** |

## Findings, and what I fixed

1. **[P1, both] At accessibility XL, Done was pushed off the sheet.** The save object, two tall library cards and
   the new Review card overflowed. "Done" and "Add a note" were cut off, the heading truncated ("Where does it
   li…"), and the library titles broke mid-word ("Collec-tions"). The third card made this worse. I didn't shoot
   the old dashed row at XL, so I can't say how much of it was already there.
   *Fixed:* at accessibility sizes the save shows as its small card, the three choices become full-width rows
   (the fans drop out, the words take the width), and they scroll above a docked Done. Done is always on screen.
   It still isn't "three cards without scrolling": at XL, Collections fits and Lifestyle and Review scroll, with
   the next card peeking above Done. (`A-light-libraries-xl.png`, `B-light-libraries-xl.png`)
2. **[P1, A] The one line that explains Review was truncated.** It read "4 waiting · Keepsake suggests a ho…" at
   the default size, because the card was compressed under height pressure. *Fixed:* the card keeps its height and
   the caption wraps to two lines.
3. **[P1, B] Two primary actions on the Review page.** "Put it in Review" and Done were both filled slabs, black on
   black in light. My first fix used Review's mustard, but in dark mode Done is mustard too, so they matched again.
   The risk is real: tapping Done here keeps the save where it was, not in Review. *Fixed:* "Put it in Review" is
   now a raised, outlined card-button with the tray icon, and Done stays the screen's only filled slab.
   This departs from the brief's "full-width primary" on purpose.
4. **[P2, both] The picked Review card didn't say anything new.** The library cards swap their caption for where
   the save is; Review kept its generic caption. *Fixed:* when picked, the card reads "Waiting here with 4 others",
   and VoiceOver gets the same value.
5. **[P2, B] The B card didn't say what Review is.** It said only "Review · 4 waiting ›", so a first-timer couldn't
   tell it apart from a third library. *Fixed:* added "Not sure yet? Pick a home later" above the count, matching a
   library card's caption-plus-tally.
6. **[P2, B] The "Waiting in Review" state was muddy.** A highlight at 25 to 35% over the surface came out khaki in
   light and dark. *Fixed:* it's now a flat surface (pressed in, no shadow) with an ink outline and a filled check.
7. **[P2, B] Saves without a picture looked like broken images.** They showed as grey wells with a faint bag.
   *Fixed:* they get the kind's fill and symbol, the way a group tile draws an empty cover.

Not fixed (P3):
- The Review fan holds products, so at a glance it looks like a third Collections. The tray icon only appears when
  nothing is pictured. A small tray badge on the fan would mark it as Review.
- Tile titles on the B page truncate after one line ("Glass pour-over c…"). That's fine for recognition but loses
  information.
- The mustard tile for an unpictured product is loud next to the photos.
- "N waiting" leaves out the save being shared, the same way group counts do ("not counting this one"). Once it's
  picked, "with 4 others" covers it.

## Which reads better

**A.** Review is a destination, not a library. It has no groups to choose between, so a page in front of it adds a
tap and a screen that only confirms what the card already said. A makes Review exactly as easy as Keepsake's own
pick, and the fan plus "N waiting" already shows what's there. B's page is pleasant, and seeing what's waiting
reassures you a little. But it's the only place in the sheet where a card opens a page with a single action on it,
and it creates the two-button problem in finding 3. That's why B still scores 2 on efficiency after the fixes.
If seeing the waiting saves matters, put them in A's caption or the fan; don't add a page.
