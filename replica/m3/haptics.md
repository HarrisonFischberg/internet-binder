# Haptics map

Date: 2026-10-15 · Status: **for review at M3.0.** Every haptic in the app is listed here; anything
not listed doesn't buzz. Rules: a haptic means something physical happened (a thing landed, clicked
into place, or was refused). Never on scroll, never on appear, never twice for one act.

Implementation: SwiftUI `.sensoryFeedback(_:trigger:)` for standard moments; one `Haptics` type wrapping
`CHHapticEngine` for the patterns marked *custom*. Settings → Sound & haptics has one Haptics switch
(on by default) and one Sound switch (off by default). The system "System Haptics" setting is honoured.

| moment | where | feedback | why |
| --- | --- | --- | --- |
| Save stored | Share card appears with "Saved" | `.success` | the save has landed; you can leave |
| Destination detent | flicking the share slip / Move picker | `.selection` per detent | a card index clicking past tabs |
| Destination chosen (lift finger) | share slip settles | `.impact(.soft, 0.6)` | the slip drops into its slot |
| Done | share card | `.impact(.heavy, 1.0)`, then `.impact(.rigid, 1.0)` 70 ms later; the sheet closes after 110 ms | the binder snaps shut: firm enough to feel through a case |
| Undo | share card, toasts | `.impact(.rigid, 0.5)` | something is taken back out |
| Press on a card | Library, Home | none (visual press only) | too frequent; the sink is enough |
| Lift a card to drag | long press, Library / iPad | `.impact(.medium)` | picked up |
| Hover over a drop target | collection rail, sidebar | `.selection` | it's over something that can take it |
| Drop into collection | release over target | `.success` | filed |
| Drop refused | Lifestyle-only kinds into a shopping collection | `.error` | can't go there (with the reason shown) |
| Hold to stamp (Been, Done today, Cooked) | Place, Workout, Recipe | *custom*: ticks rising in intensity 0.2→0.7 over 450 ms, then a sharp 1.0 transient | the stamp is being pressed, then lands |
| Hold released early | same | none; the ring springs back | nothing happened |
| Check an ingredient | Recipe checklist | `.selection` | a tick on paper |
| Servings dial detent | Recipe | `.selection` per serving | a dial with clicks |
| Next step | Cooking mode, swipe or tap | `.impact(.light)` | a page turned |
| Last step done | Cooking mode | `.success` | finished |
| File from Review | swipe onto a suggestion | `.impact(.soft)` then `.success` on settle | sorted |
| Pull to search | Library, pull past threshold | `.impact(.light)` once at threshold | the drawer catches |
| Toggle a filter chip | Library | `.selection` | a switch flipped |
| Style dial (Appearance) | Settings | `.selection` per style | a dial |
| Delete (to Trash) | swipe or menu | `.impact(.rigid)` | thrown away (Undo follows) |
| Error that needs you | import failed, storage full | `.error` | once, with the message |
| Warning | AI consent, typed confirm screens | `.warning` on open | careful |

**Sound** (optional layer, off by default): only for Save stored, Hold-to-stamp landing, Drop into
collection and Last step done. Each has three close takes picked at random, pitched by kind. Sounds are
our own recordings (paper, card stock, a rubber stamp), never sampled from anyone.

**Accessibility:** with Reduce Motion on, haptics stay (they aren't motion). With VoiceOver, hold-to-stamp
becomes a single activation (double-tap) plus the landing haptic.
