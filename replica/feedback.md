# Feedback: what Thingz and Albo users value and complain about

Date: 2026-10-11. Data: `replica/reviews.csv`, built by `replica/tools/fetch_reviews.py` from Apple's public US customer-review RSS feed. That's every page the feed returned: **Thingz 36 reviews** (2025-12-12 → 2026-09-18, versions 1.0.3 → 2.0.4) and **Albo 78 reviews** (2025-06-11 → 2026-10-09, versions 0.2.13 → 1.24.0). Deduplicated by Apple review id (0 duplicates).

How to read this:

- Review text is kept **exactly** in `reviews.csv`. Below, each review is **paraphrased** and cited by its `review_id`, so every claim can be checked against the exact words.
- The only link Apple publishes is the app's review listing (in the `url` column). There's no per-review URL.
- **Every theme is single-source (App Store US).** By the pack's rule all themes are "thin". Google Play, Reddit and HN produced nothing usable (see the recon maps). Treat counts as directional, not as demand.
- The pack's `reviews.py` ran cleanly (0 dropped, 0 duplicates), but its default themes target SaaS products and misfiled several reviews. The themes below were coded by hand from the full text.
- These are **competitor users**, not Keepsake users. No Keepsake user feedback was available.

## 1. What users value (keep or match these)

| # | value | Thingz | Albo | notes |
| --- | --- | --- | --- | --- |
| V1 | **One place for saves from every app**, so you can find something later and show it to someone | 14349119118, 14236721450, 14135628032, 14063401192 | 14235261118, 14092778103, 13267190530, 12824957728 | The strongest positive theme in both. People describe losing reels across Instagram, Facebook and YouTube, and texting themselves links. |
| V2 | **Sorting happens for me** (no folders to make) | 13629850528, 14332362771, 13603375613 | 14486546644, 13388904393 | Valued when it's right. See C3 for when it's wrong. |
| V3 | **Getting back to saves without doom-scrolling** the social app | 14135628032 | 14422899148, 13365380118, 14235261118, 13579228065 | Albo users frame it as escaping the feed. |
| V4 | **Saves become plans**: a map for a trip, date ideas, places nearby | — | 13868501849, 14106199572, 13386664485, 13767303986, 13780902262 | Places are the clearest "act" use case in the sample. |
| V5 | **Polished, calm, high-quality UI** | 13603375613 | 13589738145, 13267190530, 13517108046, 14427787205 | Design quality is noticed and praised. |
| V6 | **Save into a folder right from the share sheet** | (requested: 14456616637) | 13586686391 | Same need, Albo has it. |
| V7 | **Media kept, not just a link** | 13557688612 | (lost: 13756857108) | Thingz praised for keeping videos locally. Albo criticised when videos became stills. |
| V8 | **Recipes, workouts, books, shows** as kinds | 13629850528, 14447371148 | 14486546644, 14422899148, 13365380118, 14113805234 | Recipes appear in both apps' samples. Shows and books in Albo's. |

## 2. Complaints: what goes wrong

Ranked by count, with recency checked against the latest version notes. "Current" means seen in a review on a 2026-08 or later version with no fix in the changelog.

