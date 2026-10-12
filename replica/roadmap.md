# Keepsake roadmap (proposal for gate 1)

Date: 2026-10-11. Nothing here is approved yet. Releases, store submissions, tags, pushes and hosted dependencies each need explicit approval. Pushing a `v*.*.*` tag publishes to the Chrome Web Store automatically.

## Product in one line

Keepsake: one private place for the things you find and want to come back to. Products and wishlists first, plus places, recipes, videos and articles, on Chrome, iPhone, iPad and Mac. No account, no tracking, no caps.

## Milestones

| # | milestone | platform | user-visible result | depends on | size | approvals needed |
| --- | --- | --- | --- | --- | --- | --- |
| **M0** | **Test suite rebuilt** | Chrome | none. Pins 1.3.1 behaviour: storage, migrations, import/export and secret exclusion, categorizer, extraction fixtures, IG parsing, AI boundary with a fake fetch, a dashboard smoke test in jsdom, a manifest/CSP checker | — | M | adding a dev-only `package.json` and `tests/` |
| **M1** | **"Every save sticks"** (Chrome 1.4) | Chrome | Saves never wait on the network; "Finishing details…" state; Trash and undo-delete; storage-full handling; privacy docs corrected (audit P1–P4); measured performance | M0 | M | schema v3 migration, `unlimitedStorage`, release |
| **M2** | **New Keepsake design + kinds** (Chrome 1.5) | Chrome | Redesigned popup, capture card and dashboard; kinds: product, place, recipe (built from a saved dish), video, article, workout, film/show and book lists; places list with Open in Maps (map view on Apple in M3); workout goals and check-ins; to-do/done; better search and filters | M1, design gate | L | design direction, release |
| **M3** | **Keepsake for iPhone and iPad**, on-device only | iOS/iPadOS | Share extension, library, search, Review, collections, item detail, trash, export/import via Files | experiments 1 and 3; Xcode set up; Apple Developer enrolment | L | Apple Developer Program, TestFlight |
| **M4** | **Keepsake for Mac + iCloud sync** between Apple devices | macOS, iOS | Mac app; library on all Apple devices | M3; sync stance decided | L | CloudKit container, encryption choice |
| **M5** | **Chrome ↔ iCloud link** | Chrome | Optional "Connect to your iCloud library" | experiment 2, or the native-messaging option | M | new network destination and privacy update |
| later | Rediscover row and widget · export of downloaded social data · per-collection CSV/Markdown export · price tracking (iOS plan design) · optional BYOK AI on iOS | | | | | |

**Smallest meaningful first milestone: M0 + M1.** It fixes the most important structural risk (saves that depend on the network, quota, hard deletes), sets up the v3 data foundation every later platform needs, and produces real performance numbers. It ships as an ordinary Chrome update with little visual change.

The first **design** slice (after the design gate) should be the **capture card (S01) plus Review (S09)** on Chrome. They're the most-used screens and the core of the differentiator, and they exercise every capture state.

## Performance: measured now, budgets proposed

Measured in a real Chromium browser (Comet 154, headless, generated libraries; full table in audit §8): a save at 5,000 items took **430 ms** on 1.3.1 and **4.5 ms** on M1; at 15,000 items M1 takes 11.9 ms, where 1.3.1 can't store that many (quota). Dashboard ready at 5,000: 125 → 101 ms; at 15,000 (M1 only): 256 ms.

Proposed budgets (M1 already meets the Chrome storage, save and dashboard rows in headless runs; popup timing on real pages is still unmeasured):

| metric | where | proposed budget |
| --- | --- | --- |
| capture to durable save (local, no network) | Chrome toolbar and context menu | ≤ 150 ms p95 |
| popup ready (card shows title) | Chrome | ≤ 300 ms p95 on a product page |
| dashboard ready (first 120 cards) | Chrome, 10k items | ≤ 800 ms warm |
| search keystroke to results | Chrome, 10k items | ≤ 50 ms |
| share card to "Saved" | iPhone, airplane mode | ≤ 1 s |
| app ready (library visible) | iPhone, 10k items | ≤ 1 s warm |
| storage | Chrome | 10k items without quota errors |

Network enrichment (page reading, thumbnails, AI) is measured separately and never counts toward the save budget.

## Dependencies and owner tasks

1. `sudo xcode-select -s /Applications/Xcode.app` (needed for any native prototype).
2. Apple Developer Program enrolment, and checking the "Keepsake" App Store name (from the iOS plan, still open).
3. Decisions listed in `architecture.md` §10.

## Explicit exclusions

See `gap-analysis.md`: social network features, public curation, community, hosted AI or MCP, paywalls and caps, meal planner and film/book trackers (for now), Android, logging in to third-party accounts.
