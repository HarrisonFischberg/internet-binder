# Recon map: Albo: Save & Organize (formerly Sortd), iOS, iPadOS, Android, web and browser extensions

Scope: the save → organize → rediscover → act loop, as it bears on Keepsake. Not a clone target.
For: Keepsake.
Date: 2026-10-11. Current iOS version at research time: **1.24.0** (released about 2026-10-10).
Access: **public sources only.** No account was used and the app wasn't installed or run, so nothing below is directly observed behaviour.

Evidence labels: **[listing]**, **[site]**, **[changelog]**, **[policy]**, **[cws]** (Chrome Web Store), **[video-index]** (a third-party index of a walkthrough recording, text only), **[review:ID]** (`review_id` in `replica/reviews.csv`), **[infer]**.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store listing (US) | https://apps.apple.com/us/app/albo-save-organize/id6578421992 | 4.9 from 2.1K ratings. Free with IAP: Monthly Hoarder $4.99; Yearly Hoarder / Albo Pro $29.99–$49.99. iPhone and iPad, iOS 17+. 313 MB. Lifestyle. 16+. English (the changelog says 16 in-app languages). Accessibility: "not indicated". |
| 2 | App Store reviews, US RSS feed | `itunes.apple.com/us/rss/customerreviews/id=6578421992` | **78** written reviews (2025-06-11 → 2026-10-09). That's every page the feed returned. |
| 3 | Marketing site | https://albo.inc/ | Features: bulk import, smart collections, trip planner, film/book trackers, meal planner, reviews, workouts, guides, cooking view, **product price history**. "Loved by 600k users" (marketing claim, unverified). |
| 4 | Changelog | https://albo.inc/changelog | v1.4 → v1.23 dated Feb 14 → Oct 2 2026. The listing has 1.24.0. |
| 5 | FAQ / import guides | https://albo.inc/faq, https://albo.inc/guides | 12 source guides (Pinterest, X, LinkedIn, TikTok, Instagram, Threads, Reddit, Safari, Chrome, Facebook, YouTube, Screenshots). FAQ answers didn't render for our fetcher. |
| 6 | AI connections (MCP) | https://albo.inc/mcp | Remote MCP server with OAuth for ChatGPT, Claude, Meta Muse (preview) and dev CLIs. Read, and optional write. |
| 7 | Privacy policy v2.0 (2026-10-07) | https://albo.inc/privacy-policy | Supabase, AWS, Vercel. AI: Gemini, OpenRouter, Bedrock, OpenAI, Anthropic. PostHog (incl. session replay), Adjust. London/EU storage. |
| 8 | Chrome extension "Albo Browse" | https://chromewebstore.google.com/detail/albo-browse/jhphnfgfpdfcjdpcpgafmhpnkjoflppb | v2.0.2, 2026-09-13, 4,000 users, 4.7 from 3 ratings. Declares it handles "Web history". Also Safari (Mac) and Firefox versions. |
| 9 | Google Play | https://play.google.com/store/apps/details?id=com.thesortdapp.sortd | Exists. **Not read** (the page didn't render for our fetcher). |
| 10 | TechCrunch, 2026-08-02 | https://techcrunch.com/2026/08/02/these-app-store-hidden-gems-prove-theres-still-room-for-great-software-in-the-ai-era/ | Feature summary. The author criticizes the heavy trial push in onboarding. |
| 11 | Screens Design showcase | https://screensdesign.com/showcase/albo-save-organise | Timestamped index of an onboarding/feature walkthrough. Undated version. |
| — | Reddit / HN | searched, none relevant | |

## Core loop

Share anything into Albo (or bulk-import existing TikTok, Instagram or Pinterest saves). AI extracts structured details (places, recipe ingredients, titles of films and books, workouts) and sorts them into smart collections. Saves then become **action views**: a map of places, a trip planner, a meal planner, film and book trackers, a cook mode, price tracking, plus "Ask Albo" chat.

## Screens (from public material)

