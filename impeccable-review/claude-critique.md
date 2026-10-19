# Critique and audit (main 7d0a657)

Method: the /impeccable skill is not installed in this session, so this follows its critique and audit
structure by hand: screenshots of every main screen and state, an axe-core 4.10 scan of the dashboard and
popup in light and dark, and a read of tokens.css, Theme.swift and the UI copy.

## Hierarchy
- iPhone recipe: three floating layers at the bottom (Cooked stamp, Start cooking, Share stamp) sit on top of
  the ingredients, with the floating tab bar under them. The first ingredients are covered and faded.
- Chrome Review rows give eight controls equal weight (3 suggestions, "Somewhere else…", Details, Delete).
- Chrome Home has two search boxes (Home body and toolbar on other pages) and Review is a thin banner.
- Popup after saving: "Open in dashboard" carries a double focus ring at rest, so it shouts louder than "Saved".

## Consistency
- Two brands. Chrome ships Modern / Moss / Minimalist (cool grey, cobalt, sans); iPhone ships Postcard /
  Linen / Ink (warm paper, New York serif, postmark red). Different style names, palettes and type.
- Missing photos: Chrome draws a giant outline icon on a pastel flood (half the Library grid in the demo);
  iPhone draws a dashed empty frame. Neither looks intentional.
- Recipes and places open as an "Item details" edit form on Chrome; on iPhone they open as a reading view.
- Product cards have no kind chip on Chrome (they show the shop instead); every other kind has one.

## Accessibility
- axe: no contrast failures in either theme. 43 aria-allowed-role and 1 list violation per Library page
  (role="link" on li in the collection list and cards): screen readers announce broken lists.
- Placeholder initials on Review ("D", "S") measure 1.16:1 against their tile; decorative, but they read as broken.
- Popup buttons are 32px tall; below the 44px touch guidance if the popup is used on a touch screen.
- iPhone: VoiceOver walkthrough and Switch Control on hold-to-stamp still not done on a device (accessibility.md).

## Spacing
- Dashboard cards in the Library masonry have three different heights for text blocks; the grid feels ragged.
- Place edit form truncates its own fields ("United St", "Price, e.g").
- iPhone Library: Review banner, filter chips, search dock and tab bar stack four bands of chrome.

## Typography
- Chrome has no display face: page titles, card titles and nav share one sans in three weights.
- iPhone uses New York for names and SF for UI, which is good, but the collection cards push names to 28pt
  and the review banner to 20pt, so sizes don't follow one scale.
- Mono URL field in the Chrome edit form is the only mono on the page.

## Color
- Kind tints in dark mode turn muddy (brown book, brown place, purple video tiles).
- Chrome accent cobalt #2a5bd7 vs iPhone ink blue #24439A vs postmark red: no shared accent.
- Collection avatars mix photos and coloured letter tiles in the same list.

## Copy
- Em dashes in UI strings: "Not sure — leave for Review" (popup.js:293), "check the title and price before
  saving" warning, "Filed automatically — reason", keyword placeholder (dashboard.js:2904).
- Mixed names: "Review queue" (dashboard.js:569) vs "Review"; "Item details" (dashboard.js:2565);
  "Save item" (popup.html:168); "35 items" vs "28 saves".
- Empty Home says "Nothing saved yet" twice (heading and first sentence).
- Privacy line appears twice in the saved popup: "Saved on this device." and "Stored only in this browser".
- "Not enough signals to place this automatically" is system talk.
