# Review card (variant A, one tap): /impeccable critique of the final build

Method: iOS, a design review only (the detector reads only web markup). Chrome popup, a design review plus
`impeccable detect` on popup.html. iOS shots come from the real Share Extension, opened from Safari on an iPhone 17
simulator (iOS 27): Pantry Pop on the demo library, by `ScreenshotTests/testShareCard`. The accessibility-XL shots
come from a one-off test that isn't committed. The popup is the real popup.js rendered in jsdom with the fake
chrome.* (as in tests/popup.test.mjs), with two saves waiting in Review, then viewed at 400 px.

## Shots

| File | What it shows |
|---|---|
| pantry-light-share-libraries.png, pantry-dark-share-libraries.png | A new share. It starts in Review, so the card has the check: "Waiting here with 2 others" |
| pantry-light-share-review-unpicked.png | Filed in Coffee corner. Review is unpicked: "2 waiting · Keepsake suggests a home later" |
| pantry-light-share-review.png | After one tap on Review: check, "Waiting here with 2 others", and the subtitle "For now it's waiting in Review" |
| pantry-light-share-libraries-xl.png, -xl-scrolled.png | Accessibility XL: one card per row, scrolling above Done. Review is reached by scrolling |
| the rest | The rest of testShareCard: Collections, Lifestyle, the "Saved to" notice and the save it opens |

## Scores (Nielsen, 0 to 4)

| # | Heuristic | iOS | Popup | Note |
|---|---|---|---|---|
| 1 | Visibility of system status | 4 | 3 | iOS: the check, the caption and the subtitle all say Review. Popup: the subtitle stays "Keepsake isn't sure yet." |
| 2 | Match with the real world | 3 | 3 | "Waiting here with 2 others" reads like a place, not a queue |
| 3 | User control and freedom | 3 | 3 | Undo and re-picking both work. One tap changes the destination without confirming, which is right here |
| 4 | Consistency and standards | 3 | 3 | Drawn like the libraries. The missing chevron tells you it files the save rather than opening a page |
| 5 | Error prevention | 3 | 3 | |
| 6 | Recognition rather than recall | 3 | 3 | The fan shows what's waiting, but only pictured saves: "2 waiting" over one tile |
| 7 | Flexibility and efficiency | 3 | 3 | One tap, down from two in variant B |
| 8 | Aesthetic and minimalist design | 3 | 3 | Gap after a short fan. The caption is 2 lines unpicked and 1 line picked |
| 9 | Error recovery | 3 | 3 | Undo in the header |
| 10 | Help and documentation | 3 | 3 | VoiceOver hint "Puts it here until you pick a home." |
| | **Total** | **31/40 Good** | **30/40 Good** | The mockup's variant A scored 30/40 |

Detector (popup.html, 5 hits): none are in the Review card. The hits are icon-tile-stack (the "Nothing to save
here" state), broken-image (an `<img>` the script fills in), marquee (the loading skeleton's shimmer), and two
advisories (stripes, grid). All of them were there before this branch, so I left them alone.

## Findings, and what I fixed

1. **[P2, fixed] The screenshot test's Review tap proved nothing.** A new share already starts in Review, so
   `testShareCard` tapped a card that was already picked. `review.isSelected` passed without the tap doing
   anything, and "-share-review" looked the same as "-share-libraries".
   The test now files the save in the first collection, asserts Review is *not* selected, shoots
   "-share-review-unpicked", and then taps. So the selection assertion now tests the tap.
2. **[P3] The sheet shifts about 6 pt when you pick Review.** The unpicked caption ("2 waiting · Keepsake suggests
   a home later") wraps to two lines. The picked one ("Waiting here with 2 others") fits on one. A shorter unpicked
   caption, for example "2 waiting · sorted later", would fix it, but that's a copy decision, so I left it.
3. **[P3] "Waiting" is said twice.** When picked, the subtitle says "For now it's waiting in Review" and the card
   says "Waiting here with 2 others". It's harmless, but the card could say "Here with 2 others".
4. **[P3] The fan reserves room for three tiles.** With one or two pictured saves, there's an empty gap before
   "Review" (both iOS and the popup, whose fan is 92 px wide). Sizing the fan to its tiles would line the title
   up closer.
5. **[P3, popup] The subtitle doesn't follow the pick.** iOS changes it to "For now it's waiting in Review". The
   popup keeps "Keepsake isn't sure yet." after you pick Review.
6. **[P3, already there] At accessibility XL, "Add a note" wraps to two lines,** with its icon pinned to the top.
   The Review card itself is fine at XL: a full-width row, caption on two lines, and nothing clipped.

No P1s. The only P2 was the test, and it's fixed.
