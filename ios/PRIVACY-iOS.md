# Keepsake for iPhone and iPad: privacy (draft for review)

Status: **draft**, to be merged into `keepsake/PRIVACY.md` (or published beside it) when the app ships.
Everything here matches the Chrome extension's promises; the differences are the platform's.

## What Keepsake stores, and where
- Your saves, collections, goals, check-ins, learned sorting and settings: in Keepsake's storage on this
  device (an App Group shared by the app, its Share Extension and its widgets). The same fields as
  Chrome's (`PRIVACY.md`, "What Keepsake stores").
- Your AI key: in this device's Keychain, available after first unlock, never synced, never exported.
- The AI change log: on this device, excluded from exports (as in Chrome).
- A snapshot for widgets (active goals, your latest save's title): in the App Group.
- Small copies (≤ 640 px) of your saves' pictures, made when a picture is first shown, so it stays if
  the site removes it: in the App Group. Not exported; erased with everything else.

## When Keepsake uses the network
Keepsake has no server, no account, no analytics and no advertising. It contacts:
- **The sites your saves came from**, to show their pictures, as a web page would.
- **Apple Maps** to draw maps of your places; **Directions** opens Apple Maps with the place's name and
  address (built from what's saved; nothing is looked up).
- **Optional AI** (off until you turn it on and add your own key): your chosen provider only, with the
  same payloads as Chrome (`PRIVACY.md`, "Optional AI").
- **Lookups** (each off until turned on): `nominatim.openstreetmap.org` (a place's name and city),
  `www.wikidata.org` (a film's title and year), `openlibrary.org` (a book's title and author); posters and
  covers load from Wikimedia Commons and `covers.openlibrary.org`.
Any other request is refused by the app itself (an allowlist built from your settings).

## Sharing into Keepsake
When you share a screenshot or photo, its text is read on this device (Apple's Vision) and a small copy
of the picture is kept with the save. Nothing is sent anywhere.

When you share a page from Safari, Keepsake reads that page in Safari to save its title, picture and
details (the same reader as Chrome's toolbar button). Nothing is sent anywhere.

## App Store privacy label (proposed)
**Data Not Collected.** Keepsake's developer receives nothing. AI and Lookups requests go from your
device to services you turn on, under their policies; to confirm against Apple's definitions before
submission.

## Your controls
Export your library (the same file as Chrome's export), import a Chrome export, Undo any AI change in
the change log, turn any feature off at once, or erase everything (typed confirmation).