| ID | screen | how to reach | purpose | key components | states seen (source) |
| --- | --- | --- | --- | --- | --- |
| A01 | Onboarding (multi-step, demo import, personalised plan) | first launch | teach, collect intent, push trial | orbit animation, "magic import" demo, plan reveal | **10+ steps, hard to skip** [review:14312598718]. **Stuck: no button** [review:14302726125, fixed per same reviewer]. **Repeats every launch** [review:14041832219]. Praised as streamlined [review:13517108046, 14304594177] |
| A02 | Paywall (soft, 3-day trial timeline) | end of onboarding, and when limits hit | subscription | trial timeline (Today / reminder / billing) | [video-index]. "Weekly limit reached" [review:14239481685, 14648611545] |
| A03 | Share-sheet save | iOS/Android share sheet | capture | extension | session-timeout message but the save works [review:13735322345]. Save directly into folders [review:13586686391] |
| A04 | Screenshot save | share sheet, Siri Shortcut (1.16) | capture images, extract details | | screenshots "pretend to save" then never appear [review:13581966606] (Jan 2026, v1.3.1) |
| A05 | Bulk import | in app / **computer (web or extension)** | import TikTok, IG, Pinterest collections | importer, progress | **needs a computer** surprise [review:13804200602]. Only collections imported, not all bookmarks [review:14566457729] |
| A06 | Home / library | tab | mixed library, filters, grid or list per collection | cards, tags, filters (1.20) | home reorganised 1.17 |
| A07 | Smart collections | library | auto-filled by tag (1.18), filtered views auto-add (1.21), folders (1.15), ranked or dump collections, drag-to-rank (1.7–1.8) | | robot sorts restaurants into "recipes" with no removal [review:13697730838] (Jan 2026) |
| A08 | Map | tab | saved places pinned, friends' saves, trending, filters (top rated, open now) | Apple/Google Maps view | **map broken for weeks, no support reply** [review:14635372354] (Oct 6 2026, v1.23). Map loved for trip planning [review:13868501849] |
| A09 | Trip planner | from places | day-by-day itinerary from saved places | | v1.19 (Sep 2026) |
| A10 | Recipe detail / cook mode / meal planner / grocery list | recipes | ingredient checklist, unit conversion, steps, nutrition, screen-awake, meal plan, grocery list | | v1.17, v1.23, v1.24 (editing, remix, voice dictation) |
| A11 | Film/show and book trackers | media | Watching / Up next / Finished, rate | status chips | video-to-title detection **fails over half the time** for one heavy user [review:14113805234] (May 2026, v1.12) |
| A12 | Workout / step-by-step guide | | sets, reps, steps | | [site] |
| A13 | Product wishlist / price history | | price history, discounts | | [site]. **Not in the changelog**, so its depth is unknown |
| A14 | Item detail | tap a save | source post link (1.18), notes (1.9), extracted fields, "Made it?", reminders (place or day), add event to calendar | | [video-index, changelog] |
| A15 | Ask Albo (chat) | tab / Siri (1.22) | ask about your saves, "decide for me", recommendations | chat | AI misses ingredient quantities [video-index] |
| A16 | Friends / community / explore / blend | tab | share collections, blend with a friend, community chat, curated explore | | [changelog 1.4–1.13] |
| A17 | Widgets / Control Center / Action Button | iOS system | quick capture and resurfacing | | v1.22 |
| A18 | Weekly recap | notification or screen | rediscovery | | v1.14 |
| A19 | Get-started checklist with reward imports | | engagement, unlocks extra imports | checklist | [video-index] |
| A20 | Settings / account / plan | profile | subscription tiers | | pricing tiers confusing [review:14432340080, 14566457729] |
| A21 | Browser extension (Albo Browse) | Chrome / Firefox / Safari Mac | save a page, bulk-import TikTok/IG collections | | 4,000 Chrome users [cws] |
| A22 | MCP connector | external AI client | read and write the library from ChatGPT/Claude | OAuth | [site /mcp] |

## Flows

```
F01 Save a TikTok from the phone
    (TikTok) Share -> Albo -> A03 -> extraction -> smart collection / map
    happy path taps: ~3 [site guide; not observed]
    edge: weekly free save limit hits mid-session (~17–20 saves) [review:13804944583, 14648611545];
          extraction fails for show/movie clips [review:14113805234]; server/connection errors in early versions
          [review:13571220612, 13463501366] (Dec 2025; developer replies claim fixes)

F02 Bulk import existing saves
    computer -> extension or web -> A05 -> collections
    edge: requires a computer [review:13804200602]; only collections, not all bookmarks [review:14566457729];
          weekly import caps on paid tiers [review:14566457729]

F03 Plan a trip from saved places
    A08 map -> A09 trip planner -> itinerary
    edge: map outage [review:14635372354]; wants addresses in captions to auto-pin [review:13573961918]

F04 Cook from a saved recipe
    A10 -> cook mode -> meal planner -> grocery list
    edge: wanted to export extracted recipe text to notes [review:12762381238] (Jun 2025)

F05 Correct sorting
    A07 -> move or remove
    edge: no way to remove from an auto category [review:13697730838]; wants bulk move [review:13597754083, 13578727659];
          nested collections request [review:13578727659] -> addressed by "collection folders" v1.15 (Jun 30 2026)

F06 Ask an outside AI about the library (MCP)
    ChatGPT/Claude -> OAuth -> read saves; optional write (save link, organise)
```

## Components (advertised)

Share extension · smart collection tile · map pin and sheet · itinerary day list · status chips (Watching / Up next / Finished) · ingredient checklist · cook-mode step view · rating and review sheet · "Made it?" button · reminder picker (place / day) · chat composer · paywall timeline · checklist with rewards · widgets.

## Inferred data model [infer]

