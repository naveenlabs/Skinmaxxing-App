import { addDays, todayStr } from "./dates.js";

export function usageStats(products, logs) {
  const stats = {};
  products.forEach((p) => { stats[p.id] = { count: 0, last: null }; });
  Object.keys(logs).sort().forEach((d) => {
    const l = logs[d];
    products.forEach((p) => {
      if ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id])) {
        stats[p.id].count += 1;
        stats[p.id].last = d;
      }
    });
  });
  return stats;
}

export function anyChecked(obj) { return obj && Object.values(obj).some(Boolean); }

// the "must-have" categories that count toward Today's Progress — cleanser + moisturizer always,
// sunscreen only for AM (actives/toners/serums are tracked but optional, not part of the base).
// Having multiple products in a must-have category (e.g. two moisturizers) only requires ONE of them checked.
export function mustHaveCategories(period) {
  return period === "AM" ? ["cleanser", "moisturizer", "sunscreen"] : ["cleanser", "moisturizer"];
}

// "Is it on my shelf right now" — correct for the present-tense views (Shelf, Insights),
// wrong for anything that renders or scores a past day. Those use statusOn(p, date).

// "Is it on my shelf right now" — correct for the present-tense views (Shelf, Insights),
// wrong for anything that renders or scores a past day. Those use statusOn(p, date).
export function isRetired(p) { return (p.status || "active") === "retired"; }

// ---------------------------------------------------------------------------
// Product timeline
//
// Status used to be a single flag applied to every day in history, so retiring
// something rewrote the past: its rows vanished from days you had actually used
// it, and the must-have categories it covered stopped counting, which silently
// re-scored months of logs (a 2/3 morning became 2/2 = complete). A product now
// carries the date ranges it was part of the default routine, so every past day
// is judged against what was true on that day and never moves again.
//
// `stints` is the source of truth; `status`/`retiredReason` are kept mirrored on
// every write so this data still opens in a build without stints.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Product timeline
//
// Status used to be a single flag applied to every day in history, so retiring
// something rewrote the past: its rows vanished from days you had actually used
// it, and the must-have categories it covered stopped counting, which silently
// re-scored months of logs (a 2/3 morning became 2/2 = complete). A product now
// carries the date ranges it was part of the default routine, so every past day
// is judged against what was true on that day and never moves again.
//
// `stints` is the source of truth; `status`/`retiredReason` are kept mirrored on
// every write so this data still opens in a build without stints.
// ---------------------------------------------------------------------------

export function stintsOf(p) { return Array.isArray(p.stints) ? p.stints : []; }

// from <= date <= to, where to:null means "still in the routine"

// from <= date <= to, where to:null means "still in the routine"
export function stintCovers(p, date) {
  return stintsOf(p).some((s) => s.from && s.from <= date && (!s.to || date <= s.to));
}

export function openStint(p) { return stintsOf(p).find((s) => !s.to) || null; }

// What this product was on one specific date. "trying" isn't versioned — it and
// "active" both mean "in the routine", they only differ in how they're badged.

// What this product was on one specific date. "trying" isn't versioned — it and
// "active" both mean "in the routine", they only differ in how they're badged.
export function statusOn(p, date) {
  if (stintCovers(p, date)) return (p.status || "active") === "trying" ? "trying" : "active";
  const list = stintsOf(p);
  if (!list.length) return "retired";
  return list.some((s) => s.from && s.from <= date) ? "retired" : "not-yet";
}

// Upgrade from the old single-flag shape. Everything is derived from data the app
// already holds, and it runs once — a product that already has `stints` is skipped.

// Upgrade from the old single-flag shape. Everything is derived from data the app
// already holds, and it runs once — a product that already has `stints` is skipped.
export function migrateProductStints(products, logs) {
  const dates = Object.keys(logs).sort();
  const firstLogged = dates[0] || null;
  const usedDates = {};
  products.forEach((p) => { usedDates[p.id] = []; });
  dates.forEach((d) => {
    const l = logs[d] || {};
    products.forEach((p) => {
      if ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id])) usedDates[p.id].push(d);
    });
  });

  let changed = false;
  const next = products.map((p) => {
    if (Array.isArray(p.stints)) return p;
    changed = true;
    const used = usedDates[p.id] || [];
    const from = used[0] || firstLogged || todayStr();
    if ((p.status || "active") === "retired") {
      // "when did I stop?" is honestly answered by the last day it appears in a log
      const to = used.length ? used[used.length - 1] : null;
      if (!to || to < from) return { ...p, stints: [] }; // retired without ever being used
      return { ...p, stints: [{ from, to, reason: p.retiredReason || null }] };
    }
    return { ...p, stints: [{ from, to: null, reason: null }] };
  });
  return { products: next, changed };
}

