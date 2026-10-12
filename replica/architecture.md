# Keepsake architecture: Chrome, iOS, macOS

Date: 2026-10-11 · Status: **proposal for gate 1**. Nothing here is implemented, and production code is untouched.
Inputs: `replica/keepsake-audit.md`, `replica/recon.md`, `replica/features.csv`, "Keepsake for iOS: Plan" (2026-09-23).
Fixed by the product owner: no Android; sync via Apple CloudKit; local-first; no mandatory account; no telemetry; AI optional and opt-in. Any hosted dependency needs explicit approval.

The pack's default stack (Next.js, Postgres, Supabase, Stripe, Vercel) **does not apply**. Keepsake has no server and must not gain one. The pack steps map onto this product as: stack → per-platform choices; SQL schema → shared record schema plus `replica/schema.sql` for the Apple local store; API routes → local operations and message contracts; jobs → on-device enrichment queues.

---

## 1. Principles that decide the hard calls

1. **Save first, enrich later.** A capture writes a usable record (source URL, captured title, time, device) to local storage before any network request, AI call or image download. Enrichment only adds to it and never blocks it. This fixes audit A1/A2 and answers the competitors' top complaint (feedback C1).
2. **Manual beats machine.** Fields the user edits are recorded in `user_fields`. Enrichment, AI and sync merges never overwrite them. Confidence below the threshold goes to Review, not a guess.
3. **Never invent.** No synthesized URLs, product matches or prices. (This keeps 1.x's rules: AI prices must appear in the input, and AI links must appear in search results.)
4. **One record format, many stores.** A versioned JSON record schema (`schema/keepsake-record.v3.json`, proposed) is the contract between the Chrome store, the Apple store, CloudKit records and export files.
5. **Share logic, not UI.** Categorization, URL normalization, taxonomy and parsers are shared. Each platform gets native UI.
6. **Reversible migrations.** Every schema change is backup → migrate → verify → keep the old data until the next version.

## 2. Stack

| layer | choice | why |
| --- | --- | --- |
| Chrome extension | **keep** MV3, plain ES modules, no runtime deps | Works today. No framework is needed for a popup, overlay and dashboard. |
| Chrome storage | **IndexedDB** for items, collections, media and the log; `chrome.storage.local` only for settings and the secret; add `unlimitedStorage` | Fixes the quota risk (audit A3) and whole-map rewrites (§4 of the audit). Transactions fix cross-context races (A5). Blobs for thumbnails. Whether `unlimitedStorage` shows an install warning **needs verification**. |
| Chrome tooling | add a **dev-only** `package.json`: `node:test` + jsdom, a manifest/CSP checker, and a zip script | Rebuilds the missing suite (audit §1). Still no runtime deps and no build step for the shipped extension. |
| Apple apps | **SwiftUI multiplatform**: one app target for iPhone, iPad and Mac, plus a **share extension**; iOS 17+ / macOS 14+ | Native share sheet, widgets, Shortcuts and Mac windowing. The extension can't host a web dashboard within its memory budget anyway. See §8 for why this revises the iOS plan's Capacitor proposal. |
| Apple local store | **SQLite via GRDB** in an App Group container (`replica/schema.sql`) | Shared by the app and the extension, FTS5 search built in, explicit migrations, and no Core Data mirroring constraints on the CloudKit model. |
| Shared logic on Apple | **The JS core running in JavaScriptCore** (`categorizer`, `taxonomy`, `url`, `instagram/post` parsers), bundled into one file at build time for iOS only | One implementation of the sorting rules, so a correction on the phone means the same thing on desktop. JavaScriptCore is a system framework (no download). Covered by golden tests (§3). |
| Page extraction on Apple | Safari share: run **`extract.js` as the share extension's JavaScript preprocessing file** (it reads the live page DOM, as in Chrome). Other apps: save link-first, then the main app loads the URL in a non-persistent `WKWebView` and runs the same `extract.js` | Reuses the existing extractor. The second path is **source-page access** (a network request to the saved site), disclosed as such. |
| Sync | **CloudKit private database via `CKSyncEngine`** (Apple), CloudKit Web Services for Chrome **only if experiment 2 passes** (§6) | Owner decision; no Keepsake server. |
| Design tokens | one `tokens.json` (W3C design-token format) → CSS custom properties and a Swift `Theme` file via a small generator script | Same colour roles and type scale everywhere without sharing a UI framework. Produced by replica-design after gate 1. |
| AI | keep the BYOK provider boundary. Chrome: `fetch` from the extension. Apple: `URLSession`, key in the **Keychain**, per device, never synced | Same opt-in and consent model. Never on the save path (principle 1). |
| Payments, auth, email, hosting, analytics | **none** | Out of scope; would need explicit approval. |

## 3. What is shared and what is platform-specific

| shared (one source, tested once) | shared contract, two implementations | platform-specific |
| --- | --- | --- |
| `categorizer.js`, `taxonomy.js`, `url.js`, sanitizers in `util.js`, IG post parsers, `extract.js` (Chrome tab and Safari share and WKWebView) | record schema v3 (JS validator and Swift `Codable`); store operations (§5); search ranking rules; export format v3 | Chrome: popup, overlay, dashboard, permissions, IG scan. Apple: SwiftUI screens, share extension, widgets, Shortcuts, Keychain, CloudKit |
| design tokens, terminology, content kinds, item states, icon set (SF Symbols-compatible names mapped to a Keepsake SVG set on Chrome) | | navigation (Chrome sidebar and dashboard; iPhone tabs; iPad and Mac split view), density, gestures, keyboard shortcuts |

**Golden tests** live in `keepsake/tests/fixtures/golden/` (proposed): product, page and caption inputs with the expected `classify()` output, URL keys and extraction results. Chrome runs them in Node. The Apple app runs the same files through JavaScriptCore in XCTest, so the two can't drift.

## 4. Data

### 4.1 Record schema v3 (what changes from v2)

The full field list is in `replica/schema.sql`; the Chrome IndexedDB stores use the same field names in camelCase.

| change | why | evidence |
| --- | --- | --- |
| `kind` (product, place, recipe, video, article, book, media, idea, image, link) replaces `type` (product, inspiration, instagram). Instagram becomes `sourceApp`, not a kind | broader content; a reel can be a recipe | audit V2; feedback V8 |
| `originalTitle`, `userFields[]` | keep what was captured; protect manual edits from AI, enrichment and sync | audit A2 |
| `captureState` pending/complete/failed and `captureError` | save first, show "Finishing details…", retry | principle 1; iOS plan "Finishing details…" |
| `status` saved/todo/done alongside the existing `purchased`/`archived`/`favorite` flags | "act" for non-products; Purchased keeps working unchanged | feedback V4; features "Mark done" |
| `deletedAt` tombstones and a 30-day trash | undo delete, sync deletions | audit A4 |
| `media` records (blobs or files) instead of data-URLs inside items | storage size, sync assets | audit §4 |
| `learnedWeight` rows instead of one prefs blob | additive learning from two devices | iOS plan "learned habits sync" |
| `details` JSON per kind, validated by the schema | type-specific views without a table per kind | recon S08 |
| `priceMinor` (integer) | exact money | pack rule; avoids float drift |

### 4.2 Chrome migration v2 → v3 (needs approval; nothing ships before the test suite exists)

1. **Before migrating:** write a full v2 export to IndexedDB `backup_v2` (and offer a file download in the release notes and the dashboard banner). Keep `keepsake_items`/`keepsake_collections` in `chrome.storage.local` untouched.
2. **Migrate:** map each v2 item to a v3 record. `type:'instagram'` becomes `kind` from classification or `link`, with `sourceApp:'instagram'` and `legacy.instagram`. Data-URL images become `media` blobs. `price` becomes `priceMinor`. Prefs become `learnedWeight` rows. Ids are kept verbatim.
3. **Verify:** compare counts and a checksum of ids, titles, urls and collectionIds between v2 and v3. If anything differs, stop, keep using v2, and show a "migration paused" notice with an export button.
4. **Switch:** set `keepsake_meta.schemaVersion = 3` and `storeBackend = 'idb'`.
5. **Rollback window:** v2 keys stay for one release. 1.5 can fall back to them. 1.6 removes them only after a successful v3 read on that profile.
6. **Export/import:** v3 export format; import still accepts v1, v2 and v3 files (fixtures for all three in the suite).

Compatibility tests: a v1 export, a v2 store with IG thumbnails, a hostile import, a 10k-item store, an interrupted migration (worker killed mid-way), and a quota-full simulation.

## 5. Operations (the "API": local, per flow)

Chrome keeps its message hub. Every write goes through one store module with IndexedDB transactions, so popup, dashboard and worker can't overwrite each other. Apple calls the same operations on a `LibraryStore` actor.

| operation | does | caller | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `capture(source)` | writes the item (pending or complete) **first**, runs local classify, returns at once | popup, overlay, context menu, share extension | url, title, page data?, capturedVia, collection? | item, classification, duplicateOf? | F01 F02 |
| `enrich(itemId)` | page extraction (tab, Safari JS, or WKWebView), thumbnail fetch, optional AI tidy; fills only non-user fields; logs AI changes | background queue | id | item delta | F01 F02 |
| `findDuplicate(url)` | url_key lookup (indexed) | capture | url | item? | F01 |
| `fileItem(id, collectionId, learn)` | move and learn (light/strong) | Review, Move | | item | F03 F06 |
| `updateItem(id, patch)` | edit; adds edited fields to `userFields` | detail | | item | F06 |
| `setStatus(ids, status/flags)` | todo/done, purchased, archive, favorite | card, bulk | | | F05 |
| `trash(ids)` / `restore(ids)` / `purgeTrash()` | soft delete; Undo toast; purge after 30 days (on open, no alarms) | anywhere | | | F07 |
| `search(query, scope)` | tokenized, field-weighted, typo-tolerant (edit distance 1 for ≥5 chars); Apple uses FTS5 | search | | ranked ids | F04 |
| `exportAll()` / `importFile(f, mode)` | v3 export without secrets or device settings; import v1–v3 with validation; auto-backup before replace | settings | | report | F08 |
| `importInstagram…`, `importTabs…` | unchanged flows, writing through `capture` | dashboard | | | F08 |
| Sync engine hooks | `pendingChanges()`, `apply(remoteRecords)`, `markSynced()` | CKSyncEngine delegate | | | F09 |

Background work, all on-device and with no timers on Chrome: an enrichment queue drained when the worker wakes for a save or when the dashboard opens; trash purge on dashboard open; on Apple, `BGAppRefreshTask` for pending enrichment (best effort; iOS decides when).

## 6. Sync: options and recommendation (needs approval before any implementation)

The owner has chosen CloudKit. Within CloudKit there are still decisions to make:

| option | encryption and keys | Chrome access | conflicts | deletion | account | cost | portability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. CKSyncEngine, standard fields** | encrypted at rest; Apple holds keys unless the user has Advanced Data Protection | possible through CloudKit Web Services with the user's Apple sign-in (**unproven; experiment 2**) | per-record change tags; Keepsake merges per field (below) | tombstone field, then hard delete after 30 days | the user's iCloud; none of ours | free to us within CloudKit's per-user quotas; it counts against the **user's** iCloud storage (assets) | v3 JSON export always available |
| **B. CKSyncEngine, `encryptedValues` for user content** (title, note, URLs, details) | end-to-end; keys in iCloud Keychain | **very likely blocked** for web access (to verify in experiment 2) | same | same | same | same | same |
| **C. Option B on Apple, plus a native-messaging bridge** from Chrome on a Mac to the Keepsake Mac app | E2E kept | Chrome on Mac only, through the local app (`nativeMessaging` permission, user-installed host). No Windows | the Mac app is the sync client | same | same | same | same |
| D. iCloud Drive export file | per the user's iCloud settings | none | whole-file, last writer wins (poor) | coarse | same | — | good |
| E. Own server or E2E relay | — | — | — | — | adds an account and hosting | ongoing | — | **excluded** (privacy promise, approval rule) |

**Recommendation:** build Apple-to-Apple sync as **B** (E2E for content; non-sensitive metadata such as timestamps, kind and collection membership stays in standard fields for queries). Decide the Chrome link after experiment 2. If web access can't read encrypted fields, prefer **C** for Mac Chrome users and keep export/import for others, over weakening Apple-side encryption. This changes the iOS plan, which proposed standard fields to keep Chrome compatible. It's a values call for you, so it's listed under decisions (§10).

**Conflict rules** (all options):

- Per-field merge. The later `updatedAt` wins for that field, except fields in `userFields`, which beat machine edits regardless of time.
- Learned weights are additive rows. Collection order uses fractional `sortOrder`.
- Deleting a collection on one device moves its items to Review on every device. Delete beats edit only for the deleted record; an edit to a trashed item resurrects it into Review (no silent loss).
- The same URL saved on two devices is detected after sync by `urlKey`. Records are merged (richer data wins) only when one side was never user-edited. Otherwise both stay and are flagged in Review as possible duplicates.

**Offline:** every operation is local, and the sync engine sends when connectivity returns. **Account:** none of ours, and sync is off until the user turns it on (on Apple, using the device's iCloud). **Data portability:** export never depends on sync.

## 7. The parts that bite

| area | note |
| --- | --- |
| Storage quota | Chrome: `unlimitedStorage` + IndexedDB + `navigator.storage.persist()` where available. Handle write failures with a clear "storage full" state and never drop a capture silently. Apple: assets count against the user's iCloud quota; show the library size. |
| Races | Chrome contexts all write through IndexedDB transactions. Apple: one `LibraryStore` actor; GRDB WAL mode for the extension and app in parallel. |
| Idempotency | `capture` keyed by a client id, so retries from the share extension or popup don't duplicate. Sync applies by record id and change tag. |
| Share extension limits | memory (commonly reported around 120 MB; to verify in experiment 3) and time. Write the row first, do nothing heavy in the extension, enrich in the app. |
| Time zones | everything stored in UTC ISO-8601. Display in local time. "Saved today" is computed locally. |
| Search | Chrome: an in-memory index rebuilt on open and updated incrementally; budget in roadmap. Apple: FTS5. Same tokenizer rules, golden queries in tests. |
| Rate limits | Instagram post reads keep the 1.x pacing. AI calls are batched (existing `CLEANUP_BATCH = 8`). No background polling of retailers (price tracking deferred). |
| Remote media | Product images load from retailer CDNs (disclosed). Cache a local thumbnail on capture (opt-out), so saves survive dead links (features "survives source deletion"). |
| Privacy disclosures | Every new network path (source-page access in WKWebView, CloudKit, thumbnail fetch) is listed in PRIVACY.md, the store listings and the in-app Privacy screen **before** it ships. Apple privacy label target: "Data Not Collected" (to confirm with Apple's definitions once CloudKit is in). |
| GDPR-style deletion | local erase as today. With sync on: "Delete from all devices" deletes the CloudKit zone. Document that the trash purge is 30 days. |
| Accessibility | Dynamic Type, VoiceOver labels, 44 pt targets, reduced motion, contrast checked from tokens (replica-design contrast checker). |

## 8. Reconciling "Keepsake for iOS: Plan" (2026-09-23)

| plan item | verdict | reason |
| --- | --- | --- |
| Goal: one private library, Chrome plus an iOS share card, no Keepsake server | **retain** | Matches the vision and the owner's constraints. |
| Apple-only plus Chrome; no Android | **retain** | Owner decision. |
| Keepsake never signs in to Instagram; the share sheet is the iOS bridge | **retain** | Least privilege; same as the competitors' share flow. |
| CloudKit private DB, no sign-in on iPhone, opt-in "Connect" in Chrome | **retain**, with the Chrome link pending experiment 2 | §6. |
| Review rule: anything not in a collection is in Review; pending items show "Finishing details…" | **retain** | Core differentiator; matches `captureState`. |
| AI optional, key per device, never synced | **retain** (Keychain on Apple) | Secret hygiene. |
| Step 3 groundwork: per-record storage with last-changed and deleted markers; logic free of Chrome calls; iOS storage backend; add-only price readings; commit the smoke tests | **retain and expand** into M0/M1 | The audit confirms none of it shipped. 1.3.0 shipped UI work instead. Tests first. |
| "Ships as 1.3.0" | **revise** | 1.3.0 and 1.3.1 are already out; the groundwork becomes 1.4.x. |
| Phase 1: wrap the dashboard in Capacitor (your open comment) | **revise → native SwiftUI** | (a) The share extension must be native regardless and can't host the web UI within its memory budget. (b) The approved direction asks for platform-native navigation, density and accessibility, and a redesign is planned anyway, so reusing today's dashboard UI has little value. (c) Reuse is kept where it matters: the JS sorting, URL and parsing logic runs in JavaScriptCore, and `extract.js` runs in Safari and WKWebView. (d) A Mac app comes from the same SwiftUI target, where Capacitor would need Catalyst. Cost: more UI code than a wrap. Effort estimate in the roadmap. |
| Experiments 1–4 (IG logged-out data, Chrome↔CloudKit, share card limits, push without server) | **retain** experiments 1–3 before iOS build; **defer** experiment 4 with price tracking | Each answers a real dependency. |
| Conflict rule: latest edit wins per record | **revise → per-field merge with user-field protection** | Prevents enrichment on one device from clobbering a manual edit made on another. |
| Encryption: normal fields so Chrome can read | **revise to a decision** (§6 option B/C) | Privacy-first argues for E2E; it's your call. |
| Price tracking (passive in Chrome, opt-in daily checks, iOS on open, CloudKit alerts) | **defer** to after M4; keep the add-only `price_reading` table in the schema | No user evidence in 114 competitor reviews (feedback §5). Adds permissions (alarms, site access) and a privacy-policy change. Keep it as product-owner direction for later. |
| Thumbnails stored locally (IG links expire) | **retain and generalise** | Media records for all kinds. |
| Phase 5 positioning against Thingz: private, no account, no tracking | **retain, refine** | Both competitors list tracking. Albo also has paywall caps (feedback C2). |
| Open: price (free/paid), iPad from day one, minimum iOS | **carry forward**. Recommend iOS 17+ (CKSyncEngine) and an iPad layout from the start (SwiftUI split view is low cost; Thingz reviewers ask for iPad) | |
| Missing from the plan: macOS app, non-product kinds, trash/undo-delete, test suite, quota | **add** | Audit and recon findings. |

## 9. Build order (each milestone is usable on its own; details in `roadmap.md`)

| milestone | screens | data | operations |
| --- | --- | --- | --- |
| M0 tests | none | fixtures v1/v2, golden set | the whole 1.3.1 behaviour pinned |
| M1 reliable capture (Chrome 1.4) | S01, S09, S13, S11 (storage, privacy) | v3 in IndexedDB, media, trash | capture, enrich, trash/restore, export v3, migrate |
| M2 redesign + kinds (Chrome 1.5) | S01–S12 in the new design; kind panels for product, link/article, place, recipe, video | details per kind, status | search v2, setStatus |
| M3 iPhone/iPad, local only (TestFlight) | S01 (X), S03–S09, S11–S14 | SQLite v3 | same operations, JavaScriptCore core |
| M4 Mac app + Apple sync | all on Mac; sync settings | CloudKit zones, record meta | sync hooks |
| M5 Chrome link (if experiment 2 passes, or option C) | S11 Connect | — | — |

## 10. Gate 1 decisions (owner, 2026-10-11)

1. **Approved:** native SwiftUI for iOS, iPadOS and macOS (revising the Capacitor proposal).
2. **Approved:** Chrome storage moves to IndexedDB + `unlimitedStorage` with schema v3 and the §4.2 migration, as the M1 direction. No production code until after the design gate.
3. **Chosen: option B.** User content in CloudKit `encryptedValues` (end-to-end). The Chrome link is decided after experiment 2; the native-messaging bridge (option C) is the fallback for Chrome on Mac.
4. **Approved:** price tracking deferred past M4.
5. **Kinds for the first release:** products and wishlists stay first-class. Added: **place (with a map of saved restaurants and places)**, recipe, video, article, and **workout (with workout goals)**. Excluded: social features, public curation, paywalls.

### Follow-on design questions from decision 5

**Map of saved places.** Showing a pin needs coordinates. Pages sometimes publish them (schema.org `geo` on restaurant pages), but often only an address, which then needs geocoding: a network call to a map provider.

| platform | map and geocoding | privacy note |
| --- | --- | --- |
| iOS, iPadOS, macOS | MapKit (`Map` in SwiftUI) and `MKLocalSearch`/`CLGeocoder` | Apple services; addresses go to Apple to geocode. Map tiles load from Apple. No location permission needed to show saved places. "Near me" asks for When-In-Use location only on request. |
| Chrome dashboard | **Proposed: no in-dashboard map in M2.** A places list grouped by city with "Open in Google Maps / Apple Maps". The map lands on Apple first (M3). | An embedded web map would load tiles from a third party (OpenStreetMap's tile servers restrict heavy use; MapKit JS needs a signed token, which means key handling). Revisit later with an approved provider. |

Coordinates are cached on the item once found, so each address is geocoded once and the result syncs.

**Follow-up decisions (owner, 2026-10-11):**

- **Recipes:** save a food item you like; Keepsake extracts the ingredients and steps and builds a recipe view. No meal planning, grocery lists or cook mode. Extraction is local (schema.org `Recipe` on the page, or ingredient and step lines in a caption). When the source has no recipe, the item offers **"Draft a recipe with AI"**: opt-in BYOK, on request, labelled as a guess, editable, and logged in the change log with undo. Never automatic.
- **Hosted AI:** stays **excluded**. Keepsake never runs its own AI server or sends saves anywhere by default.
- **Film/show and books:** simple saved lists to scroll through. No status, ratings or progress.
- **Restaurant map:** approved as described below.
- **Workout goals:** approved as described below. Local by default; optional BYOK AI suggests a progression only on request.

**Workout goals.** Confirmed by the owner. The proposed default is local and has no AI: a saved workout is extracted into exercises, sets, reps and durations. You turn it into a goal ("3× a week for 4 weeks", or "reach 3×12 push-ups"), and Keepsake tracks your check-ins against it. Optional BYOK AI could suggest a progression, but only when you ask. This adds `goal` and `goal_checkin` records to the schema (syncable, add-only check-ins, like price readings).
