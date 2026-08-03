# Audit & regression harness

Playwright scripts that drive the real app at the iPhone viewport (393×852). They exist
because the bugs found in this codebase were behavioural — they only showed up on real
interaction, not on a code read.

## Setup

The dev server must be running (`npm run dev`). Photo-upload tests need real JPEG
fixtures, generated once:

```
npm run fixtures     # writes 7 valid JPEGs to /tmp/glass-fixtures
```

## Regression suite

```
npm run verify
```

Covers, in order, each defect found in the audit and asserts the fixed behaviour:

| # | What it guards |
|---|---|
| 1 | Storage works in a plain browser (no permanent "Couldn't save"); a check-off survives reload |
| 2 | 100% stays reachable when the only product in a must-have category is retired |
| 3 | Streak survives an unfinished today, and Routine / Insights / export all report the same number |
| 4 | Export resolves deleted products instead of leaking raw ids; carries photo ids + definitions |
| 5 | A bad photo pick (non-image) never destroys the photos already saved for that slot; 5-per-pick cap; errors visible from the Routine tab |
| 6 | Compare never pairs a photo with itself, never renders a src-less `<img>`, and discloses a far-off preset |
| 7 | A product whose category no longer exists is still reachable on the Shelf |
| 8 | Never-used product history shows no "Invalid Date" |
| 9 | 90-day cleanup asks before deleting, and cancelling keeps everything |
| 10 | Gallery tiles have a stable aspect ratio and real height |
| 11 | Empty product name explains itself instead of silently doing nothing |
| 12 | All four pages are console-clean with zero data |

`verify:p2` covers the product-timeline work — retiring must not rewrite history, and any
product must be usable on a single day without changing its status:

| # | What it guards |
|---|---|
| 1 | Retiring a product changes **no** past day's log, consistency trend, or either streak |
| 2 | A past day still shows a since-retired product, still ticked |
| 3 | A retired product can be added to one day; its shelf status stays `retired` |
| 4 | Skipping a must-have doesn't lower that day's bar (it caps below 100% and says so); undo restores the row unchecked |
| 5 | Restoring opens a second date range instead of rewriting the gap |
| 6 | Migration from the old single-flag shape is derived, idempotent, and keeps `status` readable by an older build |
| 7 | `copyYesterday` carries per-day step changes, so no tick is left without a row |
| 8 | A day from before the record begins still shows the routine **and can reach 100%** |
| 9 | Copy-forward is offered on any past blank day, worded for that day, and withdraws once the day has content |
| 10 | Adding a new product still doesn't re-score past consistency or the longest streak |
| 11 | A retired product still shows, still ticked, on a day it was genuinely used — and stays listed (not dropped) in Insights' "Tracked products", just relabeled |
| 12 | A brand-new product never appears on a day before it was added — only from that day forward |
| 13 | The steps sheet works with zero logged data |

Blocks 8 and 10 are a matched pair and must both stay green: the scoring bar has to stay
conservative (10) while the visible list stays generous (8). Tying them to the same rule is
what broke back-filling.

Blocks 11 and 12 guard the same root cause from opposite directions: a row must appear on
a past day for an honest reason — it was part of that day's routine, or it was genuinely
checked that day — never merely because a product happens to be active *right now*. That
shortcut is what let a new product bleed onto the past (12) and let retiring erase a day
you'd actually logged (11), at the same time.

## Screenshots

```
npm run shots           # all four pages at four scroll depths
npm run shots:states    # empty states, every bottom sheet, kebab menu, lightbox, year view
```

## Files

- `drive.mjs` — boots a browser with a seeded dataset; `go(page, tab)` navigates.
- `seed.mjs` — builds a deterministic ~150-day dataset (logs, moods, notes, weekly
  reflections, 21 photos spread so 30/90-day compare has real targets).
- `mkfixtures.mjs` — generates valid JPEGs for upload tests.
- `palette.mjs` — samples dominant colours out of `src/assets/*` (this is how the
  palette in `GLOBAL_CSS` was derived).
- `compose.mjs` — builds side-by-side before/after composites.
- `p1-*.mjs` — the original exploratory audits, kept as documentation of how each bug
  was reproduced.

Tests select on `data-testid` attributes, not on styling, so a visual change doesn't
break them.
