# Keepsake audit

Date: 2026-10-11 · Checkout: `main` at `6ed3c4d` (Chrome extension 1.3.1) · Auditor: Claude (code reading plus Node runs; no real-Chrome session yet)

This is what Keepsake does **today**, from the local checkout. The iOS plan ("Keepsake for iOS: Plan", 2026-09-23) is planning context and is reconciled in `architecture.md`, not here.

Evidence labels used below:

- **[code]**: read in the source, not run.
- **[run]**: executed in this session (Node v23.8.0, Apple M5, 32 GB, macOS).
- **[doc]**: stated in README/PRIVACY, not re-verified against code.
- **[risk]**: a code-audit concern. Not a reproduced bug and not a user complaint.

No Keepsake user feedback was available for this audit.

---

## 1. Baseline checks

| check | result |
| --- | --- |
| Automated test suite | **Missing.** `keepsake/README.md` §Development documents `npm test`, `npm run check`, `npm run zip`, a `tests/` folder and eight suites. There is no `package.json` and no `tests/` in the checkout, and none on any branch in git history (`git log --all -- tests package.json keepsake/tests keepsake/package.json` is empty). The first commit is "Add files via upload", which suggests the suite never made it into the repo. The iOS plan says the same about the 1.2.0 smoke tests. **[run]** |
| Syntax | All 24 JS files pass `node --check`. **[run]** |
| Static rules the README claims (no `innerHTML`/`eval`, CSP) | Not machine-checked because the checker is missing. The manifest CSP is strict: `script-src 'self'`, `object-src 'none'`. **[code]** |
| Real Chrome | Not run yet. Planned with a separate test profile and generated data (approved). |
| iOS/macOS tooling | `xcode-select` points to CommandLineTools, so `xcodebuild` cannot run. Simulator data exists under `~/Library/Developer`. The user needs to run `sudo xcode-select -s /Applications/Xcode.app` before any native build. **[run]** |
| Playwright | Not installed. **[run]** |

**Rebuilding the test suite is a prerequisite for any change in this program** (see roadmap M0).

## 2. Inventory: what exists

Size: about 13.5k lines (JS 7.8k, CSS 3.7k, HTML 0.3k). MV3, plain ES modules, no build step, no runtime dependencies.

| area | files | status | notes |
| --- | --- | --- | --- |
| Toolbar capture (popup) | `src/popup/*` | works [doc] | Instant save at ≥ 0.75 local confidence, otherwise a preview. Undo, Move, a duplicate prompt (update or copy), up to 6 image candidates, "use for similar". |
| Right-click capture | `background.js` | works [code] | Saves a page, image, link or selection. Reads only the card around a clicked image or link. Toast with Move, Undo and Edit. |
| On-page Save buttons | `src/content/{detector,floating,toast}.js` | works [doc] | Off by default. Per-site or all-sites permission, closed Shadow DOM, keyboard support (Alt+Shift+S), reduced motion. |
| Import from tabs | `src/dashboard/tabsImport.js` | works [code] | Needs the **all-sites** permission, which README and PRIVACY don't list (see §5). |
| Extraction | `src/extract/extract.js` | works [doc] | JSON-LD, then OG/Twitter, then microdata, then visible heuristics. Shopify/Woo type and tags. **Product-shaped only.** |
| Categorizer | `src/shared/categorizer.js`, `taxonomy.js` | works [code] | Deterministic, local, explainable reasons, a confidence threshold (0.6 default), learned corrections (light/strong, capped), user keywords, retailer habits. **No Chrome APIs: portable.** |
| Review queue | dashboard `#review` | works [doc] | Three suggested collections, one-click file and learn. |
| Library dashboard | `src/dashboard/dashboard.js` (1.7k lines) | works [doc] | Home, All, Favorites, Purchased, Archive, Collections, item view, quick view, bulk select, theme. Renders 120 cards per "Show more". |
| Collections | `storage.js` | works [code] | Create/rename/merge/delete. Pins, keywords, aliases, cover. Fuzzy name dedupe. Limit 500. |
| Instagram import | `src/instagram/*` | works [doc] | Scans the user's own Saved collection in their tab, reads post pages with the user's session, falls back to a background tab, stores ≤320 px thumbnails locally. Selectors are kept in one adapter file. |
| Optional AI | `src/ai/provider.js`, `src/dashboard/aiCleanup.js` | works [doc] | BYOK (OpenAI, Anthropic, custom). One switch, off by default. Per-origin permission. Payload preview for Find products. AI change log with undo. Search links are verified against results. |
| Export / import / erase | `storage.js` | works [code] | JSON export excludes `keepsake_secrets` and `keepsake_aiLog`. The import validator sanitizes every field and caps counts. Merge or typed-confirm replace. Typed-confirm erase. |
| Migrations | `storage.js` | works [code] | `SCHEMA_VERSION = 2`, ordered `MIGRATIONS[n]`. Older exports with `rules` fold into keywords. |
| Release | `.github/workflows/release.yml` | works [code] | A `v*.*.*` tag push **publishes to the Chrome Web Store automatically** after a manifest/tag version check. |

