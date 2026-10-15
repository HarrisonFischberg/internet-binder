# M3 parity report (replica-diff, iOS column)

Date: 2026-10-15. Against `replica/features.csv`, weighted must 3, should 2, could 1; yes 1, partial ½, no 0.
Rows the brief excludes on iOS (n/a: Chrome-only capture, Instagram bulk import, social, paywall,
price tracking, M4 sync, meal planning) are left out of the score.

**Weighted parity: 88%** (90 of 102).
By priority: must 23/23 · should 10/11 · could 1/11

## Still missing (must and should)
- Smart collections filled by rule or tag (should)

## Every feature
| feature | priority | iOS | how / why |
| --- | --- | --- | --- |
| Save current page from browser toolbar in one action | must | n/a | iOS equivalent is the Share Sheet |
| Right-click save of page image link or selection | should | n/a | no right-click on iPhone |
| On-page save buttons on product cards | could | n/a | Chrome only |
| Save from any iOS app via the share sheet | must | yes | Share Extension; Safari reads the page with Chrome's extract.js |
| Save screenshots and photos with text extraction | should | yes | share a screenshot or photo: its text is read on the device (Vision) and a small copy kept |
| Save straight into a chosen collection at capture time | must | yes | destination slip on the share card |
| Bulk import existing Instagram saved collections | should | n/a | stays in Chrome by decision (PROMPT.md) |
| Bulk import TikTok and Pinterest saves | could | no |  |
| Import products from all open tabs | could | n/a | Chrome only |
| Saved record survives the source post being deleted | must | yes | text and details kept; a small local copy of each picture is kept when first shown |
| Original source URL always kept and openable | must | yes | Open/Watch/Read/Visit shop; Share |
| Practical details enrichment (address hours price ingredients) | should | yes | page reading on save; Lookups and AI when turned on |
| Personal notes on a save | must | yes | note on the share card and in Edit |
| Add own photos to a save | could | no |  |
| Ratings and personal review or take on a save | could | no |  |
| Automatic categorization into collections | must | yes | Chrome's categorizer in JavaScriptCore |
| Uncertain saves wait for review instead of guessing | must | yes | Review, banner and badge |
| Correct a wrong category directly and teach it | must | yes | Review filing and Move to… learn strongly |
| User-defined collections with keywords | must | yes | create, rename, keywords, pin, delete (saves go back to Review) |
| Nested collections or folders | could | no |  |
| Smart collections filled by rule or tag | should | no |  |
| Bulk select move archive delete | should | yes | Select mode: move or trash several at once; drag onto the iPad sidebar |
| Content kinds beyond products (place recipe video article workout film-show book) | must | yes | every kind with its own object and view |
| Search across all saved text | must | yes | Chrome's ranking and typo correction |
| Filters by kind status source and place | should | yes | kind, Review, status (To do, Done, Purchased) and source site; Places by state |
| Natural-language ask over your own saves | could | no |  |
| Resurface saves by context or a periodic recap | should | yes | Come back to |
| Home screen widget for capture or rediscovery | could | yes | Latest save; Workout goal |
| Map of saved places | must | yes | MapKit |
| Trip planner from saved places | could | no |  |
| Recipe built from a saved food item (ingredients and steps) | must | yes | checklist, method, cooking mode |
| Meal planner and grocery list | could | n/a | excluded by owner decision |
| Film show and book lists to scroll | should | yes | still to watch/read first, then done |
| Wishlist with purchased state | must | yes | Collections with Purchased; Mark purchased |
| Price history and drop alerts | should | n/a | deferred past M4 by decision |
| Mark done or tried for non-products | should | yes | hold-to-stamp Been, Cooked, Done today |
| Reminders by date or place | could | no |  |
| Undo after save and after AI changes | must | yes | toasts with Undo; AI change log |
| Deleted items recoverable (trash) | should | yes | Trash with Restore, 30 days |
| Saves succeed offline and finish later | must | yes | save first; fill-in runs when the app opens |
| Partial save when details fail (link-first) | must | yes | a bare link is saved as a Link |
| Full self-serve export and import | must | yes | Chrome's file format, both ways |
| Delete all data from the device in one step | must | yes | Erase everything, typed confirmation |
| No account required for core use | must | yes |  |
| No tracking or analytics | must | yes | allowlisted network only |
| AI optional and bring-your-own-key | must | yes | off by default, key in Keychain |
| Sync across iPhone iPad Mac | should | n/a | M4 |
| Sync with Chrome extension | could | n/a | M4 (sync-bridge.md) |
| iPad layout | should | yes | sidebar, columns, drag and drop, keyboard |
| Native Mac app | could | no | not attempted in M3 |
| Siri and Shortcuts capture | could | no |  |
| Share collection privately with a link or friend | could | n/a | social excluded |
| Friends feed comments likes follows | could | n/a | social excluded |
| Public curated collections and creator follows | could | n/a | social excluded |
| Community chat | could | n/a | social excluded |
| AI chat connector for outside assistants (MCP) | could | no |  |
| Weekly free save limits and paywall | could | n/a | excluded |
| Workout saves with exercises sets and reps | must | yes | Chrome's formatExercise |
| Workout goals derived from saved workouts with progress | should | yes | goal card, week strip, check-ins, widget |
