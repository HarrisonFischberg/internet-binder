# Keepsake information architecture, terminology, flows and states

Date: 2026-10-11. Screen IDs (S01–S15) and flows (F01–F09) are from `replica/recon.md`. Kinds are from the owner's decisions in `replica/architecture.md` §10.

## Terminology (the same words on every platform)

| term | meaning | not |
| --- | --- | --- |
| **Save** (noun and verb) | anything kept in Keepsake | item, bookmark, post, pin |
| **Library** | every save | All saves, inbox |
| **Collection** | a named group the user owns; a save is in at most one | folder, board, list |
| **Review** | saves Keepsake wasn't sure where to put | inbox, uncategorized |
| **Kind** | what a save is: Product, Place, Recipe, Video, Article, Workout, Film or show, Book, Link | type, category |
| **Wishlist** | products you haven't bought (filter: Kind = Product, not Purchased) | — |
| **To do / Done** | your plan for a save. Done has a per-kind verb: Bought, Been, Cooked, Watched, Read, Finished | completed |
| **Purchased**, **Archive**, **Favourite** | unchanged from 1.x | — |
| **Goal** | a workout target with check-ins | challenge, streak |
| **Trash** | deleted saves, kept 30 days | bin, recycle |
| **Finishing details** | saved; Keepsake is still reading the page | processing, syncing |
| **Saved on this device** / **Saved to iCloud** | where the save lives | uploaded, cloud |

Copy rules: say what happened ("Saved to Kitchen"), offer the fix next to it ("Move"), never apologise, never say "AI" unless AI did it, and label every AI result as a suggestion.

## Information architecture

```
Keepsake
├── Home                      what's new, what needs you, what to come back to
│   ├── Review banner         only when something is waiting
│   ├── Recent saves          one row
│   ├── Collections           pinned first, then most used
│   └── Come back to          to-dos and saves not opened in 6+ weeks (local, can be turned off)
├── Library                   every save; filter by Kind, Collection, Status, Source; sort; grid or list
│   ├── Wishlist              preset filter: products, not purchased
│   ├── Places                list grouped by city (Chrome) · Map (Apple)
│   ├── Recipes · Videos · Articles · Workouts · Films & shows · Books   (preset filters, shown only when they have saves)
│   ├── Favourites · Purchased · Archive
│   └── Trash
├── Review                    file uncertain saves; appears only when non-empty
├── Collections               all collections → one collection
├── Search                    global, ranked; scope chips for kind and collection
├── Save detail               full context, kind panel, actions, history
│   └── Goal (workouts)       create, check in, progress; "Suggest a progression" (AI, on request)
└── Settings
    ├── Capture               on-page buttons, sites, shortcut (Chrome) · share card options (Apple)
    ├── Sorting               threshold, keywords, learned habits
    ├── Import & export       Instagram, open tabs, file; export JSON/CSV
    ├── iCloud                off by default; status; delete from iCloud
    ├── Optional AI           off; provider; key; what is sent; change log
    ├── Appearance            style: Modern / Moss / Minimalist · mode: system / light / dark
    └── Privacy               every network path, in plain words; erase everything
```

Kinds are **filters over one library**, not separate sections with their own storage. A recipe saved from Instagram is a Recipe whose source is Instagram.

## The save card (shared anatomy)

```
┌──────────────────────────┐
│ [image or kind tile]     │   media: local thumbnail, else remote, else a kind-tinted tile with the kind icon
│                      ☆   │   favourite (top right)
├──────────────────────────┤
│ ◉ Recipe · nytimes.com   │   kind chip (icon + tint) · source
│ Brown butter pasta       │   title, 2 lines max
│ 9 ingredients · 25 min   │   the kind's key fact (see below)
│ "make for Sam's visit"   │   note preview, 1 line
│ [Needs a collection]     │   state badge when relevant
└──────────────────────────┘
```

