# Recon map: Thingz (formerly Likepost), iOS

Scope: the save → organize → rediscover → share loop, as it bears on Keepsake. Not a clone target.
For: Keepsake (privacy-first, local-first saved-things library).
Date: 2026-10-11. Current version at research time: **2.0.7** (App Store, "2 days ago").
Access: **public sources only.** No account was used and the app wasn't installed or run, so nothing below is directly observed behaviour.

Evidence labels:

- **[listing]**: App Store listing text, version notes or privacy label.
- **[site]**: thingz.com / likepost.com.
- **[policy]**: privacy policy.
- **[review:ID]**: one App Store review. The ID is `review_id` in `replica/reviews.csv`.
- **[infer]**: our inference. Unverified.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store listing (US) | https://apps.apple.com/us/app/thingz/id6744123389 | Rating 4.8 from 769 ratings. Free, no IAP listed. iPhone only, iOS 18+. 297 MB. Category Social Networking. 13+. EN/DE/RU/ES. Accessibility: "not indicated". |
| 2 | Same app under the old name | https://apps.apple.com/uy/app/likepost/id6744123389 | Same id. Rebranded in 2.0.1–2.0.4 (Sep 14–18 2026). |
| 3 | App Store reviews, US RSS feed | `itunes.apple.com/us/rss/customerreviews/id=6744123389` | **36** written reviews (2025-12-12 → 2026-09-18). That's every page the feed returned. |
| 4 | Marketing site | https://thingz.com/ (likepost.com/* redirects here) | Features, use cases, "Loop", curated collections. Says 4.7 from 291 ratings across stores (stale). |
| 5 | Product page | https://thingz.com/product?from=likepost | Same features, more detail. |
| 6 | Privacy policy | https://thingz.com/privacy-policy/ | Optional account. Ads partners, Google Analytics, Brave Search API, YouTube API. |
| 7 | Google Play | https://play.google.com/store/apps/details?id=com.likepost.app | Linked from the site. **Not read** (the page didn't render for our fetcher). |
| — | Help center, changelog page, public API, feature board | none found | The site links no help, blog or changelog. Version notes on the listing are the only changelog. |
| — | Reddit / HN | searched, none relevant | No useful threads found for "Thingz" or "Likepost". |

## Core loop

