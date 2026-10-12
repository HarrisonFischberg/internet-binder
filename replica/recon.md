# Recon map: Keepsake target experience (Chrome, iOS, macOS)

Scope: the **capture → retain context → organize → rediscover → act** loop for Keepsake, synthesized from the Keepsake audit and two reference apps. This is the canonical map that downstream pack skills read (architect, design, build, test, diff).
For: Keepsake, an existing product being evolved. Not a clone.
Date: 2026-10-11

Per-competitor evidence is kept separately and is not overwritten:

- `replica/thingz/recon.md`, `replica/thingz/features.csv` (Thingz, formerly Likepost)
- `replica/albo/recon.md`, `replica/albo/features.csv` (Albo, formerly Sortd)
- `replica/keepsake-audit.md` (what Keepsake does today)
- `replica/reviews.csv`, `replica/feedback.md` (competitor user feedback)

Labels: **[have]** exists in Keepsake 1.3.1 · **[T]** / **[A]** seen in Thingz / Albo public material · **[new]** proposed.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Keepsake checkout | `main@6ed3c4d` | authoritative for current behaviour |
| 2 | Keepsake for iOS: Plan | https://claude.ai/artifact/LmukQnWGZuuSxmAQ39VPuP | planning context, reconciled in `architecture.md` |
| 3 | Thingz recon | `replica/thingz/recon.md` | 7 public sources, 36 reviews |
| 4 | Albo recon | `replica/albo/recon.md` | 11 public sources, 78 reviews |

## Core loop

Save anything worth coming back to, from wherever you found it, in one action. Keepsake keeps the source and enough context to recognise it later, files it where it belongs (or asks when unsure), and brings it back in a form you can act on: buy, go, cook, watch, read. All of it stays on your devices.

## How the references serve the loop (summary)

| loop stage | Thingz | Albo | Keepsake 1.3.1 |
| --- | --- | --- | --- |
| Capture | iOS/Android share sheet, gallery, camera | share sheet, screenshots (Shortcut), bulk import (computer), Chrome/Firefox/Safari extension, widgets, Action Button | Chrome toolbar, right-click, on-page buttons, IG import, tabs import |
| Retain context | server enrichment (address, hours, where to buy), notes, own photos, media download | AI extraction by kind (place, recipe, film, book…), source link, notes, ratings | structured product data, note, original URL, IG caption/creator/tagged products, local IG thumbnails |
| Organize | automatic categories, curated collections | smart collections, folders, ranked collections, tags, filters | local categorizer with confidence and reasons, Review queue, learn-from-move, keywords, pins |
| Rediscover | "Your Loop" context resurfacing and ask, friends feed | weekly recap, widgets, map, Ask Albo, explore | Home: recent saves and top collections; substring search |
| Act | take (recommend / want to try), share | map, trip planner, cook mode, meal planner, trackers, reminders, calendar, price history | Purchased, Archive, Favorite, open link |
| Trust | tracking label, account | tracking label, account, weekly caps | no account, no telemetry, BYOK opt-in AI |

## Target screens (cross-platform; the IDs are stable for design and build)

Platforms: **C** Chrome (popup P, dashboard D, page overlay O) · **I** iPhone (and iPad) · **M** Mac · **X** iOS share extension.

| ID | screen | platforms | purpose | key components | states to design | origin |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Quick capture card | C-P, C-O, X | save in one action, confirm where it went, move or undo | thumbnail, title, kind badge, collection chip, Undo, Move, Add note | saving, saved, saved-to-Review, duplicate, partial (link only), error, restricted page, offline | [have] popup and toast; [T][A] share card |
| S02 | Capture preview / edit | C-P, X (expanded), I, M | adjust before or after saving | image picker, title, price, note, collection select, confidence pill | loading skeleton, sparse data, low confidence | [have] |
| S03 | Home | D, I, M | today: what's new, what needs sorting, what to come back to | search, Review prompt, recent row, pinned collections, resurfacing row [new] | empty (first run), filled, Review pending, offline | [have] Home; [A] recap |
| S04 | Library (all saves) | D, I, M | browse and filter everything | grid/list toggle, kind filter, status filter, sort, bulk select | empty, filtered-empty, loading many, partial items | [have] |
| S05 | Search | D, I, M | find anything by words, kind, place, shop | field, scoped chips, ranked results, recent searches (local) | no results, typo suggestion | [have] basic; [new] ranking and filters |
| S06 | Collections index | D, I, M | all collections, pinned first | cover tiles, sort, find | empty, hundreds | [have] |
| S07 | Collection detail | D, I, M | one collection | hero, keywords, items, per-collection view | empty, filled | [have] |
| S08 | Item detail | D, I, M | full context and actions | media, source link, kind-specific panel (product, place, recipe, video, article), note, status, history | details pending, enrichment failed, source gone, image missing | [have] product and IG; [new] kinds |
| S09 | Review | D, I, M | file uncertain saves fast, teach the sorter | card, top-3 suggestions, new collection, skip | empty (hidden), many, "finishing details…" | [have] |
| S10 | Import | D (IG, tabs, file), I (file) | bring existing saves in | source picker, progress, select, assign | permission needed, partial, stopped, duplicates | [have] |
| S11 | Settings and Privacy | D, I, M | data, permissions, AI, sync, appearance | sections, permission rows with state, export/erase | permission denied, AI off/on, sync off/on/error | [have] |
| S12 | Optional AI | D, I, M | opt-in, key, preview, log | consent, payload preview, change log with undo | off, key missing, provider error | [have] |
| S13 | Trash | D, I, M | recover deleted saves | list, restore, empty trash | empty | [new] |
| S14 | Onboarding | D (welcome), I, M | first value fast | 3 steps max, sample data, capture tutorial | skipped | [have] welcome; [A] lesson: keep it short (feedback C5) |
| S15 | Places view | I, M, D | saved places as a list, open in Maps | list grouped by city, "Open in Maps" | no location data | [new], later milestone |