| kind | key fact | done verb | detail panel |
| --- | --- | --- | --- |
| Product | price + shop; "was $X" only if the user saw the price drop (later) | Bought | images, price, shop, variants text, Visit page, Mark purchased |
| Place | neighbourhood or city · cuisine or category | Been | address, hours if published, map (Apple) or Open in Maps (Chrome), source post |
| Recipe | ingredients count · total time | Cooked | ingredients (checkable), steps, servings. **Draft with AI** only when the source has none (opt-in, labelled) |
| Video | creator · duration | Watched | thumbnail, Open, caption, what the video is about (if extracted) |
| Article | site · reading time | Read | summary from the page description, Open |
| Workout | exercises count · focus | Finished | exercises with sets, reps and rest; **Goals** |
| Film or show | year · film or series | Watched | poster, Open (source) |
| Book | author | Read | cover, Open (source) |
| Link | site | Done | page title, description, Open |

## Flows and their states

Each flow lists every state the design must cover. ✓ means a mock exists in `prototypes/index.html`.

### F01 Save a page in Chrome (S01)

```
toolbar or ⌥⇧K → card: Saving… → Saved to Kitchen  [Move ▾] [Add note] [Undo]
                                └ Not sure where this goes → Saved to Review  [Choose collection ▾]
```

| state | what the user sees | ✓ |
| --- | --- | --- |
| saving | skeleton image, title from the tab, "Saving…" (under 150 ms target; often never seen) | ✓ |
| saved | "Saved to {collection}" + confidence pill when below High + Move / Add note / Undo | ✓ |
| saved to Review | "Saved. Pick a collection now or later" + top-3 suggestion chips | ✓ |
| finishing details | saved state plus a quiet line "Finishing details…" (AI tidy, thumbnail). The card can close; the library shows the same line | ✓ |
| duplicate | "Already saved in {collection} on {date}" + Open / Save a copy / Update | ✓ |
| link only (sparse page) | "Saved the link. This page doesn't describe a product." Kind: Link | ✓ |
| offline (AI on) | "Saved on this device. Details will finish when you're back online." | ✓ |
| can't read page | "Chrome doesn't let extensions read this page." + Open Keepsake | ✓ |
| storage full | "Keepsake is out of space in this browser profile. Nothing was lost. Free space in Settings." | ✓ |
| permission denied (on-page buttons) | in Settings: site row shows "Access not granted" + Grant | ✓ |

### F02 Save from an iPhone app (S01 share card)

```
Share → Keepsake → card slides up: [thumb] Title · kind chip · "Saved to Places" [Change] → auto-close 2 s (pauses on touch)
```

States: saved; saved to Review; finishing details (opens fine, finishes in the app); private post (link only, "This post is private, so Keepsake saved the link"); offline (link saved); unsupported content (plain text becomes an Idea/Link). ✓ (iPhone mock)

### F03 Review (S09)

One card at a time on iPhone, a list on desktop. Each row has the top-3 suggestions as chips, "New collection…" and "Skip". Filing animates the row out and announces "Filed to Kitchen" to VoiceOver. **Empty: Review disappears from navigation**, and Home says nothing (no "all caught up" nag). ✓

### F04 Search (S05)

Type → results ranked by title > note > collection > source > text. Scope chips appear after typing (kinds that have matches, plus "In: {collection}" when searching from a collection). States: no results ("No saves match 'linen lamp'. Check the spelling or search all kinds"), typo corrected ("Showing results for 'linen'"), offline (no difference: search is local).

### Recipes open as recipes (all platforms; owner decision 2026-10-11)

Opening a recipe from anywhere (a card, the Recipes view, Review, Home, search) goes straight to the **recipe view**, not to a preview or the editor. It's a full-size view: the photo; the title; the source and author; time, servings and cuisine; a checkable **ingredient** list with "3 of 9"; and numbered **method** steps you can tick off while cooking. The actions are Mark cooked, Visit page or Open post, and Edit details. Checking things off is for cooking along and isn't saved. Editing ingredients and steps, and the optional AI draft, live in Edit details.

| platform | recipe view |
| --- | --- |
| Chrome dashboard | full-size dialog (`modal-full`), photo and facts on top, ingredients and method side by side; single column under 820 px |
| iPhone | full-screen push: photo header, facts row, segmented **Ingredients / Method**, screen kept awake while it's open |
| iPad / Mac | the detail pane becomes the recipe view, with ingredients and method side by side |

### F05 Act on a save (S08)

The done verb button sits next to Open. Places: "Open in Maps" chooser (Apple Maps / Google Maps). Recipe: checkable ingredients, step list. Workout: Goals panel.