### Data model today [code]

`chrome.storage.local`, keyed as single large maps:

```
keepsake_items          { [id]: Item }        // one value, rewritten on every item write
keepsake_collections    { [id]: Collection }
keepsake_prefs          { confidenceThreshold, autoCreateCollections, learnedKeywords, retailerPrefs, corrections[≤200] }
keepsake_settings       theme, floating, instagram, ai, onboardingDone
keepsake_importHistory  { instagram: { [normalizedUrl]: itemId } }
keepsake_secrets        { aiApiKey }           // never exported
keepsake_aiLog          [AiChange ≤ 3000]      // never exported
keepsake_meta           { schemaVersion: 2, installedAt, updatedAt }
```

`Item` has `id, collectionId|null, type ∈ {product, inspiration, instagram}, title, description, note, price, currency, retailer, host, url, canonicalUrl, sourceUrl, urlKey, image, images[], productType, tags[], imageAspect, favorite, archived, purchased, confidence, categorizationSource, categorizationReason, needsReview, previousCollections[], instagram{…}, ai{…}, relatedItemId, createdAt, updatedAt`.

Missing for the broader vision: a content **kind** beyond product/Instagram, type-specific fields (place, recipe, video, article, book…), a persisted **capture state** (pending/enriching/failed), the original captured title separate from the edited title, **tombstones** (`deletedAt`), a device/revision for sync, and a separate media record.

## 3. What to reuse

| keep as-is (portable logic) | keep, refactor | presentation (replace freely once the design is approved) |
| --- | --- | --- |
| `categorizer.js`, `taxonomy.js`, `url.js` (normalizeUrl/cleanUrl), `util.js` sanitizers, `instagram/post.js` parsers, `ai/provider.js` boundary and its link-verification rule, `validateExport` | `storage.js` (split into a domain layer plus a backend; per-record keys; tombstones), `extract.js` (product-only now; needs kind detection), `background.js` save pipeline (save first, enrich after) | `dashboard.css`/`popup.css`/`base.css` (3.7k lines), card, quick view, sidebar, home layout |

The shared modules are already almost free of Chrome APIs: `categorizer`, `taxonomy`, `url`, `provider` and `post` have none. `util.js` has two `document` uses, both in DOM helpers. `storage.js` touches `chrome` only in `chromeBackend()`. This is the main asset for iOS/macOS. It can run in JavaScriptCore, or serve as the spec for a Swift port with shared golden tests (see architecture).

## 4. Measured baseline: storage layer [run]

`replica/tools/bench_storage.mjs` runs the real `createStore` over `memoryBackend` with generated items: about 1 KB of text each, and optionally 25% carrying a 25 KB data-URL thumbnail. The thumbnail size is an assumption for ≤320 px JPEGs. Median of 15 runs, Node v23.8.0, Apple M5. **This measures the store's own algorithmic cost, not Chrome.** `chrome.storage.local` adds structured-clone, IPC and disk on top.

