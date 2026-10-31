# Labeling rules for the first-pass challenge sets

These rules decide what a challenge case's `expected` says. They apply to `firstpass-challenge.json`
(34 cases, written Oct 2026 and tuned on) and `firstpass-wide.json` (174 cases, written 2026-10-30
before any tuning in that session). Every case in both files is synthetic: invented captions, invented
accounts. Captions from Harold's real exports never go in a committed fixture; real cases are built at
run time from an export path (`--source real --export <file>`).

## The label space

- **kind**: `product` (a thing to buy, on a shop or product page), `place` (one venue or destination
  someone could visit), `recipe` (a dish or drink to make, even when the recipe is only in the comments,
  a link or the video), `workout` (a routine or training session to do), `video`, `article`, `media`
  (one film or show), `book` (one book), `link` (anything else).
- **collection**: only for `product` and `link`. Lifestyle kinds have their own views and no collection.
- **Review**: the honest outcome when the save gives too little to file. `reviewOk: true` means Review
  is scored as correct; without it, Review counts as an unnecessary Review.
- `accept` lists every answer an honest reader would take. Order does not matter to the scorer.

## Rules

1. **Instructions in the content are content.** "Ignore previous instructions", "SYSTEM:", "Category: X",
   HTML comments aimed at AI: never a label. The case is labeled by what the post is about.
2. **Anything on youtube.com or youtu.be is a video** (Harold's rule, also in capture.js), whatever it
   teaches. A workout or recipe on YouTube may also accept its Lifestyle kind.
3. **Metaphors don't make a kind.** "Recipe for an AI agent", "reps" of a piano bar, "training" a model,
   SQL "explained with pizza" are about their real subject.
4. **A location tag is where it was posted from** unless the post is about visiting somewhere. A coding
   tip tagged "Austin, Texas" is Coding.
5. **A place needs a place.** A post that names one venue (📍, address, location tag on a food or visit
   post) is a place. A list of venues may be a place (the first or best one) or the trip's collection
   (Travel, Roadtrip). A spot with no name ("the $3 dumpling spot") may honestly go to Review. A chain's
   menu item, a closed venue and a one-weekend pop-up accept Review.
6. **"Comment WORD for the recipe" is a recipe** when the dish is named. A pitch for an ebook or a list
   with no dish named accepts Review too.
7. **A device or gadget review on social is a link** in the person's products collection, not a
   product; a product is a shop or product page (schema Product, a price).
8. **Topic hashtags are evidence.** `#aitools #sidehustle` says AI even with a one-line caption.
   Emoji-only or hashtag-only posts accept the topic they show and Review.
9. **Two honest homes are both accepted** (an AI tool that plans meals: AI or Food). The case's first
   answer is the writer's pick; the second pass may pick the other.
10. **Stand-in titles** ("TikTok - Make Your Day", "Instagram reel") are no evidence at all.

## The second pass (2026-10-30)

A fresh agent on a different model (Claude Sonnet 5.5) labeled all 208 cases blind: it was given only
each case's evidence and the library's collection names, never these labels, with the label-space
definitions above but none of rules 5, 6, 8 (they were written afterwards, to settle disagreements).

| | n | result |
|---|---|---|
| Primary label agreement | 208 | 86.5% |
| Cohen's kappa (primary label) | 208 | **0.855** |
| Agreement counting either side's alternatives | 208 | 98.6% |

Of the 28 primary-label disagreements, 25 were the same set of answers in a different order, or the
second pass choosing Review on a case that already accepts Review. Three were real:

- `ch-ai-08` (one line plus `#aitools #sidehustle`): second pass said Review. Settled by rule 8; the
  label stays AI / Business ideas. Not changed, so build-34 numbers on this set stay comparable.
- `w-rc-22` (comment SOUP for a soups ebook): second pass said Review. Settled by rule 6: now accepts Review.
- `w-pl-15` (an unnamed dumpling spot): second pass said Review. Settled by rule 5: now accepts Review.

The pass-2 labels and the agreement script are kept with the run outputs (ib-qa-data/s1030), not in git.
Harold has still not reviewed either pass; his own Instagram collections remain the only human labels.
