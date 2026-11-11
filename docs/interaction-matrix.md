# Interaction matrix: iPhone and iPad app

The interaction, motion, gesture and haptics pass on the Divider Tabs design (`ios/DESIGN.md`).
Tokens: `KSMotion` and `Haptic` in `ios/KeepsakeKit/Sources/KeepsakeUI/Haptics.swift`; press styles in
`Controls.swift` (`PressStyle`) and `Binder.swift` (`RowPressStyle`); swipe, Select mode and Undo in
`ios/App/Selection.swift`; reorder in `Reorder.swift`.

Status: **done** (changed in this pass) · **there** (already in the app, checked in code) ·
**n/a** (with the reason) · **device** (works in code or the simulator; the feel needs a real iPhone).
Haptics never fire in the simulator, so every haptic below is also **device**.

## Tokens

| token | value | used for |
| --- | --- | --- |
| `KSMotion.press` | spring 0.22 s, damping 0.7 | buttons, chips, tabs: scale 0.97; the swipe's bin growing |
| `RowPressStyle` | tint in 0.05 s, out 0.2 s | index lines: a 7% tint, nothing moves |
| `KSMotion.settle` | spring 0.38 s, damping 0.82 | rows closing a gap, the swipe settling, reorder, Select mode |
| `KSMotion.sheet` | spring 0.42 s, damping 0.88 | the Undo toast, the place card, the AI bar |
| `KSMotion.lift`, `.stamp` | springs with overshoot | only a picked-up card and a stamp landing |
| `KSMotion.quiet` | ease-out 0.18 s | fades, and every animation under Reduce Motion (`KSMotion.or`) |
| `KSMotion.rise(reduce:)` | from the bottom edge, or a cross-fade | bars and cards that come up from the bottom (**done**: new) |

## Journeys and components

