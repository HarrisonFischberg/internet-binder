# Keepsake design direction (proposal for the design gate)

Date: 2026-10-11 · Status: **for review.** Nothing here is wired into the extension or any app.

Files: `tokens/<style>.<mode>.json` (six sources: modern, moss, minimal × light, dark) → `build_tokens.py` → `tokens.css` (Chrome) and `Theme.swift` (Apple). Contrast reports sit next to each source (`tokens/*.contrast.txt`). Also `ia.md` (structure, flows, states) and `components.md` (specs). `prototypes/index.html` is a **static visual prototype** (no app logic, sample content).

## Update 2026-10-11: three user-selectable styles

After review, the owner asked for less moss and brass and a more modern UI, and for people to be able to choose. Keepsake now has three **styles**, each with light and dark:

| style | feel | colour | headings | shape and depth |
| --- | --- | --- | --- | --- |
| **Modern** (proposed default) | crisp, current | cool greys, cobalt accent, saturated kind colours | system sans, bold, tight tracking | 12–16 px radius, soft layered shadows |
| **Moss** | the original Keepsake | warm neutrals, moss accent, brass highlight | system serif (New York) | 10–14 px radius, light shadows |
| **Minimalist** | quiet, editorial | black and white, accent is ink; kinds carry only a hint of colour | system sans, medium | 4–8 px radius, hairline edges instead of shadows |

How it works: role names never change between styles, so every component is written once. The style is a device setting next to System/Light/Dark (Settings → Appearance). It's stored per device and not synced, like the theme today. Chrome sets `data-style` on the root element; Apple reads `KSStyle` from `@AppStorage`. All six combinations pass WCAG AA on all 40 pairs.

Decided: grid by default on the dashboard; favourites stay a star.

## Original direction (now the "Moss" style): "A well-kept shelf"

Keepsake is where good finds go to be kept and used, and the design should feel like that: calm, tidy, and quick. It should never feel like a feed. The direction keeps what's already recognisably Keepsake and modernises the rest.

| keep (identity) | change (modernise) |
| --- | --- |
| The bookmark mark; moss green as the accent; brass for what you love (favourites, wishlist) | Sharper neutrals with a slight moss bias instead of cream. Real elevation levels (card, raised, overlay). Fewer borders |
| A serif for headings only (system serif: New York on Apple, Iowan/Palatino/Georgia on Chrome) | System sans for everything you read or tap; Dynamic Type sizes on Apple |
| Calm, uncluttered pages | **Kind colours**: each kind of save (product, place, recipe, video, article, workout, film/show, book) has a quiet tint and a matching icon, so a mixed library scans at a glance |
| Review as the place uncertain saves wait | Review moves into the capture moment as well: the capture card shows the collection chip and its confidence, so most corrections take one tap before you leave the page |

Why this and not something closer to the references: the competitors lean social and playful (feeds, curated public lists, onboarding with rewards). Keepsake's users come for a private, tidy library, and the competitor feedback says they value "one place", "sorting done for me" and "a calm, polished UI" (feedback V1, V2, V5). Nothing here reuses either app's colours, layouts, icons or copy. Their brand colours weren't sampled, because no screenshots were captured.

No remote fonts and no icon CDN. Chrome uses inline SVG icons drawn on a 24 px grid in a Lucide-compatible style (Lucide is ISC-licensed; any icon copied in keeps its licence notice). Apple uses SF Symbols. `components.md` maps names between the two.

## One product, three environments

| | Chrome popup / capture card | Chrome dashboard | iPhone | iPad / Mac |
| --- | --- | --- | --- | --- |
| Width | 380 px popup; 360 px in-page card | 1240 px max content, 248 px sidebar | compact | split view: sidebar, list, detail |
| Navigation | none; one task | sidebar: Home, Library, Review (when needed), kinds, collections; Settings at the bottom | tab bar: Home, Library, Map, Search; Review appears as a Home banner and a badge | sidebar with the same sections as Chrome; toolbar search; ⌘F, ⌘N, ⌘⌫ |
| Density | compact | comfortable grid; list option | comfortable list and grid | grid or list; keyboard first on Mac |
| Capture | toolbar, shortcut, right-click, on-page buttons | Import | share sheet card, in-app paste link, photo | share sheet (iPad), Share menu and services (Mac), paste |
| Map of places | list + "Open in Maps" | list grouped by city + "Open in Maps" | MapKit map tab | MapKit map in the detail pane |

What stays the same everywhere: names (see `ia.md` §Terminology), the kind icons and tints, the save card's anatomy (image, kind, title, the one fact that matters for that kind, note preview), item states, the confidence pill, Undo after every change, and the privacy line "Saved on this device".

## First implementation slice to propose after approval

**Capture card + Review, Chrome** (S01 + S09 in `replica/recon.md`), built on M1's save-first pipeline:

1. The capture card in the popup and as the in-page card (replacing today's toast), with every state: saving, saved, saved to Review, finishing details, duplicate, link only, offline, couldn't read the page, storage full.
2. The Review page in the new design, with kind badges and top-3 suggestions.
3. Tokens in `tokens.css` adopted by those two surfaces only. The rest of the dashboard stays on the current styles until M2.

Why this slice: they're the most-used screens and the core of the differentiator, they exercise every capture state, and they stay small enough to review in one sitting.

Not yet decided, and needing your input at review:
- whether the Chrome dashboard defaults to grid or list (the prototype shows grid);
- whether "Favourite" stays a star or becomes "Love" with the brass heart (the prototype shows a star, to keep 1.x behaviour).