### Workout goal (S08 → Goal)

```
Workout detail → [Make it a goal] → choose: "Do it 3× a week for 4 weeks" | "Reach a target: [exercise] [sets]×[reps]"
→ Goal card: progress ring (2 of 3 this week), [Check in] → sheet: done ✓ (optional sets/reps/time) → progress updates
→ (AI on) [Suggest a progression] → preview of suggested weekly targets → Accept / Dismiss (logged, undoable)
```

States: no exercises found ("Keepsake couldn't find exercises on this page. Add them yourself"), goal finished, goal missed a week (neutral wording: "1 of 3 last week"), AI off ("Suggest a progression" hidden, never teased), provider error ("Your AI provider didn't answer. Nothing changed."). ✓ (iPhone mock)

**Workouts open as workouts (all platforms, built in Chrome M2b).** Like recipes, opening a workout from anywhere goes straight to the **workout view**: title, source, exercise count, time and focus; an **Exercises** table (exercise, sets, reps or time, rest); and the **Goal** column with the goal card above. Actions: Mark finished, Visit page or Open post, Edit details (where exercises are edited as text, one per line, "Squats 3×12" or "Plank 45s rest 60s").

Rules the apps share (`shared/goals.js`, mirrored in Swift):
- Weeks run from the goal's start day, not the calendar week. Check-ins count once per day for "× a week".
- A frequency goal finishes after its last week or when every week is met; a target goal when one check-in reaches it (sets and reps, or sets and time).
- One active goal per workout; finished and ended goals stay listed under it. Ending a goal and a check-in both have Undo; ended goals are purged with the Trash after 30 days.
- A target goal's check-in asks for the numbers (that's what it measures); a frequency goal's check-in is one tap ("Done today"), with sets and reps optional.

| platform | workout view |
| --- | --- |
| Chrome | full-size dialog; exercises left, goal right; one column under 820 px |
| iPhone | full-screen push; segmented Exercises / Goal; check-in as a sheet; screen kept awake while open |
| iPad, Mac | detail pane with exercises and goal side by side |

### Places (Chrome, built in M2c)

Saving a restaurant or place page reads its schema.org place data (address, pin, phone, cuisine, price range, opening hours). A Google Maps or Apple Maps link is read from the URL itself: the name and the place's own pin (`!3d…!4d…`, not the map's centre). Places file to a **Places** collection unless one of your keywords matches first.

- **Places view:** a list grouped by city (A–Z, "Somewhere else" last), each row with thumb, name, cuisine or category · price · street, a **Been** badge, and **Open in Maps** (menu: Apple Maps / Google Maps). Been places sink to the bottom of their city.
- **Place view:** photo, name, source, address with Copy, cuisine, price, phone, opening hours ("As published on the page when you saved it. Check before you go."), actions Edit details, Visit page, Apple Maps, Google Maps, Mark been.
- **Edit details:** address fields, cuisine, price, phone, hours (one line each). Changing the address drops the page's pin, so maps search the new address instead of pointing at the old spot. On an Instagram save, "Use the tagged location as the name".
- No map in Chrome (no third-party tiles); the Apple apps add the map in M3.

### F07 Delete and undo

Delete → toast "Moved to Trash" + Undo (8 s) → Trash keeps it for 30 days with Restore. Delete forever is in Trash only, with confirmation.

### Settings: Privacy (S11)

A plain list of every network path, each with its switch and state: page reading (only the page you save from), thumbnails (download a copy), Instagram post details (instagram.com, when you import), optional AI (provider name, off), iCloud (off), map lookups (Apple, when you open a place). States: permission granted / not granted / revoked by Chrome.

## Empty states (written fresh)

| where | copy |
| --- | --- |
| Library, first run | "Nothing saved yet. Save a page with the Keepsake button or ⌥⇧K, or try the sample library." |
| Wishlist | "Products you save land here until you buy them." |
| Places | "Save a restaurant or place and it shows up here with its address." |
| Recipes | "Save a recipe or a dish you'd like to cook. Keepsake pulls out the ingredients." |
| Workouts | "Save a workout and turn it into a goal." |
| Films & shows / Books | "Save a film, show or book you want to get to." |
| Trash | "Nothing in Trash. Deleted saves stay here for 30 days." |
| Search | see F04 |
