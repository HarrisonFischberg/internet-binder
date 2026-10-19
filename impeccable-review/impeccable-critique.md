# Impeccable critique: Keepsake (whole app)

Impeccable skill v4.6.0 (`/Users/harrison/projects/.claude/skills/impeccable`), `critique` command, run read-only on 2026-10-19 against origin/main 7d0a657. No source files were changed.

- **Web (Chrome extension: `keepsake/src`):** Method: dual-agent (A: isolated design-review sub-agent · B: isolated detector + browser-overlay sub-agent). A finished without seeing any detector output.
- **Native (iOS/iPadOS app: `ios/App`, `ios/KeepsakeKit/Sources/KeepsakeUI`, share extension, widgets; macOS Safari container: `safari/Keepsake`):** Method: design review only (detector not applicable, native platform). Visual evidence: `impeccable-review/before/ios` (65 PNGs) and `before/mac` (4 PNGs).
- **Context:** there is no PRODUCT.md or DESIGN.md in the repo. `impeccable context` reported `NO_PRODUCT_MD`. For a scoped critique the skill proceeds from the code and offers `init` later, so I skipped init and wrote nothing to the repo root.
- **Snapshot:** the skill's `critique-storage write` would create `.impeccable/critique/` inside the repo. This run was scoped read-only, so I skipped it. This file is the archive instead.

---

## Design Health Score

| # | Heuristic | Web extension | iOS / Mac | Key issue |
|---|-----------|:---:|:---:|-----------|
| 1 | Visibility of System Status | 3 | 3 | Saving, Undo and stamp states are clear. Focus drops to `<body>` after delete (web). The Review count is a badge on the Home tab even while you're on Home (iOS). |
| 2 | Match System / Real World | 2 | 3 | Jargon reaches users: "Lifestyle", "views", "groups", "Kind", "Low · 52%", and IndexedDB / chrome.storage in Settings. Web copy says "products" only. |
| 3 | User Control and Freedom | 3 | 3 | Strong Undo, Trash (30 days), Alt+Z, Esc. Weakened by Undo at 1.6:1 in dark mode (web) and two floating layers on detail screens (iOS). |
| 4 | Consistency and Standards | 2 | 2 | The "unsorted" state has 5–8 names. The floating in-page button ignores tokens. iOS Settings is stock grey. The Mac container is the Xcode template. |
| 5 | Error Prevention | 3 | 3 | Duplicate and near-match checks, typed wipe confirm, share-sheet saves always land somewhere. Risks: the in-page 1/2/3 key capture steals site shortcuts, and Paste can be tapped with no link copied. |
| 6 | Recognition Rather Than Recall | 2 | 2 | Card actions appear only on hover. Shortcuts are listed nowhere. The iOS Paste button is icon-only, yet its toast says "tap Paste". Filter rows run off-screen. |
| 7 | Flexibility and Efficiency | 3 | 3 | Bulk select, number-key filing, reorder, widgets, iPad drop targets. Missing: range select, Cmd+A, arrow-key grid navigation. "/" is broken on Home. |
| 8 | Aesthetic and Minimalist Design | 2 | 3 | Web Library shows about 23 controls before the first card. iOS detail screens stack an action dock over the tab bar over content. |
| 9 | Error Recovery | 3 | 2 | Web errors are clear but can leak raw `chrome.runtime.lastError`. iOS search with no results has no "Clear search". The Mac error path is a template stub that shows nothing. |
| 10 | Help and Documentation | 2 | 2 | No shortcut reference. Lifestyle and Review are never explained. Empty Home says "share from any app" without showing how. |
| **Total** | | **25/40** | **26/40** | **Acceptable (20–27) on both** |

## Design Specificity Verdict

**LLM assessment.** iOS is clearly authored for this product. The web default is generic. The Mac container is a template.

- **iOS/iPadOS ("postcard" world) is unmistakably Keepsake:**
  - a warm grainy table background
  - New York serif for names
  - saves drawn as objects of their kind, with perforated kind stamps
  - per-kind done verbs (Been / Cooked / Purchased / Done today)
  - a tilted postage-stamp Share
  - a stamp "thud" when marking done

  It mostly respects the HIG: TabView, NavigationStack zoom transitions, PasteButton, context menus, SF Symbols, text styles. It drops the world in Settings (stock grouped grey) and in the 🎉 emoji.
