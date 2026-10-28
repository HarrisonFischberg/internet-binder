# Performance and architecture check-in, 2026-10-28

Run against main `ed7e47a` (2.2.5, build 29) with the `performance` and `improve-architecture` skills
(daveebbelaar/bama). Earlier work this builds on: the iOS speed pass (PR #51: list bodies without pictures,
reads off the main thread, `SaveIndex`, debounced widget snapshot) and the audits in PR #45, #50 and #75.

## Performance findings, ranked

1. **The shared JavaScript loaded on the main thread at every launch and every share.** `KeepsakeCore.init`
   ran `queue.sync { load() }`, so whoever opened the library waited while JavaScriptCore parsed and ran
   ~500 KB of `keepsake-core.js` plus `ios-bridge.js`. The app does this in `LibraryModel.init` (before
   the first frame), the Share Extension in `save(items:)` (main actor), the check-in widget intent too.
   Nothing on screen needs it: Home's first frame comes from SQLite (`glance`). Node needs 28 ms cold for
   the same bundle on a fast server; a phone's JavaScriptCore is slower. **Fixed in this PR**: the core
   loads on its own queue, every call already queues behind it.
2. **Every in-process write redrew the whole app twice.** A write fires `observeSaves` (every save decoded,
   `SaveIndex` rebuilt, every view that reads the library invalidated), then the `refresh()` most actions
   call read every save again and assigned an identical list, which invalidated everything again. During
   Fix with AI on a Lifestyle view `refresh()` runs every 5 saves on top of the per-write observation.
   **Fixed in this PR**: an unchanged list is not assigned, and overlapping refreshes share one read.
3. **First launch decoded the whole library on the main thread to ask "is it empty?"** (`decideSync`, and
   the Debug `importOnLaunch` / `seedPerf` paths). **Fixed**: `Library.isEmpty()` is one SQLite `EXISTS`.
4. **The Trash list was read on the main thread.** **Fixed**: read detached, like `reload()`.
5. **The iOS bridge parses the whole library in JavaScript on every list call** (`listItems()`, 11 callers:
   search on every keystroke, each Lifestyle view, Places, Review, the widget snapshot, `finishSaves` and
   `readOnDevice` at each app open). PR #51 measured search at 20 ms for 259 saves; it grows linearly.
   Not fixed: caching needs a change counter that also sees the Share Extension's writes (another process).
   Proposal below.
6. **Chrome's dashboard re-reads the whole library on every change** (`reload()` → `store.getAll()`, then
   a full `render()`), debounced 150 ms. Fine at today's sizes (Chrome stores picture URLs, not pictures);
   worth doing with item 5's change counter if libraries grow into the thousands.

Not measured on a device from the cloud. The repo already has the harness: `ios/UITests/PerformanceTests.swift`
(`KEEPSAKE_PERF=1`, 5,000 saves: launch to usable, scrolling). Before/after numbers go in the PR once run
on the Mac.

## Architecture cards

### Fix with AI lives twice  [Strong]

Files: `keepsake/src/dashboard/aiCleanup.js` (637 lines), `ios/KeepsakeKit/Sources/KeepsakeKit/Resources/ios-bridge.js` (`views.fixWithAI`, `views.undoAi`, ~120 lines)
Signal: drifted copy. The bridge's comments point at `aiCleanup.js runAiCleanup, planFixes` and `undoEntries`;
the patch rules (which fields, user-edited fields kept, confidence threshold, log entry shape) are hand-copied.
Problem: a rule change in Chrome's Fix with AI (say, a new field the AI may fix) has to be made twice, and the
iOS copy has no test that it still matches.
Proposal: `keepsake/src/shared/aiFix.js`, DOM-free, used by both:
```js
export function planFix(item, ai, { threshold, changedAlready }) // → { patch, changes, before } | null
export async function applyFixes(store, plans, { runId })       // → log entries, appended
export async function undoFixes(store, entryIds)                 // → count undone
```
Benefits: one place for the rules; `aiCleanup.js` keeps only progress UI; the bridge shrinks to the loop.
Proof: `tests/ai-backlog.test.mjs`, `tests/on-device-ai.test.mjs` plus a new shared test run against both callers; `npm run test:ios-core`.
Plan: (1) add `aiFix.js` with tests, (2) move the dashboard to it, (3) move the bridge to it, re-bundle.

### A library change counter for list reads  [Worth exploring]

Files: `ios-bridge.js` (`listItems`), `RecordDatabase.swift`, `dashboard.js` (`reload`)
Signal: performance item 5 and 6; the same "read everything again" in two places.
Proposal: a `revision` the record store bumps on every committed write (a row in `setting`, written in the
same transaction, so the Share Extension's writes count too). `listItems()` keeps its parsed list until the
revision moves. Chrome's `db.onChanged` already carries the store; adding the changed keys lets `reload()`
patch `state.items` instead of reading all of them.
Proof: search and view results identical before/after on the 5,000-save perf library; timing in the PR.

### `LibraryModel` holds the whole app  [Worth exploring]

Files: `ios/App/KeepsakeApp.swift` (531 lines, 23 changes in 30 days), `ios/App/Selection.swift` (its extension)
Signal: a god model: the library list, toasts, appearance, AI runs and their progress, iCloud sync state and
account checks, widgets, destinations, imports. Every screen observes it.
Proposal: split by area, each its own `@Observable`: `SyncModel` (sync, status, account, first copy),
`AIWork` (aiRun, aiFixLeft, workEnd, progress screen), leaving `LibraryModel` the saves, index and toasts.
Benefits: a sync status tick or an AI progress tick no longer touches the object the grids read; sync
logic becomes testable without the app target.
Plan: one area per commit, `SyncModel` first (it has the clearest edges).

### `dashboard.js` is 3,814 lines  [Worth exploring]

Signal: file over 1,000 lines and the most changed file in the repo (24 changes in 30 days).
Proposal: move each route's renderer to its own module beside `aiCleanup.js`, `importer.js`, `ui.js`
(Places, Review, Lifestyle views, item page), with `state` passed in as the existing `ctx` already is.
Pure move, no behaviour change; the jsdom tests cover the routes.

### Considered, not recommended

- Moving pictures out of save bodies into their own table: the biggest remaining memory win on iOS, but it
  changes the stored format sync and export rely on (left out of PR #50 for the same reason).
- Replacing the JavaScriptCore core with Swift: it is what keeps iOS, Mac Safari and Chrome on one set of
  rules; the cost it has (finding 1, 5) is fixable in place.
- Splitting `keepsake-core.js` into lazily loaded pieces: finding 1's fix takes it off the critical path,
  which was the reason to want this.

**Top recommendation:** "Fix with AI lives twice", then the change counter.