| items | thumbs | JSON size | addItem | findByUrl (dup check) | updateItem | getAll | substring search |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0% | 1.0 MB | 3.0 ms | 1.5 ms | 2.9 ms | 1.4 ms | 0.2 ms |
| 1,000 | 25% | 7.1 MB | 5.8 ms | 2.7 ms | 5.8 ms | 2.3 ms | 0.2 ms |
| 5,000 | 0% | 5.2 MB | 18.8 ms | 10.0 ms | 17.9 ms | 9.7 ms | 2.2 ms |
| 5,000 | 25% | 35.7 MB | 33.4 ms | 17.4 ms | 33.1 ms | 16.6 ms | 1.6 ms |
| 19,900 | 0% | 20.6 MB | 84.5 ms | 43.1 ms | 82.1 ms | 40.4 ms | 7.9 ms |
| 19,900 | 25% | 142 MB | 154.8 ms | 80.9 ms | 165.1 ms | 76.1 ms | 9.1 ms |

What this shows:

- Every write costs O(library). One save does a dup check (full read) plus an add (full read and full rewrite), plus a collection read and possibly a cover update. In Chrome each full rewrite also re-serializes the whole map to disk.
- The dashboard re-reads the whole library and re-renders on **every** storage change (debounced 150 ms).
- Search is a linear substring scan. It's fast enough at these sizes, but it has no tokenization, ranking, typo tolerance or field weighting.

### Storage quota [risk, needs real-Chrome verification]

The manifest does not request `unlimitedStorage`, so `chrome.storage.local` is limited to Chrome's documented local quota (10 MB in current Chrome). The code has **no quota handling**: no `getBytesInUse` checks and no catch for quota errors on write. From the sizes above:

- A text-only library reaches about 10 MB near **~10,000 items**, half the advertised 20,000 cap.
- Instagram imports store data-URL thumbnails inside `keepsake_items`. With the assumed 25 KB thumbnail, a few hundred imported posts take several MB, and a 300-post scan (the default safety limit) could approach the quota on its own.
- If a write fails on quota, `addItem` rejects and the save is lost with only a generic error. The library isn't corrupted, because the old value stays.

To verify in Chrome: import a few hundred posts with thumbnails into a test profile, read `chrome.storage.local.getBytesInUse()`, and check what happens at the limit. This is the most urgent reliability item found.

## 5. Findings

### Reliability and data safety

| # | finding | type | evidence | severity |
| --- | --- | --- | --- | --- |
| A1 | With Optional AI on, a save **waits for the AI call before the item is stored** (`saveProduct` awaits `cleanupWithAI`; `callProvider` timeout is 45 s). A slow or offline provider delays the durable save by up to 45 s, and closing the popup or a worker shutdown in that window can lose the save. This breaks "persist before enrichment". | [code] | `background.js` saveProduct, `provider.js:54` | high |
| A2 | AI instant save **overwrites the captured title before storage** and doesn't log it in `keepsake_aiLog`, so the original title is lost and can't be undone separately (only Undo of the whole save). | [code] | `background.js` saveProduct | medium |
| A3 | No quota handling, and no `unlimitedStorage` (see §4). | [risk] | manifest, storage.js | high, pending verification |
| A4 | Deleting is a **hard delete with no undo**. The dashboard warns "can't be undone", the popup/toast **Undo** hard-deletes the just-saved item, and there are no tombstones. That's fine locally, but it blocks sync and differs from the competitors' recovery expectations. | [code] | `storage.deleteItems`, dashboard `deleteItems` | medium |
| A5 | Every write is a read-modify-write of the whole `keepsake_items` map, serialized in-process by a promise queue. Popup, dashboard and background each create **separate store instances**, so concurrent writes from two contexts can race (last writer wins on the whole map). For example, a popup save during a dashboard bulk move could drop one of them. | [risk] | `createStore` per context | medium, needs a repro test |
| A6 | Import "replace" makes no automatic backup first. A typed confirmation is required. | [code] | `settings.js:294` | low |
| A7 | No crash-safe pending state. A capture that fails part-way (extraction error, restricted page) leaves nothing. That's right for restricted pages, but there's no "saved link only, details failed" record for the network-dependent paths that will come. | [code] | | design gap |

