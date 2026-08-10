# Skinmaxxing

An installable PWA for tracking an AM/PM skincare routine — what's on your shelf, what
you actually did each day, and progress photos over time.

**Live:** [skinmaxxing.netlify.app](https://skinmaxxing.netlify.app)

Sign in with Google to sync across devices, or use it without an account and keep
everything on the phone. Both paths are first-class; guest mode exists because OAuth
inside an installed iOS PWA is a long-standing Safari weak spot, so there has to be a
way in that cannot fail.

---

## What makes it non-trivial

Most of the difficulty in this app is not the UI. It's that the same data is edited on
more than one device, offline, by a person who expects yesterday's history to stay
exactly as they left it.

**History is immutable by construction.** Every product records `stints` — the date
ranges it was actually part of the routine. A day is scored against the shelf as it
stood on *that* day, so retiring a sunscreen today cannot retroactively break a streak
from last month. That's a data-model guarantee, not a rule someone has to remember.

**Local-first, cloud-reconciled.** localStorage is the source of truth the UI reads;
Supabase is a replica. Nothing blocks on the network. Conflicts resolve per entry, by
change stamp, at the persistence seam — which is why no mutation function in the UI
needs to know sync exists.

**Identity epochs.** Every read, write and sync carries the identity it belongs to
(`uid` or `"guest"`). The boot read records *which identity it finished for*, and sync
refuses to run unless that matches the current one. Without this, signing out of A and
into B in one tab could push A's routine into B's account — the render gate is computed
during render, not in an effect, because effects run after paint.

**Photos are Blobs in IndexedDB**, not base64 in localStorage. Real browsers cap
localStorage near 5 MB; the storage meter reports the actual server-enforced quota when
signed in, and the browser's real grant when not.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

That's the whole setup. With no Supabase credentials the build tree-shakes Supabase out
and the app runs fully local — no sign-in screen, everything on the device. This is
deliberate: it's what keeps the Playwright audits runnable without a backend.

To enable sign-in and sync:

```bash
cp .env.example .env.local   # then fill in the two values
```

Both values are public by design (they ship in the client bundle) — row level security
is what actually protects the data. The backend they point at is described in
[docs/SETUP.md](docs/SETUP.md), which is the authority on the SQL, storage buckets and
dashboard settings.

---

## Architecture

Four layers, each of which may only depend on the ones below it:

```
src/
├── App.jsx           container: all state, the boot read, sync wiring
├── features/         one folder per tab — presentational, own no persistence
│   ├── today/          the routine, and per-day edits to it
│   ├── shelf/          the product catalogue and its editor
│   ├── insights/       streaks, consistency, mood and category analysis
│   ├── journey/        calendar, photo gallery, comparisons
│   └── account/        sign-in, account screen, and its sheets
├── components/       the design system + shared widgets. Knows no domain concepts.
├── domain/           pure logic. No React, no JSX, no I/O.
│   ├── routine.js      what counts as done, and streaks — the core rules
│   ├── calendar.js     month grids
│   ├── dates.js        YYYY-MM-DD handling (never a Date across a boundary)
│   ├── catalog.js      categories, statuses, moods, filters
│   ├── photos.js       photo keys and gallery limits
│   └── exportData.js   the whole history as self-describing JSON
├── lib/              infrastructure. No JSX.
│   ├── auth.js         the auth state machine, incl. offline-unverified
│   ├── sync.js         push/pull with optimistic concurrency
│   ├── merge.js        per-entry conflict resolution
│   ├── store.js        namespaced localStorage
│   ├── photos.js       photo upload/download queues
│   ├── photoStore.js   photo + avatar blobs
│   └── idb.js          the IndexedDB wrapper
└── styles/theme.js   design tokens and the one global stylesheet
```

**Where to make a change**

| You want to… | Go to |
|---|---|
| change what counts as a complete day, or a streak | `domain/routine.js` |
| change how two devices reconcile an edit | `lib/merge.js` |
| restyle something everywhere at once | `styles/theme.js`, `components/primitives.jsx` |
| change one screen | the matching folder in `features/` |
| add a product category | `domain/catalog.js` (one line) |
| change a backend limit | `docs/SETUP.md`, then the mirroring constant in the app |

The dependency rule is what keeps this honest: `domain/` importing React, or a feature
importing another feature's internals, means the boundary was drawn in the wrong place.

---

## Testing

The suite is Playwright driving the real app against a mocked Supabase, asserting
behaviour rather than implementation. **285 assertions across 8 suites.**

```bash
npm run dev      # in one terminal — the browser suites need a running server
npm run verify   # in another
```

| Command | Asserts |
|---|---|
| `verify:merge` | conflict resolution, tombstones, field-level day merging (no browser needed) |
| `verify:p1` / `verify:p2` | the four tabs, edge cases, retirement, immutability of history |
| `verify:auth` | the auth state machine and the sign-in gate |
| `verify:identity` | **the cross-account leak regression.** Must never fail. |
| `verify:offline` | an expired token offline still opens your own data |
| `verify:storage2` | IndexedDB migration, the meter, namespace isolation |
| `verify:account` | guest lifecycle, guest→account conversion, avatars, deletion |

Also available: `verify:a11y` (reduced-motion and accessible names), `verify:prod`,
`check:phone` (renders correctly over the LAN on a real device), `shots`.

`verify:identity` is the one to care about most — it seeds as account A, signs out,
signs in as B, and asserts that zero bytes of A's data reach B's row or B's screen.

---

## Deployment

Netlify builds from `main` on push. `npm run build` emits `dist/` with a service worker
and the PWA manifest; installing to the home screen is what makes it a real app rather
than a bookmark.

---

## License

All rights reserved — see [LICENSE](LICENSE). The source is public to read; it is not
licensed for reuse.