Share a post or link into Thingz from any app. It saves it, enriches it with practical details, and auto-files it into categories. Saves come back later through "Your Loop" (context-based resurfacing and asking in natural language), and can be shared socially with a take (Recommend / Want to try / Don't recommend).

## Screens (from public material; IDs local to this map)

The App Store screenshots have no text captions available to our fetcher, so screen names come from the website's section headings and the version notes.

| ID | screen | how to reach | purpose | key components | states seen (source) |
| --- | --- | --- | --- | --- | --- |
| T01 | Onboarding / sign-up | first launch | account (Apple sign-in mentioned), interests | sign-in | **hang on sign-up** [review:14282608126], refreshed onboarding [listing 1.0.18, 1.0.21] |
| T02 | Share-sheet save | iOS share sheet from IG/TikTok/YouTube/Facebook/web | capture | share extension | Facebook save **failures with an error that asks for a screenshot** [review:14045643071]. Facebook saves **blank** [review:13641655295]. **Pinterest missing image** [review:13660564335] |
| T03 | Save from gallery / camera | in app | capture photos, create your own post | picker, camera | added 1.0.8–1.0.13 [listing] |
| T04 | Collections hub | tab | auto categories (Travel, Recipes, Beauty, Tech, Health, Personal Growth) | category tiles | "Easier collection management" 2.0.5 [listing] |
| T05 | Collection detail | tap a collection | browse a category | grid of saves | missing thumbnails and generic titles [review:13650335996] |
| T06 | Item detail | tap a save | context: address, hours, menu, price, where to buy, notes, photos | enrichment card, notes | notes not visible without opening the item [review:13650335996] |
| T07 | Recipes / routines section | 2.0.5 | step-by-step recipes and routines | steps | new Sep 28 2026 [listing]. Earlier: "doesn't save whole recipe" [review:13723771097] |
| T08 | Your Loop | tab | natural-language ask, context resurfacing (location, plans, friends) | chat-like ask, recommendations | 1.0.14–1.0.17, location setting 1.0.19 [listing, site] |
| T09 | Friends activity | tab | social feed of friends' saves | feed, comments, mentions, likes, vouch | 1.0.4–1.0.7 [listing] |
| T10 | Share / take | from item | set take (Recommend / Want to try / Don't recommend) and visibility (Private / Friends / Public) | segmented choice | [site] |
| T11 | Curated collections | tab or explore | follow public expert lists, publish your own | follow, like, save | 1.0.19–1.0.20. Who viewed or followed: 2.0.7 [listing] |
| T12 | AI correction chat | from item | change category or tag | chat bot | the only way to correct a wrong tag, per one reviewer [review:13638986352] |
| T13 | Settings / account | profile | account, notifications | | **not documented publicly** |

Not observed or documented: search UI details, empty states, offline behaviour, export, delete, bulk actions.

## Flows

```
F01 Save a reel from Instagram
    (Instagram) Share -> Thingz in share sheet -> T02 -> auto-filed -> T05/T06
    happy path taps: ~3 (Share, Thingz, confirm/close) [infer from "share feature" reviews; not observed]
    edge: Facebook/Pinterest saves blank or failing [review:13641655295, 13660564335, 14045643071];
          import stops after ~30–99 saves [review:13680230313, 13674399835] (v1.0.3, Jan 2026; not mentioned since)
          wants to pick collection at share time, not after [review:14456616637] (v1.0.20, Aug 2026: still open then)

F02 Find something saved
    T04 -> T05 -> T06, or T08 (ask Loop)
    edge: generic titles and missing thumbnails make browsing guesswork [review:13650335996]

F03 Correct a wrong category
    T06 -> T12 chat -> suggestion
    edge: no direct edit or delete of an AI tag [review:13638986352] (v1.0.3; 2.0.5 claims easier collection management, not verified)

F04 Act on a save (recommend, plan, go)
    T06 -> T10 set take/visibility -> friends see it in T09; or T08 asks "what should we do tonight"

F05 Follow a curated collection
    T11 -> follow -> appears in Loop answers [site]
```

## Components (advertised)

Share extension card · category tile · save card (thumbnail, title) · enrichment details block · take selector (3-state) · visibility selector (3-state) · Loop ask box · friends feed card · curated-collection header with follow/like · camera/gallery picker.

## Inferred data model [infer, confidence: guess unless noted]

```
User        id, email, name?, gender, birth_year, location   (evidence: privacy policy §collected; confidence: high)
Save        id, user_id, source_url, source_platform, media (downloaded video/image?), title, category,
            enrichment {address, hours, phone, menu, price_range, ingredients, where_to_buy},
            note, user_photos[], take (recommend|want_to_try|dont_recommend), visibility (private|friends|public),
            created_at
            evidence: site product page, review 13557688612 ("locally downloads videos")
Collection  id, owner_id, name, is_curated, is_public, followers
Friendship, Comment, Like/Vouch, Mention, "TYSM" thanks   (evidence: version notes)
LoopQuery   text, context(location, date, friends)
```

Relationships: User 1-n Save; Save n-1 Category; User n-n Collection (follow); User n-n User (friends).

We can't know the server architecture from public material. The privacy policy says data is stored on US servers or third-party hosts.

## Privacy posture [listing, policy]

- App Privacy label: **Data used to track you: Identifiers.** Data linked: precise location, contact info, identifiers. Not linked: usage and diagnostics, used for advertising and analytics.
- The policy says an account is optional. It also describes advertising partners and Google Analytics, does not honour Do Not Track, and lets the company use submitted content for "any purpose including developing… marketing". It names no AI providers.

## What users value (positive themes, US App Store, n=36)

- **Auto-sorting without making folders**: 13629850528, 14332362771, 14135628032, 13603375613.
- **One place for saves from many apps, easy to find and show someone later**: 14349119118, 14236721450, 14135628032, 14063401192.
- **Videos kept locally, not only linked**: 13557688612.

## Complaints and requests, checked against later versions

| theme | reviews | first/last seen | later version note | status |
| --- | --- | --- | --- | --- |
| Saves from Facebook/Pinterest blank or failing | 13641655295, 13660564335, 14045643071 | 2026-01-16 → 2026-05-09 | none addresses it | **open (unverified)** |
| Missing thumbnails or generic titles | 13650335996, 13641655295 | 2026-01 | "improving media handling" (developer reply) | unknown |
| Can't correct AI tags directly | 13638986352 | 2026-01-15 | 2.0.5 "easier collection management" | unknown |
| Wants own organization / sub-collections | 13660564335, 14447371148 | 2026-01 → 2026-08 | 2.0.5 recipes section | partly? |
| Pick collection at share time | 14456616637 | 2026-08-21 | none | open |
| Import stops after N saves | 13680230313, 13674399835 | 2026-01 | none | unknown (no later reports) |
| Crashes / TLS errors / sign-up hang | 14321042977, 14182688750, 14282608126 | 2026-06 → 07 | many bug-fix releases | unknown |
| iPad version | 14097559024, 13657175679 | 2026-01 → 05 | listing still iPhone only | **open** |
| Bulk import of existing social saves | 14456616637, 13957033419, 13507759718 | 2025-12 → 2026-08 | none | open |
| Download images back to phone | 13728315910, 13638986352 | 2026-01 → 02 | none | unknown |
| Rebrand dislike | 14566273270 | 2026-09-18 | n/a | n/a |

Sample caveat: 36 written US reviews out of 769 ratings. All app-store sourced, so every theme here is thin by the pack's rule (it needs more than one source).

## Out of scope for Keepsake (cannot or should not be reproduced)

- The social graph, friends feed, public curated collections, view/follow counts, "TYSM": their network, and against Keepsake's private-by-default stance. **skip**.
- Expert/tastemaker content: licensed or partner content. **skip**.
- Location-based ad-supported recommendations. **skip** (privacy).

## Size (if Keepsake matched the useful private subset)

Screens about 9 of 13 relevant. Flows F01–F03 relevant, F04 partly (private takes), F05 skip. Hard parts: share-extension enrichment within iOS memory and time limits, video/image extraction from social sites, and context resurfacing without a server or location tracking. Size: **L** for the private subset across iOS plus Chrome.