| component or journey | trigger and intent | visual response | gesture + accessible alternative | haptic | states, Reduce Motion | pri | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Save line (Library, Search, a kind, a collection) | tap: open the save | tint on press; zooms open from the line | tap; VoiceOver activates | none (too frequent) | Reduce Motion: system cross-fade | P0 | there |
| Save line: delete | swipe left: throw it away | Delete shows behind the line; past halfway the bin grows; the line goes, Undo toast 8 s | half swipe then tap Delete, full swipe, long-press menu, the save's own More menu, VoiceOver "Move to Trash" | one tick crossing the commit point, rigid on delete | cancelled touch settles the line; Reduce Motion: no bin growth, fades | P0 | **done** (was only on Places and Review lines; the tick and the cancel are new) |
| Save line: long press | hold: the line's actions | system context menu: mark done, favorite, move, share, copy link, Select, trash | visible alternative: the save's More menu; VoiceOver actions on the line | system | system | P1 | there |
| Save line: leading swipe (mark done) | — | — | — | — | — | — | n/a: iOS 26 goes back with a right swipe from anywhere on a pushed page, so it would fight Back; marking done is in the long-press menu and VoiceOver actions (see decisions) |
| Delete, anywhere | swipe, menu, Select bar | row leaves, list closes the gap; Undo toast | Undo button 44 pt, VoiceOver reads the toast | rigid; rigid 0.5 on Undo | failure: error buzz and "Couldn't move to Trash. Try again.", nothing claims success | P0 | **done** (a failed delete or move used to say it worked) |
| Move to… (menu, Select bar, a save's page) | pick a collection | toast "Moved to …" | menus only | success | failure: error buzz and a sentence | P0 | **done** (failure path) |
| Select mode | Select, or long press → Select | ticks on lines; bar rises from the bottom; the count rolls | Select button in the header; Cmd-A, Delete on a keyboard | selection per tick | Reduce Motion: bar and count cross-fade | P1 | **done** (the bar slid under Reduce Motion on five screens) |
| Reorder: Home tabs, Recent, collections, Lifestyle views | hold and slide | lifted preview, neighbours make room, order kept as it changes | VoiceOver "Move earlier / later" | medium on lift, selection per step, success on drop | Reduce Motion: fades | P1 | there; device |
| Collection line | tap, long press, "…" | tint; menu: pin, select, delete (keep or delete its saves) | the "…" button is the visible route | soft on pin, rigid on delete | Undo toast restores the collection and its saves | P1 | there |
| Edit a save, Edit collection, Fix place | type, then Save or Cancel | sheet; Save disabled while the name is empty | Save and Cancel in the bar | soft on save | a swipe down no longer discards typed changes; a failed save keeps the sheet and the text, error buzz, alert | P0 | **done** |
| Fix place fields | type a city, region, country | — | — | — | address autofill hints, words capitalised | P2 | **done** |
| Buttons, chips, index tabs | tap | scale 0.97 (opacity under Reduce Motion), released when the finger leaves | — | selection on chips and segments only | disabled 45% | P0 | there |
| Stamp (Cooked, Been, Purchased, Done today) | tap: mark done | symbol swaps, the 🎉 card pops in the middle, the line says the verb | VoiceOver hint and announcement | heavy | Reduce Motion: fades, no tilt | P1 | there; device |
| Undo toast | after any reversible act | rises above the tab bar, 8 s | Undo 44 pt; announced politely | rigid 0.5 on Undo | Reduce Motion: fade | P0 | there |
| Tabs and navigation | tab bar, index tabs, back | system push and zoom; tab bar steps aside on a save | system back swipe untouched (the row swipe only takes leftward drags) | none | deep links `keepsake://save/<id>` | P0 | there |
| Search (tab and Library field) | type | results after 120 ms, stale queries dropped; Cancel slides in; scrolling drops the keyboard | clear button 44 pt, Cancel | selection on filter chips | Reduce Motion: Cancel fades (**done**) | P1 | there + done |
| Places map | pinch, pan, tap a pin | MapKit's own; the place card rises | list mode is the alternative | none | Reduce Motion: card fades | P1 | there |
| Cooking mode | swipe or tap between steps | pages; step number counts | Next/Back buttons | light per page, selection on a tick | own layout per look | P1 | there; device |
| Workout goal sheet | steppers | the sentence's numbers roll | native steppers | selection per step | Reduce Motion: fade (**done**) | P2 | there + done |
| AI and sync runs | Fix with AI, Find on the map | progress bar with a sweep, deck of cards; Stop | Stop button | — | Reduce Motion: no sweep, still deck | P1 | there |
| Loading, empty, error | open a screen | lines the size of real ones; `EmptyNote`; the library's problem as a sentence | — | — | no fake progress | P1 | there |
| Share Extension | share a link | card rises, shelves, Done | all buttons | success on save, thunk on Done | Reduce Motion handled | P0 | there; device |
| Erase everything | Settings | typed confirm (cannot be undone) | — | rigid | — | P0 | there |
| Pull to refresh | pull a list down | — | — | — | — | — | n/a for now: the library is on the device and iCloud syncs itself when the app comes forward; adding a pull would call sync on demand, which this pass was told not to touch (see decisions) |
| List row stagger, arcs, masks, knob stretch | — | — | — | — | — | — | n/a: lines are met many times a day and the design says nothing moves on them; no custom sliders or knobs; no object flies between screens except the system zoom |
| Sound | — | optional tick, off by default | Settings switch | — | silent switch mutes it | — | there; nothing added |
| Pinch to zoom a save's picture | — | — | — | — | — | P2 | n/a here: pictures are link thumbnails; not added |
| Mac (Safari extension) and Chrome dashboard | — | web UI in `keepsake/`, shared with Chrome | — | none (web pages cannot fire haptics) | `prefers-reduced-motion` already honoured in `base.css`, `looks.css`, `popup.css`, the toast and floating button | — | there; not changed in this pass |

## Needs a real iPhone

Every haptic (the simulator has none), the swipe's commit point by feel, hold-and-slide reorder next
to the long-press menu, VoiceOver's custom actions on a swiped line, and smoothness on an older phone.