### Privacy and permissions

| # | finding | type | evidence |
| --- | --- | --- | --- |
| P1 | **Import from tabs requests the all-sites permission**, but README §Permissions and PRIVACY.md say site access is requested only for on-page buttons or Fix with AI. It's a disclosure gap, not a data leak (tabs are read locally). | [code] | `tabsImport.js:33` vs PRIVACY.md |
| P2 | PRIVACY.md says "applies to Keepsake 1.2.0". The shipping version is 1.3.1. | [doc] | |
| P3 | README §Releasing names `CHROME_CLIENT_ID/SECRET/REFRESH_TOKEN`. The workflow now uses `CHROME_SERVICE_ACCOUNT_KEY` and `CHROME_PUBLISHER_ID`. | [doc] | release.yml |
| P4 | README says "storage (schema v1 + migrations)". The code is schema 2. | [doc] | |
| P5 | Messages: content scripts can send `UPDATE_ITEM`/`UNDO_SAVE` for any item id. Only Keepsake's own content scripts can reach the worker (no `externally_connectable`), so the risk is low. A future web or app bridge must not reuse this unauthenticated pattern. | [code] | `background.js` handleMessage |
| P6 | Remote images (retailer CDNs) are loaded directly by the dashboard, which is disclosed in PRIVACY. Instagram thumbnails are local by default. | [doc] | |

Strengths to keep: no telemetry, a strict CSP, optional permissions requested in context and given back on disable, the secret key kept out of exports, an exact payload preview before AI image lookup, invented links dropped, and price changes limited to numbers seen on the page.

### Product limits against the broader vision

| # | limit |
| --- | --- |
| V1 | Capture is **Chrome desktop only**. There's no mobile capture path, which is where both competitors live (share sheet). |
| V2 | **Product-shaped model.** Extraction, the taxonomy (25 shopping categories), card UI and AI prompts all assume a purchasable product. Places, recipes, videos, articles and books have no fields and no type-specific view. |
| V3 | **Rediscovery** is limited to Home's "recent" and "top collections". There's no resurfacing, no "what did I save about X" beyond substring search, and no map, plan or list-to-do views. |
| V4 | **Action** support: Purchased, Archive, Favorite and the item link. There's no "done/tried" for non-products, no price or stock re-check (the iOS plan proposes it), and no shopping or planning workflows. |
| V5 | Search has no ranking, no filters by kind or status, no saved filters, and no smart collections. |
| V6 | No sync (the iOS plan proposes CloudKit). Export/import is the only portability. |
| V7 | No tests, which is the single biggest risk to any of the above. |

## 6. Accessibility notes [code, not tested with a screen reader]

There are labelled buttons (`aria-label`, `aria-pressed`), `role="list"` grids, keyboard shortcuts (`/`, `Esc`, Alt+arrows), focus management in the popup, reduced-motion support in content scripts, and `loading="lazy"` images. Not yet checked: contrast in both themes, focus order in dialogs, screen-reader announcements for toasts, and target sizes. These go in the test plan.

## 7. What must be verified on a real machine

1. Quota behaviour and `getBytesInUse` with a large generated library and Instagram thumbnails (separate Chrome profile).
2. Popup open-to-saved latency and dashboard ready time at 1k/5k/10k items in real Chrome (the Performance panel or `performance.now()` marks in a test build).
3. The AI-on save path with the provider offline: does the save land, and how long does it take?
4. A concurrent-write race between the popup and dashboard (A5).
5. Xcode selection, before any iOS/macOS prototype.

---

