# Keepsake for iPhone and iPad (M3): build prompt

Paste everything below the line into Claude Code, run from the repository root
(`/Users/harrison/projects/keepsake`). It is written to be used with `/goal` and `/ralph-loop`
(see "How to run it" at the end).

---

## Who you are and what you're making

You are the design lead and the lead iOS engineer for **Keepsake**, a privacy-first saver that already
ships as a Chrome extension (Chrome Web Store, v1.4.2). Build **Keepsake for iPhone and iPad**: a
native SwiftUI app that feels like a beautifully made object. It should be tactile, quick, calm, a little
joyful, and unmistakably Keepsake's own.

The app has to work just as well as the extension, and be the most beautiful thing on the person's
home screen. When function and beauty seem to conflict, find the design that gives you both. Don't
trade one away.

## Sources of truth (read these first, in this order)

1. `README.md` and `keepsake/PRIVACY.md`: what Keepsake is and the promises it makes.
2. `keepsake/src/shared/*.js`: the product's real rules. These are pure functions, written to run on iOS
   too: `kinds.js` (what a save is, and the details each kind has), `places.js` (state and review rules),
   `goals.js`, `topics.js`, `search.js`, `categorizer.js`, `lookups.js`, and the storage schema in
   `storage.js` / `db.js`.
3. `replica/architecture.md`: the decided Apple stack. Start from SwiftUI multiplatform, SQLite via GRDB
   in an App Group, the JS core run in JavaScriptCore, and CloudKit later. Section 8 reconciles the
   earlier iOS plan. If you find a better path, write the trade-off down and ask; don't switch silently.
4. `replica/design/` (`ia.md`, `components.md`, `tokens/`, `Theme.swift`, `prototypes/`): the
   information architecture and the existing design system. Evolve it; don't discard it.
5. `replica/recon.md`, `replica/albo/`, `replica/thingz/`, `replica/features.csv`,
   `replica/gap-analysis.md`, `replica/feedback.md`: what comparable apps do and what their users ask for.
6. `replica/m3/sync-bridge.md`: how iPhone and Chrome will connect through CloudKit later (pairing by QR,
   sealed bundles, then two-way sync). M3 doesn't sync, but its storage must be ready for it.
7. The Chrome extension itself. Load `keepsake/` unpacked and use it: its kinds, Lifestyle views, Places
   by state with Places review, the Instagram import flow, Check with AI, and its tone of voice. The iOS
   app is the same product, rethought for a phone in one hand.

## Fixed decisions

- **Current iOS only.** Use the newest SwiftUI and system design APIs freely; no back-deployment shims.
- **The Apple Developer Program is active.** Use real App Groups, a Share Extension, widgets, and a
  CloudKit container for the experiments. The signing team comes from the owner; don't create
  identifiers or change account settings without asking.
- **The Share Sheet is the way in from Instagram on iOS.** No in-app Instagram import or scraping; the
  full Saved-collection import stays in Chrome.

## Hard rules (never break these)

- **Local-first, no account, no telemetry, no Keepsake server.** Everything lives on the device. Sync
  comes later, in M4, through the person's own iCloud (CloudKit). Don't build any other network path.
- **Optional AI uses the person's own key (BYOK)**, is off by default, and sends only what
  `PRIVACY.md` says. **Lookups** (OpenStreetMap, Wikidata, Open Library) are off until turned on.
  On iOS, maps use MapKit.
- **Same data, both ways.** The app imports a Chrome export (`keepsake-export-*.json`, the current
  `schemaVersion`) losslessly, and its own export imports into Chrome. Any schema change gets tests
  and a recovery plan.
- **Never invent content.** No made-up sources, prices, product matches or addresses. A missing detail
  stays empty or goes to review.
- **Public sources only for other apps.** Use App Store pages, their screenshots and preview videos,
  public press, interviews and talks, and public reviews. **Never decompile, dump, intercept or
  reverse-engineer** another company's app, binary, network traffic or private API. That includes
  using `rea` on them.
- **Don't copy, learn.** Take principles from the references, never their assets: no icons,
  illustrations, sounds, fonts, colour palettes, copy, or signature layouts. Keepsake must not be
  mistakable for a Not Boring app, Albo or Thingz.
- **No outward actions without explicit approval.** That means no git push, no tags, no TestFlight, no
  App Store Connect, no Apple Developer account changes, and nothing sent to anyone. Commit only when
  asked.

## The references, and how to use them

