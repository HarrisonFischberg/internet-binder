Night Atlas: a dark-first, cinematic Keepsake where every save is a lamp-lit point on the map of your life, with one amber action per screen.

# Option 4 · Night Atlas

**Rationale.** Keepsake is mostly opened in the evening, on the sofa, to plan a trip, a dinner or a weekend. Night Atlas leans into that: a deep ink room where your own photos are the light source, metadata reads like coordinates on a chart, and one warm amber colour marks the single thing to do next (Sort, Start cooking, Open in Keepsake, the 1 key in Review). It replaces the two current looks (cool cobalt "Modern" in Chrome, warm paper "Postcard" on iPhone) with one identity that is the same on every surface. Saves with no picture stop being pastel icon tiles and become dark monogram cards with a thin dotted route in the kind's colour, so they look deliberate rather than missing. A "dawn" light mode keeps the same structure on warm paper for daytime and for people who never use dark mode.

## Key changes per platform

**iPhone**
- Home: date and save count in mono over a faint contour texture; the Review nudge is one glowing amber card with a single Sort button; Recent cards fade photos into the panel; Collections and Lifestyle are two rows with stacked thumbnails.
- One solid bottom bar (Home, Library, Places, Search). Search moves into the tab bar, so there is no floating search dock stacked over a floating tab bar.
- Save screens (recipe shown) hide the tab bar and keep exactly one bottom layer: a full-width amber Start cooking. Mark cooked, Share and Favorite move up to chips under the title, so nothing floats over the ingredients.
- Review: each card shows why Keepsake guessed; the confident first suggestion is filled amber, the others are outlined, and "Somewhere else…" / "Skip for now" are text links. When there is no strong match, no suggestion is highlighted.
- Places (not mocked): the map becomes the hero of the theme, dark map style with cyan pins; cyan is reserved for places everywhere.

**iPad**
- Same sidebar as the Chrome dashboard (Home, Library, Favorites, Review, Lifestyle kinds, Collections), dark panels, detail pane uses the Chrome reading layout (photo left, ingredients and steps right).

**Chrome and Safari extension**
- Popup: "Saved to [Home Decor ▾]" leads, the save card shows kind and shop in mono, price in mono, a note field, then Undo (secondary) and Open in Keepsake (amber). Footer keeps "Saved on this device".
- Dashboard: same tokens as iPhone; sidebar groups Lifestyle and Collections under mono labels; Review count is an amber badge; Library cards are uniform (photo or monogram, kind, title, one fact), with coordinates for places.
- A save opens as a reading view, not an "Item details" form: big photo, title, Start cooking, then ingredients and numbered steps. Edit is a secondary button that opens the form.
- Review: rows with numbered keycaps (1, 2, 3), the confident suggestion filled, a keyboard legend (↑↓ move, 1 2 3 file, S skip), Skip and a trash icon kept apart from the suggestions.

**Safari Mac app shell**
- The small container window adopts the same ink background, amber mark and one amber "Open Safari Settings" button; copy stays as is.

## What stays the same
Names and structure (Home, Library, Review, Lifestyle, Collections, Places), the kinds and their icons, the card anatomy (picture, kind, title, the one fact that matters), hold/tap to mark cooked or been, Undo after every change, keyboard shortcuts, on-device storage and the "Saved on this device" line, the bookmark mark (recoloured amber).

## Copy fixes
"Review queue" → "Review"; "Item details" → the save's own title; "Save item" → "Save"; "Not sure — leave for Review" → "Leave in Review"; no em dashes; "Somewhere else…" for the other-collection picker.

## Colour (all text pairs meet WCAG AA in their mode)
Dark: background #0B0F17, panel #141B27, raised #1B2433, text #EEF1F6, secondary #A3AEBF, amber #FFB547 (fills, with #1A1204 text), amber text #FFC266, places cyan #6FE3E8. Kind colours: recipe #FF9F7A, product #FFC266, book #C9A7FF, film #8FB3FF, video #FF8FB1, workout #9BE58A, article #E3D7BE.
Dawn (light): background #F3F1EC, panel #FFFFFF, text #12161F, secondary #4F5866, amber fill #FFB547 with dark text, amber text #8A5200, places #0B7A80; kind colours darkened to pass AA on white.

## Fonts (mockup stand-in → shipped)
- Space Grotesk (headings): bundled in the app and extension (OFL, local files, no CDN). Fallback on Apple: SF Pro Display.
- Inter (body): SF Pro Text on Apple; system-ui in Chrome.
- JetBrains Mono (coordinates, metadata): SF Mono on Apple; ui-monospace in Chrome (or bundle JetBrains Mono, OFL).

## Risks
Dark-first can feel heavy in bright daylight, so Dawn must be equally polished. Uppercase mono metadata needs care at large Dynamic Type sizes (switch to sentence case above XL). Glow effects must be turned off with Reduce Transparency.