## 8. M0 and M1 results (2026-10-11, branch `m0-test-suite`, uncommitted)

### Test suite (M0, extended in M1)

`npm test` at the repository root: **155 tests, 153 pass, 0 fail, 2 `todo`** (known price-parsing limitations: Swiss `CHF 1’200`, multi-buy `2 for $10`). The storage suite runs every test twice: on the in-memory backend and on the real IndexedDB code (via `fake-indexeddb`). Node + jsdom + a fake `chrome.*`; not a browser.

### Findings status

| # | finding | M0 | M1 |
| --- | --- | --- | --- |
| A1 | AI-on save waits for the network | reproduced (fake browser) | **fixed**: saved first (`captureState: pending`), AI runs after; tested with a provider that never answers |
| A2 | AI overwrites the captured title, unlogged | reproduced (fake browser) | **fixed**: `originalTitle` kept, change logged with Undo, hand-edited fields (`userFields`) never overwritten |
| A3 | 10 MB `chrome.storage.local` quota, no handling | — | **reproduced in a real browser** on 1.3.1 (`Resource::kQuotaBytes quota exceeded` importing 15k saves; library stays at 5,040, nothing lost) and **fixed**: IndexedDB + `unlimitedStorage`, 15,040 saves stored (8.1 MB); a clear "out of space" error if a disk does fill |
| A4 | hard delete, no undo | — | **fixed**: Trash (30 days), Undo toast, Restore, Delete forever, Empty Trash; purge on dashboard open (no alarms) |
| A5 | concurrent writes from two contexts lose one | reproduced (Node) | **fixed**: one record per save, atomic per-record transactions; tested with bursts from two store instances |
| P1–P4 | doc drift (tabs import permission, versions, secrets names, schema) | — | **fixed** in README (both copies), PRIVACY.md and the in-app Privacy page |
| new | `parsePrice('¥1200')` → 120 | found | **fixed** |

### Real-browser measurements

Conditions: Comet 154.0.8037.179 (Chromium 154), **headless**, throwaway profile, unpacked extension, Apple M5 / 32 GB / macOS. Generated libraries (`replica/tools/make_test_library.mjs`: ~0.85 KB per save, inline 40×30 SVG tiles, no network). Driver: `replica/tools/cdp_bench.mjs` over the DevTools protocol. Saves: `keepsake:save-item` messages from the dashboard page to the worker, instant, unique URLs, AI off. Dashboard ready: navigation start → first card in the DOM (5 reloads). Baseline is `HEAD` (1.3.1) from git.

| measure | 1.3.1 | M1 |
| --- | --- | --- |
| save round trip, empty library (median / p95, n=20) | 3.1 / 6.1 ms | 1.0 / 1.6 ms |
| save round trip at 5,000 saves | **430 / 479 ms** | **4.5 / 7.6 ms** |
| save round trip at 15,000 saves (n=10) | not possible (quota) | 11.9 / 12.7 ms |
| dashboard ready at 5,000 saves (median / p95, n=5) | 125 / 131 ms | 101 / 118 ms |
| dashboard ready at 15,000 saves | not possible | 256 / 266 ms |
| import 5,000 saves | 210 ms | 192 ms |
| import to 15,000 saves | **fails: quota exceeded** | 485 ms (+10,000) |
| storage at 5,000 saves | 4.19 MB in `chrome.storage.local` | 4.32 MB origin (IndexedDB) |

Upgrade check (`replica/tools/cdp_upgrade.mjs`, same conditions): 1.3.1 with 5,000 saves, 8 collections, dark theme and an AI key → swap in M1 at the same path → schema 3, 5,000 saves and 8 collections migrated, theme and key kept, v2 copy kept (5,000), dashboard renders 120 cards, 50 spot-checked saves identical, `originalTitle` set, `captureState: complete`.

Not measured: popup open time on real product pages (needs a headed browser and real sites), the AI-on path against a real provider, Instagram import against instagram.com, and a headed (non-headless) run.
