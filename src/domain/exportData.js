import { CATS, MOODS } from "./catalog.js";
import { fmtDate, monthKey, parseDate, prettyDate, todayStr } from "./dates.js";
import {
  currentStreakDays,
  dayCompletionPct,
  isPeriodComplete,
  longestStreakDays,
  productStreakDays,
  stintsOf,
  usageStats,
} from "./routine.js";

export function computeExportData(products, logs, photoIndex, photoSizes) {
  const dates = Object.keys(logs).sort();
  const todayD = todayStr();
  const productById = {};
  products.forEach((p) => (productById[p.id] = p));

  // resolve product ids -> readable names in each day's log, since raw ids alone
  // aren't useful to a human or an AI reading this without cross-referencing.
  const dailyLogs = {};
  dates.forEach((d) => {
    const l = logs[d];
    // a product deleted from the shelf leaves its id behind in old logs; surface that
    // explicitly rather than emitting a bare id nothing can resolve
    const namesOf = (obj) => Object.keys(obj || {}).filter((id) => obj[id]).map((id) => productById[id]?.name || `(deleted product, id ${id})`);
    const listNames = (bucket, k) => {
      const arr = l[bucket] && l[bucket][k];
      return Array.isArray(arr) ? arr.map((id) => productById[id]?.name || `(deleted product, id ${id})`) : [];
    };
    dailyLogs[d] = {
      date: d,
      weekday: parseDate(d).toLocaleDateString(undefined, { weekday: "long" }),
      amProductsUsed: namesOf(l.am),
      pmProductsUsed: namesOf(l.pm),
      // one-off changes to this day only — see definitions.perDayStepChanges
      amExtraProducts: listNames("extra", "am"),
      pmExtraProducts: listNames("extra", "pm"),
      amSkippedProducts: listNames("skip", "am"),
      pmSkippedProducts: listNames("skip", "pm"),
      amMood: l.amMood || null,
      amNote: l.amNote || "",
      pmMood: l.pmMood || null,
      pmNote: l.pmNote || "",
      weeklyReflectionMood: l.weeklyMood || null,
      weeklyReflectionNote: l.weeklyNote || "",
    };
  });

  // per-product lifetime stats
  const stats = usageStats(products, logs);
  const productStats = products.map((p) => {
    const usedDates = dates.filter((d) => (logs[d].am && logs[d].am[p.id]) || (logs[d].pm && logs[d].pm[p.id]));
    const currentStreak = productStreakDays(logs, p.id);
    return {
      name: p.name,
      category: p.category,
      timeOfDay: p.time,
      status: p.status || "active",
      retiredReason: p.retiredReason || null,
      isTrackedForDayCounter: !!p.tracked,
      isFlaggedExfoliantOrActive: !!p.exfoliant,
      totalDaysUsed: stats[p.id]?.count || 0,
      firstUsedDate: usedDates[0] || null,
      lastUsedDate: stats[p.id]?.last || null,
      currentConsecutiveDayStreak: currentStreak,
    };
  });

  // overall streaks — same helpers the UI uses, so export and screen never disagree
  const firstDate = dates[0];
  const longestStreakEver = longestStreakDays(logs, products);
  const currentOverallStreak = currentStreakDays(logs, products);

  // monthly consistency trend, last 12 months
  const monthlyTrend = [];
  for (let i = 11; i >= 0; i--) {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() - i);
    const mk = monthKey(fmtDate(base));
    const daysCounted = mk === monthKey(todayD) ? parseDate(todayD).getDate() : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const mDates = dates.filter((d) => monthKey(d) === mk);
    const complete = mDates.filter((d) => dayCompletionPct(d, logs, products) >= 100).length;
    monthlyTrend.push({
      month: mk,
      daysWithAnyLog: mDates.length,
      daysFullyComplete: complete,
      consistencyPct: daysCounted ? Math.round((complete / daysCounted) * 100) : 0,
    });
  }

  // mood distribution, all-time (not just current month, for full-history questions)
  const moodCounts = { am: {}, pm: {} };
  MOODS.forEach((m) => { moodCounts.am[m] = 0; moodCounts.pm[m] = 0; });
  dates.forEach((d) => {
    const l = logs[d];
    if (l.amMood) moodCounts.am[l.amMood] = (moodCounts.am[l.amMood] || 0) + 1;
    if (l.pmMood) moodCounts.pm[l.pmMood] = (moodCounts.pm[l.pmMood] || 0) + 1;
  });

  // AM vs PM adherence
  const amDays = dates.filter((d) => isPeriodComplete(d, logs, products, "AM")).length;
  const pmDays = dates.filter((d) => isPeriodComplete(d, logs, products, "PM")).length;

  // category balance, all-time
  const categoryTotals = {};
  CATS.forEach((c) => (categoryTotals[c.id] = 0));
  products.forEach((p) => { categoryTotals[p.category] = (categoryTotals[p.category] || 0) + (stats[p.id]?.count || 0); });
  const categoryGrandTotal = Object.values(categoryTotals).reduce((a, b) => a + b, 0) || 1;
  const categoryBalance = CATS.map((c) => ({
    category: c.label,
    totalUses: categoryTotals[c.id] || 0,
    pctOfAllCheckIns: Math.round(((categoryTotals[c.id] || 0) / categoryGrandTotal) * 100),
  })).filter((c) => c.totalUses > 0);

  // photo metadata only — no image bytes in this export
  const photoEntries = [];
  Object.keys(photoIndex).forEach((d) => {
    const slot = photoIndex[d];
    (slot.am || []).forEach((id) => photoEntries.push({ date: d, period: "AM", id, approxSizeKB: Math.round((photoSizes[`${d}:am:${id}`] || 0) / 1024) }));
    (slot.pm || []).forEach((id) => photoEntries.push({ date: d, period: "PM", id, approxSizeKB: Math.round((photoSizes[`${d}:pm:${id}`] || 0) / 1024) }));
  });
  photoEntries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const activeCount = products.filter((p) => (p.status || "active") === "active").length;
  const retiredCount = products.filter((p) => p.status === "retired").length;

  const summary = `Tracking since ${firstDate ? prettyDate(firstDate) : "n/a"} (${dates.length} days logged total, ${monthlyTrend[11].consistencyPct}% consistent this month). Current streak: ${currentOverallStreak} day(s), longest ever: ${longestStreakEver} day(s). Shelf has ${products.length} products (${activeCount} active, ${retiredCount} retired). ${photoEntries.length} progress photo(s) logged.`;

  return {
    exportedAt: new Date().toISOString(),
    app: "Skinmaxxing — AM/PM skincare routine tracker",
    notes: "dailyLogs contains the complete raw daily record — every field the user ever entered. The insights/productStats blocks below are pre-computed conveniences derived from that same raw data, not additional information, so any question can in principle be answered directly from dailyLogs even if not explicitly precomputed here. Products deleted from the shelf still appear in dailyLogs (marked as deleted) but contribute no productStats or categoryBalance rows, since their category was deleted with them.",
    definitions: {
      dayCompletion: "A day counts as fully complete once every must-have category in that day's default routine is checked in both periods. Must-have categories are cleanser + moisturizer + sunscreen for AM, cleanser + moisturizer for PM. Having two products in one must-have category only requires one of them. Which products counted on a given day comes from each product's routinePeriods (see below), NOT from its status today — so retiring a product never changes a past day's score.",
      routinePeriods: "The date ranges a product was part of the default routine (to:null means still in it). A day is judged against the products whose range covers that day, which is what makes history immutable.",
      perDayStepChanges: "extraProducts / skippedProducts on a daily log are one-off changes to that single day, made without altering the product's status. They change what was on the list but never the bar: a skipped step still counts against that day's completion, and an added step can satisfy a must-have category but never adds a new one.",
      currentOverallStreak: "Consecutive fully-complete days ending today. An unfinished today does not break the streak — it is measured from yesterday until today is completed.",
      consistencyPct: "Fully-complete days divided by calendar days elapsed in that month (not by days logged).",
    },
    summary,
    products: products.map((p) => ({
      name: p.name,
      category: p.category,
      timeOfDay: p.time,
      status: p.status || "active",
      retiredReason: p.retiredReason || null,
      routinePeriods: stintsOf(p).map((s) => ({ from: s.from, to: s.to, retiredReason: s.reason || null })),
      trackedForDayCounter: !!p.tracked,
      flaggedExfoliantOrActive: !!p.exfoliant,
      hasProductPhoto: !!p.photo,
    })),
    dailyLogs,
    productStats,
    insights: {
      totalDaysTracked: dates.length,
      firstTrackedDate: firstDate || null,
      lastTrackedDate: dates[dates.length - 1] || null,
      currentOverallStreak,
      longestStreakEver,
      monthlyConsistencyTrend: monthlyTrend,
      moodDistributionAllTime: moodCounts,
      amAdherence: { daysWithAnyAmCheckIn: amDays, pctOfTrackedDays: dates.length ? Math.round((amDays / dates.length) * 100) : 0 },
      pmAdherence: { daysWithAnyPmCheckIn: pmDays, pctOfTrackedDays: dates.length ? Math.round((pmDays / dates.length) * 100) : 0 },
      categoryBalanceAllTime: categoryBalance,
    },
    photos: {
      totalCount: photoEntries.length,
      totalApproxSizeMB: Math.round((photoEntries.reduce((a, b) => a + b.approxSizeKB, 0) / 1024) * 10) / 10,
      note: "Image data itself is not included in this export — photo bundling is a separate feature. This is metadata only: which dates/periods have photos attached.",
      entries: photoEntries,
    },
  };
}
