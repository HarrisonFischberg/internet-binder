# Keepsake for iPhone and iPad: design principles

Date: 2026-10-15 · Status: **for review at M3.0.**

Learned from the Not Boring suite (Weather, Calculator, Timer, Camera, Habits, Vibes) through public
sources only: the App Store pages, press reviews, the makers' manifesto and public interviews. Nothing
here describes their pixels, palettes, sounds or layouts, and nothing of theirs is reused. What we take
are ideas, each restated for Keepsake with one screen or interaction it decides.

Sources (public):
- Andy Allen, "Monitor stands have more personality than software" (manifesto), uxtools.co.
- UX Tools podcast with Andy Allen, 2026: physical prototypes, 3D-printing the Camera UI to feel it in the hand.
- Launched (RevenueCat) podcast, July 2026: sound and haptics as the most underused tools; many slightly
  different versions of one click so it never sounds canned.
- Apple Developer, "Behind the Design: (Not Boring) Habits" (2022 Apple Design Award): one checkbox
  given room to become an event.
- TapSmart reviews of Camera and Vibes: chunky toggles, real-time shadows, custom haptics; pinch and swipe
  as the controls of a whole screen.

---

## 1. Control hierarchy: one thing in front

**The idea.** Each screen has one job, and the control for that job is large, physical and placed where
the thumb already is. Everything else steps back: smaller, quieter, or behind a gesture. The control
*is* the chrome: no toolbars of equal-weight icons.

**For Keepsake.** The primary action differs per screen, and only it gets weight:

| screen | the one thing | how it's made primary | pushed back |
| --- | --- | --- | --- |
| Share card | *where this save goes* | a large destination "slip" under the thumb; flick it sideways to change Lifestyle view or collection | note, Undo (small, always there) |
| Library | finding a save | search lives at the bottom, in thumb reach, as a pull-up drawer | filters (chips inside the drawer), sort, layout |
| Place | *go there* | one wide Directions slab at the bottom edge | share, edit, move (overflow) |
| Recipe | *cook it* | Start cooking; then one step fills the screen | ingredients checklist is the warm-up, not the event |
| Workout | *check in* | a big press-and-hold Done today | history, goal settings |
| Review | *file it* | three suggestion slips; swipe the card onto one | Skip, New collection |

**Example.** The Place screen: the postcard (photo + pin) fills the top two thirds; the only full-width
control is Directions at the bottom. "Been there" is a stamp you press onto the postcard, a secondary
but delightful act. Share and edit sit in a small ⋯.

## 2. Tactile interaction: everything answers your finger

**The idea.** Press, hold, drag, flick and dial, with physics that have mass. Every touch gets an
instant answer (a press state within one frame), and haptics and sound are part of the material, not
notifications. Variation keeps repeated sounds and taps alive.

**For Keepsake.**
- **Press**: every card sinks 2 pt and its shadow tightens on touch-down (not on release). 100 ms rule.
- **Hold**: check-ins and "Been there" are *press-and-hold to stamp*: a ring fills over 450 ms with
  rising haptic ticks, then a stamp lands with a firm thud. Holding prevents accidental check-ins
  without a confirmation dialog.
- **Flick**: on the share card, the destination slip flicks left/right through Lifestyle views and
  pinned collections with detents, like a card index. Each detent clicks (selection haptic).
- **Drag**: a save can be lifted (long press) and dropped onto a collection in the Library rail or
  the iPad sidebar. Lift = medium impact; hover over target = soft tick; drop = success.
- **Dial**: recipe servings is a small dial (rotate or drag); ingredient quantities scale live.
- **Variation**: the "saved" sound has a few close takes chosen at random, pitched by kind (lower for
  books, brighter for places), and is off by default (sound is an optional layer; haptics on).

**Example.** Workout check-in: hold the Done today disc; ticks rise; release early and it springs back
with no record; complete the hold and the week strip gains a stamped mark with a heavy spring.

## 3. Materiality: surfaces that explain

**The idea.** Light, depth, texture, shadow and translucency are information. A thing that lifts is
movable; a thing under glass is a preview; a thing that's paper can be written on.

**For Keepsake.** Saves are **objects you keep**, so they have the material of their kind:

| kind | object | material cue |
| --- | --- | --- |
| Place | postcard | photo face, white border, a pin; postmark when Been |
| Recipe | recipe card | ruled lines, an index tab with the time |
| Film or show | ticket stub | perforated edge, admit-one strip with the year |
| Book | spine / cover | a spine strip on the left edge of the card |
| Product | swing tag | a punched hole and string, price on the tag |
| Video | slide / frame | rounded frame with a play notch |
| Article | clipping | a torn top edge, set in a column |
| Workout | training card | a punched edge strip with the week marks |
| Link | luggage label | plain, small |

Depth has three levels only: the **table** (background), **objects** resting on it (cards, soft
contact shadow), and **held** objects (lifted while dragged or open as a sheet, longer shadow). Light
comes from one place (top-left), consistently. Translucency is reserved for controls that float over
content (the search drawer, the share card's frame) so content stays visible behind them.

**Example.** Library grid: cards rest on the table with a contact shadow; when you long-press one it
lifts (shadow grows, 1.03 scale) and the collection rail slides up to receive it.

## 4. Personalisation: it's yours

**The idea.** Themes, icons and widgets worth choosing, so the app feels owned. Choices are few,
complete and well made, not a settings maze.

**For Keepsake.**
- **Three styles** (from the Chrome system: Modern, Moss, Minimalist), each re-imagined with the chosen
  identity's materials, plus light/dark. Picking one is done on a live preview of *your own* saves.
- **App icons**: one per style plus a few objects (a postcard, a recipe card, a ticket stub). Each icon
  preview shows on a sample home screen.
- **Card style and density**: Objects (the kind materials above) or Plain (clean cards), and
  Comfortable/Compact.
- **Widgets**: Come back to (a single postcard/recipe card), Workout goal (week strip + hold-to-check-in
  as an App Intent), Places near a city (small map), and a lock-screen ring for this week's goal.

**Example.** Settings → Appearance opens a full-screen stage showing three of your recent saves; swiping
the style dial restyles them live with a soft click per detent.

## 5. Restraint: what we leave out

**The idea.** Bold apps are bold about one thing; the rest is quiet. They leave out what doesn't serve
the moment: tutorials, badges, feeds, settings on the main screen.

**For Keepsake.**
- No feed, no streak guilt, no badges, no counts on the icon except Review when it has saves.
- No onboarding carousel: first run is one sentence and a "Try sharing something to Keepsake" demo card.
- No sound on by default. No confetti. One celebration per day at most (the first check-in of a week).
- No decoration that doesn't explain: textures are subtle (≤ 4% contrast) and vanish with Reduce Transparency.
- No exclamation marks, no "Oops". Copy is short, warm and plain (see `ia.md` §Terminology).
- Kind colours appear on the object, never as background floods.

**Example.** Home has three things: Review (only if something is waiting), Recent (one shelf), Come back
to (one card). That's it.

---

## How we check a screen against these

1. Cover the screen with a thumb at the bottom: is the primary action still obvious and reachable?
2. Tap everything: does every control answer within 100 ms with a press state?
3. Turn on Reduce Motion, Reduce Transparency, Increase Contrast and AX5 text: is it still clear?
4. Read the copy aloud: plain, warm, short?
5. Would anyone mistake it for a Not Boring app, Albo or Thingz? If yes, redesign.
