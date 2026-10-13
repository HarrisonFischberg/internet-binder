# Live smoke test

Runs Keepsake against real pages on the web, the way you would use it: open a page, save it, and see what
Keepsake made of it (kind, name, address, map pin, film or book match). It complements the unit tests
(`npm test`), which use made-up pages and never touch the network.

```bash
node replica/tools/smoke_live.mjs                       # every page in sites.json (about 15 minutes)
node replica/tools/smoke_live.mjs --only gmaps-top-pot,site-saigon-sandwich
node replica/tools/smoke_live.mjs --no-lookups          # skip OpenStreetMap / Wikidata / Open Library
```

It needs Comet (or Chrome: `--browser /path/to/Chrome`) and runs headless in a throwaway profile; your own
browser and data are never touched. Reports go to `reports/<date>.md` (and `.json`); a run with `--only`
writes `reports/<date>-partial.md`.

## What the statuses mean

| status | meaning |
| --- | --- |
| pass | Keepsake produced what the page's `expect` asks for |
| gap | it passes, but falls short of the page's `ideal` (something Keepsake can't do yet) |
| fail | wrong: fix it, or fix the expectation if the page changed |
| blocked | a login wall, bot check or error page: reported, never worked around |
| error | the page or the save broke |

## Pages (`sites.json`)

About 55 real pages across places (business sites, Yelp, Tripadvisor, Time Out, The Infatuation, OpenTable,
Fresha, Booksy, Discover LA, Instagram reels and profiles, Facebook pages, Google Maps links), articles and
discussions (news, Reddit, Tripadvisor forums, Wikipedia), and the other kinds (recipe, workout, YouTube,
Letterboxd, Goodreads). Each entry has:

- `expect`: what Keepsake must produce: `kind` (one or a list), a word that must be in the `name`, and
  `address: true` when a street address must be found.
- `ideal` (optional): what it should produce one day. Missing it is a gap, not a failure.

Add pages the same way: real ones you've seen, with expectations taken from the page itself, not guessed.

## Being a good visitor

One page at a time, a pause between pages, about 55 pages per run, run by hand now and then. OpenStreetMap
gets at most one request a second. Sites that block automated visits (Yelp, Tripadvisor, Booksy, Instagram
when logged out) show up as blocked, and that's fine: in your own browser they load normally.