// The only writer of stints. Both the Shelf kebab and the product editor route through
// here — two independent writers for one piece of state is exactly how the retroactive
// status bug appeared in the first place. Returns a patch for updateProduct().

// The only writer of stints. Both the Shelf kebab and the product editor route through
// here — two independent writers for one piece of state is exactly how the retroactive
// status bug appeared in the first place. Returns a patch for updateProduct().
export function applyStatusChange(product, nextStatus, logs, reason) {
  const today = todayStr();
  const wasRetired = (product.status || "active") === "retired";
  const nowRetired = nextStatus === "retired";
  const stints = stintsOf(product).map((s) => ({ ...s }));

  if (nowRetired && !wasRetired) {
    const day = logs[today] || {};
    const usedToday = !!((day.am || {})[product.id] || (day.pm || {})[product.id]);
    // gone from today, unless it's already been used today — then today stays
    // intact and it disappears tomorrow
    const to = usedToday ? today : addDays(today, -1);
    const open = stints.find((s) => !s.to);
    if (open) {
      if (to < open.from) stints.splice(stints.indexOf(open), 1); // never actually used
      else { open.to = to; open.reason = reason || null; }
    }
  } else if (!nowRetired && wasRetired && !stints.some((s) => !s.to)) {
    // a fresh stretch — the gap since the last one stays a gap
    stints.push({ from: today, to: null, reason: null });
  } else if (nowRetired && wasRetired && reason !== undefined) {
    // reason edited without a status change — keep the closed stint in sync
    const last = [...stints].reverse().find((s) => s.to);
    if (last) last.reason = reason || null;
  }

  return { status: nextStatus, stints, retiredReason: nowRetired ? (reason || null) : null };
}

export function dayTweakList(dayLog, bucket, period) {
  const b = dayLog && dayLog[bucket];
  const arr = b && b[period.toLowerCase()];
  return Array.isArray(arr) ? arr : [];
}

// The routine actually in effect for one date + period.
//   base — what that day is SCORED against (see completionRatio)
//   list — what is shown and can be ticked
//
// A row earns its place on a past day for exactly one of three honest reasons: it was
// part of that day's default routine, it was genuinely checked off that day, or it was
// explicitly added for that one day. Never "because it happens to be active right now" —
// no fallback, no borrowing from today, not even for the very first product you ever add.
// A product simply does not exist before its own stint begins. Full stop.

// The routine actually in effect for one date + period.
//   base — what that day is SCORED against (see completionRatio)
//   list — what is shown and can be ticked
//
// A row earns its place on a past day for exactly one of three honest reasons: it was
// part of that day's default routine, it was genuinely checked off that day, or it was
// explicitly added for that one day. Never "because it happens to be active right now" —
// no fallback, no borrowing from today, not even for the very first product you ever add.
// A product simply does not exist before its own stint begins. Full stop.
export function routineFor(date, dayLog, products, period) {
  const matchesTime = (p) => p.time === "Both" || p.time === period;
  const key = period.toLowerCase();
  const skipSet = new Set(dayTweakList(dayLog, "skip", period));
  const base = products.filter((p) => matchesTime(p) && stintCovers(p, date));
  const baseIds = new Set(base.map((p) => p.id));

  // A product genuinely ticked on this day keeps its row forever, independent of whatever
  // happens to its status afterwards. This is the actual guarantee behind "retiring only
  // affects today onward" — not just the stint math, but the row itself never disappearing
  // out from under a tick that's already there.
  const checked = (dayLog && dayLog[key]) || {};
  const usedThatDay = products.filter((p) => matchesTime(p) && checked[p.id] && !baseIds.has(p.id));
  const usedIds = new Set(usedThatDay.map((p) => p.id));

  const visible = [...base, ...usedThatDay];
  const added = dayTweakList(dayLog, "extra", period)
    .map((id) => products.find((p) => p.id === id))
    .filter((p) => p && !baseIds.has(p.id) && !usedIds.has(p.id));

  return {
    base,
    list: [...visible.filter((p) => !skipSet.has(p.id)), ...added],
    addedIds: new Set(added.map((p) => p.id)),
    skipped: visible.filter((p) => skipSet.has(p.id)),
  };
}

