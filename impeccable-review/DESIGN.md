# DESIGN.md (draft for review, not yet in the repo)

Describes the system as it is today (main 7d0a657), so a refresh has a baseline.

## Today there are two design systems
| | Chrome / Safari extension | iPhone / iPad |
| --- | --- | --- |
| Styles | Modern (default), Moss, Minimalist | Postcard (default), Linen, Ink |
| Source | keepsake/src/shared/tokens.css | ios/KeepsakeKit/Sources/KeepsakeUI/Theme.swift |
| Feel | cool grey, cobalt accent, Inter-like system sans | warm paper table, New York serif names, ink blue, postmark red |
| Kinds | pastel tint floods + outline icon | the object of its kind (postcard, ruled card, ticket) |
| Missing photo | large icon on a pastel tile | dashed empty frame |

## Shared vocabulary (keep)
Saves, collections, kinds, Lifestyle (kind views), Review, Favorites, Purchased, Come back to,
"Saved on this device", Undo after every change, kind icons, the confidence pill.

## Tokens to unify
Role names already match in spirit (surface, ink, muted, accent, stamp, rule). A refresh should publish
one token set with light and dark per style and generate both tokens.css and Theme.swift from it
(replica/design/build_tokens.py already does this for the three Chrome styles).

## Type
Apple: SF for UI, New York for names (Dynamic Type). Chrome: system stack. No remote fonts; anything
custom is bundled.
