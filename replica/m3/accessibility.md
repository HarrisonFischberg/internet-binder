# Accessibility pass (M3.6)

Date: 2026-10-15. Tool: Xcode's accessibility audit (`UITests/AccessibilityTests.swift`) on Home, Library,
a Place and Places (iPhone 17 Simulator, Postcard light), plus the design rules in `quality bar`.

## Gate (fails the build): passing
Labels and descriptions, hit areas (44 pt), traits, text that VoiceOver can't reach.
Fixed by it: the place map's street names were unreachable text; the map is now one element,
"Map of ‹place›", with a hint to use Directions. Ignored: Apple Maps' own "Legal" link (system control).

## For a person to judge (reported, not gating)
These are measured on rendered pixels and trip on intended design. Reviewed one by one:

| finding | where | verdict |
| --- | --- | --- |
| Contrast | cards near the bottom of Library and Home | **intended**: content fades under the floating search dock and tab bar (scrim) so it doesn't collide with them; nothing there is meant to be read until scrolled up |
| Contrast | "Place" kind label, book-cover titles | **false positive**: computed ratios are ≥ 4.5:1 (kind on table, all themes, `tokens/make_tokens.py`) and ≥ 7:1 (white on cover); the auditor samples the paper grain and the spine shading |
| Text clipped | Recent shelf, cards running off the screen edge | **intended**: a horizontal shelf |
| Dynamic Type partly unsupported | Lifestyle tiles, LONGFORM label, "Been" stamp | **to check by hand**: all use scaling text styles; tiles no longer shrink text and the stamp grows with text size (`@ScaledMetric`). Verified visually at AX5 on Library (`screens/library-light-ax5.png`) |

## Still to do on a device, by hand
- A full VoiceOver walk-through: save from the Share Sheet, file from Review, cook a recipe, check in.
- Switch Control and Voice Control on the hold-to-stamp (single activation is provided).