// The single definition of "complete" that Today's %, the week rail, both calendars,
// the heatmap, Insights and the export all read from, so they can't drift apart.
// The bar comes from `base` — the default routine on that date — while credit comes
// from `list`, so an added product can satisfy a category it isn't required to fill.

// The single definition of "complete" that Today's %, the week rail, both calendars,
// the heatmap, Insights and the export all read from, so they can't drift apart.
// The bar comes from `base` — the default routine on that date — while credit comes
// from `list`, so an added product can satisfy a category it isn't required to fill.
export function completionRatio(date, dayLog, products, period) {
  const { base, list } = routineFor(date, dayLog, products, period);
  const checked = (dayLog && dayLog[period.toLowerCase()]) || {};
  let cats = mustHaveCategories(period).filter((cat) => base.some((p) => p.category === cat));
  // A day with nothing on record at all (nothing covered it, nothing was checked) has no
  // bar to protect — so if it's since been filled in by hand via "Add a step for this
  // day," let what was actually added define the bar for that one day. This never borrows
  // from today's routine; it only ever reacts to what was deliberately added for this
  // exact day, so it can't be used to inflate any other day.
  if (cats.length === 0 && base.length === 0) {
    cats = mustHaveCategories(period).filter((cat) => list.some((p) => p.category === cat));
  }
  if (cats.length === 0) return { done: 0, total: 0 };
  const done = cats.filter((cat) => list.some((p) => p.category === cat && checked[p.id])).length;
  return { done, total: cats.length };
}

// a day is "full" only once its must-have routine steps (see completionRatio) hit 100% —
// merely checking something in both AM and PM is no longer enough to count as complete.

// a day is "full" only once its must-have routine steps (see completionRatio) hit 100% —
// merely checking something in both AM and PM is no longer enough to count as complete.
export function dayCompletionPct(date, logs, products) {
  const dayLog = logs[date];
  if (!dayLog) return 0;
  const am = completionRatio(date, dayLog, products, "AM");
  const pm = completionRatio(date, dayLog, products, "PM");
  const totalAll = am.total + pm.total;
  return totalAll ? Math.round(((am.done + pm.done) / totalAll) * 100) : 0;
}

export function dayStatus(date, logs, products) {
  const pct = dayCompletionPct(date, logs, products);
  if (pct >= 100) return "full";
  if (pct > 0) return "partial";
  return "none";
}

export function isPeriodComplete(date, logs, products, period) {
  const dayLog = logs[date];
  if (!dayLog) return false;
  const r = completionRatio(date, dayLog, products, period);
  return r.total > 0 && r.done >= r.total;
}

// Consecutive fully-complete days ending today. Today is still in progress for most of
// the day, so an unfinished today doesn't reset the count to zero — the run is measured
// from yesterday until today is finished, at which point today joins it. Shared by
// Routine, Insights and the export so all three always report the same number.

// Consecutive fully-complete days ending today. Today is still in progress for most of
// the day, so an unfinished today doesn't reset the count to zero — the run is measured
// from yesterday until today is finished, at which point today joins it. Shared by
// Routine, Insights and the export so all three always report the same number.
export function currentStreakDays(logs, products) {
  const today = todayStr();
  let cursor = dayCompletionPct(today, logs, products) >= 100 ? today : addDays(today, -1);
  let n = 0;
  while (dayCompletionPct(cursor, logs, products) >= 100) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function longestStreakDays(logs, products) {
  const dates = Object.keys(logs).sort();
  if (!dates.length) return 0;
  let longest = 0, run = 0;
  for (let c = dates[0], end = todayStr(); c <= end; c = addDays(c, 1)) {
    if (dayCompletionPct(c, logs, products) >= 100) { run++; longest = Math.max(longest, run); } else { run = 0; }
  }
  return longest;
}

// Consecutive days a single product has been used, ending today — same "today is still
// in progress" grace as the overall streak, so a tretinoin counter doesn't read Day 0
// every morning. One definition for Routine, Insights and the export.

// Consecutive days a single product has been used, ending today — same "today is still
// in progress" grace as the overall streak, so a tretinoin counter doesn't read Day 0
// every morning. One definition for Routine, Insights and the export.
export function productStreakDays(logs, productId) {
  const used = (d) => {
    const l = logs[d];
    return !!(l && ((l.am && l.am[productId]) || (l.pm && l.pm[productId])));
  };
  const today = todayStr();
  let cursor = used(today) ? today : addDays(today, -1);
  let n = 0;
  while (used(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}