## Flows (happy path counts are targets to beat)

```
F01 Save a product page in Chrome                         [have]
    page -> toolbar/shortcut -> S01 saved -> (optional) Move
    clicks: 1 (icon) ; durable save must not wait on network
    edge: duplicate, restricted page, no product data (save link, Review), AI on and offline (save now, tidy later)

F02 Save from any iPhone app                              [new; T, A]
    app Share -> Keepsake -> S01 (X) saved / saved to Review -> dismiss
    taps: 2 (Share, Keepsake) + auto-dismiss
    edge: share card cut short (save link, finish in app), private IG post (link only), no network

F03 File what Keepsake wasn't sure about                  [have]
    S03 Review prompt -> S09 -> pick suggestion (learns)
    taps: 1 per item

F04 Find something again                                   [have, improve]
    S03/S04 -> S05 type -> ranked results -> S08
    edge: misspelling, searching by shop or place, item with no title

F05 Act on a save                                          [partly have]
    product: S08 -> Visit page / Mark purchased
    place:   S08 -> Open in Maps / Mark visited             [new]
    recipe:  S08 -> ingredients and steps / Mark cooked      [new]
    video/article: S08 -> Open / Mark watched or read       [new]

F06 Fix a wrong save                                       [have]
    S01 Move / S08 edit / S09 -> correction learns ; Undo everywhere

F07 Recover a deletion                                     [new]
    S08 Delete -> toast Undo, or S13 Trash -> Restore (within 30 days)

F08 Bring existing saves in                                [have]
    S10 -> IG collection / open tabs / Keepsake JSON

F09 Use Keepsake on a second Apple device                  [new; needs approval]
    I/M -> iCloud on -> library appears ; offline edits merge
```

## Components (shared semantics; layouts differ per platform)

Save card (grid and list variants, with kind badge, source, price or place or time, note preview, status) · capture card (S01) · confidence pill · collection chip and picker · kind badge · status chip (saved, to-do, done, purchased, archived) · search field with scope chips · filter sheet · empty state · toast with Undo · permission row · progress row with Stop · detail panels per kind · tile (collection cover) · settings row · dialog (confirm, typed confirm).

## Target data model (sketch; the schema is in `architecture.md`)

```
Item        id, kind (product|place|recipe|video|article|book|media|idea|image|link), title, originalTitle,
            source {url, canonicalUrl, host, app, capturedVia}, media [{ref, role, local, remote}],
            note, status, flags {favorite, purchased, archived}, collectionId|null,
            classification {confidence, source(local|ai|manual), reason, suggested[]},
            captureState (complete|pending|failed), details {kind-specific}, createdAt, updatedAt, deletedAt
            evidence: audit §2, features.csv, both recon maps ; confidence: proposal
Collection  id, name, keywords, aliases, pinned, order, cover, taxonomyKey, updatedAt, deletedAt
Prefs       learned terms and retailers (syncable), threshold
DeviceLocal settings, secrets (AI key), permissions, theme ; never synced or exported
```

## Feature matrix

See `features.csv` (57 rows, the pack's columns). `original` = seen in Thingz or Albo. `clone` = Keepsake today. Notes tag the reference ([T], [A], [T+A]). Must: 21, should: 14, could: 22. Keepsake today: yes 19, partial 8, no 24, skip 6 (social network, public curation, community, hosted MCP, paywall limits, meal planner).

## Out of scope

Social graph, friends feeds, public curated or creator collections, community chat, view and follow counts, hosted AI pipelines, analytics or attribution, paywall limits, Android, logging into third-party accounts on the user's behalf.

## Size

Screens 15, flows 9, core entities 3 (+ per-device settings). Hard parts: an iOS share extension under memory and time limits, the CloudKit sync model and Chrome's access to it, per-kind extraction without a server, and a storage migration with zero data loss. Size: **L** across three platforms, delivered as small milestones (see `roadmap.md`).
