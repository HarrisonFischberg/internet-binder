Gallery: a quiet museum for your finds, photos edge to edge, big serif titles, wall-label captions, and black as the only accent.

# 2. Gallery

## Rationale
Keepsake is where good finds are kept, so let the finds be the whole show. Gallery takes the interface out of the way: white walls, photographs edge to edge, titles set large in a display serif, and small sans captions that read like wall labels ("Place · San Francisco"). There is no brand colour. Black is the accent, a filled black rectangle is the one primary action on any screen, and links are a single thin underline. That restraint fixes the current split between Chrome (cool grey and cobalt) and iPhone (warm Postcard), because both become the same gallery. Saves without a picture stop being pastel icon tiles and become typographic plates: a soft tinted field with the one detail that names the save (the author, the city, the year) set like a title page. Dark mode is the gallery after hours, near-black walls and warm white type.

## Key changes per platform
- **iPhone:** Large serif screen titles; text-only tab bar (Home, Library, Places, with search at the end) on a solid bar with a hairline, never floating over content. Home leads with the latest save full-bleed, then a row of three, then Collections and Lifestyle as ruled index lines, then Come back to as an edge-to-edge strip. The Review nudge is a ruled line with a "File them" link, not a coloured banner. Save screens hide the tabs and put one solid action bar at the bottom (Start cooking, plus Cooked); Share and more move to the top bar, so nothing floats over the ingredients. Review gives the first suggestion a filled button, the other two outlines, and Other collection / Skip as text.
- **iPad:** Same as iPhone in a split view: text sidebar like the dashboard, grid in the middle, the save as a reading page on the right.
- **Chrome / Safari extension popup:** The saved state is a small exhibit: the product photo on a light field, "Saved" caption, serif title, price and shop, a ruled "In Home Decor" row you can change, a ruled "Add a note" row, then Open in Keepsake (black) and Undo (outline). Footer: "Saved on this device" and a Settings link.
- **Chrome / Safari dashboard:** Text-only sidebar with tabular counts and small-caps section labels. Library is a four-column wall of photos and plates with wall labels; kind filters are underlined text, not chips. A save opens as a reading page (photo left, title, Start cooking, Cooked, Share, Edit, Open page, then ingredients and numbered steps), not an "Item details" form; Edit is a secondary action. Review is a ruled list with 1/2/3 keyboard hints, the selected row marked by a black edge.
- **Safari Mac app shell:** The welcome window adopts the same white wall, serif "Keepsake" and one black "Open Safari Settings" button.

## What stays the same
Information architecture and names (Home, Library, Review, Lifestyle, Collections, Places), every feature and flow, the kind set and the one fact per kind under each title, hold-to-stamp interactions (the stamp becomes a small black mark), Undo after every change, "Saved on this device", system light/dark.

## Fonts
- Display serif: Instrument Serif stands in. On Apple it maps to New York (system serif, large title optical size); a bundled Instrument Serif in the extension is an option, shipped locally, never from a CDN.
- Captions, UI and body: Inter Tight stands in for SF Pro (Apple) and the system UI font (Chrome).

## Colour (all text passes WCAG AA)
Light: wall #FFFFFF, ink #111111, caption #5E5E5E (6.4:1), rule #E4E4E4, plates in eight barely tinted neutrals. Dark: #0E0E0E, ink #F2EDE4, caption #A7A196 (7.5:1), rule #2A2927.
