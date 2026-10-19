# Impeccable audit: Keepsake (whole app)

**Run details**
- Skill: Impeccable v4.6.0 (`/Users/harrison/projects/.claude/skills/impeccable`), `audit` command.
- Run read-only on 2026-10-19 against origin/main 7d0a657. No source files were changed.
- **Part 1, web.** The Chrome extension (`keepsake/src`) was scored against `reference/audit.md`, with the bundled detector.
- **Part 2, native.** These were scored against `reference/audit.native.md` and `reference/ios.md`, with no detector:
  - the iOS/iPadOS app, share extension and widgets (`ios/`)
  - the macOS Safari container (`safari/Keepsake`)
- Each part was run by a separate read-only sub-agent and is reproduced here in full.

| Surface | A11y | Perf | Theming | Responsive / Conformance | Integrity / Adaptivity | Total |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Chrome extension (web) | 2 | 3 | 2 | 3 | 3 | **13/20 Acceptable** |
| iOS / iPadOS + Mac container (native) | 2 | 2 | 3 | 3 | 3 | **13/20 Acceptable** |

---

# Part 1: Web audit (Chrome extension, `keepsake/src`)

**Scope:** `src/popup`, `src/dashboard`, `src/toolbar`, `src/content`, `src/shared`. `vendor/` was excluded.

**Evidence tags used below:**
- **[source]**: read from code.
- **[computed]**: WCAG contrast ratio worked out from the token hex values.
- **[rendered]**: seen in the built-in browser, served read-only from outside the repo, with `window.chrome` stubbed, 4 collections and 16 items seeded, light and dark, and a 375×812 viewport.
- **[emulated]**: viewport or colour scheme emulated. Touch gestures were not synthesised; those claims rest on [source] only.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | The toast "Undo" fails contrast in all 6 themes (1.59–3.34:1). The card focus ring is fully clipped. Keyboard focus drops to `<body>` after every data change. |
| 2 | Performance | 3 | Good lazy-loading and throttling. But every storage change destroys and rebuilds the whole view, and there are a few layout-property and blur animations. |
| 3 | Theming | 2 | Excellent generated token system: 3 styles × light/dark, all core pairs ≥4.5:1. But about 28 hard-coded colours bypass it and break dark mode, and hard-coded radii mean "Style" only half applies. |
| 4 | Responsive Design | 3 | The dashboard reflows cleanly at 375px with no overflow. But touch targets are 22–34px throughout, reorder is HTML5 drag only, and the on-page button needs hover. |
| 5 | Implementation Integrity | 3 | Coherent and product-specific. 3 of the 4 detector findings are false positives. Real drift: duplicate `/` handlers, a floating button on the legacy palette, misleading alias token names. |
| **Total** | | **13/20** | **Acceptable (significant work needed)** |

## Implementation Integrity Verdict

**Pass, with drift.** The UI is clearly product-specific, not template work:
- A token pipeline generated from `tokens/*.json` into `tokens.css` and `tokens-content.js` feeds both the extension pages and the closed-shadow in-page card.
- It is built around product concepts: kinds with their own colour roles, the capture card, collection suggestions with 1/2/3, and Lifestyle/Collections navigation.
- Privacy copy is careful.

**Detector:** `impeccable detect --json …` exited 2 with 4 findings, each checked in context.

| Detector finding | Location | Verdict |
|---|---|---|
| `broken-image` (`<img>` with no src) | `popup.html:107` `<img id="heroImg" alt="" hidden />` | **False positive.** The image is `hidden` and its `src` is set at runtime by `setHeroImage()`. |
| `marquee` (`.skeleton::after` infinite shimmer, popup) | `base.css:413-426` | **False positive.** It is a loading skeleton, removed when loading ends. |
| `marquee` (dashboard) | `base.css:413-426` | **False positive.** Same shared rule; `.skeleton` is unused in the dashboard. |
| `icon-tile-stack` (46px tile above h2 "Nothing to save here") | `popup.html:44-48`, `popup.css:132-146` | **True pattern match, low impact (P3).** The browser overlay also found it on the dashboard empty state, `ui.js:404-411`. |

The browser overlay also reported `low-contrast` on the sidebar collection initials, which is real (see P2 below).

**Drift beyond the detector:**
- **Duplicate "/" handlers:** two global keydown handlers fight each other (`dashboard.js:195-203` and `225-229`).
- **Floating button on the legacy palette:** the on-page Save button hard-codes legacy Moss colours and ignores the user's Style and Theme (`floating.js:20-39`).
- **Misleading alias names:** `--moss`, `--sage` and `--brass` now mean a blue accent in Modern (`base.css:16-20`).
- **Redesign layered as overrides:** the redesign landed as "Redesign R1/R2" override layers (`dashboard.css:3593`, `3811`), and 14 selectors are defined more than once.
- **Weaker `.sr-only` copy:** `popup.css:600-607` redefines `.sr-only` more weakly than `base.css:98-108`.
- **Dead class:** `.badge-sage` is unused (`dashboard.css:737`).

## Executive Summary

- **Audit Health Score: 13/20 (Acceptable).**
- **Issues found: 26.** P0: 0 · P1: 8 · P2: 11 · P3: 7.

**Top issues:**
1. **Toast Undo is nearly unreadable** in every theme: 3.34:1 light, 1.59:1 dark. Dark danger toasts are 2.28:1.
2. **Library card focus is invisible.** The 2px outline on `.card-hit` is clipped by `.card { overflow:hidden }`. Menu item focus is a background change of only 1.12:1.
3. **Focus is destroyed after each change.** Starring an item or flipping a setting sends focus to `<body>`. The whole `#view` is also `aria-live`.
4. **The mobile nav drawer is unsafe for keyboards.** When closed, 24 off-screen controls stay tabbable. When open, Esc doesn't close it, focus isn't moved into it, and the toggle is covered.
5. **The collection row's pin button sits inside `<li role="link">`,** so assistive tech can't reach it.

**Next steps:** `/impeccable harden`, then `/impeccable colorize`, then `/impeccable adapt`, then `/impeccable polish`.

## Detailed Findings by Severity

### P1 Major

**[P1] Toast action ("Undo") and danger toasts fail text contrast in every theme**
- **Location:**
  - `dashboard.css:1996-2008` (`.toast`: background ink, text paper).
  - `:2020-2024` (`.toast-action { color: var(--brass) }`).
  - `:2041-2044` (`.toast-danger { background: var(--danger); color:#fff }`).
  - Built in `ui.js:189-229`.
- **Category:** Accessibility / Theming
- **Evidence:** [computed] Brass on ink, the Undo text:

  | Style | Light | Dark |
  |---|---|---|
  | Modern | 3.34 | **1.59** |
  | Moss | 2.63 | 1.71 |
  | Minimal | 2.96 | 1.71 |

  White on danger: 2.28 in dark, 2.44 in Moss dark, 2.39 in Minimal dark (5.75 in light). [rendered] The Undo button's border disappears on the light toast in dark mode.
- **Impact:** Undo is the main recovery path after a delete or move. Its ⌥Z shortcut can't be discovered, and low-vision users can't read the button.
- **WCAG:** 1.4.3 AA
- **Recommendation:** Generate inverse tokens per theme (`--c-inverse-surface`, `--c-inverse-text`, `--c-inverse-accent`) so the action reaches ≥4.5:1. For danger toasts, use on-danger text, or danger text on a danger-soft background (6.85–7.23:1 in dark).
- **Suggested command:** `/impeccable colorize`

**[P1] "AI draft" badge text fails contrast in all light styles**
- **Location:** `dashboard.css:732-735` (`.badge-brass { background: var(--brass); color:#2a2926 }`), used at `dashboard.js:2025`.
- **Category:** Accessibility / Theming
- **Evidence:** [computed] 2.61:1 in Modern light, 2.46:1 in Moss, 2.28:1 in Minimal. Dark themes pass.
- **Impact:** The warning that AI wrote a field, at 11px, is the least legible text on the screen.
- **WCAG:** 1.4.3 AA
- **Recommendation:** Use `color: var(--c-highlight); background: var(--c-highlight-soft)`, which is 4.90–8.79:1 in every theme.
- **Suggested command:** `/impeccable colorize`