**Function: Albo and Thingz** (App Store: `id6578421992`, `id6744123389`). These show what people expect
from a save-and-organise app on a phone: the share sheet as the way in, capture speed, how saves get
sorted, and collections. Our recon is already in `replica/albo/` and `replica/thingz/`. Use them for what
the app must *do*. Beat them on speed to save, on sorting quality, and on Lifestyle (places on a map,
recipes you can cook from, workouts with goals). Don't use them for how it should *look*.

**Design: the Not Boring suite** (App Store bundle `id1847738447`: Weather, Calculator, Timer,
Camera, Habits, Vibes; two Apple Design Awards). Study the whole suite, not one app. From public
screenshots, preview videos and the makers' public talks and interviews, write
`replica/m3/design-principles.md`, a principles document covering:

- **Control hierarchy.** How each screen makes one thing primary and pushes everything else back. How
  big, physical-feeling controls replace chrome. How the thumb finds the main action without looking.
- **Tactile interaction.** Press, hold, drag, flick and dial. Spring physics with weight. Haptics that
  match what's happening. Sound as an optional layer. Instant feedback on every touch.
- **Materiality.** Surfaces that feel like stuff: light, depth, texture, shadow and translucency used
  to explain the interface, not to decorate it.
- **Personalisation.** Themes, app icons and widgets that are worth choosing, and the sense that the
  app is *yours*.
- **Restraint.** What they leave out.

For each principle, write what it means for Keepsake specifically, with one concrete example screen
or interaction. Don't describe their pixels; describe the idea.

**Keepsake's own identity.** A keepsake is something you keep because it matters: a ticket stub, a
recipe card in someone's handwriting, a pressed flower, a postcard from a place you want to go back
to. Develop the visual language from that world. Saves are *objects you keep*, not rows in a database:
a place is a postcard with a pin, a recipe a card, a film a ticket, a book a spine, a product a tag.
Propose two or three distinct directions (material, type, colour, motion, sound) as **static
prototypes** before building, and let me choose. The Chrome extension's tokens are the starting point;
the iOS app can go further.

## What the app does (M3 scope)

1. **Save from anywhere through the Share Sheet** (Share Extension). Instagram, Safari, Maps, YouTube,
   TikTok, Letterboxd, Goodreads, Notes, and photos. It saves in one tap with no waiting: the save is
   stored first, then the details are filled in. The sheet shows where it's going (Lifestyle view or
   collection) and lets you change it with one gesture. Undo is always there.
2. **Library**: everything, with search that forgives typos, filters by kind, status, source and
   tags, and grid or list.
3. **Lifestyle**:
   - **Places**: by state, then city, with a full-screen **MapKit** map and Places review with Fix with AI.
   - **Recipes**: a cooking view with a checklist, step by step, and the screen kept awake.
   - **Workouts**: exercises, goals and one-tap check-ins, with a widget.
   - **Videos, Articles, Films & shows, Books.**
4. **Collections** for shopping, with Purchased. The **Review** queue for anything Keepsake wasn't
   sure about.
5. **Optional AI and Lookups**, with the same rules, consent screens and change log (with Undo) as
   Chrome.
6. **Import and export**: the Chrome export file both ways (Files, AirDrop, and the share sheet). Instagram
   comes in through the Share Sheet only.
7. **Personalisation**: themes, alternate app icons, card styles and density, sound and haptics
   switches, and home-screen and lock-screen widgets.
8. **iPad**: a real iPad layout (sidebar, multi-column, drag and drop into collections, pointer and
   keyboard), not a stretched phone. A macOS (Designed for iPad or Catalyst) build only if it comes
   nearly free.

Out of M3: CloudKit sync and the Chrome pairing (M4, designed in `sync-bridge.md`), Android, any server,
accounts, price tracking. M3 does the groundwork: stable UUIDs, `updatedAt`/`deletedAt` tombstones,
`userFields`, content fields kept apart from sync metadata, a local change outbox, and a `Sealer`
(CryptoKit: X25519, HKDF-SHA256, AES-GCM) with test vectors shared with Chrome's WebCrypto.

## Quality bar (every screen must pass all of these)

- **One primary action per screen**, reachable by the thumb, obvious within a second.
- **Every touch answers within 100 ms**: a visible press state, and a haptic where it means something.
  Write the haptics map (`replica/m3/haptics.md`) and keep to it.
- **Motion has weight and purpose.** Springs, not linear tweens. Nothing moves without a reason.
  Everything respects Reduce Motion.
- **60 fps** (120 on ProMotion) when scrolling 5,000 saves. Opening the app to a usable Library takes
  under 400 ms on a recent iPhone.
- **Accessibility is designed in**: Dynamic Type up to AX5 with no clipped text, VoiceOver labels and
  rotor actions, contrast at AA or better in every theme, and a target size of at least 44 pt.