- **The Chrome extension's interaction model is product-specific:**
  - the "Saved to [Kitchen ▾]" capture card with 1/2/3 suggestions and Undo, shared by the popup, the in-page card and Review rows
  - collections that learn from corrections
  - kind colours
  - a three-style token system (Modern / Moss / Minimal × light/dark)

  The default **Modern** style is `system-ui` + `#2B59D9` blue + cool greys + a Pinterest-style masonry grid. Under it the dashboard could be any bookmarking SaaS. **Moss** (paper, sage, serif) is the closest sibling to the iOS postcard world, but it isn't the default. The in-page floating Save button still hard-codes the old Moss colours (`floating.js:24-42`), so under Modern the button and the card beside it look like two products.
- **The macOS Safari container** (`safari/Keepsake`) is Xcode's Safari Extension App template almost unchanged: system font, white or `#1e1e1e`, the default status sentence, "Quit and Open Safari Settings…". The only brand on it is the icon.
- **Net effect:** three platforms, three visual identities. iOS feels like a keepsake box, Chrome like a SaaS bookmark manager, the Mac like a placeholder.

**Deterministic scan (web).** `impeccable detect --json` on `keepsake/src` (popup, dashboard, toolbar, content, shared) exited 2 with 4 findings. Line numbers are 0 because it analyses rendered HTML; source locations below were resolved by hand.

| Rule | Count | Location | Verdict |
|---|---|---|---|
| `icon-tile-stack` | 1 | `popup.html:43-46` (46×46 tile above "Nothing to save here"; `popup.css:132-146`) | **True positive** |
| `broken-image` | 1 | `popup.html:105` `<img id="heroImg" alt="" hidden>` | **False positive**: hidden until `onload`, falls back to placeholder (`popup.js:263-281`) |
| `marquee` | 2 | `shared/base.css:413-425` `.skeleton::after` shimmer, attributed to popup and dashboard | **False positive** on the dashboard (`.skeleton` is unused there). On the popup it is a loading shimmer covered by reduced-motion (`base.css:428-437`), not a marquee. |

The detector missed nothing that A found, and A found much the detector cannot see: focus loss, `aria-live`, the clipped sidebar, copy drift.

**Visual overlays.** Script injection succeeded in the browser pane, and `detect.js` ran in-page on the popup (restricted, product and loading states) and on the dashboard (error, empty Home, Home with sample data, Library). The live server is now stopped, so no overlay remains visible. The in-page console found:

- **`icon-tile-stack`** on the dashboard empty state (`dashboard/ui.js:407`, `dashboard.css:866-880`), in addition to the popup. **True positive**
- **`low-contrast`** on the 26×26 sidebar collection initials (11px/600 white): **true positive**. These come from JS data, so the CLI scan can't see them.

  | Cover colour | Collection | Contrast with white |
  |---|---|---|
  | `#B9924F` | Home Decor | 2.9:1 |
  | `#7A7F5E` | Van Build | 4.2:1 |
  | `#8B6F8F` | Clothing | 4.4:1 |
  | `#5B7C8F` | Technology | 4.4:1 |

  Sources: `dashboard.css:235-247`, `dashboard.js:443`, `shared/taxonomy.js:26/35/44/62`, `storage.js:183`.
- **Not checked live:** light theme only, so no dark mode and none of the Moss or Minimal styles.

## Overall Impression

Keepsake already has its best idea: a save is a physical object that can be stamped, filed and undone. It is fully realised on iOS and half-realised on the web. The biggest single opportunity is **one identity across platforms**:

1. Bring the postcard/Moss world to the Chrome default and the Mac container.
2. Use one vocabulary for "not filed yet".
3. Clear away the chrome that sits on top of content: the iOS detail dock and tab bar, and the web filter wall.

## What's Working

1. **The object world (iOS).** Kind-specific objects, stamps and done verbs come from shared tokens (`Theme.swift`, `Controls.swift`). Colours adapt to dark as matched pairs, and the grain drops under Reduce Transparency (`Theme.swift:117-124`).
2. **One correction loop everywhere (web).** Every save ends in the same card: where it went, a one-step move, 1/2/3 suggestions, Undo. Fixing a wrong guess is cheap, and the classifier learns from it.
3. **The safety model.** Trash with Undo instead of confirm dialogs, Alt+Z, a typed wipe, duplicate detection. The iOS share sheet saves before asking anything ("✓ Saved · Undo", then "Where does it live?", with Review as a safe default).
4. **Accessibility groundwork above average.**
   - **iOS:** `@ScaledMetric` stamps, Reduce Motion honoured in press/stamp/toast/celebration, VoiceOver custom actions on cards (`RootView.swift:191-194`), a one-column grid at accessibility sizes (`RootView.swift:186`).
   - **Web:** skip link, focus-trapped modals that restore focus, Esc everywhere, reduced-motion overrides.