**[P1] Library card keyboard focus indicator is clipped (invisible)**
- **Location:** `dashboard.css:571-585` (`.card { overflow:hidden }`, and `:focus-within` adds only a shadow and translate); `:597-606`; `base.css:110-114`.
- **Category:** Accessibility
- **Evidence:** [rendered] `card-hit` matches `:focus-visible` with a 2px outline at offset 2px. Its rect equals the card's, so the outline is fully clipped and no ring is visible. In dark mode `--shadow-raised` is barely visible.
- **Impact:** Keyboard users can't tell which card is focused in the product's central grid.
- **WCAG:** 2.4.7 AA; 1.4.11
- **Recommendation:** Use `.card:has(.card-hit:focus-visible) { outline: 2px solid var(--c-focus); outline-offset: 2px }`, or `outline-offset:-2px` on `.card-hit`.
- **Suggested command:** `/impeccable harden`

**[P1] Menu item focus is only a 1.1:1 background shift**
- **Location:** `dashboard.css:842-846`; menu built at `dashboard.js:1084-1130`.
- **Category:** Accessibility
- **Evidence:** [computed + rendered] 1.12:1 in dark (`rgb(31,35,43)` on `rgb(22,25,31)`) and 1.14:1 in light. The outline is removed.
- **Impact:** Arrow-key navigation through the item menu, including Delete, gives almost no feedback.
- **WCAG:** 2.4.7; 1.4.11
- **Recommendation:** Give focus a real outline or an inset 2px `--c-focus` ring, separate from the hover style.
- **Suggested command:** `/impeccable harden`

**[P1] Every data change rebuilds the view and drops keyboard focus to `<body>`**
- **Location:** `dashboard.js:102-108` (`store.onChanged` triggers `render`); `:678-681` (`clear(view)`); the favourite button at `:1055-1058`; settings switches at `ui.js:383-388`. Nothing restores focus.
- **Category:** Accessibility / Performance
- **Evidence:** [rendered] After pressing "Add to favorites", and after toggling a Settings switch, `activeElement` is `BODY`.
- **Impact:** Every star, pin, setting change or background job sends keyboard and screen-reader users back to the top of the document.
- **WCAG:** 2.4.3; 3.2.2
- **Recommendation:** Give focusable controls stable `data-focus-key`s. Save the key before `clear(view)` and refocus it after render with `preventScroll`. Better still, patch the changed card in place.
- **Suggested command:** `/impeccable harden`

**[P1] The whole content area is an `aria-live` region**
- **Location:** `dashboard.html:139` (`#view aria-live="polite"`); `#toasts` is also live (`:144`), and each toast is `role="status"` (`ui.js:195`), so live regions are nested.
- **Category:** Accessibility
- **Evidence:** [source + rendered] Every route change, search keystroke (120ms debounce) or storage update replaces the region's content.
- **Impact:** Screen readers may read out large grid content or long card names after every change, and toasts may be announced twice.
- **WCAG:** 4.1.3 (misused)
- **Recommendation:**
  - Remove `aria-live` from `#view`.
  - Focus `h1#viewTitle` on navigation.
  - Announce result counts through one `role="status"` node.
  - Keep a single live mechanism for toasts, and use `role="alert"` for danger toasts.
- **Suggested command:** `/impeccable harden`

**[P1] Mobile nav drawer: hidden links tabbable, no Esc, no focus management, toggle covered**
- **Location:** `dashboard.css:2382-2412` (`translateX(-100%)` only; no `inert` or `visibility`; toggle at z 31, sidebar at z 32); `dashboard.js:234-240`; `dashboard.html:16` (label is always "Open navigation").
- **Category:** Accessibility / Responsive
- **Evidence:** [rendered, emulated 375×812]
  - Closed: 24 focusable controls are off-screen but still tabbable.
  - Open: Esc does nothing, focus stays behind the scrim, the 272px drawer covers the hamburger, and the label is unchanged.
- **Impact:** Below 900px, keyboard users pass 24 invisible stops before reaching content, and can only close the drawer by clicking the scrim.
- **WCAG:** 2.4.3; 2.4.7; 2.1.2; 4.1.2
- **Recommendation:**
  - Make the sidebar `inert` while it is closed at ≤900px.
  - On open, focus the first item. Esc closes it and returns focus to the toggle.
  - Swap the label to "Close navigation", or keep the toggle above the drawer.
- **Suggested command:** `/impeccable harden`

**[P1] Collection rows: interactive pin button nested inside `role="link"`**
- **Location:** `dashboard.js:444-480`
- **Category:** Accessibility / Implementation Integrity
- **Evidence:** [source] The children of a link role are presentational, so the button is hidden from most screen readers, and the list loses its list semantics.
- **Impact:** Screen-reader users can't pin or unpin collections.
- **WCAG:** 4.1.2; 1.3.1
- **Recommendation:** Keep a plain `<li>` containing a real `<a href="#c/{id}">` and a sibling pin `<button>`.
- **Suggested command:** `/impeccable harden`

### P2 Minor

**[P2] White initials on collection colours fail contrast**
- **Location:** `dashboard.css:235-247`, `:913-924`, `:2228-2232`; set inline at `dashboard.js:443,:2806,:3067`; palettes in `storage.js:183` and `taxonomy.js`.
- **Category:** Accessibility / Theming
- **Evidence:** [computed] Of 31 palette colours, 25 give white text below 4.5:1 and 9 below 3:1 (worst: `#9FB3A8` at 2.21, `#BE9C6B` at 2.57). The default `#8A9A88` is 2.98. The browser overlay confirms the same family (`#B9924F` at 2.9:1).
- **Impact:** The 11px sidebar initials are unreadable, and 9 colours fail even for large tile text. The collection name sits next to them, which limits the harm.
- **WCAG:** 1.4.3
- **Recommendation:** Pick black or white per colour by luminance, or darken the palette. Mark the 11px initial `aria-hidden`.
- **Suggested command:** `/impeccable colorize`

**[P2] Progress bar fill invisible against its track**
- **Location:** `dashboard.css:2468-2480`
- **Category:** Accessibility / Theming
- **Evidence:** [computed] 1.08:1 in light, 1.11:1 in dark.
- **Impact:** AI cleanup, import and fill progress can only be read from the text.
- **WCAG:** 1.4.11
- **Recommendation:** Fill with `--c-accent` on a `--c-surface-2` track.
- **Suggested command:** `/impeccable colorize`

**[P2] Switch thumb hard-coded `#fff`, disappears when checked in dark styles**
- **Location:** `base.css:323-334`, `:336-339`
- **Category:** Theming / Accessibility
- **Evidence:** [computed] Checked: 1.12:1 in Minimal dark, 2.06:1 in Moss dark, 2.63:1 in Modern dark.
- **Impact:** In Minimal dark the knob vanishes. The track fill still shows the state.
- **WCAG:** 1.4.11 (partial)
- **Recommendation:** Use `var(--c-on-accent)` when checked and `var(--c-surface)` when unchecked.
- **Suggested command:** `/impeccable colorize`

**[P2] Global reduced-motion "0.001ms kill" overrides the targeted alternatives**
- **Location:** `base.css:428-437`; `tokens.css:448`. Good targeted rules exist at `dashboard.css:541,1513,3439,3760,4040,4210`.
- **Category:** Accessibility / Performance
- **Evidence:** [source] The Instagram scan spinner (`popup.css:660-667`) freezes after one turn, so the page looks hung.
- **Impact:** Users who prefer reduced motion lose progress feedback instead of getting a calmer version of it.
- **WCAG:** 2.3.3 (AAA) intent; Impeccable motion rule.
- **Recommendation:** Remove the universal kill and keep the token zeroing and targeted rules. Add a non-rotating "Scanning…" indicator in a live region.
- **Suggested command:** `/impeccable animate`

**[P2] Collection reorder is HTML5 mouse-drag only; the keyboard path is undiscoverable**
- **Location:** `dashboard.js:510-545` (`bindDrag`), `:451-460` (Alt+↑/↓)
- **Category:** Responsive / Accessibility
- **Evidence:** [source] There are no pointer or touch handlers and no `touch-action`, and the Alt+Arrow shortcut is undocumented.
- **Impact:** Touch users can't reorder at all, and keyboard users won't find the shortcut.
- **WCAG:** 2.5.7 (2.2 AA)
- **Recommendation:** Add Move up / Move down to a row menu or as handle buttons, and surface the Alt+↑/↓ hint.
- **Suggested command:** `/impeccable adapt`

