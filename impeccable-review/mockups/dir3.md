Pantry Pop: a bold, tactile pantry of labelled jars, where every kind of save owns one bright colour and every button feels pressable.

# Option 3: Pantry Pop

**Rationale.** Keepsake is where good finds get put away, so this direction treats the library like a well-stocked pantry: cream shelves, thick ink outlines, hard shadows that squash when you press, and one saturated colour per kind (tomato recipes, teal places, mustard products, grape films, sky books, lime workouts, pink videos, orange articles). Colour does the sorting, so a mixed library scans at a glance, and a save without a picture stops being an empty pastel tile: it becomes a solid jar label with its title set big. It is the most playful option and the most "app with a personality" (in the spirit of the Not Boring apps, nothing copied), and it gives Chrome and iPhone one shared look for the first time. Kind colours always carry ink text (#16130F), which passes WCAG AA on every block in light and dark.

## Key changes per platform

**iPhone**
- One docked tab bar (Home, Library, Places, Search) with a mustard pill for the current tab; no floating glass layers stacked on content.
- Home: big Bricolage title, a mustard nudge "3 saves need a collection", Recent and Come back to as chunky cards with rotated kind stickers, and two colour tiles for Collections and Lifestyle.
- Library: search at the top, kind chips in their own colours, a two-column grid where no-image saves are full-colour jar labels.
- Recipe: tabs hidden; one docked tomato "Start cooking" button at the bottom edge, with nothing floating over the ingredients. "Cooked it" and "Share" become small secondary pills under the title.
- Review: each save gets one filled best guess (one tap files it), two outlined alternatives, and quiet "Another collection…" and "Skip for now" text links.
- Press feedback: shadows collapse from 4 pt to 0 on touch-down (the card moves into its shadow), paired with the existing haptics.

**iPad**
- Same components in the existing split view; the sidebar uses the Chrome dashboard's sidebar (ink-filled current row, kind colour dots, collections).

**Chrome and Safari extension**
- Popup: "Saved!" with a lime check sticker, the save on a bordered card, "Saved to Home Decor" as a mustard dropdown pill, a dashed note field, then "Open in Keepsake" (primary, ink) and "Undo". Footer keeps "Saved on this device".
- Dashboard: cream background replaces cool grey and cobalt; sidebar with Review badge in tomato, Lifestyle kinds with colour dots, Collections, Settings at the bottom; kind filter chips in their own colours; five-column grid of the same cards as iPhone.
- A save opens as a reading view, not an "Item details" form: big photo, title, source, Start cooking as the only filled button, then Cooked it, Visit page, and Edit as a quiet text button. Ingredients and steps sit side by side.
- Review: one filled suggestion per row with 1/2/3 key hints, the selected row outlined in mustard, Open and Skip as text, and "Undo with ⌥Z".
- Safari uses the same web pages, so it gets all of this for free.

**Safari for Mac app shell**
- The container window gets the cream background, the tomato jar logo, and one ink "Open Safari Settings" button in the same chunky style.

## What stays the same
Names (Home, Library, Review, Lifestyle, Collections, Favorites), information architecture and navigation, the kind set and kind icons, the one-fact-per-kind card rule, Undo after every change, the "Saved on this device" privacy line, keyboard shortcuts (/, 1/2/3, ⌥Z), and Dynamic Type scaling.

## Fonts
- Titles: Bricolage Grotesque ExtraBold (would be bundled in the app and extension; no CDN fonts at runtime). Fallback if bundling is unwanted: SF Pro Rounded Heavy on Apple, system-ui 800 on Chrome.
- Body and controls: Nunito stands in for SF Pro Rounded (system on Apple; Chrome would bundle Nunito or fall back to system-ui).
- Key hints: JetBrains Mono stands in for SF Mono.

## Copy changes in these mockups
"Save item" becomes the instant "Saved!"; "Review queue" and "Item details" go away (it's Review, and a save just opens); "Not sure — leave for Review" becomes "Another collection…" / "Skip for now"; no em dashes.

## Colour
Light: cream #FFF7E8, card #FFFFFF, ink #16130F, muted #5B5348. Dark: charcoal shelf #1B1A17, card #26241F, cream text and outlines #FFF7E8, muted #CFC6B4. Kind blocks are identical in both modes and always carry ink text.