## Priority Issues

### [P1] Deletion's safety net is hard to see and to reach (web)
- **What:**
  - Toast Undo is `var(--brass)` on `var(--ink)` (`dashboard.css:2020-2023`): about 3.3:1 in light mode and **about 1.6:1 in dark mode** (rendered and measured).
  - After Delete, focus falls to `<body>` (`deleteItems`, `dashboard.js:1270`).
  - Toasts (z 60) cover the item modal's footer actions (z 40).
- **Why it matters:** Undo is the reason delete has no confirmation dialog. If Undo can't be seen or reached by keyboard, delete is unsafe for Sam and Jordan.
- **Fix:**
  - Give `.toast-action` an on-inverse colour in both themes (e.g. `var(--paper)` + underline, or a new `--c-on-inverse-accent` token).
  - Focus the neighbouring card's `.card-hit` after delete.
  - Offset `.toasts` above an open modal footer.
- **Suggested command:** /impeccable harden

### [P1] Floating chrome covers about 30% of every iOS detail screen
- **What:** the action dock (stamp + primary slab + Share stamp, about 70pt) floats directly on the floating tab bar (about 70pt), over a 170pt `BottomScrim` that only half-hides content.
  - Ingredients are faintly readable through the slab (`iphone-postcard-dark-recipe-carbonara.png`).
  - Provenance fades to nothing (`iphone-postcard-light-place.png`).
  - The workout week strip runs under "Done today" (`iphone-postcard-dark-workout-kettlebell.png`).
  - Directions and the Library tab are about 20pt apart.
- **Why it matters:** content is the point of a detail screen. Two stacked layers invite mis-taps for Casey, and the faded text fails contrast for Sam.
- **Fix:**
  - `.toolbar(.hidden, for: .tabBar)` on pushed detail screens (compact width).
  - Move `actions` into `.safeAreaInset(edge: .bottom)` (`SaveDetailScreen.swift:320-361`).
  - Shrink or replace `BottomScrim` (`Controls.swift:187-197`) with a system material bar.
- **Suggested command:** /impeccable layout

### [P1] Navigation and assistive-tech breakage in the web dashboard
- **What:**
  - **Trash is clipped at 1280×800.** The override at `dashboard.css:3990-3998` (`.sidebar-section{flex:0 0 auto; overflow:visible}`, `.collection-list{max-height:50vh}` inside an `overflow:hidden` sidebar) pushes Trash to 820px, unreachable.
  - **Hidden nav is still in the Tab order.** Below 900px the off-canvas sidebar is only `translateX(-100%)` (`dashboard.css:2395`), so its 29 controls stay tabbable.
  - **Whole views are announced.** `#view` has `aria-live="polite"` (`dashboard.html:139`), so every re-render is read aloud.
  - **Toasts may be announced twice.** `#toasts` is live and each toast is also `role="status"` (`ui.js:195`).
  - **Menu focus is nearly invisible.** `.menu-item:focus-visible` changes background only, about 1.1:1 (`dashboard.css:843-846`).
  - **"/" is broken on Home.** Two handlers fire (`dashboard.js:195-205` and `225-229`) and focus ends on `<body>`.
- **Why it matters:** Trash is where you recover things. Sam tabs through invisible links and hears whole pages. Alex's search shortcut fails on the landing page.
- **Fix:**
  - Remove the 3990-3998 override (or restore `flex:1 1 auto; min-height:0` and scroll the list).
  - `sidebar.inert = !open` at ≤900px in `toggleNav` (`dashboard.js:234`).
  - Drop `aria-live` from `#view` and add a small status region for result counts.
  - Keep a single live mechanism for toasts.
  - Add a 2px focus outline on menu items.
  - Delete the duplicate "/" handler.
- **Suggested command:** /impeccable layout (sidebar) + /impeccable harden (a11y)