**[P2] In-page capture card hijacks the 1/2/3 keys on the host site**
- **Location:** `content/toast.js:211-222` (capture-phase keydown with `preventDefault` and `stopPropagation`)
- **Category:** Accessibility / Implementation Integrity
- **Evidence:** [source] For 6.5s × 1.25 (longer on hover), pressing 1/2/3 outside a text field files the save and blocks the site's own handlers (YouTube, Gmail, games). There is no Esc to dismiss.
- **Impact:** Accidental filing, and broken shortcuts on the host site.
- **WCAG:** 2.1.4 AA
- **Recommendation:** Only handle 1/2/3 when focus is inside the card's shadow root, or require a modifier. Add Esc to dismiss.
- **Suggested command:** `/impeccable harden`

**[P2] On-page Save button ignores the token system and the user's Style/Theme**
- **Location:** `content/floating.js:20-39`, `:109`. It hard-codes `#2A2926`, `rgba(250,247,241,.96)`, `#5F6F5E`, `#8A9A88`, `#EFEAE1` and `#FBF8F2`, plus its own font stack.
- **Category:** Theming / Implementation Integrity
- **Evidence:** [source] The capture card injects `__keepsakeTokenCss` and `data-style`/`data-theme`; the button does neither, despite the comment at `:10`.
- **Impact:** Modern and Minimal users see a sage button on every site, and its dark mode follows the OS rather than the chosen theme.
- **Recommendation:** Inject the token CSS into the button's shadow root, apply `config.look` as `toast.js:setLook` does, and map colours to `--c-surface`, `--c-text` and `--c-accent`.
- **Suggested command:** `/impeccable colorize`

**[P2] Style tokens bypassed: radii and spacing hard-coded, so "Style" only partly applies**
- **Location:** `dashboard.css`, `popup.css`, `base.css`, e.g. `base.css:128,194,201,235` and `popup.css:136,180,407`.
- **Category:** Theming / Implementation Integrity
- **Evidence:** [source]
  - 72 raw `border-radius` values vs 25 `var(--r-*)`.
  - The `--s-*` spacing tokens are used 0 times.
  - 102 raw `font-size` values vs 55 `var(--t-*)`.
  - Minimal's 4–6px radii are ignored by buttons, inputs, notices and popup cards, which stay at 10–12px.
  - About 320 legacy alias uses vs about 340 role-token uses.
- **Impact:** Switching Style changes colour but not shape, and the alias names mislead maintainers.
- **Recommendation:** Migrate to `--r-*` and `--s-*`, then retire the aliases in `base.css:7-40`.
- **Suggested command:** `/impeccable polish`

**[P2] Two global "/" shortcut handlers conflict**
- **Location:** `dashboard.js:195-203`, `:225-229`
- **Category:** Implementation Integrity / Accessibility
- **Evidence:** [source] Both handlers fire. On Home one navigates to `#all` while the other focuses `#homeSearch`, which the re-render then destroys. The critique's design reviewer verified in the browser that focus ends on `BODY`.
- **Impact:** The advertised "/" shortcut fails on Home and on collection pages.
- **Recommendation:** Use one handler that targets the current view's search and only navigates when there is none.
- **Suggested command:** `/impeccable harden`

**[P2] Touch targets consistently below 44px; some below the 24px AA minimum**
- **Location:**

  | Control | Location | Size |
  |---|---|---|
  | `.collection-pin` | `dashboard.css:266-271` | **22×22** |
  | `#collectionsToggle` | | 24×28 |
  | `#newCollectionBtn` | | 28×28 |
  | `.card-actions .btn-icon` | `:770-777` | 30×30 |
  | `.btn-sm` | `base.css:190-195` | 30px tall |
  | `.btn-icon` | `base.css:197-202` | 34px |
  | in-page `.close` | `toast.js:56` | 26px |
  | small floating button | `floating.js:19` | 28px |

- **Category:** Responsive
- **Evidence:** [rendered] measured with `getBoundingClientRect`; [emulated 375px].
- **Impact:** Mis-taps on touch Chromebooks and tablets.
- **WCAG:** 2.5.8 AA (the pin fails); 2.5.5 AAA / Impeccable 44px.
- **Recommendation:** Give 44px hit areas under `@media (pointer: coarse)`, and make the pin at least 24px everywhere.
- **Suggested command:** `/impeccable adapt`

**[P2] Missing ARIA state and announcements on several controls**
- **Location:**
  - More actions button (`dashboard.js:1059`): has `aria-haspopup`, but no `aria-expanded` [rendered: null]. The menu doesn't close on Tab and is appended to the end of `<body>`.
  - Theme toggle (`dashboard.html:120`, `dashboard.js:206-212`): the static label "Toggle theme" never states the current theme.
  - Popup image candidates (`popup.js:224-236`): `role="radio"` with no roving tabindex or arrow keys.
  - Instagram scan (`popup.html:68-75`): `#igCount` and `#igStatus` are not live regions.
  - Nav SVGs are not `aria-hidden`.
- **Category:** Accessibility
- **Evidence:** [source]; [rendered] for `aria-expanded`.
- **Impact:** Screen-reader users can't tell menu state or current theme, and don't hear scan progress.
- **WCAG:** 4.1.2; 4.1.3
- **Recommendation:**
  - Toggle `aria-expanded` and close the menu on Tab or focus-out.
  - Use a state-bearing label for the theme toggle.
  - Apply the arrow-key radio pattern to the image candidates.
  - Put `aria-live` on `#igStatus`.
- **Suggested command:** `/impeccable harden`

### P3 Polish

- **[P3] Masonry columns make reading and focus order run column-first**
  - **Location:** `dashboard.css:560-569` (`columns: 5 220px`)
  - **Category:** Accessibility / Responsive
  - **Evidence:** [rendered] Items 1–5 stack down column 1 before item 6 appears at the top of column 2.
  - **WCAG:** 1.3.2 / 2.4.3 (borderline)
  - **Recommendation:** Use a CSS grid with `grid-auto-flow: dense`, or a row-major JS masonry.
  - **Suggested command:** `/impeccable layout`
- **[P3] Layout-property and blur animations**
  - **Location:** `dashboard.css:1831` (max-height 900ms); `:2479` (width); `:724` (`backdrop-filter` blur on every badge); `:1669`; `floating.js:24`.
  - **Category:** Performance
  - **Impact:** Jank on low-end devices when many badged cards are on screen.
  - **Recommendation:** Animate transform or clip-path instead, use `scaleX` for progress, and give badges an opaque background.
  - **Suggested command:** `/impeccable optimize`
- **[P3] Duplicate, weaker `.sr-only` in the popup**
  - **Location:** `popup.css:600-607` vs `base.css:98-108`
  - **Recommendation:** Delete the popup copy.
  - **Suggested command:** `/impeccable polish`
- **[P3] Many text sizes below 12px**
  - **Location:** `dashboard.css:119,146,245,309,719,1257,1297,1591` (11–11.5px); `.pill` at `base.css:375`; `kbd` at 10px (`popup.css:575`, `toast.js:42`).
  - **Recommendation:** Set a 12px floor using `--t-caption`.
  - **Suggested command:** `/impeccable typeset`
- **[P3] Settings rows: the visible label is a `<div>` and the help text isn't linked**
  - **Location:** `ui.js:373-388`
  - **Evidence:** [rendered] `aria-describedby` is null. Generated labels read awkwardly, e.g. "Show Come back to on Home".
  - **Recommendation:** Use `<label for>` and link the help with `aria-describedby`.
  - **Suggested command:** `/impeccable harden`
- **[P3] Popup has no `h1`, and the product state has no heading**
  - **Location:** `popup.html:12-18` (the brand is an `<a href="#">` used as a button); `:103-176`.
  - **Evidence:** [rendered] Zero h1 and zero visible h2.
  - **Recommendation:** Add a visually hidden `h1` ("Save to Keepsake") and make the brand a `<button>`.
  - **Suggested command:** `/impeccable harden`
