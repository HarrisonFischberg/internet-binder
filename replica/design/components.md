# Keepsake components

Tokens use the role names in `tokens.json`: `--c-*` in CSS, `KS.Palette.*` in Swift. Sizes in px for Chrome and pt for Apple. Screens are S01–S15 (`replica/recon.md`).

Every component has a visible focus state (2 px `focus` ring with a 2 px offset on Chrome; the system focus ring on Apple), honours reduced motion (cross-fade only), and supports Dynamic Type on Apple up to accessibility sizes. Minimum targets: 32 px on Chrome, 44 pt on iOS.

## Kind system

| kind | schema `kind` | token | Chrome icon (Lucide-style name) | SF Symbol |
| --- | --- | --- | --- | --- |
| Product | product | `kind-product` | shopping-bag | bag |
| Place | place | `kind-place` | map-pin | mappin.and.ellipse |
| Recipe | recipe | `kind-recipe` | chef-hat | fork.knife |
| Video | video | `kind-video` | play-square | play.rectangle |
| Article | article | `kind-article` | newspaper | doc.text |
| Workout | workout | `kind-workout` | dumbbell | figure.strengthtraining.traditional |
| Film or show | media | `kind-film` | clapperboard | film |
| Book | book | `kind-book` | book-open | book |
| Link | link | `kind-link` | link | link |

Colour is never the only signal: the chip always shows the icon and the word.

## Components

