Swiss Index: a precise, numbered index in hairlines and one signal red, built to stay calm at thousands of saves.

# Option 5: Swiss Index

**Rationale.** Keepsake's promise is a tidy, private library that sorts itself, and the International Typographic Style is the visual language of tidy systems: a strict grid, flush-left type, hairline rules and nothing decorative. Every save gets a permanent index number (No. 026), so the library reads like a well-kept catalogue rather than a feed, and the number doubles as the fallback "picture" when a save has none. Colour is reserved for one job: signal red marks the primary action and anything that needs you (Review counts, the Home nudge, Start cooking). Kinds become small typographic labels instead of pastel floods, which makes a mixed library scan faster and lets photos carry the colour. The same tokens, type and components run on iPhone, iPad, Chrome, Safari and the Mac shell, so Keepsake finally looks like one product.

## Key changes per platform

**iPhone**
- One identity with Chrome: off-white #FAFAF7 / black ink / red #D92D20, square corners, 1 px rules instead of cards and shadows; dark mode is inverted (#0D0D0D, red lifted to #F04438 for contrast).
- Home: big condensed title, a ruled nudge row with a huge red count ("2 saves need a collection · File"), Recent as three uniform cells, Collections and Lifestyle as index rows with large numerals, Come back to as a numbered list. Solid tab bar (Home, Library, Places, Search) with a hairline top; no floating glass layers.
- Library: dense numbered list by default (No., thumbnail or kind code, title, one fact, kind label), grid optional; search sits at the top; kind filters are a text tab strip with counts.
- Recipe: one bottom bar, one layer: Cooked and Share as square secondary buttons either side of a red Start cooking. Tab bar hides on detail, so nothing covers the ingredients. Ingredients are numbered rows; a three-cell fact strip (ingredients, steps, times cooked).
- Review: a red count, then each save with its best guess as a filled black button and two alternatives as outlined buttons; Other collection and Skip as quiet text.

**iPad**
- Same as the Chrome dashboard layout: sidebar with counts in mono, a strict 6-column grid or dense list, and the reading view's two-column recipe. Keyboard shortcuts from Chrome (1/2/3, S, ⌫) also work with a hardware keyboard.

**Chrome / Safari extension**
- Popup: "Saved" in big condensed type with the new index number, the item row, then a two-row field table (Collection with Change, Note), Undo + a red Open in Keepsake, footer "Saved on this device" with the shortcut.
- Dashboard: sidebar of text rows with counts right-aligned (Review count in red, active row marked by a red edge), the page title and a huge count set as a pair, filters written as "Kind All ⌄" text, a hairline grid of uniform cells. No-image saves become a typographic cell: kind label plus the save's big index number.
- A save opens as a reading view, not an "Item details" form: title, Start cooking (primary), Mark cooked, Share, Edit (quiet); ingredients and steps in two columns; a metadata table under the photo. Edit opens the form only when asked.
- Review is a table: No., save, three suggestions with key caps (best guess filled), Other / Skip; the selected row has a red edge and a tint; a keyboard legend sits under the table.

**Safari Mac app shell**
- The container window uses the same type and rules: condensed "Keepsake", one numbered list of the three setup steps, and one red button (Open Safari settings).

## What stays the same
Structure and names (Home, Library, Review, Lifestyle, Collections), the kinds and their facts, one-tap filing with three suggestions, Undo after every change, hold-to-stamp interactions, privacy line "Saved on this device", all data and features. Photos stay full colour.

## Copy changes
"Review queue" and "Item details" go; it's Review everywhere and the save's own name. "Save item" becomes Save. "Not sure — leave for Review" becomes "Leave in Review". Reasons are written for people: "Your keyword “dutch oven” is in the title", "Nothing on the page said what this is".

## Fonts (mockup stand-ins → shipped)
- Archivo Condensed (headings, big numerals) → SF Pro Display Condensed via `.width(.condensed)` on Apple (iOS 16+); on Chrome, Archivo bundled in the extension (local file, no CDN), falling back to system-ui.
- Archivo normal (buttons, labels) → SF Pro Text / SF Compact.
- Inter (body) → SF Pro Text; Chrome keeps system-ui, Inter bundled optional.
- IBM Plex Mono (index numbers, counts, key caps) → SF Mono; Chrome uses ui-monospace.

## Contrast
Light: ink #0A0A0A on #FAFAF7 19:1; muted #5C5C56 6.6:1; red #D92D20 4.6:1 as text and 4.8:1 for white on red. Dark: #F5F5F0 on #0D0D0D 18:1; muted #A3A39C 7.6:1; red #F04438 5.2:1, #0D0D0D on red 5.2:1. All pass WCAG AA.