- **[P3] Generic icon-tile empty state (detector `icon-tile-stack`)**
  - **Location:** `popup.html:44-48`, `popup.css:132-146`, `ui.js:404-411`
  - **Recommendation:** Put the icon inline with the heading, or use a product-specific mark.
  - **Suggested command:** `/impeccable delight`

## Patterns & Systemic Issues

1. **Hard-coded colours outside the token system:**
   - about 28 literals in `dashboard.css`
   - all of `floating.js`
   - the switch thumb and the select caret (`base.css:272`)
   - 31 collection colours that were never contrast-checked

   Almost every dark-mode contrast failure comes from these. The generated token pairs themselves all pass (4.6–18.9:1 in all 6 themes).
2. **"Rebuild everything" rendering.** `clear(view)` followed by a full rebuild on each storage change. This one choice causes the focus loss, the noisy live region and wasted work on large libraries. It is the highest-leverage fix.
3. **Focus styling suppressed locally.** `outline:none` on `.menu-item`, `.title-input`, `.collection-name-input` and `.input:focus`, with a 28%-alpha halo of about 1.5:1, plus overflow clipping on cards. Together these keep undercutting a good global `:focus-visible`.
4. **Desktop-pointer assumptions.** Hover-revealed actions, a hover-triggered on-page button, HTML5-only drag, and 22–34px targets.
5. **Two token vocabularies plus override layers.** Legacy aliases next to role tokens, R1/R2 blocks at the end of a 4,356-line stylesheet, and 14 duplicate selectors.

## Positive Findings

- **The token pipeline is excellent.** It is generated from JSON for 3 styles × light/dark and injected into the closed shadow DOM, and every core role pair passes AA in every theme (minimum 4.74:1; muted text 5.7–8.2:1).
- **Dark mode is complete at the token level.** The `:root:not([data-theme="light"])` + `[data-theme="dark"]` pattern is correct, and the toolbar icon follows the scheme.
- **The modal is solid** (`ui.js:17-106`): `role="dialog"`, `aria-modal`, `aria-labelledby`, a Tab trap, Esc, focus restore, autofocus and correct stacking.
- **Toast timing is thoughtful.** Toasts pause on hover and focus, Undo stays for 10s, and errors persist (WCAG 2.2.1).
- **Cards are built well.** Each has one large `button.card-hit` with a full accessible name, a favourite button with `aria-pressed`, and labelled checkboxes.
- **Semantic shell.** A skip link, two labelled `<nav>`s, `<main>`, an `h1` per view, `h2`s in Settings, real buttons, and `sr-only` input labels in the popup.
- **Performance hygiene:**
  - MapLibre (about 1MB) is lazy-loaded.
  - Images use `loading="lazy"` and `decoding="async"`.
  - The grid renders 120 items at a time.
  - rAF and passive listeners are used.
  - The detector throttles mutations to 600ms with a WeakMap cache.
  - `will-change` is not misused.
- **Responsive dashboard.** `@container home`, an off-canvas sidebar at 900px, 2 columns at 480px, and no overflow at 375px.
- **Targeted reduced-motion rules already exist;** only the global kill needs to go.
- **Safe DOM.** `el()` and `textContent` instead of `innerHTML`, and the in-page UI lives in a closed shadow DOM.

## Recommended Actions

1. **[P1] `/impeccable harden`**:
   - Restore focus after re-renders, or patch in place.
   - Remove `aria-live` from `#view` and focus the `h1` on navigation.
   - Unclip the card focus ring (`.card:has(.card-hit:focus-visible)`).
   - Give menu items a real focus indicator.
   - Make the ≤900px drawer `inert` when closed, close it on Esc, manage its focus and update its label.
   - Split collection rows into a link and a pin button.
2. **[P1] `/impeccable colorize`**:
   - Add inverse and on-danger tokens so the toast Undo and danger toasts pass in all 6 themes.
   - Restyle the AI draft badge as highlight on highlight-soft.
   - Choose black or white initials by luminance.
   - Fix the progress fill and the switch thumb.
   - Move the floating button onto the tokens and the user's look.
3. **[P2] `/impeccable harden`**:
   - Scope the in-page 1/2/3 keys to the card and add Esc.
   - Merge the "/" handlers.
   - Add `aria-expanded` to the More menu.
   - Give the theme toggle a state label.
   - Apply the arrow-key radio pattern to image candidates.
   - Make the Instagram status a live region.
4. **[P2] `/impeccable adapt`**:
   - 44px coarse-pointer hit areas, and ≥24px for the pin.
   - Non-drag Move up / Move down, plus the Alt+↑/↓ hint.
5. **[P2] `/impeccable animate`**: Replace the universal reduced-motion kill, and add a non-rotating scan indicator.
6. **[P3] `/impeccable optimize`**: Use transform-based animations, and drop the per-badge `backdrop-filter`.
7. **[P3] `/impeccable layout`**: Switch the masonry to row-major order.
8. **[P3] `/impeccable typeset`**: Set a 12px floor.
9. **[P2/P3] `/impeccable polish`**:
   - Migrate to `--r-*` and `--s-*`.
   - Retire the aliases and fold the R1/R2 overrides into the base.
   - Delete the duplicate `.sr-only` and `.badge-sage`.
   - Add a popup `h1` and settings `<label for>`.
   - Replace the icon-tile empty state.

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run `/impeccable audit` after fixes to see your score improve.

---

# Part 2: Native audit (iOS/iPadOS app, Share Extension, Widgets, macOS Safari container)

**Scope and evidence**
- **Source audited:** `ios/App/*.swift`, `ios/KeepsakeKit/Sources/KeepsakeUI/*.swift` (plus the KeepsakeKit read paths they call), `ios/ShareExtension`, `ios/Widgets`, the `ios/Keepsake.xcodeproj` build settings, and `safari/Keepsake`.
- **Visual evidence:** captures in `impeccable-review/before/ios` and `before/mac`.
- **Not captured:**
  - accessibility Dynamic Type sizes
  - iPad in dark mode or landscape
  - Split View
  - the Linen and Ink themes

  Findings that depend on these are verified from source only.
- **Contrast:** ratios were computed from the hex values in `Theme.swift`.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | Labels, custom actions, Reduce Motion and Reduce Transparency are strong. But the Share Extension card can't scroll and overflows at large text, VoiceOver reads the Masonry grid column-by-column, and dark book covers fail contrast (2.74:1). |
| 2 | Performance | 2 | About 410 KB of JS is evaluated on the main thread before the first frame. Every mutation and foreground synchronously re-reads and JSON-decodes the whole library on the main actor. |
| 3 | Appearance & Theming | 3 | First-class dark variants, and every text pair passes AA in all 6 theme×mode combinations. But Increase Contrast is ignored, and widgets have no tinted or clear rendering. |
| 4 | Platform Conformance | 3 | The structure is native (TabView, NavigationSplitView, NavigationStack, sheets, menus). But the nav bar is hidden and redrawn in content, Library search is a custom dock, and the Mac container is a web page. |
| 5 | Adaptivity | 3 | A real iPad sidebar, all orientations, ⌘F/⌘,. But widget deep links do nothing on iPad, a size-class change rebuilds the whole tree, and the share popover anchor is hard-coded. |
| **Total** | | **13/20** | **Acceptable (significant work needed)** |

## Platform Conformance Verdict

**iOS/iPadOS: PASS. It reads as a native app, not a ported website.**

What is native:
- A real `TabView` on iPhone (`RootView.swift:42-47`) and a `NavigationSplitView` sidebar on iPad (`SplitRootView.swift:18-63`).
- Per-tab `NavigationStack`s, so edge-swipe back works.
- The zoom transition from card to detail.
- System `Form`s in sheets with Cancel/Done, and a `confirmationDialog` for deletes.
- Context menus and VoiceOver custom actions.
- System pickers, Stepper, Toggle, PasteButton and Menu.
- All icons are SF Symbols.
- The custom "objects on a table" visuals stay on the content layer, which `ios.md` allows.

Violations:
1. **The nav bar is hidden on the three root screens and redrawn in content** (`HomeScreen.swift:75`, `LibraryScreen.swift:93`, `PlacesScreen.swift:41`).
   - The serif title (`RootView.swift:164-176`) never collapses.
   - Paper-circle Settings and More buttons imitate toolbar buttons (`HomeScreen.swift:42-48`, `LibraryScreen.swift:126-138`).
   - Pushed screens set `.inline` with no `navigationTitle`, so the back-button history and the iPad nav bar are blank.
