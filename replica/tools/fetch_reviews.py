#!/usr/bin/env python3
"""Build replica/reviews.csv from Apple's public customer-reviews RSS feed.

Standard library only. Reads at most 10 pages per app with a pause between
requests (the feed's own maximum). Rows keep the review text exactly as Apple
serves it, deduplicated by Apple's review id, and are tagged with the
competitor and the app version the reviewer was on.

    python3 -I replica/tools/fetch_reviews.py            # fetch and write
    python3 -I replica/tools/fetch_reviews.py --from DIR  # use saved <appid>-<page>.json files

Columns: source,url,date,rating,text (what replica-entrepreneur's reviews.py
reads) plus app,review_id,version,title,author. The url is the app's public
review listing; Apple does not publish a link per review, so review_id is the
key for finding a row again.
"""
import argparse, csv, json, os, sys, time, urllib.request

APPS = {
    "thingz": "6744123389",   # formerly Likepost, same App Store id
    "albo": "6578421992",     # formerly Sortd
}
LISTING = {
    "thingz": "https://apps.apple.com/us/app/thingz/id6744123389?see-all=reviews",
    "albo": "https://apps.apple.com/us/app/albo-save-organize/id6578421992?see-all=reviews",
}
FEED = "https://itunes.apple.com/us/rss/customerreviews/page={page}/id={app}/sortby=mostrecent/json"


def pages(app, src_dir):
    for page in range(1, 11):
        if src_dir:
            path = os.path.join(src_dir, f"{app}-{page}.json")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as fh:
                yield json.load(fh)
        else:
            with urllib.request.urlopen(FEED.format(page=page, app=app), timeout=30) as res:
                yield json.load(res)
            time.sleep(1)


def entries(feed):
    es = feed.get("feed", {}).get("entry", [])
    return [es] if isinstance(es, dict) else es


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="directory of saved feed pages")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "reviews.csv"))
    args = ap.parse_args()
    rows, seen = [], set()
    for name, app in APPS.items():
        n = 0
        for feed in pages(app, args.src):
            for e in entries(feed):
                if "im:rating" not in e:
                    continue  # the first entry of page 1 is the app itself
                rid = e["id"]["label"]
                if rid in seen:
                    continue
                seen.add(rid)
                n += 1
                rows.append({
                    "source": "app-store-us", "url": LISTING[name],
                    "date": e["updated"]["label"][:10], "rating": e["im:rating"]["label"],
                    "text": e["content"]["label"], "app": name, "review_id": rid,
                    "version": e["im:version"]["label"], "title": e["title"]["label"],
                    "author": e["author"]["name"]["label"],
                })
        print(f"{name}: {n} reviews", file=sys.stderr)
    rows.sort(key=lambda r: (r["app"], r["date"]), reverse=True)
    cols = ["source", "url", "date", "rating", "text", "app", "review_id", "version", "title", "author"]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