### [P1] One concept, many names, and copy that undersells the product (all platforms)
- **What:** "not filed yet" is called:
  - **Web:** "Review", "Review queue", "Review (not sorted)", "Needs sorting", "Needs a collection", "waiting to be filed", "Not sure — saved for review", "Pick a collection now or later".
  - **iOS:** "needs a collection", "waiting in Review", "In Review", "Waiting in Review", "Needs a collection".

  Groupings are "collections" in one place, "groups" in the share sheet (`ShareViewController.swift:395`) and "views" for Lifestyle (`HomeScreen.swift:63`). "Lifestyle" is never defined. The web welcome page and restricted page say "products" only (`dashboard.js:3291`, `popup.js:89`), contradicting the manifest's promise of recipes, places and more. The editor says both "Bought" and "Purchased".
- **Why it matters:** Jordan must learn that 8+ phrases mean one place, and recipe or place savers are told the product isn't for them.
- **Fix:**
  - One noun for the inbox and one phrase for the state, used in every surface.
  - Count Lifestyle by what it holds ("Places, Recipes, Workouts +4 · 22 saves").
  - Replace "groups" and "views".
  - Rewrite the welcome and restricted copy for "anything worth keeping".
- **Suggested command:** /impeccable clarify

### [P2] First run and filtering bury the main job (iOS + web)
- **What:**
  - **Empty Home is a dead end.** iOS empty Home (`HomeScreen.swift:51-53`) is one sentence with no action. It shows 3 pre-made empty collections ("3 collections · 0 saves"), and Paste and Import live only on Library.
  - **iOS Library chip row.** About 15+ chips in one horizontal row (`LibraryScreen.swift:143-187`), Review cut off, icon-only Paste (`LibraryScreen.swift:377-384`), "Search 0 saves" on empty.
  - **Web Library filter wall.** About 23 controls before the first card. At 375px the grid starts 521px down an 812px screen.
- **Why it matters:** Jordan's first action is undiscoverable, and "find it later", the second half of the job, starts with a wall of choices.
- **Fix:**
  - A "Save your first thing" card: labelled Paste, Import from Chrome, "How to share to Keepsake".
  - Hide "0 saves" counts.
  - Reduce scope chips to All · Collections · Lifestyle · Review and move kinds and collections into the filter menu.
  - Web: one "Type" menu plus a "Filters" popover with an active-count badge.
- **Suggested command:** /impeccable onboard, then /impeccable distill

### [P2] macOS Safari container is the unmodified template
- **What:**
  - `Resources/Style.css`, `Script.js` and `Base.lproj/Main.html` are boilerplate.
  - The only button quits the app (`ViewController.swift:46-52`).
  - The error path is the stub comment "Insert code to inform the user…" (`ViewController.swift:31-34`), so failures show nothing.
- **Why it matters:** it is the first thing a Mac user sees, and it shares nothing with iOS or Chrome.
- **Fix:**
  - Postcard tokens (`Theme.swift:16-19`) and a serif heading ("Keepsake is on in Safari").
  - A stamped or dashed status seal.
  - A 3-step "how to save from Safari" panel.
  - "Open Safari Settings" without quitting.
  - A real error message.
- **Suggested command:** /impeccable adapt

## Persona Red Flags

**Alex (power user, web):**
- "/" does nothing useful on Home.
- No Cmd/Ctrl+A, no shift-click range select, no arrow-key grid navigation.
- Bulk work needs `#selectToggle` first.
- Alt+Shift+S is documented only in a tooltip.
- There is no shortcut reference.
- Quick view focuses "Visit page", so Enter leaves the app.

**Sam (VoiceOver / keyboard / contrast):**
- **Web:**
  - Off-canvas sidebar is focusable.
  - `#view` is aria-live.
  - Focus is lost after Delete and menu actions.
  - Menu focus is about 1.1:1.
  - Undo is 1.6:1 in dark.
  - The in-page capture card (closed shadow root, appended at document end) never receives focus and auto-hides in 6.5–15s.
  - Review rows put `aria-label` on a focusable div, overriding their inner buttons.
- **iOS:**
  - The action dock is capped at `.dynamicTypeSize(...DynamicTypeSize.large)` (`SaveDetailScreen.swift:358`).
  - Fixed sizes: 🎉 at 34pt (`RootView.swift:141`), step numbers at 64pt (`CookingView.swift:39`), map pins at 14pt (`PlacesScreen.swift:131`).
  - Empty week cells in dark mode are about 1.3:1 (`Workout.swift:36`).
  - Text under the scrim fades out.