2. **Library search is a custom bottom dock** (`LibraryScreen.swift:357-388`), even though the iOS 27 deployment target has native bottom search.
3. **The share sheet goes through UIKit with a hard-coded popover anchor** (`Share.swift:15-25`) instead of `ShareLink`.
4. **The floating chrome uses opaque paper capsules and gradient scrims** (`Controls.swift:164-186`) next to the system glass tab bar.
5. **Filter chips use a typed "✕" glyph** (`LibraryScreen.swift:170,174`) instead of an SF Symbol.

**macOS Safari container: FAIL as a native Mac window.**
- It is the unmodified Safari Web Extension App template. The whole UI is a `WKWebView` showing `Main.html`, with an HTML `<button>` and `cursor: default; user-select: none` to hide the browser (`Style.css:1-5`).
- The button is a flat grey WebKit pill. It is not the default button, and Return does nothing (`mac-container-light-extension-on.png`).
- The menu bar has only the app menu and Help (`Main.storyboard:13-64`). There is no File, Edit or Window menu, so ⌘W, Minimize and the window list are missing.
- The window can't be miniaturized (`Main.storyboard:81`).

## Executive Summary

- **Audit Health Score: 13/20 (Acceptable).**
- **Issues found:** P0: 0 · P1: 5 · P2: 18 · P3: 10 (33 total).

**Top critical issues**
1. **Launch blocks on JavaScript.** `LibraryModel.init` runs in the `App` struct's `@State` on the main thread. It opens SQLite, then calls `queue.sync` to evaluate `keepsake-core.js` (386 KB) and `ios-bridge.js` (24 KB), all before the first frame.
2. **Every mutation re-reads the whole library on the main actor.** `refresh()` does a synchronous full SELECT plus a JSON decode of every body, including `data:` thumbnails of up to about 380 KB. This runs on every stamp, trash, file, paste and foreground, and duplicates the `observeSaves` stream.
3. **The Share Extension card overflows at large text.** It can't scroll, and the library cards force full height, so Done and Add a note get pushed off-screen. This is the primary way content enters the app.
4. **iPad ignores widget taps.** `onOpenURL` is only on the compact `TabView`.
5. **Two dark-mode contrast failures:**
   - Book covers: white title at 2.74:1.
   - Map pins: white glyph at 2.37:1, and pins are only 32 pt.

**Recommended next steps**
1. `/impeccable optimize`: launch and the main-thread data path.
2. `/impeccable adapt`: Share card, iPad routing, size classes, widgets.
3. `/impeccable harden`: VoiceOver order, traits, toast timing.
4. `/impeccable colorize`: dark contrast and Increase Contrast.
5. `/impeccable layout`: native nav bars and titles.
6. `/impeccable shape`: the Mac container.
7. Finish with `/impeccable polish`.

## Detailed Findings by Severity

### P1 Major

**[P1] Heavy synchronous work before first frame (JavaScriptCore load + DB open on main thread)**
- **Location:**
  - App: `ios/App/KeepsakeApp.swift:8` (`@State private var model = LibraryModel()`) and `:58-67` (`try Library(...)` in init).
  - Library and core: `KeepsakeKit/Library.swift:70-78`, `CoreEngine.swift:30-34` (`try queue.sync { try load() }`), `:64-69` (`evaluateScript` of both bundles).
  - Share Extension: `ShareViewController.swift:60` (`try Library()` in the `@MainActor` `ShareState`).
- **Category:** Performance
- **Impact:** Cold launch waits for SQLite plus about 410 KB of JS before SwiftUI draws. The comment at `KeepsakeApp.swift:71-72` ("never waits on JavaScript") is wrong, because init already did. In the Share Extension, the "Saving" spinner freezes.
- **Guideline:** HIG Launching: first frame fast, defer non-essential work.
- **Recommendation:**
  - Build `Library`/`KeepsakeCore` off-main, in a `Task.detached` from `start()`.
  - Make the read path available before the JS core exists, and load JS lazily on the first write.
  - In the extension, build `Library` in a detached task as well.
- **Suggested command:** `/impeccable optimize`

**[P1] Full-library refetch + JSON decode on the main actor after every change**
- **Location:**
  - `refresh()` at `KeepsakeApp.swift:120-124`.
  - Callers: `KeepsakeApp.swift:132,161,178,185,197,200,206`; `RootView.swift:35`; `LibraryScreen.swift:320,337,340`; `KindScreen.swift:141,144`; `SplitRootView.swift:79`; `SaveDetailScreen.swift:62,375,407`; `SettingsScreen.swift:142,268`; `PlacesScreen.swift:193`; `CollectionsScreen.swift:109,122`.
  - The read itself: `Library.swift:85-96`.
- **Category:** Performance
- **Impact:** Every stamp, trash, file, undo, edit and foreground runs a synchronous `SELECT body … ORDER BY createdAt` over all saves, plus a JSON decode. Imported bodies carry `data:` thumbnails, so this can be megabytes. At the 5,000-save perf seed (`KeepsakeApp.swift:81-85`) it hitches exactly as the stamp animation and haptic fire. It is redundant with `observeSaves()` (`:93-98`).
- **Guideline:** Keep I/O and decoding off the main thread during interaction.
- **Recommendation:**
  - Rely on the ValueObservation stream.
  - Make `refresh()` async and off-main, and use it only for writes made by the Share Extension.
  - Move thumbnails out of the JSON body, or select only the columns that are needed.
- **Suggested command:** `/impeccable optimize`

**[P1] Share Extension card overflows at large Dynamic Type (Done / Add a note pushed off-screen)**
- **Location:** `ShareViewController.swift:237-292` (no ScrollView); `:402` `.fixedSize(horizontal:false, vertical:true)` in `libraryCard` (`:377-418`); `:421-442`; `:278-287`.
- **Evidence:** source only. At default size, `iphone-postcard-dark-share-libraries.png` already fills the screen.
- **Category:** Accessibility / Adaptivity
- **Impact:** At AX sizes the stack is taller than the screen, the fixed-size cards can't compress, and the Done row is clipped. People who use large text can't finish or annotate a share.
- **Guideline:** HIG Typography: support every size and scroll when content doesn't fit.
- **Recommendation:**
  - Put the middle content in a ScrollView.
  - Pin Done with `.safeAreaInset(edge:.bottom)`.
  - Stack the two cards vertically at `isAccessibilitySize` (ViewThatFits / AnyLayout).
  - Hide the SaveObject preview at AX sizes.
- **Suggested command:** `/impeccable adapt`

**[P1] Imageless book covers: white title fails contrast in dark mode**
- **Location:** `KeepsakeUI/SaveObject.swift:159-163`: `KSFont.name(.headline)` in `.white` on `kind.color.opacity(0.85)`.
- **Category:** Accessibility / Theming
- **Impact:** Dark book colour `#E3A878` at 85% over `#15130F`, against white, is **2.74:1**. A 17pt semibold label needs 4.5:1. Light mode passes at 5.55:1.
- **Guideline:** WCAG 1.4.3; HIG Color.
- **Recommendation:** Either use a dark ink (for example `#0E1630`) on the light dark-mode kind colours, or use the deep light-mode kind colour for the fill in both modes, as `accentForWhiteGlyph` does (`Theme.swift:42`).
- **Suggested command:** `/impeccable colorize`

**[P1] iPad: widget deep links are ignored in regular width**
- **Location:**
  - `RootView.swift:24` (regular width uses `SplitRootView`).
  - `:50-54` (`.onOpenURL` is attached only to the compact tabs).
  - `:82-88` (the Stack only honours `opening.stack == name`).
  - `SplitRootView.swift:51` (stacks are named `"split-…"`).
  - URL sources: `Widgets/KeepsakeWidgets.swift:51,137`.
- **Category:** Adaptivity
- **Impact:** On iPad, tapping the Latest save or Workout goal widget opens the app but not the save. This fails silently on one of the two shipped device families.
- **Guideline:** HIG Widgets: a tap deep-links to the content shown.
- **Recommendation:** Move `.onOpenURL` to the root `Group`. In `SplitRootView`, select `.library` and push the save. Better still, use one shared navigation model.
- **Suggested command:** `/impeccable adapt`