```
User        id, email, profile, plan (free|hoarder|pro|max?), weekly_import_quota      (evidence: IAP list, limit reviews; confidence: medium)
Save        id, user_id, source_url, source_platform, media snapshot (thumbnail; video dropped in 1.5 per review 13756857108),
            kind (place|recipe|film|show|book|game|workout|guide|article|product|event|music|custom),
            extracted {kind-specific fields}, tags[], note, rating/review, status, created_at
            evidence: changelog 1.14 extract data, 1.15 custom extract types; confidence: medium
Place       name, lat/lng, address, hours?, open_now   (evidence: map filters 1.12; confidence: medium)
Recipe      ingredients[], steps[], servings, nutrition (1.17)
Collection  id, owner, name, folder_id?, mode (dump|ranked), rule/tag filter (smart), shared_with[], blend_of?
Plan        trip days[] -> place refs; meal plan days[] -> recipe refs; grocery list
Friend graph, community chat, wanna-votes
```

From the privacy policy [policy]: Supabase/AWS/Vercel hosting, an LLM pipeline across several providers, embeddings, PostHog analytics and session replay, Adjust attribution. We don't know Albo's internals beyond what the policy names.

## Privacy posture [listing, policy, cws]

- App Privacy label: **Data used to track you: Identifiers, Usage Data.** Data linked: location, contact info, **user content**, identifiers, usage, diagnostics, other.
- Saved content can be sent to AI providers. Session replay is kept 90 days, analytics events up to 7 years. Deletion targets 14 days. **Export is on request through support**; there's no self-serve export.
- An account is required for practically everything (sign-in errors appear in reviews).
- The Chrome extension declares "Web history".

## What users value (positive themes, US App Store, n=78)

- **Actually going back to saves instead of doom-scrolling the social app**: 14422899148, 13365380118, 14235261118, 13579228065.
- **Map of saved places for real trips**: 13868501849, 14106199572, 13386664485 (extracts many places from one TikTok).
- **Auto-sorting and multiple ways to find things**: 14486546644, 13388904393.
- **Beautiful, high-quality UI and onboarding**: 13589738145, 13267190530, 13517108046.
- **Save straight into a folder from the share sheet**: 13586686391.
- **Supportive team and refunds**: 13825676718.

## Complaints and requests, checked against later versions

| theme | reviews | first/last seen | later change | status |
| --- | --- | --- | --- | --- |
| Free save/import limits and confusing tiers | 12885997921, 14149947612, 13804944583, 14239481685, 14432340080, 14566457729, 14648611545, 14150327660 | 2025-07 → **2026-10-09** | none (business model) | **open, current** |
| Reliability: won't open, server/connection errors, saves vanish | 12777672062, 13571220612, 13463501366, 13811459987, 13674959540, 13697730838, 14235261118 | 2025-06 → 2026-06 | developer replies claim fixes; 1.22 "rebuilt for iPhone" | improving (one reviewer upgraded 1 to 5 stars) |
| Map feature broken, no support reply | 14635372354 | 2026-10-06 | none yet | **open, current** |
| Auto-sorting wrong, can't remove from auto category | 13697730838, 13597754083, 13573961918 | 2025-12 → 2026-01 | 1.18 smart collections by tag, 1.20 filters, 1.21 filtered views | partly addressed (unverified) |
| Bulk organise / bulk move | 13597754083, 13578727659 | 2026-01 | not mentioned | unknown |
| Nested collections | 13578727659 | 2025-12 | **1.15 collection folders** | addressed |
| Search within collection / filter by location | 13578727659, 14327925723 | 2025-12 → 2026-07 | 1.20 library filters | partly |
| Video → title detection fails | 14113805234 | 2026-05 | 1.14 expanded extraction | unknown |
| Videos became pictures after an update | 13756857108 | 2026-02 | none | unknown |
| Onboarding too long or repeating | 14312598718, 14041832219, 14302726125 | 2026-05 → 07 | — | unknown |
| Import needs a computer, or only imports collections | 13804200602, 14566457729 | 2026-03 → 09 | — | open |
| Export extracted content to other apps | 12762381238 | 2025-06 (v0.2.13) | MCP connector (1.2x) is a different answer | partly |
| Own uploads (images/files) | 13735322345 | 2026-02 | screenshots via Shortcut 1.16 | partly |
| Offline maps | 12775052440 | 2025-06 | none | open |

Sample caveat: 78 written US reviews out of about 2.1K ratings, App Store only.

## Out of scope for Keepsake

- Social graph, community chat, blends, explore/trending, friends on the map: their network. **skip** (and against private-by-default).
- Weekly limits and paywall mechanics. **skip**; Keepsake's core stays free of artificial caps.
- A hosted multi-provider AI pipeline that sends user content by default. **skip**; Keepsake AI stays BYOK and opt-in.
- MCP connector to the user's library: possible later as a **local**, opt-in feature (see gap analysis). Not v1.

## Size (if Keepsake matched the useful private subset)

Albo's breadth (map, trip, meal, cook, trackers, workouts, events, games, music) is **XL**. That breadth is also where its reliability complaints cluster. Keepsake should pick 2–3 kinds, not all of them.