| # | complaint | count | reviews | latest seen | status vs current version |
| --- | --- | --- | --- | --- | --- |
| C1 | **Saves fail, vanish, or come out blank**; server or connection errors | T 6, A 9 | T: 13641655295, 13660564335, 14045643071, 13680230313, 13674399835, 14182688750 · A: 12777672062, 13571220612, 13463501366, 13811459987, 13674959540, 13581966606, 13295393175, 13133663357, 12824957728 | T 2026-06, A 2026-03 | Both shipped many fixes and Albo's 1.22 "rebuilt for iPhone". No recent reports in this sample, so possibly improved. **Still the single most common failure, and the one Keepsake can beat structurally (local save first).** |
| C2 | **Paywall, weekly save/import limits, confusing tiers** | A 8 (T 0) | 12885997921, 14149947612, 13804944583, 14239481685, 14432340080, 14566457729, 14648611545, 14150327660 | **2026-10-09** | **Current.** Thingz is free with no IAP. |
| C3 | **Sorting is wrong and I can't fix it** | T 2, A 3 | T: 13638986352, 13660564335 · A: 13697730838, 13597754083, 13573961918 | 2026-01 | Both claim later changes (Thingz 2.0.5 "easier collection management", Albo 1.18/1.20/1.21). Unverified. |
| C4 | **Poor titles and thumbnails** make the library hard to browse | T 3 | 13650335996, 13641655295, 13660564335 | 2026-01 | Unknown. The developer reply promised better media handling. |
| C5 | **Onboarding and sign-up friction**: long, stuck, repeating, keyboard bug | T 1, A 5 | T: 14282608126 · A: 14312598718, 14302726125, 14041832219, 13489189091, 13295393175 | 2026-07 | Mixed. Several reviewers praise the same onboarding (13517108046, 14304594177). |
| C6 | **Bulk import of existing saves is missing, partial, or needs a computer** | T 3, A 4 | T: 14456616637, 13957033419, 13507759718 · A: 13804200602, 14566457729, 13443851544, 13573961918 | **2026-09-18** | Current for Albo's "computer only / collections only". |
| C7 | **Organisation controls missing**: nested folders, bulk move, sort A–Z, search within collection, filter by place | T 2, A 5 | T: 13660564335, 14447371148 · A: 13578727659, 13597754083, 14275436876, 14327925723, 13573961918 | 2026-08 | Albo: folders 1.15, filters 1.20. Thingz: 2.0.5. Partly addressed. |
| C8 | **Type-specific extraction misses** (whole recipe, show from clip, ingredient quantities) | T 1, A 1 | T: 13723771097 · A: 14113805234 | 2026-05 | Thingz 2.0.5 recipe section. Albo 1.14 extraction. Unknown. |
| C9 | **Support unresponsive or feature broken for weeks** (map) | A 1 | 14635372354 | **2026-10-06** | **Current.** |
| C10 | **Can't get data out** (export recipe text, download images) | T 2, A 1 | T: 13728315910, 13638986352 · A: 12762381238 | 2026-02 | Albo's MCP is a partial answer. Thingz: nothing documented. |
| C11 | **No iPad** | T 2 | 14097559024, 13657175679 | 2026-05 | **Thingz still iPhone-only.** Albo added iPad in 1.14. |

## 3. Requests (features asked for by name)

| request | reviews | maps to |
| --- | --- | --- |
| Pick the collection at share time | T 14456616637 | capture: collection chip on the save card |
| Auto-suggest the best existing collection | T 14456616637, A 13600886699, 13573961918 | categorizer (Keepsake has it) |
| Import whole collections or folders from IG/TikTok/Facebook | T 14456616637, 13957033419 · A 13443851544, 13600886699 | import |
| Nested collections | A 13578727659 | organise (Albo added) |
| Bulk move / multi-select | A 13597754083, 13578727659 | organise (Keepsake has it) |
| Search within a collection; filter by location or country | A 13578727659, 14327925723 | find |
| Addresses in captions go straight onto the map | A 13573961918 | places kind |
| Offline maps | A 12775052440 | places, offline |
| Upload your own images or files | A 13735322345 | capture |
| Export extracted text to other apps | A 12762381238 | portability |
| Note visible without opening the item | T 13650335996 | card design |
| iPad | T 14097559024, 13657175679 | platform |
| Alphabetical sort of collections | A 14275436876 | Keepsake has A–Z |

## 4. Gaps Keepsake is positioned to close (hypotheses, need validation)

These are **hypotheses from competitor reviews**, not Keepsake user demand.

1. **"It saved, every time."** C1 is the top failure in both apps. A local-first, link-first save that never depends on a network round trip is a structural answer. It must be measured and proven (performance budgets in `roadmap.md`).
2. **"Sorting you can trust and fix."** C3 plus V2: users want automatic sorting **and** easy correction. Keepsake's Review queue, confidence and learn-from-move are differentiators no competitor documents. Validation: the correction rate and Review queue size in usability sessions.
3. **"No caps, no account, nothing leaves your device."** C2 plus both apps' tracking labels. Validation: whether privacy-motivated users exist in the target segment (interviews). The reviews barely mention privacy. Out of 114, one Albo reviewer says they'll check the terms to make sure the app is safe for users (13174100055), and one Thingz reviewer would accept ads funded by data targeting (14063401192). So **privacy is a values differentiator, not a demonstrated pain** in this sample.
4. **"Your data is yours."** C10: self-serve export already exists in Keepsake.
5. **Places and recipes are the two kinds with the most evidence** (V4, V8, C8, the map requests). Videos are the most-saved *source*, but "video" isn't a job; what's in the video is.

## 5. Not supported by this evidence

- Social features: few reviews ask for them (one Albo user looked forward to them, 13868501849). Don't infer demand.
- Natural-language "ask your saves": not mentioned by users in either sample (it's a marketing feature).
- Product saving: one Albo reviewer says links from some shopping stores won't import (13581966606). That's the only shopping-specific complaint, so Keepsake's product strength meets a real but thinly evidenced need here.
- Price tracking: no review in either sample mentions product prices, deals or discounts. The iOS plan's price tracking is product-owner direction, not user evidence.