### P2 Minor

**[P2] VoiceOver reads the Masonry grid column-by-column, not in save order**
- **Location:** `SaveObject.swift:351-361`: round-robin `VStack` columns inside an `HStack`.
- **Category:** Accessibility
- **Impact:** VoiceOver reads 1, 3, 5 … 23, then 2, 4 … 24, which breaks newest-first order on the Library, Kind, Collection and search screens.
- **Guideline:** HIG Accessibility: reading order matches visual order.
- **Recommendation:** Add `.accessibilitySortPriority` per item, or use `.accessibilityElement(children:.contain)` with explicit priorities.
- **Suggested command:** `/impeccable harden`

**[P2] Detail action bar capped at `.large` Dynamic Type**
- **Location:** `SaveDetailScreen.swift:356-359`: `.dynamicTypeSize(...DynamicTypeSize.large)` with `.accessibilityShowsLargeContentViewer()`.
- **Category:** Accessibility
- **Impact:** The primary actions (Directions, Start cooking, Visit shop, the stamps, Share) don't grow for XL–AX5 users. The Large Content Viewer is meant for system-bar-like UI, not a screen's main actions.
- **Guideline:** HIG Typography.
- **Recommendation:** Let the bar scale. At AX sizes, stack the stamps above a full-width `PrimarySlab`, or move the secondary stamps into the toolbar menu.
- **Suggested command:** `/impeccable typeset`

**[P2] Increase Contrast ignored by every theme colour**
- **Location:** `Theme.swift:12-14` (`dyn` checks only `userInterfaceStyle`); `:20,:26,:32` (rules at 12–18% alpha); `:106-111`.
- **Category:** Theming / Accessibility
- **Impact:** Hairlines, chip borders, dashed outlines and muted text stay faint for Increase Contrast users.
- **Guideline:** HIG Color: custom colours must support Increase Contrast.
- **Recommendation:** Read `accessibilityContrast == .high` in `dyn` and provide variants: darker `inkMuted`, rules at 30–40%, solid borders. Or use asset-catalog High Contrast appearances.
- **Suggested command:** `/impeccable colorize`

**[P2] Map pins: 32 pt targets and low-contrast glyph in dark mode**
- **Location:** `PlacesScreen.swift:128-137`: 32×32, with a white 14pt glyph on the place colour.
- **Category:** Accessibility
- **Impact:** The pins are below the 44pt minimum. In dark mode (`#F08E7E`) the glyph is **2.37:1**, below the 3:1 non-text minimum.
- **Guideline:** HIG 44pt; WCAG 1.4.11.
- **Recommendation:** Give the pins a 44pt `contentShape`, and use the deep `#A8342A` in both modes or a dark glyph. Alternatively use the system `Marker` with `.tint`, as `SaveDetailScreen.swift:121` does.
- **Suggested command:** `/impeccable harden`

**[P2] Non-interactive save cards announce as buttons**
- **Location:** `SaveObject.swift:27` (`.isButton` is baked in). It is used non-interactively at `ShareViewController.swift:246`, `AppearanceScreen.swift:53` and `SaveDetailScreen.swift:149`.
- **Category:** Accessibility
- **Impact:** VoiceOver says "button" where a double-tap does nothing.
- **Guideline:** HIG VoiceOver traits.
- **Recommendation:** Drop the trait from `SaveObject`; the wrapping link or button already supplies it.
- **Suggested command:** `/impeccable harden`

**[P2] Undo toast still auto-dismisses after 8s under VoiceOver / Switch Control**
- **Location:** `RootView.swift:118-122`.
- **Category:** Accessibility
- **Impact:** People who navigate by swiping or switch scanning often can't reach Undo in time, and it is the only undo for Trash, Move and AI filing.
- **Guideline:** WCAG 2.2.1.
- **Recommendation:** Don't auto-dismiss, or allow 20s or more, while VoiceOver or Switch Control is running. Move focus to the toast with `.accessibilityFocused`, and support shake / ⌘Z through UndoManager.
- **Suggested command:** `/impeccable harden`

**[P2] `data:` thumbnails decoded synchronously in `body`**
- **Location:** `SaveImage.swift:19`, `:61-70` (`Data(base64Encoded:)`, `UIImage(data:)`, `preparingForDisplay()` inline; `NSCache` has no `countLimit`).
- **Category:** Performance
- **Impact:** For Chrome-imported libraries the first scroll decodes every card on the main thread, which drops frames at 120 Hz.
- **Guideline:** No image decoding in scroll paths.
- **Recommendation:** Route `data:` images through `ThumbnailStore` with an async `.task(id:)`, show the tile until it is ready, and set limits on the cache.
- **Suggested command:** `/impeccable optimize`

**[P2] Thumbnails ~3× larger than intended; full images decoded before downscale**
- **Location:** `Thumbnails.swift:44-47`, `:63-68`; `ImageCapture.swift:19-31`, `:24`. Both use the default `UIGraphicsImageRenderer` format, which renders at screen scale.
- **Category:** Performance
- **Impact:** A "640 px" thumbnail is really 1920 px on @3x, about 9× the memory and disk. In the Share Extension this adds jetsam risk.
- **Guideline:** Downsample at the source.
- **Recommendation:** Use `UIGraphicsImageRendererFormat.scale = 1`, or `CGImageSourceCreateThumbnailAtIndex` with a max pixel size.
- **Suggested command:** `/impeccable optimize`

**[P2] Procedural paper grain is a per-pixel Canvas on every screen**
- **Location:** `Theme.swift:116-143`: `size.width*size.height/18` separate 1×1 fills.
- **Category:** Performance
- **Impact:** About 19.5k rects on an iPhone and about 79k on a 13" iPad, redrawn on every push, rotation and resize, for a texture shown at 6% opacity.
- **Guideline:** Cache static textures.
- **Recommendation:** Render a 256×256 tile once (or bundle one) and use `resizingMode: .tile`. Keep the Reduce Transparency switch.
- **Suggested command:** `/impeccable optimize`

**[P2] Root screens reinvent the navigation bar; pushed screens have no titles**
- **Location:**
  - `HomeScreen.swift:75`, `LibraryScreen.swift:93`, `PlacesScreen.swift:41`.
  - `RootView.swift:164-176`, `LibraryScreen.swift:117-141`.
  - `HomeScreen.swift:42-48`, `LibraryScreen.swift:126-138`.
  - `KindScreen.swift:37,:87`, `CollectionsScreen.swift:25,:66`, `GroupsScreen.swift:25`, `SaveDetailScreen.swift:51`.
- **Category:** Conformance
- **Impact:**
  - There is no large title that collapses; a `TopScrim` masks content under the status bar instead.
  - Pushed screens show an empty nav bar (`iphone-postcard-dark-lifestyle.png`, `ipad-postcard-light-review.png`).
  - The back menu has blank entries, and VoiceOver's screen-change announcement is untitled.
- **Guideline:** HIG Navigation bars.
- **Recommendation:** Use `.navigationTitle` with `.large` on the roots, and keep the serif via `UINavigationBarAppearance` or a largeTitle `ToolbarItem`. Make Settings and More `ToolbarItem`s, and give every pushed screen a title.
- **Suggested command:** `/impeccable layout`

**[P2] Custom bottom search dock instead of system search**
- **Location:** `LibraryScreen.swift:357-388`, `:104-106`, `:89`.
- **Category:** Conformance
- **Impact:** The dock has no Cancel, no glass, no suggestions, scopes or tokens, and no system ⌘F. It sits opaque next to the glass tab bar.
- **Guideline:** `ios.md`: platform components first; HIG Search.
- **Recommendation:** Use `.searchable(text:placement:)` or a search-role `Tab`. Keep `PasteButton` in a toolbar. This also removes `BottomScrim` and the 130pt padding (`:87`).
- **Suggested command:** `/impeccable distill`

**[P2] Crossing a size class swaps the whole app tree and loses state**
- **Location:** `RootView.swift:23-25`; `SplitRootView.swift:62` (`.id(section)`).
- **Category:** Adaptivity
- **Impact:** Resizing an iPad window across compact and regular discards the navigation path, scroll position, search, selection and the current tab.
- **Guideline:** HIG Multitasking.
- **Recommendation:** Use `TabView` with `.tabViewStyle(.sidebarAdaptable)`, or lift state into `LibraryModel` / `@SceneStorage`.
- **Suggested command:** `/impeccable adapt`

