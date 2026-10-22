# Internet Binder — Chrome Web Store graphics (2.2.1)

Made on 2026-10-22 for the rename from Keepsake. They replace `../store-screenshots/`, which date from
1.4.1 and still show the Keepsake name and the old UI.

## `upload/` — what goes on the store listing

| File | Store slot | Size |
| --- | --- | --- |
| `store-icon-128.png` | Store icon | 128×128 |
| `screenshot-1-home.png` | Screenshot 1 | 1280×800 |
| `screenshot-2-library.png` | Screenshot 2 | 1280×800 |
| `screenshot-3-places-map.png` | Screenshot 3 | 1280×800 |
| `screenshot-4-recipe-dark.png` | Screenshot 4 (dark mode) | 1280×800 |
| `screenshot-5-workout.png` | Screenshot 5 | 1280×800 |
| `promo-tile-440x280.png` | Small promo tile | 440×280 |
| `marquee-1400x560.png` | Marquee promo tile | 1400×560 |

All are 24-bit PNG with no alpha channel, as the store requires.

## `alternates/`

The other mode of each screenshot. **Don't use `2-library-dark.png`:** it shows a 2.2.1 bug where
the "Links" filter chip is dark text on a dark background and can't be read.

## How they were made

- **Screenshots** are the real 2.2.1 dashboard (`keepsake/src/dashboard/dashboard.html`), rendered
  headless in WebKit at 1280×800 with the extension's own "Load sample data" library and a small
  in-page stand-in for the `chrome.*` APIs. The Places map is live OpenFreeMap tiles, with the
  attribution left in.
- **Promo tile and marquee** are HTML in the Pantry Pop look (colors from
  `keepsake/src/shared/tokens.css`, Bricolage Grotesque and Nunito from `keepsake/fonts/`), with the
  icon from `tools/icons/styles/pantry/light-1024.png` and the Home screenshot.
- The store icon is `keepsake/icons/styles/pantry/icon128.png`, the same file the manifest uses.
