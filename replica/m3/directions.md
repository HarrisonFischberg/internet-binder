# M3.0 review: three identity directions

Date: 2026-10-15 · Status: **waiting for the owner's choice.**

Open `prototypes/index.html` for the contact sheet (24 screenshots: Library, Place, Recipe and the Share
card, light and dark, per direction). The prototypes are static SwiftUI in `ios/Prototypes/`
(run the `KeepsakePrototypes` scheme; the palette menu switches direction and screen;
`ios/Prototypes/scripts/shoot.sh` re-renders every screenshot). Gradients stand in for real photos.

All three share the same structure, so the choice is about character, not features:
- one primary action per screen under the thumb (Library: search dock; Place: Directions;
  Recipe: Start cooking; Share card: the destination slip);
- hold-to-stamp for "Been", "Cooked" and check-ins;
- the share card says "Saved" first, then lets you flick the destination;
- kind colours appear on the object, never as floods.

Tokens: `tokens/<direction>.<light|dark>.json`, checked by `tokens/make_tokens.py`: 26 pairs per
file, all pass WCAG AA (156 of 156).

## A. Postcard

Paper things on a warm table. Every save is the object of its kind: a place is a postcard with a stamp,
a recipe a ruled card with a time tab, a film a ticket stub, a book a cover with a spine, a product a
photo with a swing tag, an article a torn clipping, a workout a punched training card. Names are in
New York (serif); actions are ink-blue; the "been" stamp is postmark red.

- **For:** the most *Keepsake*: the name's idea made visible, and nothing else on iOS looks like it.
  The objects also make kinds readable at a glance without colour.
- **Against:** the most work. Each kind has its own object, and every object needs care at AX5 text
  sizes and in a dense grid. Risk of feeling twee if overdone. Mitigated by keeping the table plain and
  the textures under 4% contrast.

## B. Cabinet

A collector's drawer. Saves rest in recessed trays with numbered specimen labels ("Place · No. 001"),
index tabs filter the drawer, a brass pull opens search. Condensed sans for names, mono for labels.

- **For:** the calmest grid (uniform trays scan quickly at 5,000 saves), strong in dark mode, very
  ownable "collection" feeling. Easiest to keep fast.
- **Against:** uppercase condensed type and mono labels are harder to read at large sizes, and the
  numbered labels suggest a precision the library doesn't need. Less warmth.

## C. Daylight

Photos first, under glass. Large rounded photos, Liquid Glass controls floating over content, SF Rounded,
cobalt actions. The closest to the Chrome extension's Modern style and to current iOS.

- **For:** cheapest to build and to keep current with the system; photos do the work; feels native.
- **Against:** the least distinctive: it could be any well-made iOS app. Saves without good photos
  (articles, links) look empty. The glass needs care over busy photos (tinted glass is used already).

## Recommendation

**Postcard as the identity, with Daylight's restraint for chrome.** The objects are what make Keepsake
feel like a beautiful thing you keep, and they carry the kind system without relying on colour. Chrome
(search dock, buttons, sheets) should stay quiet and native, as in Daylight, so the objects are the only
ornament. Cabinet's uniform tray grid is worth keeping as the **Compact** density option.

The three Chrome styles (Modern, Moss, Minimalist) would then become themes of the chosen direction
(table, paper and accent colours), not separate looks.

## What I need from you

1. Which direction (or mix)?
2. Is the share card's "flick the destination" slip right, or do you prefer a visible list of chips?
3. Keep the three Chrome style names as iOS themes, or new theme names for iOS?