**[P2] Share Sheet uses the wrong window and a hard-coded anchor**
- **Location:** `Share.swift:15-25` (first scene's root VC, `sourceRect` at bottom-middle minus 80); called from `SaveDetailScreen.swift:72,354`.
- **Category:** Adaptivity / Conformance
- **Impact:**
  - On iPad the popover points at empty space (`ipad-postcard-light-place.png`).
  - With multiple windows it can open in the wrong one.
  - When invoked from a menu, it is mis-anchored.
- **Guideline:** HIG Popovers.
- **Recommendation:** Use `ShareLink`, or a representable anchored to the stamp's frame.
- **Suggested command:** `/impeccable adapt`

**[P2] iPad reading screens have no readable content width**
- **Location:** `SaveDetailScreen.swift:35-48`, `CookingView.swift:37-44`, `KindScreen.swift:96-129` (`ipad-postcard-light-place.png`).
- **Category:** Adaptivity
- **Impact:** Lines run past 100 characters and the Directions slab stretches very wide, so the phone layout is effectively stretched.
- **Guideline:** HIG Layout readable width.
- **Recommendation:** Use `.frame(maxWidth: 680)` centred, and put the hero beside the text in regular width.
- **Suggested command:** `/impeccable adapt`

**[P2] Goal sheet: medium-only detent, non-scrolling content**
- **Location:** `Workout.swift:63-87`, `:86`.
- **Category:** Accessibility / Adaptivity
- **Impact:** At large text or in landscape, "Start the goal" is clipped and the sheet can't expand. Verified from source only.
- **Guideline:** HIG Sheets.
- **Recommendation:** Use `[.medium, .large]`, a ScrollView or Form, and pin the slab with `safeAreaInset`.
- **Suggested command:** `/impeccable adapt`

**[P2] Widgets don't support tinted / clear Home Screen rendering**
- **Location:** `KeepsakeWidgets.swift:54-71`, `:126`, `:50,:136`.
- **Category:** Theming
- **Impact:** In accented mode the met, partial and empty weeks and the ring track blur together, and the stamp loses its meaning. There is no `widgetRenderingMode` handling and no `.widgetAccentable()`.
- **Guideline:** HIG Widgets rendering modes.
- **Recommendation:** Mark the fills `.widgetAccentable()`, use fill-versus-outline in accented mode, and drop the paper background there.
- **Suggested command:** `/impeccable adapt`

**[P2] Mac container is a web page, not a Mac window**
- **Location:** `safari/Keepsake/Keepsake/ViewController.swift:14-26`, `Resources/Base.lproj/Main.html:12-21`, `Resources/Style.css:1-5`.
- **Category:** Conformance
- **Impact:** A flat WebKit pill that is not the default button, does nothing on Return, and has a non-AppKit focus ring and role. Text ignores system size settings. It is the first thing a Mac user sees.
- **Guideline:** `ios.md` slop test (ported website, web-shaped buttons).
- **Recommendation:** Build a native SwiftUI `WindowGroup` or `NSViewController`:
  - an icon
  - a wrapping `NSTextField` bound to the extension state
  - an `NSButton(.push)` as the default button

  Keep `SFSafariExtensionManager` / `showPreferencesForExtension`.
- **Suggested command:** `/impeccable shape`

**[P2] Mac container menu bar lacks File/Edit/Window; window can't minimize**
- **Location:** `Main.storyboard:13-64`, `:81-82`.
- **Category:** Conformance
- **Impact:** No ⌘W, ⌘M or Window list, and the yellow traffic light is disabled.
- **Guideline:** HIG Menus (macOS).
- **Recommendation:** Add the standard File, Edit and Window menus, and add `miniaturizable` to the window style.
- **Suggested command:** `/impeccable harden`

### P3 Polish

**[P3] Fixed point sizes on display text and glyphs**
- **Location:** `CookingView.swift:39` (64pt step number), `LibraryScreen.swift:399`, `RootView.swift:141` (🎉 34pt), `Groups.swift:33,:103`, `SaveImage.swift:53`, `SaveObject.swift:200,:316`, `PlacesScreen.swift:131`.
- **Category:** Accessibility
- **Impact:** Mostly decorative. But the step number and the emoji don't scale next to AX body text.
- **Guideline:** `ios.md`: no hard-coded point sizes.
- **Recommendation:** Use `@ScaledMetric` or text styles.
- **Suggested command:** `/impeccable typeset`

**[P3] A few animations ignore Reduce Motion**
- **Location:** `AppearanceScreen.swift:61`, `Workout.swift:69`.
- **Category:** Accessibility
- **Impact:** Small springs still run when Reduce Motion is on.
- **Guideline:** HIG Motion.
- **Recommendation:** Wrap them in `KSMotion.or(_, reduce:)`.
- **Suggested command:** `/impeccable animate`

**[P3] "this iPhone" copy on iPad**
- **Location:** `SettingsScreen.swift:44,:83,:237,:239,:242,:246,:262`.
- **Category:** Adaptivity
- **Impact:** iPad users are told their library stays "on this iPhone".
- **Guideline:** HIG Writing.
- **Recommendation:** Say "this device", or branch on idiom.
- **Suggested command:** `/impeccable clarify`

**[P3] Typed "✕" in active filter chips**
- **Location:** `LibraryScreen.swift:170,:174`.
- **Category:** Conformance
- **Impact:** Its weight and baseline don't match the SF Symbols beside it.
- **Guideline:** `ios.md`: use SF Symbols.
- **Recommendation:** Use a trailing `xmark` symbol through `Chip`.
- **Suggested command:** `/impeccable polish`

**[P3] Ink theme tint equals body text colour**
- **Location:** `Theme.swift:30` (accent = ink), applied globally at `:199`.
- **Category:** Theming
- **Impact:** Interactive text can't be told apart from static text.
- **Guideline:** `ios.md`: one tint drives interactive elements.
- **Recommendation:** Give Ink a distinct accent, or underline or weight interactive text.
- **Suggested command:** `/impeccable colorize`

**[P3] Re-render churn from body-level computation**
- **Location:**
  - `HomeScreen.swift:27-33`: a new `ISO8601DateFormatter` on every body.
  - `LibraryScreen.swift:41-67`: `shown` is computed 3+ times, and `topSources` scans every save.
  - `PlacesScreen.swift:42`: the task id joins every save id.
  - `SaveObject.swift:352`: blocks are identified by offset.
  - `KeepsakeApp.swift:97`: the widget reloads on every emission.
- **Category:** Performance
- **Impact:** Noticeable at 5,000 saves. Every drag tick re-runs the date scan.
- **Guideline:** Avoid heavy work in `body`.
- **Recommendation:** Use a static formatter and cached derived lists. Use a version counter as the task id, key blocks by the first save id, and debounce widget reloads.
- **Suggested command:** `/impeccable optimize`

**[P3] One `LibraryModel` shared by every iPad window**
- **Location:** `KeepsakeApp.swift:8-15`, `:26-39`.
- **Category:** Adaptivity
- **Impact:** Toasts and celebrations appear in both windows, and ⌘F in one window focuses search in the other.
- **Guideline:** HIG Multiple windows.
- **Recommendation:** Move transient UI state into a per-scene object.
- **Suggested command:** `/impeccable adapt`

**[P3] iPad sidebar and navigation consistency**
- **Location:**
  - `SplitRootView.swift:23-25` vs `HomeScreen.swift:110-128`: Review is pushed inside Home while the sidebar still shows Home (`ipad-postcard-light-review.png`).
  - `:27`: Places has no drop-target highlight.
  - `:66-70`: ⌘F is a hidden button rather than a declared command.
- **Category:** Conformance / Adaptivity
- **Impact:** The sidebar doesn't show where you are, and the shortcut may not be discoverable.
- **Guideline:** HIG Sidebars; keyboard shortcuts.
- **Recommendation:** Select `.review` from the banner. Add the highlight to Places. Declare ⌘F and ⌘, in `.commands`.
- **Suggested command:** `/impeccable polish`

**[P3] Mac container hardening and copy**
- **Location:**
  - `Main.html:17-20`: stale "Safari Extensions preferences" copy; the `#available(macOS 13)` check is always true on a macOS 14 target.
  - `ViewController.swift:30-33`: the error path is a stub.
  - `:46`: a forced `as! String` cast.
  - `Main.html:15`: the decorative icon has a spoken alt.
  - `Main.storyboard:56`: a Help item with no Help Book.
- **Category:** Conformance / Accessibility
- **Impact:** A flash of stale copy, silent failure, a possible crash, VoiceOver noise and a dead Help item.
- **Guideline:** HIG Writing; Accessibility.
- **Recommendation:** Fix the copy, add an error state, use `as?`, set `alt=""`, and remove the Help item or link it to support.
- **Suggested command:** `/impeccable harden`

**[P3] Generated launch screen doesn't match the table colour**
- **Location:** `ios/Keepsake.xcodeproj/project.pbxproj:18-19`: `UILaunchScreen_Generation = YES` with no colour.
- **Category:** Theming
- **Impact:** Launch flashes white or black before the `#EDE6DA` / `#15130F` table appears, made longer by the P1 launch work.
- **Guideline:** HIG Launch screens.
- **Recommendation:** Set `UILaunchScreen` → `UIColorName` to a light/dark "Table" colour asset.
- **Suggested command:** `/impeccable polish`

## Patterns & Systemic Issues

- **Main-thread data access is the default.** `Library.saves()` and `collections()` are synchronous and are called from the main actor in about 20 places, for example `.task(id: model.saves.count) { collections = try? …collections() }` in `HomeScreen.swift:77`, `LibraryScreen.swift:103/115`, `SplitRootView.swift:71` and `CollectionsScreen.swift:32/35/69`. The read layer needs an async, off-main API.
- **The custom chrome duplicates system chrome.** `TopScrim`, `BottomScrim`, `ScreenHeader`, the paper-circle buttons, the search dock, the toast capsule and the hidden nav bars together form a parallel nav-bar system. It opts out of large titles, glass, back titles and `.searchable`.
- **Fixed vertical compositions with no scroll fallback.** The Share card, GoalSheet, the detail action bar and ConsentSheet's inset all assume default text size. The grids handle AX sizes well (`RootView.swift:186`, `LibraryScreen.swift:227`).
- **Theme colours only respond to light and dark.** The palette is otherwise excellent. Its two failures are white on the lightened dark-mode kind colours (book cover, map pin).
- **The iPad path is a second, partial navigation model.** Deep links, `opening` routing, and the Settings, Review and Share anchoring were written for the compact TabView first.

## Positive Findings

- **Thorough VoiceOver support:**
  - Composed card labels (`SaveObject.swift:25-27`, `:291-293`).
  - Mark done and Move to Trash custom actions (`RootView.swift:191-194`, `LibraryScreen.swift:251-254`).
  - Move earlier / Move later reorder actions (`Reorder.swift:43-45`).
  - `.isHeader` and `.isSelected` traits.
  - Stamp state with hints (`Controls.swift:118-119`).
  - Announcements, and decorative elements hidden.
  - An XCTest `performAccessibilityAudit` gate (`UITests/AccessibilityTests.swift`).
- **Reduce Motion and Reduce Transparency are honoured** almost everywhere through `KSMotion.or` (`Haptics.swift:40`), and the grain is removed (`Theme.swift:118-123`).
- **Dynamic Type foundations are right:**
  - Text styles everywhere, including serif (`Theme.swift:62-68`).
  - `@ScaledMetric` stamps and shelf cards.
  - One-column grids at AX sizes.
- **Contrast is engineered:** every text pair passes AA in all 6 combinations:
  - `inkMuted` on `well` is at least 5.40:1.
  - Kind colours on paper are at least 5.61:1.
  - `onAccent` on `accent` is at least 7.5:1.
  - `accentForWhiteGlyph` (`Theme.swift:40-42`) is a thoughtful touch.
- **44pt targets** are used consistently, except for the map pins.
- **Sound list architecture:**
  - Masonry is chunked inside `LazyVStack` (`SaveObject.swift:328-367`), and Review and Places are lazy too.
  - Remote images decode off-main with a memory fast path (`SaveImage.swift:21-33`).
  - Thumbnail fetching uses an ephemeral, cookieless session.
  - Search is debounced (`LibraryScreen.swift:107-112`).
- **Native components where it counts:**
  - NavigationSplitView with drag-and-drop filing, and ⌘F / ⌘,.
  - System Forms and `confirmationDialog`.
  - PasteButton (no paste prompt).
  - `fileImporter` / `fileExporter`, Map / Marker.
  - App Intents.
  - Alternate icons.
  - Edge-swipe back is never disabled.
  - Centralised, switchable haptics.
- **Brand on the content layer, system UI for navigation.** This is the split `ios.md` asks for.
- **All orientations, and no `UIRequiresFullScreen`.**

## Recommended Actions

1. **[P1] `/impeccable optimize`**: Move `Library` and `KeepsakeCore` construction off the main thread, both at launch and in the Share Extension (`KeepsakeApp.swift:58-67`, `CoreEngine.swift:30-34`, `ShareViewController.swift:60`). Replace the synchronous `refresh()` with the observation stream plus an async off-main fetch (`KeepsakeApp.swift:120-124`, `Library.swift:85-96`).
2. **[P1] `/impeccable adapt`**: Make the Share card scroll and reflow at AX sizes (`ShareViewController.swift:237-292,:402`). Route `keepsake://save/<id>` on iPad (`RootView.swift:50-54`, `SplitRootView.swift:51`).
3. **[P1] `/impeccable colorize`**: Fix the dark book-cover title contrast (`SaveObject.swift:159-163`).
4. **[P2] `/impeccable harden`**:
   - Masonry VoiceOver order (`SaveObject.swift:351-361`).
   - The false button trait (`:27`).
   - Undo toast timing under assistive tech (`RootView.swift:118-122`).
   - Map pins (`PlacesScreen.swift:128-137`).
   - Mac menus and minimize (`Main.storyboard`).
5. **[P2] `/impeccable optimize`**:
   - Async `data:` decode (`SaveImage.swift:61-70`).
   - Scale-1 or ImageIO downsampling (`Thumbnails.swift:44-68`, `ImageCapture.swift:24`).
   - A tiled grain (`Theme.swift:129-143`).
6. **[P2] `/impeccable colorize`**: Increase Contrast variants (`Theme.swift:12-32,:106-111`).
7. **[P2] `/impeccable adapt`**:
   - Widget accented rendering.
   - `.sidebarAdaptable` instead of the tree swap.
   - An anchored `ShareLink`.
   - Readable width on iPad.
   - A scrollable, large-detent Goal sheet.
8. **[P2] `/impeccable typeset`**: Let the detail action bar scale and reflow (`SaveDetailScreen.swift:356-359`).
9. **[P2] `/impeccable layout`**: Use system nav bars with large titles and toolbar items on the roots, and titles on every pushed screen.
10. **[P2] `/impeccable distill`**: Use `.searchable` bottom search instead of the custom dock and scrims (`LibraryScreen.swift:357-388`).
11. **[P2] `/impeccable shape`**: Rebuild the Safari container as a native window (`ViewController.swift:14-26`).
12. **[P3] `/impeccable typeset`**: Scale the step number and display glyphs.
13. **[P3] `/impeccable animate`**: Gate the remaining springs on Reduce Motion.
14. **[P3] `/impeccable clarify`**: Use "this device" copy.
15. **[P3] `/impeccable adapt`**: Per-scene transient UI state.
16. **[P3] `/impeccable harden`**: Mac container cleanup.
17. **[P3] `/impeccable polish`**:
    - SF Symbol for chip removal.
    - A distinct Ink accent.
    - Sidebar selection and declared `.commands`.
    - A launch-screen colour.
    - Body computation cleanup.
18. **`/impeccable polish`**: a final pass.

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run `/impeccable audit` after fixes to see your score improve.

*Evidence note:* the screenshots are Simulator and window captures, and the performance findings are verified from source. Confirm launch and refresh costs on a device with Time Profiler (cold launch, and a stamp tap at `-seedPerf 5000`).