```
KindChip
  variants  default (icon + label), compact (icon only, with accessible label), filter (toggle)
  states    default, hover, selected (filled kind tint + 1px kind border), focus-visible, disabled
  tokens    bg kind-*-soft, text kind-*, radius pill, type caption, padding 2/8
  a11y      label "Recipe"; as a filter: a toggle button with aria-pressed / .isSelected trait
  used on   S01, S04, S05, S08, S09

SaveCard
  variants  grid (image top), list (56px thumb left), compact (popup recent), map callout (Apple)
  slots     media, favourite, kind chip + source, title (2 lines), key fact, note (1 line), state badge
  states    default, hover (raised shadow, image 1.02 scale; none with reduced motion), focus-visible, selected (bulk),
            finishing details (quiet spinner + caption), failed details (warning caption "Couldn't read details · Retry"),
            no image (kind-tinted tile with large kind icon), purchased/done (muted image, done check), in trash (Restore)
  tokens    bg surface, radius lg, shadow card → raised on hover, title type subhead/600, fact type footnote text-muted
  a11y      one button for the card, named "{title}, {kind}, {key fact}". Favourite and menu are separate buttons.
            Never a nested interactive element inside the card button (the 1.x card-hit pattern is kept)
  used on   S03, S04, S05, S06, S07, S13

CaptureCard (popup, in-page card, iOS share card)
  layout    thumb 56 · title + kind chip · collection chip row · actions row · status line
  states    saving, saved, saved-to-review, finishing, duplicate, link-only, offline, cannot-read, storage-full, error
  actions   Move (collection picker), Add note (inline field), Undo; duplicate: Open / Save a copy / Update
  timing    in-page card: stays 10 s, pauses on hover or focus; iOS: closes 2 s after saved, pauses on touch
  tokens    bg surface, shadow overlay, radius xl, accent for the primary action
  a11y      in-page card is a role="status" region (polite) in a closed shadow root; Esc closes; focus never stolen
            from the page unless opened by keyboard. iOS: VoiceOver announces "Saved to Places"
  used on   S01

CollectionChip / CollectionPicker
  chip      collection name with a ▾ when changeable; outline in accent when it's Keepsake's pick, filled when user-chosen
  picker    search field, pinned first, recent next, "New collection…", "Leave in Review"
  states    open, filtering, empty match ("Create 'Ramen spots'"), keyboard navigation (↑↓, Enter, Esc)
  a11y      combobox pattern (Chrome); Menu or Picker with search (Apple)
  used on   S01, S02, S08, S09

ConfidencePill
  values    High (hidden on cards: not noise) · Good · Low · Needs a collection
  tokens    Good: accent on accent-soft; Low: warning on warning-soft; Needs: text-muted on surface-2
  tooltip   the categorizer's reason, e.g. "'dutch oven' in the title"
  used on   S01, S02, S09

StatusControl (to do / done)
  variants  segmented (detail), menu item (card), checkbox (list row)
  label     per-kind done verb (Bought, Been, Cooked, Watched, Read, Finished, Done)
  used on   S04, S08

Toast with Undo
  copy      past tense + object: "Moved to Kitchen", "Moved to Trash", "Saved 12 posts"
  states    info, success, warning, error (error has no auto-dismiss)
  timing    8 s; pauses on hover or focus
  a11y      aria-live polite (error: assertive); Undo reachable by keyboard (⌥Z in the dashboard)

Sidebar (Chrome dashboard, iPad, Mac)
  sections  Home · Library · Review (badge, only when > 0) · Kinds (only those with saves) · Collections (pinned, recent, "All collections") · Trash · Settings
  states    collapsed (icons only, Chrome < 900 px), hover, current (accent-soft bg, accent text), drag-to-reorder pinned
  a11y      nav landmark; aria-current="page"; Alt+↑/↓ reorders pinned (kept from 1.x)

TabBar (iPhone)
  tabs      Home · Library · Map · Search. Review shows as a badge on Home and a banner at the top of Home

SearchField + ScopeChips
  behaviour "/" focuses (Chrome), ⌘F (Mac), pull-down (iPhone); results update every keystroke (local)
  states    empty, typing, results, no results, corrected spelling

FilterBar
  controls  Kind (multi), Collection, Status (To do / Done / Purchased), Source, Sort (Newest, Oldest, Price, A–Z), Grid/List
  states    active filters shown as removable chips; "Clear all"

DetailPanel per kind
  shared    media gallery, title (editable), kind chip (changeable), collection, note, source link (full URL, Copy, Open),
            status, history (captured on, edited, AI changes with Undo)
  Product   price, shop, Visit page, Mark purchased
  Place     address, hours, Map (Apple) / Open in Maps menu (Chrome), "Been"
  Recipe    servings, ingredients (checkboxes), steps (numbered), "Draft with AI" (only if empty, AI on, labelled Suggestion)
  Workout   exercises table (exercise, sets, reps or time, rest), Goals
  Video/Article/Film/Book   key metadata, Open

GoalCard + CheckInSheet
  goal      title ("3× a week for 4 weeks"), progress ring (this week), week strip (✓ marks), next step
  check-in  one tap "Done today"; optional sets/reps/time fields; note
  AI        "Suggest a progression" (visible only when AI is on) → preview list → Accept / Dismiss; source='ai-suggested'
  states    active, finished, paused, missed week (neutral copy), no exercises found

ReviewRow
  layout    thumb · title · kind chip · reason · 3 suggestion chips · New collection… · Skip
  states    filing (row exits, 200 ms), filed (toast with Undo), skipped
  keyboard  1/2/3 files to a suggestion, N new collection, S skip, ↓ next

PermissionRow (Settings, Privacy)
  layout    what it allows (plain words) · where data goes · state (Granted / Not granted / Turned off) · action
  states    granted, not granted, revoked by browser, unavailable (e.g. no Instagram import yet)

EmptyState
  slots     kind icon (large, tinted), one sentence, one primary action at most
  copy      from ia.md §Empty states

Button
  variants  primary (accent bg, on-accent text), secondary (surface bg, border), ghost, danger (danger text; filled only in confirmation)
  sizes     sm 28/32 px web, md 36 px web / 44 pt iOS, lg 44 px web
  states    default, hover, active, focus-visible, disabled, loading (label kept, spinner leading)

Dialog / TypedConfirm
  used for  delete forever, replace library on import, erase everything, delete from iCloud
  rule      the confirm button names the action ("Erase everything"), never "OK"
```

## Motion

| moment | Chrome | Apple |
| --- | --- | --- |
| capture card in | 200 ms rise + fade | sheet spring (0.35 response) |
| filed from Review | row slides out 200 ms, list closes the gap | `.transition(.move + .opacity)` |
| favourite | star fills, 120 ms | symbol effect `.bounce` (off with reduced motion) |
| everything with reduced motion | opacity only | opacity only |