- **Every state is designed**: empty, loading, partial, error, offline, permission denied, and first
  run. No placeholder text in the shipped app.
- **Light and dark, and every theme**, screenshotted for every screen.
- **Copy** is in Keepsake's voice: plain, warm and short, with no jargon and no exclamation marks.
- **Tests**: the shared JS rules run in JavaScriptCore against the same fixtures as the Chrome tests
  (`tests/`), so both platforms agree. Swift unit tests cover storage and import/export, and UI tests
  cover the save flow and Places review.

## How to work

Use the tools for what they're good at. Don't let their defaults override this brief.

- **replica-skill.** Recon already exists, so skip `replica-recon` unless a gap appears.
  - Run `replica-design` to extend the tokens and component specs for iOS, with the WCAG contrast check.
  - Then `replica-build`, screen by screen, starting with a vertical slice: Share Sheet → save →
    Library → open the save.
  - Then `replica-test` and `replica-diff` against `replica/features.csv`.
  - Ignore its web-stack defaults, its Postgres and payments defaults, and its rebrand step. Keepsake is
    already the brand.
- **rea**: only on our own artifacts. Use it on the Chrome extension (`keepsake/`) to map behaviour you
  must match, on public web pages, and on our own iOS builds to check what they do on the network.
  Never use it on another company's app.
- **Simulator**: build and run on the iOS Simulator after every meaningful change. Screenshot each
  screen in light and dark, look at the screenshots, and judge them against the quality bar before
  moving on.
- **Decisions**: write each decision that isn't obvious (with its trade-off) in
  `replica/m3/decisions.md`.

## Milestones (stop for my review at each one marked ⏸)

1. **M3.0 Design** ⏸
   - `design-principles.md`.
   - Two or three identity directions as static SwiftUI prototypes: the Library, a Place, a Recipe,
     and the Share Sheet, in light and dark, with screenshots.
   - The haptics map, motion specs and the iOS tokens.
2. **M3.1 Foundations**
   - Xcode project (app, Share Extension, Widgets, App Group).
   - GRDB schema matching the Chrome export.
   - The JS core in JavaScriptCore, with the shared fixtures passing.
   - Import of a Chrome export.
   - Sync-ready storage: the record shape, the outbox and the `Sealer` (see `sync-bridge.md`).
   - The three CloudKit experiments in `sync-bridge.md`, written up in `replica/m3/experiments.md`. ⏸ if
     any fails, since the Chrome connection's design depends on them. These are experiments only: no
     sync ships in M3.
3. **M3.2 Vertical slice** ⏸: save from the Share Sheet (Instagram, Safari, Maps) → Library → open the
   save, fully designed and tested.
4. **M3.3 Lifestyle**: Places (map, by state, review), Recipes, Workouts with goals, Videos, Articles,
   Films & shows, Books.
5. **M3.4 Collections, Review, search, AI, Lookups, export.**
6. **M3.5 Personalisation and widgets, iPad layout, accessibility pass, performance pass.** ⏸
7. **M3.6 Release candidate**: every screen through the quality bar, `replica-diff` parity report,
   App Store screenshots in light and dark, and a privacy nutrition label matching `PRIVACY.md`.
   Stop. TestFlight and App Store only with my explicit approval.

## Each loop iteration (for `/ralph-loop`)

1. Read `replica/m3/progress.md`: what's done, what's next, open questions.
2. Pick the next smallest piece of the current milestone.
3. Build it. Run the tests. Run it in the Simulator. Screenshot light and dark.
4. Judge the screenshots against the quality bar and the design principles. Fix what fails.
5. Update `progress.md` with what was done, the evidence (screenshot paths and test results), and
   what's next.
6. At a ⏸ milestone, write a short review note and stop. Output the completion promise only when the
   current milestone is fully done and verified.

---

## How to run it

1. Prerequisites (you):
   - Run `sudo xcode-select -s /Applications/Xcode.app`.
   - Have an Apple Developer Program membership, needed for the App Group, Share Extension and
     widgets on a real device. The Simulator works without it.
   - Install rea with `npx rea-agents setup`, then restart Claude Code.
   - Install replica-skill and the Ralph Wiggum plugin.
2. Set the goal:
   ```
   /goal Ship Keepsake for iPhone and iPad (M3) per replica/m3/PROMPT.md: the most beautiful, tactile, intuitive save-and-organise app on iOS, local-first and private, matching the Chrome extension's data and rules.
   ```
3. Run one milestone at a time, so each ⏸ review happens:
   ```
   /ralph-loop "Work on the current milestone in replica/m3/PROMPT.md. Follow 'Each loop iteration'." --completion-promise "MILESTONE COMPLETE" --max-iterations 25
   ```
