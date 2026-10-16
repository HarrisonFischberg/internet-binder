# Keepsake privacy policy

_Last updated: October 2026 · applies to Keepsake 1.4.3_

Keepsake is a browser extension that saves products and inspiration into collections **stored only in your browser**. It has no server, no account, no analytics and no advertising. This document describes exactly what it stores, what it can send and when, and how to inspect or erase all of it.

## What Keepsake stores (locally)

All data lives in the browser profile you installed Keepsake in: your saves, collections and learned preferences in the extension's own **IndexedDB** database, and settings and the AI key in `chrome.storage.local`. None of it is uploaded by Keepsake.

| Where | Contents |
| --- | --- |
| IndexedDB `items` | Each save: title, price and currency, retailer/host, page URL and canonical URL, image URL(s) — or, for Instagram imports, a small locally stored thumbnail (JPEG, ≤ 320 px), your note, flags (favorite, purchased, archived), the collection it is in, the confidence and one-line reason the categorizer gave, the store's own product type and tags when the page publishes them (used to sort the item), and for Instagram cards the creator name, caption, Saved-collection name, post date, location, hashtags, caption links and creator-tagged products. Products you save from a post keep a reference to that post's id. When you last opened it in Keepsake (for Home's *Come back to*; worked out on this device, and you can turn the section off). Also the title as first captured (kept when you or the AI change it), which fields you edited by hand, whether details are still being finished, and, for saves in the Trash, when they were deleted. What kind of save it is (product, recipe, workout…) and that kind's details: a recipe's ingredients, steps, servings and times; a workout's exercises (sets, reps or time, rest); a place's address, pin, phone, cuisine, price range and opening hours as published on the page; a video's length, channel and date; an article's author, site, date, word count and reading time (the word count is counted on your device from the page you saved). A film's or show's year, director or creator, runtime or seasons and genres; a book's author, year, pages and ISBN. Tags ("AI", "Shoes"…), guessed on your device from the title, channel and description, or set by you. |
| IndexedDB `goals` and `checkins` | Workout goals you create (which workout, "3× a week for 4 weeks" or a target like 3×12, start day, an optional week-by-week plan) and each check-in (when, optional sets, reps, time and note). Ended goals are kept 30 days so they can be restored. Included in exports. |
| IndexedDB `collections` | Collection names, descriptions, keywords, aliases, cover image URL, placeholder color, whether it's pinned, and order. |
| IndexedDB `prefs` | The confidence threshold, the auto-create setting, keyword and retailer weights learned from your moves, and a capped history of the last 200 corrections (title, from → to). |
| `keepsake_settings` | Style and theme, on-page button options, Instagram import options, AI provider settings (provider, base URL, model, enabled flags), onboarding flag. |
| IndexedDB `importHistory` | Which Instagram post URLs have already been imported, so re-scans don't duplicate. |
| `keepsake_secrets` | Your AI API key, if you added one. **Excluded from exports.** |
| IndexedDB `aiLog` | What *Fix with AI*, and the AI tidy after a save, changed (item id and title, each field's value before and after, the AI's one-line reason), capped at 3,000 entries, so changes can be undone. **Excluded from exports.** |
| `keepsake_meta` | Schema version for migrations. |
| `keepsake_items`, `keepsake_collections`, `keepsake_prefs`, `keepsake_importHistory`, `keepsake_aiLog` | Only if you used Keepsake 1.3 or earlier: your library as it was before 1.4 moved it to IndexedDB, left unchanged so an older version still works. Erased by *Delete all local data*. |
| `keepsake_igScan` (session only) | A summary of an Instagram scan in progress (status, how many posts, which tab, the collection's name); cleared after import or when the browser closes. |
| IndexedDB `keepsake-scan` | The posts an Instagram scan in progress found (links, grid captions, creator names) and the thumbnails it copied (small JPEGs, ≤ 320 px), until you import them; cleared when the next scan starts, after its import and with *Delete all local data*. |

Keepsake does **not** store browsing history, page contents beyond the fields above, cookies, form data, credentials, or anything from pages you did not save from.

Displayed images are loaded from their original sites (the retailer's CDN, Instagram's CDN, or Unsplash for the optional sample data) by your browser, exactly as a web page would load them.

## What runs where

- **Toolbar popup / keyboard shortcut / right-click menu:** Keepsake reads the current page's title, price, images, structured data and breadcrumbs **at the moment you invoke it**, using Chrome's `activeTab` grant. No script is left running on the page.
- **On-page save buttons (off by default):** when you enable them for a site (or all sites), a small script runs on those pages to show a Save button next to product cards. It reads a card's title/price/link/image **only when you hover, focus or save it**. It never sends page data anywhere; saves go to the extension's background worker and into local storage.
- **Instagram Saved-collection import:** only when you click *Import this collection* on one of your own Saved-collection pages, a reader runs in **that tab**, scrolls the collection, and collects post links, thumbnails and alt-text captions from the grid. It never reads cookies, tokens, messages, your feed or anything about your account, and stops at the end, on idle, at the safety limit or when you press Stop. Thumbnails are copied locally because Instagram image links expire (you can turn this off).
- **"Read post details" (optional):** after a scan, Keepsake can request each imported post's own page from `www.instagram.com` — the same request your browser makes when you open the post, carrying your existing session cookie so the page renders — and parse out the caption, creator, date, location, hashtags, caption links and any products the creator tagged. It reads only the post pages for posts in that scan, one at a time with a pause between them; it does not read your feed, profile, messages, followers or any other page, and it never sends this data anywhere. If Instagram answers with a login page, Keepsake opens the post in a short-lived background tab instead, reads the same fields, and closes it. This needs the optional `https://www.instagram.com/*` permission, requested from the review screen and revocable under Settings → Instagram.
- **Background worker:** has no timers. It wakes only for messages from Keepsake's own pages/scripts, the context menu and permission or settings changes. Its only network access is the call to your AI provider when Optional AI is on, and the Lookups you turned on (see below).

## Network access

Keepsake makes **no network requests of its own**, with these exceptions, each off until you turn it on:

**Optional AI** — off by default, and a single switch. If you turn it on:

- You choose the provider (OpenAI, Anthropic, or a custom OpenAI-compatible endpoint) and supply **your own API key**. Keepsake asks Chrome for permission to contact only that provider's origin; turning AI off gives that permission back.
- When you click *Find this product online*, Keepsake shows the exact payload first: the post's locally stored thumbnail (as an image) and its caption, creator and Saved-collection name (as text). Remote Instagram URLs are not forwarded. Nothing else is sent.
- With web search enabled, the provider runs its own web searches (up to three per post) using that text. Those searches happen on the provider's servers under its policy; Keepsake sends nothing extra and keeps only links that appear in the provider's own search results, discarding any the model invented.
- After every save (toolbar icon, on-page button or right-click), once the save is already stored on your device, Keepsake sends that item's title, price, description, retailer, category/breadcrumbs, the store's product type and the **names** of your collections, from the extension's background worker. The AI's tidied title and collection choice are then applied, unless you already changed them yourself, and recorded in the change log with Undo. If the provider can't be reached, the save simply stays as it was.
- (Not AI) **Open in Maps** on a place opens Apple Maps or Google Maps in a new tab with that place's name and address (or its pin) in the link. Keepsake builds the link from what's saved and looks nothing up; the maps site receives it only when you click.
- Only when you ask: **Draft a recipe with AI** (Edit details, on a recipe with no ingredients) sends the save's title, caption or description and site name; **Suggest a progression** (on a workout goal) sends the workout's title, its exercises, the goal's numbers, your best result so far and the week you're in. You see the result first and decide whether to keep it; kept results are recorded in the change log with Undo.
- **Filling in a Lifestyle save**: when you save something into Places, Films & shows, Books, Recipes or Workouts (or move it there) and the post doesn't say enough, Keepsake sends its title, caption (and an Instagram post's location tag) or description and site to your provider, which names the place, film or book it's about, lists a workout's exercises, or drafts a recipe. The result is labelled, logged in the change log and can be undone.
- When you start *Fix with AI* (from Review or the AI page), Keepsake sends, for each item in the scope you picked: its title, price, retailer, a short description or caption, its current collection name, and — if you allowed live-page reading — the title, price and availability found on its product page, plus your collection names. Every change it applies is recorded in a local change log (`keepsake_aiLog`) so it can be undone; the log is never exported.
- The provider's own privacy policy and pricing apply to those requests. *Find products* results are stored with the item as clearly labelled, possibly inaccurate suggestions, and links a model made up are discarded. Instant-save and *Fix with AI* results are applied to the item directly (the tidied title, a price that was already on the page, the collection) and can be undone.

**Lookups** — off by default, one switch each under Settings → Lookups. Turning one on asks Chrome for that one site; turning it off gives the permission back. Requests carry no cookies and no account.

- **Places: OpenStreetMap.** For each place you save, Keepsake sends its **name and city** (and street, if known) to OpenStreetMap's Nominatim (`nominatim.openstreetmap.org`) to find its address and map pin, at most one request a second. The **map** in Places is drawn on your device by MapLibre (bundled inside Keepsake) with map tiles from OpenFreeMap (`tiles.openfreemap.org`), which therefore learns which **map area** you look at. A result is used only if its name matches the place you saved and it is in the city or area you saved; when the name matches places in different spots, none is used.
- **Films & shows: Wikidata.** Sends the **title** (and year, if known) of films and shows you save to `www.wikidata.org` for the year, director or creator, runtime, seasons, genres and poster. Posters load from Wikimedia Commons.
- **Books: Open Library.** Sends the **title** (and author, if known) of books you save to `openlibrary.org` for the author, year, pages, ISBN and cover. Covers load from `covers.openlibrary.org`.
- Only missing details are filled in; anything you or the page already gave is kept. Each save shows where its details came from ("Details from Wikidata ↗").

**Live product pages ("Fix with AI" only)** — if you tick *Read each item's live product page* when starting a run, Keepsake fetches the saved page URL of each item in that run, from your browser, **without cookies** (`credentials: 'omit'`), and reads only its structured product data (JSON-LD and product meta tags) with a parser that never runs the page's scripts. Nothing from those pages is stored except the fixes that are applied. This needs the optional all-sites permission.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Keep your settings locally. |
| `unlimitedStorage` | Let your library grow past Chrome's 10 MB default for extension storage. It stays on your device. |
| `activeTab`, `scripting` | Read the page you explicitly asked Keepsake to save from, and show the confirmation toast there. |
| `contextMenus` | The "Save to Keepsake" right-click item. |
| Optional site access (`*://*/*` or individual sites) | Requested **only** if you enable on-page save buttons, use *Import from tabs* (all sites, to read the open tabs you choose to import), or start a *Fix with AI* run with live-page reading ticked (all sites, to fetch your saved items' product pages). Revoke in Keepsake's settings or at `chrome://extensions`. Leaving "all sites" mode returns the permission automatically. |
| Optional `https://www.instagram.com/*` | Requested **only** when you use "Read post details" during an Instagram import. Revoke under Settings → Instagram. |
| Optional provider origin (e.g. `https://api.openai.com/*`) | Requested **only** if you turn AI on; given back when you turn it off. |
| Optional `https://nominatim.openstreetmap.org/*`, `https://tiles.openfreemap.org/*` | Requested **only** when you turn on Places lookups (or the map); given back when you turn them off. |
| Optional `https://www.wikidata.org/*` | Requested **only** when you turn on Films & shows lookups. |
| Optional `https://openlibrary.org/*` | Requested **only** when you turn on Books lookups. |

Keepsake does not request `tabs`, `history`, `cookies`, `webRequest`, `identity`, `alarms` or any other permission.

## Your controls

- **Export**: Settings → Data → *Export JSON* downloads everything, including the Trash, except the AI key and the AI change log.
- **Trash**: deleting a save moves it to the Trash, where it stays for 30 days (cleared when you next open the dashboard after that). *Delete forever* and *Empty Trash* remove saves immediately.
- **Import**: merge or replace from an export file, after validation.
- **Erase**: *Delete all local data* wipes everything above, in IndexedDB and `chrome.storage.local` (including the API key and any pre-1.4 copy), after a typed confirmation. Uninstalling the extension also removes its storage.
- **Inspect**: the in-extension *Privacy* page repeats this policy; the source is readable — there is no build step or minification.

## Children, sales, tracking

Keepsake is not directed at children under 13, does not sell or share data (it has none), does not use cookies, fingerprinting or analytics, and contains no remote code.

## Changes

If a future version changes what is stored or sent, this file and the in-extension Privacy page will be updated and the change will be noted in the version's release notes.