**Casey (one-handed, iOS):**
- The primary slab sits about 20pt above the tab bar.
- Settings is a 44pt button in the top-right corner of Home.
- Filter chips are at the top and need a sideways swipe.
- Review collection chips are clipped inside a card.
- What works: 8s toasts with a 44pt Undo, the cooking view keeps the screen awake with Next under the thumb, and the share sheet saves instantly.

**Jordan (first-timer, all):**
- Empty Home has no action.
- "Lifestyle", "views", "groups", "Kind", "Review (not sorted)" and "Low · 52%" are never explained.
- Three pre-made empty collections appear.
- The Paste icon is unlabelled.
- "Import tabs" competes with the first save.
- The empty-state copy repeats its own title (`dashboard.js:983`).
- Settings talks about IndexedDB.

## Minor Observations

- **Web:**
  - The collection tile fallback is a hard-coded `'#8A9A88'` sage regardless of style.
  - The in-page card captures 1/2/3 keydown on the host page for about 15s (`toast.js:223-233`), stealing e.g. YouTube seek keys.
  - The in-page picker needs a separate "Move" (`floating.js:340-347`); the popup chip moves on change.
  - The Review icon is a check in the popup but "!" in-page.
  - The unsure-save heading uses an amber-tinted checkmark (`popup.css:445-448`), which says done and not done at once.
  - "Low · 52%" is false precision.
  - Quick view omits note, collection and date.
  - There are three routes to the dashboard from the popup.
  - Star and ⋯ appear only on hover.
  - The currency placeholder "USD" looks like a value.
  - "✦ Check with AI" has a glyph that screen readers read aloud.
  - Raw `lastError` text can reach users (`popup.js:20`).
- **iOS:**
  - The "Been" stamp celebrates with "Cool!" (`SaveDetailScreen.swift:324`); "Been there!" fits better.
  - The "Cooked!" toast covers the recipe title.
  - "Café" is repeated 3× on place detail.
  - Provenance lines read like logs ("Recipe added by you").
  - The second segmented row in Appearance (Comfortable / Compact) has no label.
  - "Optional AI" is both section header and row label (`SettingsScreen.swift:62,82`).
  - The Review badge sits on the Home tab while iPad has a Review sidebar row (structures differ).
  - Picture-less kinds show large empty tiles in dark Lifestyle.
  - `EmptyNote`'s button title is hard-coded (`LibraryScreen.swift:403`).
- **iPad:**
  - The recipe screen leaves its right half and lower 35% blank, with a small repeated title card.
  - The cooking view is one line of title2 on a blank canvas.
  - Places has no list + map side by side.
  - The sidebar selection is a heavy accent pill.
- **Detector:** dashboard and popup empty states use the generic icon-in-a-rounded-tile above a heading. Both are true positives and worth replacing with something from the object world (e.g. an empty stamp outline).

## Questions to Consider

1. If the postcard/Moss world is the real Keepsake, why is the Chrome default a blue SaaS look? What does the product feel like when every platform shares one identity?
2. Do people think in two parallel filing systems ("Collections" to buy vs. "Lifestyle" to do), or is that the data model leaking into every picker? What if kinds were the only grouping and collections were optional?
3. When the classifier is confident, should the popup be a receipt with one "Move" chip rather than an editable form?
4. Should the Mac container be a real Keepsake window, your table of saves on the desktop, or so small it never needs a look of its own?

---

Trend: first run for this target, no trend yet (snapshot persistence skipped; see header).

## Questions for Harold (the skill's close)

The skill asks these before it plans fixes. This run is read-only and goes through the coordinating thread, so they are listed here for that thread to ask.

1. **Priority.** Which should come first?
   - (a) The safety and accessibility fixes: Undo contrast, focus, sidebar Trash, aria-live.
   - (b) One identity across platforms: the Chrome default, the Mac container, the floating button.
   - (c) Clutter: the iOS detail dock and the Library filter walls.
2. **Tone.** iOS is a warm "postcard" world, Chrome Modern is cool SaaS blue, and the Mac is a template. Which should win?
   - (a) Postcard everywhere.
   - (b) Keep Modern as the web default and align iOS to it.
   - (c) A new, third world for all.
3. **Scope.** There are 6 priority issues. Which should be fixed?
   - (a) The P1s only (4).
   - (b) All 6.
   - (c) P1s plus the copy unification.
4. **Constraints.** What should stay as it is?
   - (a) Nothing; everything is open.
   - (b) Keep the iOS postcard world.
   - (c) Keep the web token system and its 3 styles.
