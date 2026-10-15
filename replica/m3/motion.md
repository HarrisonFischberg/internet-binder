# Motion specs

Date: 2026-10-15 · Status: **for review at M3.0.** Springs only, named by what they move. Nothing moves
without a reason: it shows where something came from, where it went, or that it answered your touch.

## The springs

| name | SwiftUI | used for |
| --- | --- | --- |
| `press` | `.spring(response: 0.22, dampingFraction: 0.7)` | press-down / release of any control or card (scale 0.97, shadow tightens) |
| `settle` | `.spring(response: 0.38, dampingFraction: 0.82)` | things landing: a card into a collection, the share slip into its slot |
| `lift` | `.spring(response: 0.3, dampingFraction: 0.65)` | picking a card up (scale 1.03, shadow grows, 2° tilt toward the finger) |
| `sheet` | `.spring(response: 0.42, dampingFraction: 0.88)` | the share card rising, detail opening from its card (matched geometry) |
| `stamp` | `.spring(response: 0.18, dampingFraction: 0.5)` | the stamp landing at the end of a hold (overshoot reads as weight) |
| `heavy` | `.interpolatingSpring(mass: 1.6, stiffness: 180, damping: 18)` | week-strip mark after a check-in; postcards dropping on the map |
| `quiet` | `.easeOut(duration: 0.18)` | opacity-only changes, and every animation under Reduce Motion |

Velocity carries through: a flicked share slip or card keeps the finger's speed into the spring.

## Moments

| moment | motion | duration budget |
| --- | --- | --- |
| Share card in | rises from the bottom edge with `sheet`; thumbnail settles 120 ms later | ≤ 450 ms, interactive at once |
| Saved | check draws in (symbol effect `.drawOn`); "finishing details" fades in later | — |
| Flick destination | slip follows the finger 1:1, detents snap with `settle`; neighbours peek at the edges | follows the finger |
| Open a save | the card grows into the detail (`matchedTransitionSource` + zoom navigation transition) | `sheet` |
| Close a save | drag down anywhere; the detail shrinks back into its card | follows the finger |
| Hold to stamp | ring fills linearly over 450 ms (the only linear motion: it's a timer); stamp lands with `stamp` and leaves a postmark that fades to 60% | 450 ms + landing |
| File from Review | card slides off toward the chosen slip with `settle`; list closes the gap with `settle` | — |
| Filter chip | content cross-fades and re-flows with `settle`; no sliding grid | — |
| Map pins | drop in with `heavy`, staggered 20 ms, only on first open of the map | ≤ 600 ms total |
| Cooking step | horizontal page with `settle`; the step number counts up (numeric text transition) | — |

## Reduce Motion

Every spring becomes `quiet` (opacity only). No scale, no tilt, no matched-geometry zoom (detail cross-fades).
The hold ring still fills (it's information), the stamp appears without overshoot.

## Performance

All press and lift effects are `scaleEffect` + `shadow` on already-rendered layers: no layout changes
during scrolling. Shadows on grid cards use pre-rendered shapes (`.compositingGroup()` once per card),
measured against the 120 fps budget in M3.5.
