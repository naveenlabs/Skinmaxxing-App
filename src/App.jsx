import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from "framer-motion";
import {
  Sun, Moon, Plus, Trash2, X, ChevronLeft, ChevronRight,
  Camera, Image as ImageIcon, Sparkles, Check,
  Droplet, Loader2, Package, ArrowRight, Star, AlertTriangle, Flame,
  Layers, Search, FlaskConical, Eye, Smile, Archive, Download, MoreHorizontal, WifiOff, Trophy,
  Circle, ChartNoAxesColumn, Images, Calendar, Pencil, RotateCcw,
  ArrowDownNarrowWide, TrendingUp, TrendingDown, Info, CircleCheck,
  CircleMinus, Undo2, CalendarClock, LogOut, ArrowLeft, RefreshCw, Cloud, CloudUpload
} from "lucide-react";

import { useAuth } from "./lib/auth.js";
import { useSync } from "./lib/sync.js";
import { usePhotoSync, pickEvictions, localPhotoKey } from "./lib/photos.js";
import { getStore, loadJSON, saveJSON, approxBytes, clearNamespace } from "./lib/store.js";

/* ---------------------------------- assets ---------------------------------- */
const HERO_IMG = new URL("./assets/hero.jpg", import.meta.url).href;
const SHELF_HEADER_IMG = new URL("./assets/shelf-hero.jpg", import.meta.url).href;
const LEAF_IMG = new URL("./assets/leaf.png", import.meta.url).href;
const JOURNEY_HEADER_IMG = new URL("./assets/journey-hero.jpg", import.meta.url).href;
const AM_CARD_IMG = new URL("./assets/insights-am.jpg", import.meta.url).href;
const PM_CARD_IMG = new URL("./assets/insights-pm.jpg", import.meta.url).href;
const INSIGHTS_HEADER_IMG = new URL("./assets/insights-hero.jpg", import.meta.url).href;

/* ---------------------------------- utils ---------------------------------- */

const CATS = [
  { id: "cleanser", label: "Cleanser", icon: Droplet },
  { id: "toner", label: "Toner", icon: Sparkles },
  { id: "serum", label: "Serum", icon: FlaskConical },
  { id: "treatment", label: "Treatment", icon: Flame },
  { id: "eyecream", label: "Eye Cream", icon: Eye },
  { id: "lipcare", label: "Lip Care", icon: Smile },
  { id: "moisturizer", label: "Moisturizer", icon: Layers },
  { id: "sunscreen", label: "Sunscreen", icon: Sun },
  { id: "other", label: "Other", icon: Circle },
];

const STATUS_OPTIONS = ["active", "trying", "retired"];

function usageStats(products, logs) {
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

function computeExportData(products, logs, photoIndex, photoSizes) {
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
    app: "Glass — AM/PM skincare routine tracker",
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

const QUOTES = [
  "Consistency is the highest form of self-care.",
  "Small steps, every day, become glass skin.",
  "Your barrier remembers patience.",
  "Barrier first, glow follows.",
  "Discipline today, dewy skin tomorrow.",
  "The best routine is the one you actually finish.",
  "Skin doesn't change overnight — it changes on nights like this.",
];

const MOODS = ["Great", "Okay", "Dry", "Breakout", "Irritated"];
const NEGATIVE_MOODS = ["Dry", "Irritated"];
function anyChecked(obj) { return obj && Object.values(obj).some(Boolean); }

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseDate(s) { return new Date(s + "T00:00:00"); }
function todayStr() { return fmtDate(new Date()); }
function prettyDate(s) {
  const d = parseDate(s);
  const t = todayStr();
  const yest = addDays(t, -1);
  if (s === t) return "Today";
  if (s === yest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
function monthKey(s) { return s.slice(0, 7); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / 86400000);
}
function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/* ------------------------------- storage layer ------------------------------ */

// Signed out this is a hard ceiling on the device. Signed in the cloud holds the
// durable copy, so it becomes a local cache budget instead and old photos are evicted
// rather than refused — see the eviction effect in App.
const TOTAL_QUOTA_MB = 20;
const GALLERY_PAGE_SIZE = 20;
const MAX_PHOTOS_PER_PICK = 5;
function photoKey(date, period, id) { return `${date}:${period}:${id}`; }
function genPhotoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// The storage layer itself now lives in ./lib/store.js so the sync engine can sit under
// the same seam. Behaviour is unchanged: window.storage (the Claude artifact API) still
// wins over localStorage wherever it exists.
/* --------------------------------- component --------------------------------- */

export default function App() {
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState([]);
  const [logs, setLogs] = useState({});
  const [photoIndex, setPhotoIndex] = useState({}); // { date: { am: [id], pm: [id] } }
  const [photoCache, setPhotoCache] = useState({}); // { "date:period:id": dataUrl }
  const [photoSizes, setPhotoSizes] = useState({}); // { "date:period:id": bytes }
  const [photoError, setPhotoError] = useState(null);
  // Mirrors of the two persisted photo maps. Writes used to happen inside the state
  // updater callbacks, which React invokes twice under StrictMode — so every save fired
  // twice and concurrent updates could persist a stale snapshot. Refs let us compute the
  // next value, persist it, and set state exactly once.
  const photoIndexRef = useRef({});
  const photoSizesRef = useRef({});
  const photoCacheRef = useRef({});
  photoCacheRef.current = photoCache;
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [tab, setTab] = useState("today");
  const [moodModal, setMoodModal] = useState(null); // 'am' | 'pm' | 'weekly' | null
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const fileInputRef = useRef(null);
  const pendingSaves = useRef(0);
  const pendingPeriodRef = useRef("am");
  function triggerPhotoUpload(period) {
    pendingPeriodRef.current = period;
    fileInputRef.current && fileInputRef.current.click();
  }

  const finishSave = useCallback((ok) => {
    pendingSaves.current = Math.max(0, pendingSaves.current - 1);
    if (!ok) { setSaveStatus("error"); return; }
    if (pendingSaves.current === 0) {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    }
  }, []);
  const persistJSON = useCallback(async (key, value) => {
    pendingSaves.current += 1;
    setSaveStatus("saving");
    try {
      const r = await getStore().set(key, JSON.stringify(value));
      finishSave(!!r);
    } catch { finishSave(false); }
  }, [finishSave]);
  const persistRaw = useCallback(async (key, value) => {
    pendingSaves.current += 1;
    setSaveStatus("saving");
    try {
      const r = await getStore().set(key, value);
      finishSave(!!r);
    } catch { finishSave(false); }
  }, [finishSave]);

  /* ------------------------------ account + sync ----------------------------- */

  const auth = useAuth();
  const cloudEnabled = auth.status === "signed-in";
  const userId = auth.user?.id || null;
  const [accountOpen, setAccountOpen] = useState(false);

  // Which store everything belongs to. Null until auth settles, because useAuth sets the
  // storage namespace before it reports a status — reading first would load the signed-out
  // store into a signed-in session. Signing in or out changes this key, and EVERY piece of
  // state below is re-derived from it.
  const identityKey = auth.status === "loading" ? null : (userId || "guest");
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;

  // Ref mirrors so the sync engine always reads the current documents without being
  // re-created on every keystroke.
  const docsRef = useRef({});
  docsRef.current = { products, logs, photoIndex };

  // Holds the identity whose boot read actually completed — not a bare boolean. A boolean
  // stayed true across a sign-out, which let the sync engine start pushing while React
  // still held the *previous* account's documents: that is how account A's routine ended
  // up in account B's row. Sync refuses to run unless this equals the current identity.
  const readyForRef = useRef(null);

  // Writes merged remote data down WITHOUT stamping it as a local change — stamping it
  // would mark it dirty and push it straight back up, forever.
  const applyRemote = useCallback(async ({ products: p, logs: l, photoIndex: pi }) => {
    if (p) { setProducts(p); await saveJSON("nv-products", p); }
    if (l) { setLogs(l); await saveJSON("nv-logs", l); }
    if (pi) { photoIndexRef.current = pi; setPhotoIndex(pi); await saveJSON("nv-photo-index", pi); }
  }, []);

  const sync = useSync({ enabled: cloudEnabled, userId, identityKey, docsRef, readyForRef, applyRemote });
  const { recordChange, displayName, setDisplayName } = sync;
  const photoSync = usePhotoSync({ enabled: cloudEnabled, userId, identityKey });
  const { queueUpload, fetchRemote, removeRemote, removeAllRemote, touch: touchPhoto } = photoSync;

  useEffect(() => {
    if (!identityKey) return undefined;
    let alive = true;
    const epoch = identityKey;

    // Nothing from the previous identity may survive into this one — not the documents,
    // not the decoded photo cache, not the size table. `ready` drops so the boot screen
    // covers the swap and no view renders another account's data for a frame.
    setReady(false);
    readyForRef.current = null;
    setProducts([]);
    setLogs({});
    setPhotoIndex({});
    photoIndexRef.current = {};
    setPhotoSizes({});
    photoSizesRef.current = {};
    setPhotoCache({});
    setSelectedDate(todayStr());

    (async () => {
      try {
        const [p, l, legacyDates, newIndex, sizes] = await Promise.all([
          loadJSON("nv-products", null),
          loadJSON("nv-logs", {}),
          loadJSON("nv-photo-dates", []),
          loadJSON("nv-photo-index", null),
          loadJSON("nv-photo-sizes", {}),
        ]);
        // The namespace may have moved on while those were in flight; a late write here
        // would land in the wrong account's store.
        if (!alive || identityKeyRef.current !== epoch) return;

        const loadedLogs = l || {};
        if (p && p.length) {
          // upgrade the old single-status shape to a dated timeline, once
          const { products: withStints, changed } = migrateProductStints(p, loadedLogs);
          setProducts(withStints);
          if (changed) persistJSON("nv-products", withStints);
        } else {
          // a genuinely fresh install starts with an empty shelf — nothing appears until
          // the user adds it themselves
          setProducts(p || []);
        }
        setLogs(loadedLogs);

        if (newIndex) {
          // upgrade in place if any slot is still the old boolean shape, not an array of ids
          let needsMigration = false;
          const migrated = {};
          Object.keys(newIndex).forEach((d) => {
            const slot = newIndex[d] || {};
            const upgrade = (v) => {
              if (Array.isArray(v)) return v;
              needsMigration = true;
              if (v === true) return ["__single__"];
              if (v === "legacy") return ["__legacy__"];
              return [];
            };
            migrated[d] = { am: upgrade(slot.am), pm: upgrade(slot.pm) };
          });
          photoIndexRef.current = migrated;
          setPhotoIndex(migrated);
          if (needsMigration) persistJSON("nv-photo-index", migrated);
        } else if (legacyDates && legacyDates.length) {
          // oldest scheme: one photo/day under `photo:${date}`, no period distinction
          const migrated = {};
          legacyDates.forEach((d) => { migrated[d] = { am: ["__legacy__"], pm: [] }; });
          photoIndexRef.current = migrated;
          setPhotoIndex(migrated);
          persistJSON("nv-photo-index", migrated);
        }
        photoSizesRef.current = sizes || {};
        setPhotoSizes(sizes || {});
      } catch (e) {
        // A corrupt store must not strand the app on the boot screen forever.
        console.warn("[glass] boot read failed:", e?.message || e);
      } finally {
        if (alive && identityKeyRef.current === epoch) {
          readyForRef.current = epoch;
          setReady(true);
        }
      }
    })();

    return () => { alive = false; };
  }, [identityKey]);

  // recordChange diffs the outgoing value against what's currently in memory and stamps
  // only the entries that actually moved. Doing it here rather than at each mutation is
  // what lets every toggle/edit/reorder function below stay exactly as it was.
  const persistProducts = useCallback((next) => {
    const prev = docsRef.current.products;
    setProducts(next);
    persistJSON("nv-products", next);
    recordChange("products", prev, next);
  }, [persistJSON, recordChange]);
  const persistLogs = useCallback((next) => {
    const prev = docsRef.current.logs;
    setLogs(next);
    persistJSON("nv-logs", next);
    recordChange("logs", prev, next);
  }, [persistJSON, recordChange]);

  function getDayLog(date) {
    return logs[date] || { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
  }
  function toggleProduct(period, id) {
    const day = getDayLog(selectedDate);
    const nextPeriod = { ...day[period], [id]: !day[period][id] };
    persistLogs({ ...logs, [selectedDate]: { ...day, [period]: nextPeriod } });
  }
  // ---- per-day routine tweaks ----
  // These change what's on one day's list without touching the product's status, so
  // using a retired product for a single day no longer means un-retiring it (which
  // used to re-score every past day).
  function addStepForDay(period, id) {
    const key = period.toLowerCase();
    const day = getDayLog(selectedDate);
    const extra = { ...(day.extra || {}) };
    const skip = { ...(day.skip || {}) };
    extra[key] = [...new Set([...(extra[key] || []), id])];
    skip[key] = (skip[key] || []).filter((x) => x !== id); // never in both lists at once
    persistLogs({ ...logs, [selectedDate]: { ...day, extra, skip } });
  }

  function skipStepForDay(period, id, isAdded) {
    const key = period.toLowerCase();
    const day = getDayLog(selectedDate);
    const extra = { ...(day.extra || {}) };
    const skip = { ...(day.skip || {}) };
    if (isAdded) {
      // it was only here for this one day — drop it rather than record a skip
      extra[key] = (extra[key] || []).filter((x) => x !== id);
    } else {
      skip[key] = [...new Set([...(skip[key] || []), id])];
    }
    // skipping states you didn't do it, so it can't stay checked
    const nextChecked = { ...day[key] };
    delete nextChecked[id];
    persistLogs({ ...logs, [selectedDate]: { ...day, [key]: nextChecked, extra, skip } });
  }

  function unskipStepForDay(period, id) {
    const key = period.toLowerCase();
    const day = getDayLog(selectedDate);
    const skip = { ...(day.skip || {}) };
    skip[key] = (skip[key] || []).filter((x) => x !== id);
    persistLogs({ ...logs, [selectedDate]: { ...day, skip } });
  }

  function saveMood(period, mood, note) {
    const day = getDayLog(selectedDate);
    persistLogs({
      ...logs,
      [selectedDate]: { ...day, [period + "Mood"]: mood, [period + "Note"]: note },
    });
  }
  function moveProduct(period, id) {
    const filtered = products.filter((p) => p.time === "Both" || p.time === period.toUpperCase());
    const idx = filtered.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % filtered.length;
    const a = filtered[idx], b = filtered[nextIdx];
    const ia = products.findIndex((p) => p.id === a.id);
    const ib = products.findIndex((p) => p.id === b.id);
    const next = [...products];
    [next[ia], next[ib]] = [next[ib], next[ia]];
    persistProducts(next);
  }
  function addProduct(newP) {
    // a new product joins the routine from today, so it never changes what past days required
    const stints = newP.status === "retired" ? [] : [{ from: todayStr(), to: null, reason: null }];
    persistProducts([...products, { ...newP, id: uid(), stints }]);
  }
  function deleteProduct(id) {
    persistProducts(products.filter((p) => p.id !== id));
    // a deleted product must not linger in any day's per-day tweak lists, or that day
    // keeps a reference nothing can resolve
    let touched = false;
    const nextLogs = { ...logs };
    Object.keys(logs).forEach((d) => {
      const day = logs[d];
      let dayChanged = false;
      const next = { ...day };
      ["extra", "skip"].forEach((bucket) => {
        if (!day[bucket]) return;
        const cleaned = {};
        ["am", "pm"].forEach((k) => {
          const arr = Array.isArray(day[bucket][k]) ? day[bucket][k] : [];
          const kept = arr.filter((x) => x !== id);
          if (kept.length !== arr.length) dayChanged = true;
          cleaned[k] = kept;
        });
        next[bucket] = cleaned;
      });
      if (dayChanged) { nextLogs[d] = next; touched = true; }
    });
    if (touched) persistLogs(nextLogs);
  }
  function updateProduct(id, patch) {
    persistProducts(products.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function reorderInCategory(category, id) {
    const filtered = products.filter((p) => p.category === category);
    const idx = filtered.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % filtered.length;
    const a = filtered[idx], b = filtered[nextIdx];
    const ia = products.findIndex((p) => p.id === a.id);
    const ib = products.findIndex((p) => p.id === b.id);
    const next = [...products];
    [next[ia], next[ib]] = [next[ib], next[ia]];
    persistProducts(next);
  }
  function copyYesterday(date) {
    const y = addDays(date, -1);
    const yLog = logs[y];
    if (!yLog) return;
    const validIds = new Set(products.map((p) => p.id));
    const filterValid = (obj) => {
      const out = {};
      Object.keys(obj || {}).forEach((id) => { if (validIds.has(id) && obj[id]) out[id] = true; });
      return out;
    };
    // carry the per-day tweaks too — otherwise a copied day keeps a tick for a product
    // that isn't on its list, which is the same "checked but no row" bug in miniature
    const filterList = (arr) => (Array.isArray(arr) ? arr.filter((id) => validIds.has(id)) : []);
    const copyBucket = (bucket) => ({
      am: filterList(yLog[bucket] && yLog[bucket].am),
      pm: filterList(yLog[bucket] && yLog[bucket].pm),
    });
    const today = getDayLog(date);
    persistLogs({
      ...logs,
      [date]: {
        ...today,
        am: filterValid(yLog.am), pm: filterValid(yLog.pm),
        extra: copyBucket("extra"), skip: copyBucket("skip"),
      },
    });
  }
  function saveWeekly(mood, note) {
    const day = getDayLog(selectedDate);
    persistLogs({ ...logs, [selectedDate]: { ...day, weeklyMood: mood, weeklyNote: note } });
  }

  function exportJSON() {
    const data = computeExportData(products, logs, photoIndex, photoSizes);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `glass-export-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const storageKeyFor = localPhotoKey;

  // Memoized: LazyPhoto's IntersectionObserver effect depends on this, so a new function
  // identity every render tore down and rebuilt an observer per tile on every keystroke.
  const loadPhoto = useCallback(async (date, period, id) => {
    const ck = photoKey(date, period, id);
    touchPhoto(ck);
    if (photoCacheRef.current[ck]) return photoCacheRef.current[ck];

    const adopt = (value) => {
      setPhotoCache((c) => ({ ...c, [ck]: value }));
      if (photoSizesRef.current[ck] == null) {
        const next = { ...photoSizesRef.current, [ck]: approxBytes(value) };
        photoSizesRef.current = next;
        setPhotoSizes(next);
        persistJSON("nv-photo-sizes", next);
      }
      return value;
    };

    try {
      const r = await getStore().get(storageKeyFor(date, period, id));
      if (r && r.value) return adopt(r.value);
    } catch { /* nothing stored locally for this slot */ }

    // Not on this device — a new phone, or one that evicted it to stay under budget.
    const remote = await fetchRemote(date, period, id);
    if (remote) {
      persistRaw(storageKeyFor(date, period, id), remote);
      return adopt(remote);
    }
    return null;
  }, [persistJSON, persistRaw, fetchRemote, touchPhoto]);

  // Decode + downscale a picked file WITHOUT touching stored state. Kept separate from
  // committing so a selection that turns out to be unreadable can't destroy the photos
  // already saved for that date+period (it used to: the old photos were deleted first,
  // then the new file failed to process, and both were gone).
  function processPhotoFile(file, date, period) {
    return new Promise((resolve) => {
      if (!file) return resolve({ ok: false, error: null });
      if (!file.type || !file.type.startsWith("image/")) {
        return resolve({ ok: false, error: `"${file.name}" doesn't look like an image file.` });
      }
      if (date > todayStr()) return resolve({ ok: false, error: "Can't add a photo to a future date." });
      const reader = new FileReader();
      reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file — try again." });
      reader.onload = (e) => {
        const img = new window.Image();
        img.onerror = () => resolve({ ok: false, error: `Couldn't process "${file.name}" — try a different photo.` });
        img.onload = () => {
          try {
            const maxW = 640;
            const scale = Math.min(1, maxW / img.width);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve({ ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.72), id: genPhotoId() });
          } catch {
            resolve({ ok: false, error: "Something went wrong preparing that photo." });
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Writes already-decoded photos to storage and updates the index in one pass.
  async function commitPhotos(date, period, items) {
    await Promise.all(items.map((it) => persistRaw(`photo:${date}:${period}:${it.id}`, it.dataUrl)));

    const cacheAdds = {};
    const sizeAdds = {};
    items.forEach((it) => {
      const ck = photoKey(date, period, it.id);
      cacheAdds[ck] = it.dataUrl;
      sizeAdds[ck] = approxBytes(it.dataUrl);
    });
    setPhotoCache((c) => ({ ...c, ...cacheAdds }));

    const nextSizes = { ...photoSizesRef.current, ...sizeAdds };
    photoSizesRef.current = nextSizes;
    setPhotoSizes(nextSizes);
    persistJSON("nv-photo-sizes", nextSizes);

    const prev = photoIndexRef.current;
    const entry = prev[date] || { am: [], pm: [] };
    const nextIndex = {
      ...prev,
      [date]: { am: entry.am || [], pm: entry.pm || [], [period]: [...(entry[period] || []), ...items.map((it) => it.id)] },
    };
    photoIndexRef.current = nextIndex;
    setPhotoIndex(nextIndex);
    persistJSON("nv-photo-index", nextIndex);
    recordChange("photoIndex", prev, nextIndex);

    // Queued rather than awaited: capture stays instant, and an upload interrupted by a
    // closed tab or a dead network is retried on the next boot.
    items.forEach((it) => queueUpload(date, period, it.id));
  }

  async function deletePhotos(list) {
    // list: [{date, period, id}]
    if (!list.length) return;
    await Promise.all(list.map(({ date, period, id }) => getStore().delete(storageKeyFor(date, period, id)).catch(() => {})));

    setPhotoCache((c) => {
      const cc = { ...c };
      list.forEach(({ date, period, id }) => delete cc[photoKey(date, period, id)]);
      return cc;
    });

    const nextSizes = { ...photoSizesRef.current };
    list.forEach(({ date, period, id }) => delete nextSizes[photoKey(date, period, id)]);
    photoSizesRef.current = nextSizes;
    setPhotoSizes(nextSizes);
    persistJSON("nv-photo-sizes", nextSizes);

    const prevIndex = photoIndexRef.current;
    const nextIndex = { ...prevIndex };
    list.forEach(({ date, period, id }) => {
      const entry = nextIndex[date] || { am: [], pm: [] };
      const nextEntry = { ...entry, [period]: (entry[period] || []).filter((x) => x !== id) };
      if ((nextEntry.am || []).length === 0 && (nextEntry.pm || []).length === 0) delete nextIndex[date];
      else nextIndex[date] = nextEntry;
    });
    photoIndexRef.current = nextIndex;
    setPhotoIndex(nextIndex);
    persistJSON("nv-photo-index", nextIndex);
    recordChange("photoIndex", prevIndex, nextIndex);
    removeRemote(list);
  }

  function deletePhoto(date, period, id) {
    return deletePhotos([{ date, period, id }]);
  }

  // ---- storage quota estimate ----
  const photoBytesUsed = Object.values(photoSizes).reduce((a, b) => a + b, 0);
  const dataBytesUsed = approxBytes(JSON.stringify(products)) + approxBytes(JSON.stringify(logs))
    + approxBytes(JSON.stringify(photoIndex)) + approxBytes(JSON.stringify(photoSizes));
  const totalBytesUsed = photoBytesUsed + dataBytesUsed;
  const quotaUsedMB = totalBytesUsed / (1024 * 1024);
  const quotaPct = Math.min(100, (quotaUsedMB / TOTAL_QUOTA_MB) * 100);

  // First sign-in on a device that already has photos: hand the whole shelf to the
  // upload queue so nothing that predates the account is left behind. Once flushed the
  // flag stops it ever running twice.
  useEffect(() => {
    // readyForRef, not `ready`: this must not run against another identity's photo index.
    if (!cloudEnabled || !identityKey || readyForRef.current !== identityKey) return undefined;
    let alive = true;
    const epoch = identityKey;
    (async () => {
      if (await loadJSON("nv-photos-backfilled", false)) return;
      if (!alive || identityKeyRef.current !== epoch) return;
      Object.entries(photoIndexRef.current).forEach(([date, slot]) => {
        ["am", "pm"].forEach((period) => (slot?.[period] || []).forEach((id) => queueUpload(date, period, id)));
      });
      if (alive && identityKeyRef.current === epoch) await saveJSON("nv-photos-backfilled", true);
    })();
    return () => { alive = false; };
  }, [cloudEnabled, ready, identityKey, queueUpload]);

  // Signed in, the cloud holds the durable copy, so the local budget becomes a cache:
  // evict the least recently viewed photos instead of refusing to save new ones.
  useEffect(() => {
    if (!cloudEnabled || !identityKey || readyForRef.current !== identityKey) return;
    if (quotaPct <= 80) return;
    const budget = TOTAL_QUOTA_MB * 1024 * 1024 * 0.7 - dataBytesUsed;
    const keep = new Set(
      ["am", "pm"].flatMap((p) => (photoIndexRef.current[selectedDate]?.[p] || [])
        .map((id) => photoKey(selectedDate, p, id)))
    );
    const drop = pickEvictions(photoSizesRef.current, photoSync.atimes.current, Math.max(budget, 0), keep);
    if (!drop.length) return;

    (async () => {
      const store = getStore();
      const nextSizes = { ...photoSizesRef.current };
      for (const ck of drop) {
        const [date, period, id] = ck.split(":");
        try { await store.delete(storageKeyFor(date, period, id)); } catch { /* already gone */ }
        delete nextSizes[ck];
      }
      photoSizesRef.current = nextSizes;
      setPhotoSizes(nextSizes);
      setPhotoCache((c) => {
        const cc = { ...c };
        drop.forEach((ck) => delete cc[ck]);
        return cc;
      });
      saveJSON("nv-photo-sizes", nextSizes);
    })();
  }, [cloudEnabled, ready, quotaPct, dataBytesUsed, selectedDate, photoSync.atimes]);

  // The sign-in screen sits behind both the session check and the local boot read, so
  // returning to an app you're already signed into never flashes a login wall.
  if (auth.status === "signed-out") {
    return (
      <Shell>
        <SignInScreen
          onGoogle={auth.signInWithGoogle}
          onGuest={auth.continueAsGuest}
          error={auth.error}
          onDismissError={auth.clearError}
        />
      </Shell>
    );
  }

  // Computed during render, not from an effect. The reset in the boot effect runs *after*
  // React has already painted, so on the first render following an identity change the
  // documents in state still belong to the previous account — one frame of someone else's
  // shelf. Comparing the ref here means that frame renders the boot screen instead.
  const readyForIdentity = ready && readyForRef.current === identityKey;

  if (auth.status === "loading" || !readyForIdentity) {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 18 }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="u-display"
            style={{ fontSize: 42, letterSpacing: "0.14em", color: "var(--gold)" }}
          >
            GLASS
          </motion.div>
          <motion.div
            initial={{ width: 0 }} animate={{ width: 64 }}
            transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
            style={{ height: 1, background: "var(--gold)", opacity: 0.5 }}
          />
        </div>
      </Shell>
    );
  }

  const dayLog = getDayLog(selectedDate);

  // A chosen display name wins over Google's, so the greeting can still read exactly
  // "Naveen." even when the account says something more formal.
  const greetingName = (displayName || auth.profile?.givenName || "").trim();
  const monogram = (greetingName || auth.profile?.email || "G").trim().charAt(0).toUpperCase();
  const avatarUrl = auth.profile?.avatarUrl || "";

  const pages = {
    today: (
      <TodayView
          products={products}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          dayLog={dayLog}
          logs={logs}
          toggleProduct={toggleProduct}
          moveProduct={moveProduct}
          setMoodModal={setMoodModal}
          setTab={setTab}
          onTriggerPhoto={triggerPhotoUpload}
          photoIndex={photoIndex}
          onCopyYesterday={copyYesterday}
          onAddStep={addStepForDay}
          onSkipStep={skipStepForDay}
          onUnskipStep={unskipStepForDay}
          greetingName={greetingName}
          monogram={monogram}
          avatarUrl={avatarUrl}
          onOpenAccount={() => setAccountOpen(true)}
      />
    ),
    shelf: <ProductsView products={products} logs={logs} onAdd={addProduct} onUpdate={updateProduct} onDelete={deleteProduct} onReorder={reorderInCategory} />,
    insights: (
      <InsightsView
          products={products}
          logs={logs}
          photoIndex={photoIndex}
          photoCache={photoCache}
          loadPhoto={loadPhoto}
          quotaUsedMB={quotaUsedMB}
          quotaPct={quotaPct}
          onExport={exportJSON}
      />
    ),
    journey: (
      <JourneyView
          products={products}
          logs={logs}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          setTab={setTab}
          photoIndex={photoIndex}
          photoCache={photoCache}
          loadPhoto={loadPhoto}
          onTriggerPhoto={triggerPhotoUpload}
          onDelete={deletePhoto}
          onDeleteMany={deletePhotos}
          quotaUsedMB={quotaUsedMB}
          quotaPct={quotaPct}
          onExport={exportJSON}
      />
    ),
  };

  return (
    <Shell>
      {/* Each tab fades and lifts in rather than snapping — with the scroll position
          reset so a new page never opens halfway down. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          onAnimationStart={() => { const r = document.getElementById("root"); if (r) r.scrollTop = 0; }}
        >
          {pages[tab]}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {moodModal && (
          <MoodModal
          period={moodModal}
          current={
            moodModal === "weekly"
              ? { mood: dayLog.weeklyMood, note: dayLog.weeklyNote }
              : { mood: dayLog[moodModal + "Mood"], note: dayLog[moodModal + "Note"] }
          }
          onClose={() => setMoodModal(null)}
          onSave={(mood, note) => {
            if (moodModal === "weekly") saveWeekly(mood, note);
            else saveMood(moodModal, mood, note);
            setMoodModal(null);
          }}
          />
        )}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={async (e) => {
          const period = pendingPeriodRef.current;
          const date = selectedDate;
          const picked = Array.from(e.target.files || []);
          e.target.value = "";
          if (!picked.length) return;
          setPhotoError(null);

          const files = picked.slice(0, MAX_PHOTOS_PER_PICK);
          // Decode everything FIRST. Only once we're holding usable replacements do we
          // remove what was there — otherwise a corrupt or non-image pick wipes the
          // existing photos for this date+period and leaves nothing behind.
          const results = await Promise.all(files.map((f) => processPhotoFile(f, date, period)));
          const ready = results.filter((r) => r.ok);
          const failure = results.find((r) => !r.ok && r.error);

          if (!ready.length) {
            setPhotoError(failure ? failure.error : "Couldn't add that photo.");
            return;
          }

          // a fresh photo selection replaces whatever was already saved for this
          // date+period rather than piling on top of it (5 + 5 stays 5, not 10)
          const existingIds = photoIndexRef.current[date]?.[period] || [];
          if (existingIds.length) {
            await deletePhotos(existingIds.map((id) => ({ date, period, id })));
          }
          await commitPhotos(date, period, ready);

          if (picked.length > MAX_PHOTOS_PER_PICK) {
            setPhotoError(`Up to ${MAX_PHOTOS_PER_PICK} photos at a time — the first ${MAX_PHOTOS_PER_PICK} were saved.`);
          } else if (failure) {
            setPhotoError(`Saved ${plural(ready.length, "photo")}. ${failure.error}`);
          }
        }}
      />

      <AnimatePresence>
        {accountOpen && (
          <AccountView
            profile={auth.profile}
            isGuest={auth.status === "guest"}
            authEnabled={auth.authEnabled}
            displayName={displayName}
            greetingName={greetingName}
            monogram={monogram}
            products={products}
            logs={logs}
            syncStatus={sync.status}
            lastSyncedAt={sync.lastSyncedAt}
            onSyncNow={sync.syncNow}
            onSetDisplayName={setDisplayName}
            onExport={exportJSON}
            quotaUsedMB={quotaUsedMB}
            quotaPct={quotaPct}
            onClose={() => setAccountOpen(false)}
            onSignIn={auth.signInWithGoogle}
            onSignOut={async () => { setAccountOpen(false); await auth.signOut(); }}
            // Remote first, and abort if it fails. The other order wiped local, reloaded,
            // then let the next pull download everything the user had just deleted back
            // onto the phone — a destructive action that silently undid itself.
            onDeleteEverything={async () => {
              if (cloudEnabled) {
                try {
                  await removeAllRemote();
                  await sync.deleteRemote();
                } catch (e) {
                  console.warn("[glass] remote wipe failed:", e?.message || e);
                  return { ok: false, error: "Couldn't reach your account. Nothing was deleted — check your connection and try again." };
                }
              }
              // Photo blobs can't be enumerated through the artifact API, so hand over the
              // keys derived from the index before it's destroyed.
              const photoKeys = [];
              Object.entries(photoIndexRef.current || {}).forEach(([date, slot]) => {
                ["am", "pm"].forEach((period) => (slot?.[period] || [])
                  .forEach((id) => photoKeys.push(storageKeyFor(date, period, id))));
              });
              await clearNamespace(userId, photoKeys);
              setAccountOpen(false);
              window.location.reload();
              return { ok: true };
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sync.choice && (
          <SyncChoiceSheet
            local={sync.choice.local}
            remote={sync.choice.remote}
            onChoose={sync.resolveChoice}
          />
        )}
      </AnimatePresence>

      <PhotoErrorToast message={photoError} onDismiss={() => setPhotoError(null)} />
      <SaveStatus status={saveStatus} />
      {!accountOpen && <TabBar tab={tab} setTab={setTab} />}
    </Shell>
  );
}

// Photo errors used to render only inside JourneyView, so a failed upload started from
// the Routine tab's camera button reported nothing at all. This is app-level.
function PhotoErrorToast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 6500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          role="alert"
          style={{
            position: "fixed", bottom: 104, left: 16, right: 16, maxWidth: 448, margin: "0 auto",
            zIndex: 172, padding: "13px 15px", borderRadius: 16,
            display: "flex", gap: 11, alignItems: "flex-start",
            background: "rgba(34,19,15,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(226,160,141,0.42)", boxShadow: "var(--shadow-lift)",
          }}
        >
          <AlertTriangle size={15} color="var(--rose)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: "#F4E2DB", lineHeight: 1.55, flex: 1 }}>{message}</span>
          <button onClick={onDismiss} aria-label="Dismiss" className="u-tap"
            style={{ background: "none", border: "none", padding: 0, flexShrink: 0, display: "flex" }}>
            <X size={15} color="rgba(244,226,219,0.65)" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SaveStatus({ status }) {
  const map = {
    saving: { text: "Saving\u2026", color: "var(--text-3)", Icon: null },
    saved: { text: "Saved", color: "var(--gold)", Icon: CircleCheck },
    error: { text: "Couldn't save \u2014 check your connection", color: "var(--rose)", Icon: WifiOff },
  };
  const s = map[status];
  return (
    <AnimatePresence>
      {s && (
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 14, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", bottom: 106, left: "50%", translateX: "-50%",
            zIndex: 168, padding: "9px 16px", borderRadius: 999, maxWidth: 320,
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(16,11,8,0.94)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${status === "error" ? "rgba(226,160,141,0.4)" : "var(--line-2)"}`,
            boxShadow: "0 14px 32px -16px rgba(0,0,0,0.9)",
          }}
        >
          {status === "saving" && (
            <Loader2 className="animate-spin" size={12} color="var(--text-3)" style={{ flexShrink: 0 }} />
          )}
          {s.Icon && <s.Icon size={13} color={s.color} style={{ flexShrink: 0 }} />}
          <span style={{ fontSize: 11.5, color: s.color, lineHeight: 1.45, fontWeight: 500 }}>{s.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------- shell ---------------------------------- */

/*
  Palette note — every colour below was sampled out of the header photographs rather
  than picked in the abstract. The warm images (hero, shelf, journey, insights) sit on
  hue ~24 terracotta with pale champagne highlights around hsl(34 90% 80%); the two PM
  images sit on hue ~216 steel blue with hsl(215 40% 75%) moonlight. So the app runs a
  deliberate dual temperature: gold for morning, moonlight for night, on a warm umber
  substrate — which is also exactly the AM/PM distinction the product is built around.
*/
const GLOBAL_CSS = `
  :root {
    --ink-0: #0A0705;
    --ink-1: #100B08;
    --ink-2: #17100C;
    --ink-3: #201711;
    --ink-4: #2B1F17;

    --line: rgba(243,201,140,0.10);
    --line-2: rgba(243,201,140,0.18);
    --line-3: rgba(243,201,140,0.30);

    --text: #F8F2E9;
    --text-2: #CBBCAB;
    --text-3: #8D7F71;

    --gold: #F3C98C;
    --gold-2: #E0AC66;
    --gold-3: #B8853F;
    --gold-wash: rgba(243,201,140,0.09);
    --gold-wash-2: rgba(243,201,140,0.16);

    --moon: #A8BEDC;
    --moon-2: #7B95BA;
    --moon-wash: rgba(168,190,220,0.10);

    --rose: #E2A08D;
    --rose-wash: rgba(226,160,141,0.12);
    --sage: #A9BE9B;

    --r-sm: 12px;
    --r-md: 18px;
    --r-lg: 24px;
    --r-xl: 30px;

    --shadow-card: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px -14px rgba(0,0,0,0.8);
    --shadow-lift: 0 20px 50px -20px rgba(0,0,0,0.9);

    --ease: cubic-bezier(0.22, 1, 0.36, 1);

    --font-ui: 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, system-ui, sans-serif;
    --font-display: 'Instrument Serif', 'Times New Roman', serif;
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }

  ::-webkit-scrollbar { width: 0; height: 0; }
  #root { scrollbar-width: none; }

  .u-display {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.015em;
    line-height: 1.04;
  }
  /* Numbers align in columns without needing a monospace family — the old design used a
     mono face purely for this, which read more "terminal" than "premium". */
  .u-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

  /* Eyebrow labels: one definition, used on every page. Previously each page invented
     its own size/tracking/colour for the same role. */
  .u-eyebrow {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .u-card {
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018));
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-card);
  }

  /* Frosted panel used for sheets and the tab bar */
  .u-frost {
    background: rgba(16,11,8,0.82);
    backdrop-filter: blur(28px) saturate(1.3);
    -webkit-backdrop-filter: blur(28px) saturate(1.3);
  }

  .u-hairline { height: 1px; background: linear-gradient(90deg, transparent, var(--line-2) 18%, var(--line-2) 82%, transparent); }

  button { font-family: inherit; color: inherit; }
  button:not(:disabled) { cursor: pointer; }
  input, textarea, select { font-family: inherit; }
  textarea:focus, input:focus, select:focus { outline: none; }
  /* keyboard focus was falling back to the browser's blue ring, which is the one colour
     nothing else on screen uses */
  :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  textarea:focus-visible, input:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
  input::placeholder, textarea::placeholder { color: var(--text-3); }

  .u-tap { -webkit-tap-highlight-color: transparent; }

  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .animate-spin { animation: spin 0.9s linear infinite; }

  /* Slow ambient drift on hero photography — barely perceptible, but it stops the
     headers reading as flat static images. */
  @keyframes heroDrift {
    0%   { transform: scale(1.06) translate3d(0, 0, 0); }
    100% { transform: scale(1.14) translate3d(-1.2%, -1.4%, 0); }
  }
  .u-hero-img { animation: heroDrift 34s ease-in-out infinite alternate; will-change: transform; }

  @media (prefers-reduced-motion: reduce) {
    .u-hero-img { animation: none; }
    .animate-spin { animation-duration: 2s; }
  }
`;

function Shell({ children }) {
  return (
    <div style={{ background: "var(--ink-0)", minHeight: "100vh", fontFamily: "var(--font-ui)", color: "var(--text)" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 108 }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ design primitives ----------------------------- */

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
const SPRING_SOFT = { type: "spring", stiffness: 240, damping: 30 };

// Tone system: every AM/PM-flavoured surface reads from here instead of hard-coding
// gold or blue at each call site, which is how the two temperatures stayed consistent.
const TONES = {
  gold: { fg: "var(--gold)", fgDeep: "var(--gold-2)", wash: "var(--gold-wash)", wash2: "var(--gold-wash-2)", line: "var(--line-3)", glow: "rgba(243,201,140,0.28)" },
  moon: { fg: "var(--moon)", fgDeep: "var(--moon-2)", wash: "var(--moon-wash)", wash2: "rgba(168,190,220,0.18)", line: "rgba(168,190,220,0.32)", glow: "rgba(168,190,220,0.26)" },
  // signal tone — for "this needs attention", never for AM/PM. Keeping it separate stops
  // negative states borrowing the night colour and muddling the two meanings.
  rose: { fg: "var(--rose)", fgDeep: "#C9836E", wash: "var(--rose-wash)", wash2: "rgba(226,160,141,0.2)", line: "rgba(226,160,141,0.3)", glow: "rgba(226,160,141,0.28)" },
};

function Eyebrow({ children, tone, style }) {
  return (
    <div className="u-eyebrow" style={{ color: tone ? TONES[tone].fg : undefined, ...style }}>
      {children}
    </div>
  );
}

// One section header for the whole app, so Insights / Journey / Shelf stop each having
// their own slightly different label treatment.
function Section({ title, hint, action, children, style }) {
  return (
    <section style={{ marginBottom: 26, ...style }}>
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <Eyebrow>{title}</Eyebrow>
            {hint && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Card({ children, style, tone, onClick, interactive, ...rest }) {
  const t = tone ? TONES[tone] : null;
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      onClick={onClick}
      whileTap={onClick || interactive ? { scale: 0.985 } : undefined}
      transition={SPRING}
      className="u-card u-tap"
      style={{
        display: "block", width: onClick ? "100%" : undefined, textAlign: onClick ? "left" : undefined,
        padding: 16, border: t ? `1px solid ${t.line}` : undefined,
        background: t ? `linear-gradient(180deg, ${t.wash}, rgba(255,255,255,0.014))` : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

// Big numeral treatment used for every headline statistic.
function Stat({ value, unit, label, tone = "gold", size = 40 }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span className="u-display u-num" style={{ fontSize: size, color: "var(--text)" }}>{value}</span>
        {unit && <span className="u-display" style={{ fontSize: size * 0.48, color: TONES[tone].fg }}>{unit}</span>}
      </div>
      {label && <div className="u-eyebrow" style={{ marginTop: 6 }}>{label}</div>}
    </div>
  );
}

function ProgressRing({ pct, size = 116, stroke = 6, tone = "gold", children, track = "rgba(255,255,255,0.07)" }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={TONES[tone].fg} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * clamped) / 100 }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 7px ${TONES[tone].glow})` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function Pill({ active, tone = "gold", children, onClick, disabled, style }) {
  const t = TONES[tone];
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={SPRING}
      className="u-tap"
      style={{
        padding: "8px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: active ? 600 : 500,
        whiteSpace: "nowrap", border: `1px solid ${active ? t.line : "var(--line)"}`,
        background: active ? t.wash2 : "transparent",
        color: active ? t.fg : "var(--text-2)",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.2s var(--ease), color 0.2s var(--ease), border-color 0.2s var(--ease)",
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

function PrimaryButton({ children, onClick, tone = "gold", style, disabled }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={SPRING}
      className="u-tap"
      style={{
        width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
        background: tone === "danger"
          ? "linear-gradient(180deg, #E9AC98, #D08571)"
          : "linear-gradient(180deg, var(--gold), var(--gold-2))",
        color: "#20150C", fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
        boxShadow: tone === "danger" ? "0 10px 24px -12px rgba(226,160,141,0.6)" : "0 10px 24px -12px rgba(243,201,140,0.6)",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

function GhostButton({ children, onClick, style }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={SPRING}
      className="u-tap"
      style={{
        width: "100%", padding: "13px 0", borderRadius: 14,
        border: "1px solid var(--line-2)", background: "transparent",
        color: "var(--text)", fontSize: 13.5, fontWeight: 600, ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// Every bottom sheet in the app funnels through this: one animation, one scroll
// behaviour, one grabber, one safe-area-aware bottom padding so the primary action is
// always reachable.
function Sheet({ children, onClose, maxHeight = "88vh", z = 150, labelledBy }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: z, display: "flex", alignItems: "flex-end", justifyContent: "center",
        background: "rgba(5,3,2,0.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <motion.div
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="u-frost"
        style={{
          width: "100%", maxWidth: 480, maxHeight, overflowY: "auto", WebkitOverflowScrolling: "touch",
          borderRadius: "26px 26px 0 0", border: "1px solid var(--line-2)", borderBottom: "none",
          padding: "10px 20px calc(22px + env(safe-area-inset-bottom))",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.16)" }} />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function SheetHeader({ title, onClose, subtitle, id }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <h2 id={id} className="u-display" style={{ fontSize: 24, color: "var(--text)", margin: 0 }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      <button onClick={onClose} aria-label="Close" className="u-tap" style={{
        background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 999,
        width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <X size={15} color="var(--text-2)" />
      </button>
    </div>
  );
}

// Shared cinematic page header: photograph, dual gradient scrim, ambient drift, and a
// consistent title block. Replaces four hand-rolled header blocks that each had their
// own padding, gradient and type scale.
function PageHeader({ image, eyebrow, icon: Icon, title, italic, subtitle, action, minHeight = 268, focus = "50% 50%", children }) {
  return (
    <div style={{ position: "relative", minHeight, overflow: "hidden", isolation: "isolate" }}>
      <img
        src={image} alt="" aria-hidden="true" className="u-hero-img"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focus }}
      />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background:
          "radial-gradient(120% 80% at 8% 12%, rgba(10,7,5,0.94) 0%, rgba(10,7,5,0.62) 38%, rgba(10,7,5,0.08) 72%)," +
          "linear-gradient(180deg, rgba(10,7,5,0.55) 0%, rgba(10,7,5,0.10) 28%, rgba(10,7,5,0.55) 74%, var(--ink-0) 100%)",
      }} />
      {/* warm light leak, pulled from the champagne highlight in the photography */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(70% 50% at 88% 6%, rgba(243,201,140,0.16), transparent 70%)",
        mixBlendMode: "screen",
      }} />

      <div style={{ position: "relative", padding: "24px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {Icon && <Icon size={14} color="var(--gold)" strokeWidth={2} />}
          <span className="u-eyebrow" style={{ color: "var(--gold)" }}>{eyebrow}</span>
        </div>
        {action}
      </div>

      <div style={{ position: "relative", padding: "18px 20px 22px" }}>
        <h1 className="u-display" style={{ fontSize: 40, color: "var(--text)", margin: 0 }}>
          {title}
          {italic && <><br /><span style={{ fontStyle: "italic", color: "var(--gold)" }}>{italic}</span></>}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "12px 0 0", maxWidth: 268, lineHeight: 1.55 }}>{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  );
}

function Body({ children, style }) {
  return <div style={{ padding: "22px 20px 8px", ...style }}>{children}</div>;
}

// Staggered entrance for lists — each child rises in sequence rather than the whole
// page appearing at once.
const listVariants = { show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } }, hide: {} };
const itemVariants = {
  hide: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1] } },
};

function Stagger({ children, style, tag = "div" }) {
  const M = motion[tag] || motion.div;
  return (
    <M variants={listVariants} initial="hide" animate="show" style={style}>
      {children}
    </M>
  );
}
function StaggerItem({ children, style, ...rest }) {
  return <motion.div variants={itemVariants} style={style} {...rest}>{children}</motion.div>;
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ textAlign: "center", padding: "34px 24px 30px" }}
    >
      <div style={{
        width: 54, height: 54, borderRadius: 999, margin: "0 auto 16px",
        border: "1px solid var(--line-2)", background: "var(--gold-wash)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} color="var(--gold)" strokeWidth={1.7} />
      </div>
      <div className="u-display" style={{ fontSize: 21, color: "var(--text)", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6, maxWidth: 250, margin: "0 auto" }}>{body}</div>
      {action && <div style={{ marginTop: 18, maxWidth: 220, margin: "18px auto 0" }}>{action}</div>}
    </motion.div>
  );
}

function MetaBar({ pct, tone = "gold", height = 5, track = "rgba(255,255,255,0.08)" }) {
  const reduce = useReducedMotion();
  return (
    <div style={{ height, borderRadius: 999, background: track, overflow: "hidden" }}>
      <motion.div
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${TONES[tone].fgDeep}, ${TONES[tone].fg})` }}
      />
    </div>
  );
}

/* -------------------------------- today view -------------------------------- */

// the "must-have" categories that count toward Today's Progress — cleanser + moisturizer always,
// sunscreen only for AM (actives/toners/serums are tracked but optional, not part of the base).
// Having multiple products in a must-have category (e.g. two moisturizers) only requires ONE of them checked.
function mustHaveCategories(period) {
  return period === "AM" ? ["cleanser", "moisturizer", "sunscreen"] : ["cleanser", "moisturizer"];
}

// "Is it on my shelf right now" — correct for the present-tense views (Shelf, Insights),
// wrong for anything that renders or scores a past day. Those use statusOn(p, date).
function isRetired(p) { return (p.status || "active") === "retired"; }

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

function stintsOf(p) { return Array.isArray(p.stints) ? p.stints : []; }

// from <= date <= to, where to:null means "still in the routine"
function stintCovers(p, date) {
  return stintsOf(p).some((s) => s.from && s.from <= date && (!s.to || date <= s.to));
}

function openStint(p) { return stintsOf(p).find((s) => !s.to) || null; }

// What this product was on one specific date. "trying" isn't versioned — it and
// "active" both mean "in the routine", they only differ in how they're badged.
function statusOn(p, date) {
  if (stintCovers(p, date)) return (p.status || "active") === "trying" ? "trying" : "active";
  const list = stintsOf(p);
  if (!list.length) return "retired";
  return list.some((s) => s.from && s.from <= date) ? "retired" : "not-yet";
}

// Upgrade from the old single-flag shape. Everything is derived from data the app
// already holds, and it runs once — a product that already has `stints` is skipped.
function migrateProductStints(products, logs) {
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
function applyStatusChange(product, nextStatus, logs, reason) {
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

function dayTweakList(dayLog, bucket, period) {
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
function routineFor(date, dayLog, products, period) {
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
function completionRatio(date, dayLog, products, period) {
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
function dayCompletionPct(date, logs, products) {
  const dayLog = logs[date];
  if (!dayLog) return 0;
  const am = completionRatio(date, dayLog, products, "AM");
  const pm = completionRatio(date, dayLog, products, "PM");
  const totalAll = am.total + pm.total;
  return totalAll ? Math.round(((am.done + pm.done) / totalAll) * 100) : 0;
}
function dayStatus(date, logs, products) {
  const pct = dayCompletionPct(date, logs, products);
  if (pct >= 100) return "full";
  if (pct > 0) return "partial";
  return "none";
}
function isPeriodComplete(date, logs, products, period) {
  const dayLog = logs[date];
  if (!dayLog) return false;
  const r = completionRatio(date, dayLog, products, period);
  return r.total > 0 && r.done >= r.total;
}

// Consecutive fully-complete days ending today. Today is still in progress for most of
// the day, so an unfinished today doesn't reset the count to zero — the run is measured
// from yesterday until today is finished, at which point today joins it. Shared by
// Routine, Insights and the export so all three always report the same number.
function currentStreakDays(logs, products) {
  const today = todayStr();
  let cursor = dayCompletionPct(today, logs, products) >= 100 ? today : addDays(today, -1);
  let n = 0;
  while (dayCompletionPct(cursor, logs, products) >= 100) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

function longestStreakDays(logs, products) {
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
function productStreakDays(logs, productId) {
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

function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function TodayView({ products, selectedDate, setSelectedDate, dayLog, logs, toggleProduct, moveProduct, setMoodModal, setTab, onTriggerPhoto, photoIndex, onCopyYesterday, onAddStep, onSkipStep, onUnskipStep, greetingName, monogram, avatarUrl, onOpenAccount }) {
  // the routine as it stood on the selected date, plus that day's own tweaks — never
  // today's product list projected backwards
  const amRoutine = routineFor(selectedDate, dayLog, products, "AM");
  const pmRoutine = routineFor(selectedDate, dayLog, products, "PM");
  const [stepsFor, setStepsFor] = useState(null); // "AM" | "PM" | null
  const am = completionRatio(selectedDate, dayLog, products, "AM");
  const pm = completionRatio(selectedDate, dayLog, products, "PM");
  const totalDone = am.done + pm.done;
  const totalAll = am.total + pm.total;
  const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  const activeNight = pmRoutine.list.some((p) => p.category === "treatment" && dayLog.pm[p.id]);

  // irritation pattern: 3 consecutive nights logged as Dry or Irritated
  const last3PM = [0, 1, 2].map((i) => {
    const l = logs[addDays(todayStr(), -i)];
    return l ? l.pmMood : null;
  });
  const irritationFlag = last3PM.every((m) => m && NEGATIVE_MOODS.includes(m))
    ? (last3PM[0] === last3PM[1] && last3PM[1] === last3PM[2] ? last3PM[0] : "reactive")
    : null;

  // exfoliant conflict — 2+ exfoliating steps checked in the same period
  const amExfoliantCount = amRoutine.list.filter((p) => p.exfoliant && dayLog.am[p.id]).length;
  const pmExfoliantCount = pmRoutine.list.filter((p) => p.exfoliant && dayLog.pm[p.id]).length;

  const streak = currentStreakDays(logs, products);

  // tracked-product day counters (consecutive days used, ending today)
  const trackedCounters = products.filter((p) => p.tracked && stintCovers(p, selectedDate)).map((p) => ({
    id: p.id, name: p.name, days: productStreakDays(logs, p.id),
  }));

  const quote = QUOTES[dayOfYear(new Date()) % QUOTES.length];
  const isToday = selectedDate === todayStr();
  const isSunday = new Date().getDay() === 0;
  const showWeekly = isToday && isSunday;
  // Copying forward is most useful on the day you forgot, not on today — so it's offered on
  // any past day too. Only while the day is still blank, which is both the case that needs
  // it and the only way it can't quietly overwrite something.
  const prevHasLog = !!logs[addDays(selectedDate, -1)];
  const dayIsBlank = !anyChecked(dayLog.am) && !anyChecked(dayLog.pm);
  const canCopyPrev = prevHasLog && dayIsBlank && selectedDate <= todayStr();

  // The week rail is the 7 days ending on whatever's selected — not hardcoded to today —
  // so paging a week back genuinely reaches earlier days instead of snapping back to the
  // same trailing week every time. Selecting today keeps the familiar "last 7 days" view.
  const railDays = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(selectedDate, -i);
      out.push({
        d,
        status: dayStatus(d, logs, products),
        dow: parseDate(d).toLocaleDateString(undefined, { weekday: "narrow" }),
        dom: parseDate(d).getDate(),
      });
    }
    return out;
  }, [selectedDate, logs, products]);

  const weekRangeLabel = (() => {
    const first = parseDate(railDays[0].d), last = parseDate(railDays[6].d);
    const fmt = (d, withYear) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: withYear ? "numeric" : undefined });
    const sameYear = first.getFullYear() === last.getFullYear();
    return `${fmt(first, !sameYear)} – ${fmt(last, true)}`;
  })();
  const canGoNextWeek = !isToday;
  const goPrevWeek = () => setSelectedDate(addDays(selectedDate, -7));
  const goNextWeek = () => setSelectedDate(addDays(selectedDate, 7) > todayStr() ? todayStr() : addDays(selectedDate, 7));

  const dateLine = (() => {
    const d = parseDate(selectedDate);
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  })();

  const headline = pct >= 100
    ? "Everything's checked off."
    : pct === 0
      ? (isToday ? "Nothing logged yet today." : "Nothing was logged this day.")
      : `${totalDone} of ${totalAll} essentials done.`;

  const advisories = [
    activeNight && {
      key: "active", icon: Moon, tone: "moon",
      title: "Active night",
      body: "Barrier's under more stress — favour your richest ceramide moisturiser tonight.",
    },
    isToday && irritationFlag && {
      key: "irritation", icon: AlertTriangle, tone: "gold",
      title: irritationFlag === "reactive" ? "Skin's been reactive lately" : `Logged "${irritationFlag}" three nights running`,
      body: "Consider skipping an active tonight, or doubling up on ceramide moisturiser.",
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        image={HERO_IMG}
        eyebrow="Routine"
        icon={Droplet}
        minHeight={330}
        focus="62% 42%"
        action={<AccountButton monogram={monogram} avatarUrl={avatarUrl} onClick={onOpenAccount} />}
        title={<>{greetingWord()},<br /><span style={{ fontStyle: "italic", color: "var(--gold)" }}>{greetingName ? `${greetingName}.` : "you."}</span></>}
      >
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: "14px 0 0", maxWidth: 224, lineHeight: 1.65, fontStyle: "italic" }}>
          {quote}
        </p>
      </PageHeader>

      <Body style={{ paddingTop: 4 }}>
        {/* ---- week rail: status + navigation in one control ---- */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button onClick={goPrevWeek} aria-label="Previous week" className="u-tap" style={iconBtnStyle}>
            <ChevronLeft size={15} color="var(--text-2)" />
          </button>
          <span className="u-num" style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{weekRangeLabel}</span>
          <button onClick={goNextWeek} disabled={!canGoNextWeek} aria-label="Next week" className="u-tap"
            style={{ ...iconBtnStyle, opacity: canGoNextWeek ? 1 : 0.3 }}>
            <ChevronRight size={15} color="var(--text-2)" />
          </button>
        </div>
        <LayoutGroup id="week-rail">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 2, marginBottom: 22 }}>
            {railDays.map((r) => {
              const selected = r.d === selectedDate;
              const today = r.d === todayStr();
              return (
                <motion.button
                  key={r.d}
                  onClick={() => setSelectedDate(r.d)}
                  whileTap={{ scale: 0.9 }}
                  transition={SPRING}
                  aria-label={`${prettyDate(r.d)} — ${r.status === "full" ? "complete" : r.status === "partial" ? "partial" : "nothing logged"}`}
                  aria-pressed={selected}
                  className="u-tap"
                  style={{
                    position: "relative", flex: 1, background: "none", border: "none",
                    padding: "7px 0 9px", borderRadius: 14,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  }}
                >
                  {selected && (
                    <motion.div
                      layoutId="day-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      style={{
                        position: "absolute", inset: 0, borderRadius: 14,
                        background: "rgba(255,255,255,0.055)", border: "1px solid var(--line-2)",
                      }}
                    />
                  )}
                  <span style={{
                    position: "relative", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                    color: selected ? "var(--gold)" : "var(--text-3)",
                  }}>
                    {r.dow}
                  </span>
                  <span className="u-num" style={{
                    position: "relative", fontSize: 13.5, fontWeight: selected ? 700 : 500,
                    color: selected ? "var(--text)" : today ? "var(--text-2)" : "var(--text-3)",
                  }}>
                    {r.dom}
                  </span>
                  {/* status is a quiet indicator, not a filled tile */}
                  <span style={{ position: "relative", display: "flex", height: 5, alignItems: "center" }}>
                    {r.status === "full" ? (
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--gold)", boxShadow: "0 0 7px rgba(243,201,140,0.8)" }} />
                    ) : r.status === "partial" ? (
                      <span style={{ width: 5, height: 5, borderRadius: 999, border: "1.5px solid var(--gold-3)" }} />
                    ) : (
                      <span style={{ width: 5, height: 1.5, borderRadius: 999, background: "rgba(255,255,255,0.16)" }} />
                    )}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* ---- the day's progress ---- */}
        <Card style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <ProgressRing pct={pct} size={104} stroke={5}>
              <span data-testid="day-pct" className="u-display u-num" style={{ fontSize: 30, color: "var(--text)", lineHeight: 1 }}>{pct}</span>
              <span className="u-eyebrow" style={{ marginTop: 3, fontSize: 8 }}>complete</span>
            </ProgressRing>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* honest label — this used to always read "TODAY'S PROGRESS" even when
                  showing a past date's numbers */}
              <Eyebrow>{isToday ? "Today" : dateLine}</Eyebrow>
              <div style={{ fontSize: 14, color: "var(--text)", marginTop: 7, lineHeight: 1.45, fontWeight: 500 }}>
                {headline}
              </div>

              <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
                {[["AM", am, "gold", Sun], ["PM", pm, "moon", Moon]].map(([label, r, tone, Ico]) => (
                  <div key={label} style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                      <Ico size={11} color={TONES[tone].fg} />
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-3)" }}>{label}</span>
                      <span data-testid={`ratio-${label}`} className="u-num" style={{ fontSize: 10.5, color: TONES[tone].fg, marginLeft: "auto" }}>
                        {r.done}/{r.total}
                      </span>
                    </div>
                    <MetaBar pct={r.total ? (r.done / r.total) * 100 : 0} tone={tone} height={3} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ---- streak + tracked counters ---- */}
        <div style={{ display: "flex", gap: 10, marginBottom: advisories.length || showWeekly ? 14 : 22 }}>
          <Card onClick={() => setTab("journey")} tone="gold" style={{ flex: 1, padding: 15 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Flame size={15} color="var(--gold)" />
              <ArrowRight size={13} color="var(--text-3)" />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 12 }}>
              <span data-testid="routine-streak" className="u-display u-num" style={{ fontSize: 30, color: "var(--text)" }}>{streak}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{streak === 1 ? "day" : "days"}</span>
            </div>
            <Eyebrow style={{ marginTop: 5 }}>Current streak</Eyebrow>
          </Card>

          {trackedCounters.length > 0 ? (
            <Card style={{ flex: 1.25, padding: 15, minWidth: 0 }}>
              <Eyebrow>Tracking</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 11 }}>
                {trackedCounters.slice(0, 2).map((t) => (
                  <div key={t.id} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.name}
                    </div>
                    <div className="u-num" style={{ fontSize: 15, color: t.days > 0 ? "var(--gold)" : "var(--text-3)", fontWeight: 600, marginTop: 2 }}>
                      {t.days > 0 ? `Day ${t.days}` : "Paused"}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card style={{ flex: 1.25, padding: 15, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <Eyebrow>Tracking</Eyebrow>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
                Star a product on the Shelf to count its days here.
              </div>
            </Card>
          )}
        </div>

        {/* ---- advisories ---- */}
        <AnimatePresence initial={false}>
          {advisories.map((a) => (
            <motion.div
              key={a.key}
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 10 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div style={{
                borderRadius: 16, padding: "13px 15px", display: "flex", gap: 11,
                background: TONES[a.tone].wash, border: `1px solid ${TONES[a.tone].line}`,
              }}>
                <a.icon size={14} color={TONES[a.tone].fg} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 3, lineHeight: 1.55 }}>{a.body}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {showWeekly && (
          <Card onClick={() => setMoodModal("weekly")} style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="u-display" style={{ fontSize: 19, color: "var(--text)", fontStyle: "italic" }}>This week, overall</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>
                  {dayLog.weeklyMood ? `You said: ${dayLog.weeklyMood}` : "A quick Sunday check-in"}
                </div>
              </div>
              <ChevronRight size={17} color="var(--gold)" />
            </div>
          </Card>
        )}

        {canCopyPrev && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 22, marginTop: 4 }}>
            <motion.button
              onClick={() => onCopyYesterday(selectedDate)}
              whileTap={{ scale: 0.96 }}
              transition={SPRING}
              className="u-tap"
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 999,
                background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", color: "var(--text-2)", fontSize: 12,
              }}
            >
              <RotateCcw size={12} color="var(--gold)" />
              {isToday ? "Same as yesterday" : "Same as the day before"}
            </motion.button>
          </div>
        )}
      </Body>

      <RoutineSection
        title="Morning"
        subtitle="After waking"
        period="AM"
        tone="gold"
        icon={Sun}
        products={amRoutine.list}
        addedIds={amRoutine.addedIds}
        skipped={amRoutine.skipped}
        addedLabel={isToday ? "TODAY ONLY" : "THIS DAY"}
        onAddStep={() => setStepsFor("AM")}
        onUnskipStep={onUnskipStep}
        dayLog={dayLog}
        toggleProduct={toggleProduct}
        moveProduct={moveProduct}
        moodLabel="How did your skin feel this morning?"
        onMood={() => setMoodModal("am")}
        moodSaved={dayLog.amMood}
        moodNote={dayLog.amNote}
        setTab={setTab}
        conflictCount={amExfoliantCount}
        onTriggerPhoto={selectedDate <= todayStr() ? () => onTriggerPhoto("am") : null}
        photoCount={(photoIndex[selectedDate]?.am || []).length}
        ratio={am}
      />

      <RoutineSection
        title="Night"
        subtitle="Before bed"
        period="PM"
        tone="moon"
        icon={Moon}
        products={pmRoutine.list}
        addedIds={pmRoutine.addedIds}
        skipped={pmRoutine.skipped}
        addedLabel={isToday ? "TODAY ONLY" : "THIS DAY"}
        onAddStep={() => setStepsFor("PM")}
        onUnskipStep={onUnskipStep}
        dayLog={dayLog}
        toggleProduct={toggleProduct}
        moveProduct={moveProduct}
        moodLabel="How did your skin feel tonight?"
        onMood={() => setMoodModal("pm")}
        moodSaved={dayLog.pmMood}
        moodNote={dayLog.pmNote}
        setTab={setTab}
        conflictCount={pmExfoliantCount}
        onTriggerPhoto={selectedDate <= todayStr() ? () => onTriggerPhoto("pm") : null}
        photoCount={(photoIndex[selectedDate]?.pm || []).length}
        ratio={pm}
      />

      <AnimatePresence>
        {stepsFor && (
          <DayStepsSheet
            period={stepsFor}
            date={selectedDate}
            products={products}
            routine={stepsFor === "AM" ? amRoutine : pmRoutine}
            onClose={() => setStepsFor(null)}
            onAdd={(id) => onAddStep(stepsFor, id)}
            onSkip={(id, isAdded) => onSkipStep(stepsFor, id, isAdded)}
            onUnskip={(id) => onUnskipStep(stepsFor, id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const iconBtnStyle = {
  background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)",
  borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
};

function LazyPhoto({ date, period, id, loadPhoto, cached, size = 56, aspect = null, radius = 10, onClick, selected, tag }) {
  const ref = useRef(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!ref.current || cached) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setRequested(true);
        loadPhoto(date, period, id);
        obs.disconnect();
      }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [date, period, id, cached, loadPhoto]);

  const Wrap = onClick ? motion.button : motion.div;
  return (
    <Wrap
      ref={ref}
      onClick={onClick}
      whileTap={onClick ? { scale: 0.96 } : undefined}
      transition={SPRING}
      className="u-tap"
      data-testid="lazy-photo"
      data-loaded={cached ? "1" : "0"}
      style={{
        position: "relative", flexShrink: 0, borderRadius: radius, overflow: "hidden", padding: 0,
        // Grid tiles get a fixed ratio instead of height:100%. Without it the tile had no
        // intrinsic height, so the skeleton collapsed to nothing and rows went ragged as
        // photos of different shapes loaded in.
        ...(aspect ? { width: "100%", aspectRatio: aspect } : { width: size, height: size }),
        border: selected ? "2px solid var(--gold)" : "1px solid var(--line)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      {cached ? (
        <motion.img
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          src={cached}
          alt={`Progress photo, ${prettyDate(date)} ${period.toUpperCase()}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%",
          background: requested
            ? "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(243,201,140,0.09) 37%, rgba(255,255,255,0.03) 63%)"
            : "rgba(255,255,255,0.035)",
          backgroundSize: "400% 100%", animation: requested ? "shimmer 1.5s ease infinite" : "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {!requested && <ImageIcon size={14} color="var(--text-3)" />}
        </div>
      )}
      {tag && (
        <div style={{
          position: "absolute", top: 5, left: 5, fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--text)", background: "rgba(6,4,3,0.6)", backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)", borderRadius: 6, padding: "3px 6px",
        }}>
          {tag}
        </div>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ position: "absolute", inset: 0, background: "rgba(243,201,140,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <motion.div
              initial={{ scale: 0.5 }} animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
              style={{ width: 22, height: 22, borderRadius: 999, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Check size={13} color="#20150C" strokeWidth={3.4} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Wrap>
  );
}

// Each period is now a full-bleed tinted band rather than a hairline-separated list, so
// morning and night read as two distinct places instead of one long scroll. Tone comes
// from the AM/PM photography: honey for morning, moonlight for night.
function RoutineSection({ title, subtitle, period, tone, icon: Icon, products, dayLog, toggleProduct, moveProduct, moodLabel, onMood, moodSaved, moodNote, setTab, conflictCount = 0, onTriggerPhoto, photoCount = 0, ratio, addedIds, skipped = [], addedLabel = "TODAY ONLY", onAddStep, onUnskipStep }) {
  const key = period.toLowerCase();
  const t = TONES[tone];
  const done = products.filter((p) => dayLog[key][p.id]).length;
  const allDone = products.length > 0 && done === products.length;

  return (
    <section style={{ position: "relative", marginTop: 8, padding: "26px 20px 30px" }}>
      {/* tonal wash keyed to the period */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(180deg, transparent, ${t.wash} 30%, ${t.wash} 70%, transparent)`,
      }} />
      <div aria-hidden="true" className="u-hairline" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />

      <div style={{ position: "relative" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <motion.div
              animate={allDone ? { scale: [1, 1.12, 1] } : {}}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{
                width: 40, height: 40, borderRadius: 999, flexShrink: 0,
                border: `1px solid ${t.line}`, background: allDone ? t.wash2 : "rgba(255,255,255,0.03)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: allDone ? `0 0 20px -6px ${t.glow}` : "none",
              }}
            >
              <Icon size={17} color={t.fg} strokeWidth={1.8} />
            </motion.div>
            <div>
              <h2 className="u-display" style={{ fontSize: 26, color: "var(--text)", margin: 0 }}>{title}</h2>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
            {onTriggerPhoto && (
              <motion.button
                onClick={onTriggerPhoto}
                whileTap={{ scale: 0.9 }}
                transition={SPRING}
                aria-label={`Add ${period} progress photo`}
                className="u-tap"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "7px 11px", borderRadius: 999,
                  border: `1px solid ${photoCount > 0 ? t.line : "var(--line)"}`,
                  background: photoCount > 0 ? t.wash2 : "rgba(255,255,255,0.03)",
                }}
              >
                <Camera size={13} color={photoCount > 0 ? t.fg : "var(--text-3)"} />
                {photoCount > 0 && <span className="u-num" style={{ fontSize: 10.5, color: t.fg, fontWeight: 600 }}>{photoCount}</span>}
              </motion.button>
            )}
            <span className="u-num" style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
              <span style={{ color: t.fg }}>{done}</span>/{products.length}
            </span>
          </div>
        </header>

        {conflictCount >= 2 && (
          <div style={{
            marginBottom: 14, borderRadius: 14, padding: "11px 13px", display: "flex", gap: 9, alignItems: "flex-start",
            background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.28)",
          }}>
            <AlertTriangle size={13} color="var(--rose)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {conflictCount} exfoliating steps checked — that may be more than skin can handle at once.
            </span>
          </div>
        )}

        {products.length > 0 && (
          <Stagger style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.map((p) => {
              const checked = !!dayLog[key][p.id];
              return (
                <StaggerItem key={p.id}>
                  <motion.div
                    className="u-tap"
                    onClick={() => toggleProduct(key, p.id)}
                    whileTap={{ scale: 0.99 }}
                    transition={SPRING}
                    data-testid="check-row"
                    data-checked={checked ? "1" : "0"}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProduct(key, p.id); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 13, padding: "11px 13px", borderRadius: 16,
                      background: checked ? t.wash2 : "rgba(255,255,255,0.028)",
                      border: `1px solid ${checked ? t.line : "var(--line)"}`,
                      transition: "background 0.3s var(--ease), border-color 0.3s var(--ease)",
                    }}
                  >
                    {/* checkbox with a spring pop + drawn tick */}
                    <motion.div
                      animate={checked ? { scale: [1, 1.22, 1] } : { scale: 1 }}
                      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                        background: checked ? t.fg : "transparent",
                        border: `1.5px solid ${checked ? t.fg : t.line}`,
                        boxShadow: checked ? `0 0 14px -3px ${t.glow}` : "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.25s var(--ease), border-color 0.25s var(--ease)",
                      }}
                    >
                      <AnimatePresence>
                        {checked && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 620, damping: 26 }}
                            style={{ display: "flex" }}
                          >
                            <Check size={13} color="#20150C" strokeWidth={3.4} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.div>

                    <div style={{
                      width: 42, height: 42, borderRadius: 12, flexShrink: 0, overflow: "hidden",
                      background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {p.photo
                        ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <Package size={15} color="var(--text-3)" strokeWidth={1.6} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, lineHeight: 1.35, fontWeight: 500,
                        color: checked ? "var(--text)" : "var(--text-2)",
                      }}>
                        {p.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {(CATS.find((c) => c.id === p.category) || { label: "Other" }).label}
                        </span>
                        {p.tracked && <Star size={10} color="var(--gold)" fill="var(--gold)" />}
                        {p.exfoliant && <Flame size={10} color="var(--rose)" fill="var(--rose)" />}
                        {p.status === "trying" && (
                          <span style={{
                            fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: "var(--gold)",
                            border: "1px solid var(--line-2)", borderRadius: 999, padding: "2px 7px",
                          }}>TRYING</span>
                        )}
                        {addedIds && addedIds.has(p.id) && (
                          <span data-testid="added-chip" style={{
                            fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: t.fg,
                            border: `1px solid ${t.line}`, background: t.wash, borderRadius: 999, padding: "2px 7px",
                          }}>{addedLabel}</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); moveProduct(period, p.id); }}
                      aria-label={`Move ${p.name} down`}
                      className="u-tap"
                      style={{ background: "none", border: "none", padding: 6, flexShrink: 0, display: "flex" }}
                    >
                      <ArrowDownNarrowWide size={14} color="var(--text-3)" />
                    </button>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}

        {products.length === 0 && (
          <EmptyState
            icon={Package}
            title={`No ${title.toLowerCase()} steps yet`}
            body="Add what you're using and this list builds itself."
            action={<GhostButton onClick={() => setTab && setTab("shelf")}>Go to Shelf</GhostButton>}
          />
        )}

        {/* A step you deliberately skipped is data, not an absence — so it stays on screen
            and stays reversible instead of silently vanishing from the day. */}
        {skipped.length > 0 && (
          <div
            data-testid={`skipped-${key}`}
            style={{
              marginTop: 10, padding: "10px 13px", borderRadius: 14,
              border: "1px solid var(--line)", background: "rgba(255,255,255,0.022)",
              display: "flex", alignItems: "flex-start", gap: 9,
            }}
          >
            <CircleMinus size={13} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, flex: 1, minWidth: 0 }}>
              Skipped: {skipped.map((p) => p.name).join(" · ")}
              {/* skipping doesn't lower the bar, so say so rather than let the number
                  look broken when it can no longer reach 100% */}
              {skipped.some((p) => mustHaveCategories(period).includes(p.category)
                && !products.some((x) => x.category === p.category))
                && ` — ${title.toLowerCase()} can't reach 100% today.`}
            </span>
            <button
              onClick={() => skipped.forEach((p) => onUnskipStep && onUnskipStep(period, p.id))}
              className="u-tap"
              style={{
                background: "none", border: "none", padding: 0, flexShrink: 0,
                fontSize: 11.5, fontWeight: 600, color: t.fg,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Undo2 size={12} /> Undo
            </button>
          </div>
        )}

        {onAddStep && (
          <motion.button
            onClick={onAddStep}
            whileTap={{ scale: 0.99 }}
            transition={SPRING}
            className="u-tap"
            data-testid={`edit-steps-${key}`}
            style={{
              width: "100%", textAlign: "left", marginTop: 10, padding: "13px 15px", borderRadius: 16,
              border: "1px dashed var(--line-2)", background: "transparent",
              display: "flex", alignItems: "center", gap: 11,
            }}
          >
            <Plus size={14} color="var(--text-3)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1 }}>Add a step for this day</span>
          </motion.button>
        )}

        {/* mood check-in */}
        <motion.button
          onClick={onMood}
          whileTap={{ scale: 0.99 }}
          transition={SPRING}
          className="u-tap"
          style={{
            width: "100%", textAlign: "left", marginTop: 14, padding: "14px 15px", borderRadius: 16,
            border: `1px dashed ${moodSaved ? t.line : "var(--line-2)"}`,
            background: moodSaved ? t.wash : "transparent",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <Sparkles size={14} color={moodSaved ? t.fg : "var(--text-3)"} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {moodSaved ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>Felt {moodSaved.toLowerCase()}</div>
                {moodNote && (
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {moodNote}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{moodLabel}</div>
            )}
          </div>
          <ChevronRight size={15} color="var(--text-3)" style={{ flexShrink: 0 }} />
        </motion.button>
      </div>
    </section>
  );
}

// One sheet for a single day's step list. Add and skip live together because they're the
// same question — "what am I actually doing today" — and keeping them here means the
// checklist rows stay uncluttered instead of growing a second menu system.
//
// Nothing in here touches a product's status: using a retired product for one day is a
// property of the day, not a change to the shelf.
function DayStepsSheet({ period, date, products, routine, onClose, onAdd, onSkip, onUnskip }) {
  const [query, setQuery] = useState("");
  const t = TONES[period === "AM" ? "gold" : "moon"];
  const isToday = date === todayStr();
  const onIds = new Set([...routine.list, ...routine.skipped].map((p) => p.id));
  const q = query.trim().toLowerCase();
  const candidates = products.filter((p) => !onIds.has(p.id) && p.name.toLowerCase().includes(q));

  // anything not already on the day falls into exactly one of these
  const groupOf = (p) => (stintCovers(p, date) ? "other" : statusOn(p, date) === "not-yet" ? "later" : "retired");
  const GROUPS = [
    { id: "other", label: period === "AM" ? "From your night routine" : "From your morning routine" },
    { id: "retired", label: "Retired" },
    { id: "later", label: "Added to your shelf later" },
  ];

  const catLabel = (p) => (CATS.find((c) => c.id === p.category) || { label: "Other" }).label;

  const row = (p, { onClick, icon: ActionIcon, aria, dim, note }) => (
    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0, overflow: "hidden",
        background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
        display: "flex", alignItems: "center", justifyContent: "center", opacity: dim ? 0.5 : 1,
      }}>
        {p.photo
          ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Package size={14} color="var(--text-3)" strokeWidth={1.6} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, lineHeight: 1.35,
          color: dim ? "var(--text-3)" : "var(--text)",
          textDecoration: dim ? "line-through" : "none",
        }}>{p.name}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {catLabel(p)}{note ? ` · ${note}` : ""}
        </div>
      </div>
      <motion.button
        onClick={onClick}
        whileTap={{ scale: 0.9 }}
        transition={SPRING}
        className="u-tap"
        aria-label={aria}
        style={{
          width: 32, height: 32, borderRadius: 999, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid ${t.line}`, background: t.wash,
        }}
      >
        <ActionIcon size={14} color={t.fg} />
      </motion.button>
    </div>
  );

  return (
    <Sheet onClose={onClose} z={152} labelledBy="steps-title">
      <SheetHeader
        id="steps-title"
        title={`${period === "AM" ? "Morning" : "Night"} steps`}
        subtitle={isToday ? "Just for today — your shelf stays as it is." : `Just for ${prettyDate(date).toLowerCase()} — your shelf stays as it is.`}
        onClose={onClose}
      />

      {routine.list.length + routine.skipped.length > 0 && (
        <>
          <Eyebrow style={{ marginBottom: 2 }}>On this day</Eyebrow>
          <div data-testid="steps-on-day" style={{ marginBottom: 20 }}>
            {routine.list.map((p) =>
              row(p, {
                onClick: () => onSkip(p.id, routine.addedIds.has(p.id)),
                icon: CircleMinus,
                aria: `Remove ${p.name} from this day`,
                note: routine.addedIds.has(p.id) ? "added for this day" : null,
              })
            )}
            {routine.skipped.map((p) =>
              row(p, {
                onClick: () => onUnskip(p.id),
                icon: Undo2,
                aria: `Put ${p.name} back on this day`,
                dim: true,
                note: "skipped",
              })
            )}
          </div>
        </>
      )}

      <Eyebrow style={{ marginBottom: 2 }}>Add from your shelf</Eyebrow>

      {products.length > 12 && (
        <div style={{ position: "relative", marginTop: 10, marginBottom: 2 }}>
          <Search size={14} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your shelf…"
            aria-label="Search your shelf"
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 999, padding: "11px 15px 11px 37px", color: "var(--text)", fontSize: 13,
            }}
          />
        </div>
      )}

      {candidates.length === 0 ? (
        <div style={{ padding: "18px 0 6px", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6 }}>
          {products.length === 0
            ? "Your shelf is empty — add a product there first."
            : query.trim()
              ? "Nothing on your shelf matches that."
              : "Everything on your shelf is already on this day."}
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = candidates.filter((p) => groupOf(p) === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} style={{ marginTop: 14 }} data-testid={`steps-group-${g.id}`}>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em" }}>{g.label}</div>
              {items.map((p) =>
                row(p, {
                  onClick: () => onAdd(p.id),
                  icon: Plus,
                  aria: `Add ${p.name} to this day`,
                  note: g.id === "retired" ? (p.retiredReason || "retired") : null,
                })
              )}
            </div>
          );
        })
      )}
    </Sheet>
  );
}

function MoodModal({ period, current, onClose, onSave }) {
  const [mood, setMood] = useState(current.mood || "");
  const [note, setNote] = useState(current.note || "");
  const isWeekly = period === "weekly";
  const tone = period === "pm" ? "moon" : "gold";
  const options = isWeekly ? ["Great week", "Steady", "Rough week", "Barely kept up"] : MOODS;
  return (
    <Sheet onClose={onClose} maxHeight="86vh" labelledBy="mood-title">
      <SheetHeader
        id="mood-title"
        title={isWeekly ? "This week, overall" : period === "am" ? "This morning" : "Tonight"}
        subtitle="How does your skin actually feel? One tap is enough."
        onClose={onClose}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {options.map((m) => (
          <Pill key={m} active={mood === m} tone={tone} onClick={() => setMood(mood === m ? "" : m)}>
            {m}
          </Pill>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else worth remembering…"
        rows={3}
        style={{
          width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 14, color: "var(--text)", fontSize: 13.5, lineHeight: 1.55,
          resize: "none", marginBottom: 16,
        }}
      />
      <PrimaryButton onClick={() => onSave(mood, note)}>Save</PrimaryButton>
    </Sheet>
  );
}

/* ------------------------------- products view ------------------------------- */

const FILTERS = [
  { id: "all", label: "All" },
  { id: "am", label: "Morning" },
  { id: "pm", label: "Night" },
  { id: "tracked", label: "Tracked" },
  { id: "exfoliant", label: "Actives" },
  { id: "retired", label: "Retired" },
];

function matchesFilter(p, filter) {
  if (filter === "all") return p.status !== "retired";
  if (filter === "retired") return p.status === "retired";
  if (filter === "tracked") return p.tracked && p.status !== "retired";
  if (filter === "exfoliant") return p.exfoliant && p.status !== "retired";
  if (filter === "am") return (p.time === "AM" || p.time === "Both") && p.status !== "retired";
  if (filter === "pm") return (p.time === "PM" || p.time === "Both") && p.status !== "retired";
  return true;
}

// AM/PM presence, in the same two temperatures used everywhere else.
function TimeBadges({ time }) {
  const includesAM = time === "AM" || time === "Both";
  const includesPM = time === "PM" || time === "Both";
  const chip = (tone, Ico, label) => (
    <span key={label} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999,
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
      background: TONES[tone].wash2, color: TONES[tone].fg, border: `1px solid ${TONES[tone].line}`,
    }}>
      <Ico size={9} /> {label}
    </span>
  );
  return <>{includesAM && chip("gold", Sun, "AM")}{includesPM && chip("moon", Moon, "PM")}</>;
}

function ProductsView({ products, logs, onAdd, onUpdate, onDelete, onReorder }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null); // null | 'new' | productId
  const [retiring, setRetiring] = useState(null);
  const [menuFor, setMenuFor] = useState(null); // productId whose kebab menu is open
  const [menuPos, setMenuPos] = useState(null); // {top, left} for the open kebab menu
  const listWrapRef = useRef(null);

  function openMenu(e, productId) {
    e.stopPropagation();
    if (menuFor === productId) { setMenuFor(null); setMenuPos(null); return; }
    const btnRect = e.currentTarget.getBoundingClientRect();
    const wrapRect = listWrapRef.current.getBoundingClientRect();
    const menuWidth = 198;
    const menuHeight = 130;
    const gap = 6;
    const tabBarBuffer = 96; // tab bar height + safe margin
    // window.innerHeight is the browser window, which is not the app's visible area when
    // it renders inside the phone-frame mockup. Measure against the scroll container.
    const scroller = document.getElementById("root");
    const viewportBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const spaceBelow = viewportBottom - tabBarBuffer - btnRect.bottom;
    const openUp = spaceBelow < menuHeight;
    const top = openUp
      ? btnRect.top - wrapRect.top - menuHeight - gap
      : btnRect.bottom - wrapRect.top + gap;
    const left = Math.max(4, Math.min(btnRect.right - wrapRect.left - menuWidth, wrapRect.width - menuWidth - 16));
    setMenuPos({ top, left, openUp });
    setMenuFor(productId);
  }

  const stats = usageStats(products, logs);

  const visible = products.filter((p) => matchesFilter(p, filter) && p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const grouped = CATS.map((c) => ({ ...c, items: visible.filter((p) => p.category === c.id) })).filter((g) => g.items.length > 0);
  // A product whose category id isn't in CATS any more (renamed/removed category, or data
  // from an older build) matched no group and vanished from this screen entirely — while
  // still showing up in Routine and Insights, so it couldn't be edited, retired or deleted.
  const knownCats = new Set(CATS.map((c) => c.id));
  const orphans = visible.filter((p) => !knownCats.has(p.category));
  if (orphans.length) grouped.push({ id: "__uncategorized__", label: "Uncategorized", icon: Info, items: orphans });

  const editingProduct = editing && editing !== "new" ? products.find((p) => p.id === editing) : null;
  const menuProduct = menuFor ? products.find((p) => p.id === menuFor) : null;

  const counts = {
    active: products.filter((p) => (p.status || "active") === "active").length,
    trying: products.filter((p) => p.status === "trying").length,
    retired: products.filter((p) => p.status === "retired").length,
  };
  const mostUsed = Math.max(1, ...products.map((p) => stats[p.id]?.count || 0));

  return (
    <div>
      <PageHeader
        image={SHELF_HEADER_IMG}
        eyebrow="Shelf"
        icon={Layers}
        minHeight={252}
        focus="52% 34%"
        title="Your products"
        subtitle="Everything in the rotation, and how hard each one is working."
      />

      <Body>
        {/* ---- shelf at a glance: new, and it answers the first question you'd ask ---- */}
        <Stagger style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { k: "active", label: "Active", n: counts.active, tone: "gold" },
            { k: "trying", label: "Trying", n: counts.trying, tone: "gold" },
            { k: "retired", label: "Retired", n: counts.retired },
          ].map((c) => (
            <StaggerItem key={c.k} style={{ flex: 1 }}>
              <div className="u-card" style={{ padding: "13px 14px" }}>
                <div className="u-display u-num" style={{ fontSize: 26, color: c.n ? "var(--text)" : "var(--text-3)" }}>{c.n}</div>
                <Eyebrow style={{ marginTop: 4 }}>{c.label}</Eyebrow>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        {/* ---- toolbar ---- */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your shelf…"
            aria-label="Search products"
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 999, padding: "13px 16px 13px 40px", color: "var(--text)", fontSize: 13.5,
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="u-tap"
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", display: "flex" }}>
              <X size={14} color="var(--text-3)" />
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, marginBottom: 18, overflowX: "auto", paddingBottom: 4, margin: "0 -20px 18px", padding: "0 20px 4px" }}>
          {FILTERS.map((f) => (
            <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Pill>
          ))}
        </div>

        <motion.button
          onClick={() => setEditing("new")}
          whileTap={{ scale: 0.985 }}
          transition={SPRING}
          className="u-tap"
          style={{
            position: "relative", width: "100%", borderRadius: 18, padding: "17px 18px", marginBottom: 24,
            overflow: "hidden", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
            border: "1px solid var(--line-3)",
            background: "linear-gradient(100deg, rgba(243,201,140,0.13), rgba(243,201,140,0.03))",
            boxShadow: "0 12px 30px -18px rgba(243,201,140,0.5)",
          }}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 999, flexShrink: 0,
            background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 18px -4px rgba(243,201,140,0.7)",
          }}>
            <Plus size={17} color="#20150C" strokeWidth={2.6} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Add a product</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>It'll appear in your routine straight away</div>
          </div>
          <img src={LEAF_IMG} alt="" aria-hidden="true" style={{ position: "absolute", right: -8, bottom: -26, width: 124, opacity: 0.5, pointerEvents: "none" }} />
        </motion.button>
      </Body>

      <div ref={listWrapRef} style={{ position: "relative", padding: "0 20px 8px" }}>
        {grouped.map((g) => {
          const Icon = g.icon;
          return (
            <Section
              key={g.id}
              title={g.label}
              action={<span className="u-num" style={{ fontSize: 11, color: "var(--text-3)" }}>{g.items.length}</span>}
            >
              <Stagger style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.items.map((p) => {
                  const s = stats[p.id] || { count: 0, last: null };
                  const retired = p.status === "retired";
                  return (
                    <StaggerItem key={p.id}>
                      <div className="u-card" style={{
                        position: "relative", display: "flex", alignItems: "stretch",
                        padding: 0, overflow: "hidden", opacity: retired ? 0.6 : 1,
                      }}>
                        <button
                          onClick={() => setEditing(p.id)}
                          className="u-tap"
                          aria-label={`Edit ${p.name}`}
                          style={{
                            width: 86, flexShrink: 0, background: "rgba(255,255,255,0.03)", border: "none",
                            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                          }}
                        >
                          {p.photo
                            ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <Icon size={20} color="var(--text-3)" strokeWidth={1.5} />}
                        </button>

                        <button
                          onClick={() => setEditing(p.id)}
                          className="u-tap"
                          style={{ flex: 1, minWidth: 0, background: "none", border: "none", textAlign: "left", padding: "13px 12px 13px 14px" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600, lineHeight: 1.35 }}>{p.name}</span>
                            {p.tracked && <Star size={10} color="var(--gold)" fill="var(--gold)" />}
                            {p.exfoliant && <Flame size={10} color="var(--rose)" fill="var(--rose)" />}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <TimeBadges time={p.time} />
                            {p.status === "trying" && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--gold)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "3px 8px" }}>TRYING</span>
                            )}
                            {retired && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 8px" }}>RETIRED</span>
                            )}
                          </div>

                          {/* how hard this product is actually working, relative to the shelf */}
                          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 9 }}>
                            <div style={{ flex: 1, maxWidth: 96 }}>
                              <MetaBar pct={(s.count / mostUsed) * 100} height={3} tone="gold" />
                            </div>
                            <span className="u-num" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                              {s.count > 0 ? `${s.count}× · ${prettyDate(s.last).toLowerCase()}` : "not used yet"}
                            </span>
                          </div>

                          {/* the timeline is the point now — when it was in the routine, not
                              just that it currently isn't */}
                          {retired && (() => {
                            const last = [...stintsOf(p)].reverse().find((st) => st.to);
                            if (!last) return null;
                            return (
                              <div data-testid="retired-timeline" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 7 }}>
                                in your routine {prettyDate(last.from).toLowerCase()} – {prettyDate(last.to).toLowerCase()}
                              </div>
                            );
                          })()}

                          {retired && p.retiredReason && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, fontStyle: "italic", lineHeight: 1.5 }}>
                              “{p.retiredReason}”
                            </div>
                          )}
                        </button>

                        <div style={{ display: "flex", alignItems: "flex-start", padding: "8px 6px 0 0" }}>
                          <button
                            onClick={(e) => openMenu(e, p.id)}
                            aria-label={`More options for ${p.name}`}
                            aria-expanded={menuFor === p.id}
                            className="u-tap"
                            style={{ background: "none", border: "none", padding: 7, color: "var(--text-3)", display: "flex" }}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </Section>
          );
        })}

        {visible.length === 0 && products.length > 0 && filter === "retired" && (
          <EmptyState
            icon={Archive}
            title="Nothing retired"
            body="Retire something from its “…” menu — it leaves your routine but keeps all its history."
          />
        )}
        {visible.length === 0 && products.length > 0 && filter !== "retired" && (
          <EmptyState
            icon={Search}
            title="No matches"
            body="Nothing on your shelf matches that search or filter."
            action={<GhostButton onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</GhostButton>}
          />
        )}
        {products.length === 0 && (
          <EmptyState
            icon={Layers}
            title="Your shelf is empty"
            body="Add what you're using and your morning and night routines build themselves."
            action={<PrimaryButton onClick={() => setEditing("new")}>Add your first product</PrimaryButton>}
          />
        )}

        <AnimatePresence>
          {menuProduct && menuPos && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => { setMenuFor(null); setMenuPos(null); }}
                style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(5,3,2,0.55)" }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: menuPos.openUp ? 6 : -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: menuPos.openUp ? 4 : -4 }}
                transition={{ type: "spring", stiffness: 520, damping: 36 }}
                onClick={(e) => e.stopPropagation()}
                role="menu"
                data-testid="kebab-menu"
                className="u-frost"
                style={{
                  position: "absolute", top: menuPos.top, left: menuPos.left, zIndex: 141,
                  borderRadius: 16, padding: 6, width: 198,
                  border: "1px solid var(--line-2)", boxShadow: "var(--shadow-lift)",
                  transformOrigin: menuPos.openUp ? "bottom right" : "top right",
                }}
              >
                {[
                  { label: "Edit", icon: Pencil, run: () => setEditing(menuProduct.id) },
                  {
                    label: menuProduct.status === "retired" ? "Restore to active" : "Retire",
                    icon: menuProduct.status === "retired" ? RotateCcw : Archive,
                    run: () => {
                      if (menuProduct.status === "retired") onUpdate(menuProduct.id, applyStatusChange(menuProduct, "active", logs));
                      else setRetiring(menuProduct.id);
                    },
                  },
                  { label: "Move down", icon: ArrowDownNarrowWide, run: () => onReorder(menuProduct.category, menuProduct.id) },
                ].map((it) => (
                  <button
                    key={it.label}
                    role="menuitem"
                    onClick={() => { it.run(); setMenuFor(null); setMenuPos(null); }}
                    className="u-tap"
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      padding: "11px 12px", borderRadius: 11, fontSize: 13, color: "var(--text)",
                      display: "flex", alignItems: "center", gap: 10,
                    }}
                  >
                    <it.icon size={14} color="var(--text-3)" />
                    {it.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editing && (
          <ProductEditor
            product={editingProduct}
            onClose={() => setEditing(null)}
            onSave={(data) => {
              if (editing === "new") {
                onAdd(data);
                setFilter("all");
                setQuery("");
              } else {
                // route status through the one stint writer rather than letting the
                // editor set the flag directly
                const patch = editingProduct
                  ? { ...data, ...applyStatusChange(editingProduct, data.status, logs, data.retiredReason) }
                  : data;
                onUpdate(editing, patch);
              }
              setEditing(null);
            }}
            onDelete={editingProduct ? () => { onDelete(editingProduct.id); setEditing(null); } : null}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {retiring && (
          <RetireReasonModal
            productName={products.find((p) => p.id === retiring)?.name || ""}
            usedToday={!!(logs[todayStr()] && ((logs[todayStr()].am || {})[retiring] || (logs[todayStr()].pm || {})[retiring]))}
            onClose={() => setRetiring(null)}
            onConfirm={(reason) => {
              const p = products.find((x) => x.id === retiring);
              if (p) onUpdate(retiring, applyStatusChange(p, "retired", logs, reason));
              setRetiring(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function compressProductPhoto(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new window.Image();
    img.onload = () => {
      const maxW = 320;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function FieldLabel({ children, style }) {
  return <Eyebrow style={{ marginBottom: 9, ...style }}>{children}</Eyebrow>;
}

function ProductEditor({ product, onClose, onSave, onDelete }) {
  const [name, setName] = useState(product ? product.name : "");
  const [category, setCategory] = useState(product ? product.category : "moisturizer");
  const [time, setTime] = useState(product ? product.time : "Both");
  const [tracked, setTracked] = useState(product ? !!product.tracked : false);
  const [exfoliant, setExfoliant] = useState(product ? !!product.exfoliant : false);
  const [status, setStatus] = useState(product ? product.status || "active" : "active");
  const [retiredReason, setRetiredReason] = useState(product ? product.retiredReason || "" : "");
  const [photo, setPhoto] = useState(product ? product.photo || null : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState(false);
  const photoInputRef = useRef(null);

  function submit() {
    if (!name.trim()) { setNameError(true); return; }
    onSave({ name: name.trim(), category, time, tracked, exfoliant, status, retiredReason: status === "retired" ? retiredReason.trim() : "", photo: photo || null });
  }

  const STATUS_LABEL = { active: "Active", trying: "Trying", retired: "Retired" };
  // a category id that no longer exists still needs to be offered back, or opening the
  // editor would silently reassign the product to whatever happened to be selected
  const categoryOptions = CATS.some((c) => c.id === category)
    ? CATS
    : [...CATS, { id: category, label: category, icon: Info }];

  const toggles = [
    { on: tracked, set: setTracked, icon: Star, label: "Count the days I use this", hint: "Shows a running day counter on Routine" },
    { on: exfoliant, set: setExfoliant, icon: Flame, label: "Exfoliant or strong active", hint: "Warns you if two are checked in one period" },
  ];

  return (
    <Sheet onClose={onClose} labelledBy="editor-title">
      <SheetHeader id="editor-title" title={product ? "Edit product" : "Add product"} onClose={onClose} />

      <div style={{ display: "flex", gap: 14, marginBottom: 20, alignItems: "flex-start" }}>
        {/* the clear-photo button lives inside this relative wrapper — as a bare sibling
            its position:absolute escaped to the viewport */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <motion.button
            onClick={() => photoInputRef.current && photoInputRef.current.click()}
            whileTap={{ scale: 0.96 }}
            transition={SPRING}
            aria-label={photo ? "Replace product photo" : "Add product photo"}
            className="u-tap"
            style={{
              display: "block", width: 84, height: 84, borderRadius: 18, overflow: "hidden", padding: 0,
              background: "rgba(255,255,255,0.04)", border: photo ? "1px solid var(--line-2)" : "1px dashed var(--line-2)",
            }}
          >
            {photo ? (
              <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Camera size={17} color="var(--text-3)" />
                <span style={{ fontSize: 9, color: "var(--text-3)" }}>Photo</span>
              </div>
            )}
          </motion.button>
          {photo && (
            <button onClick={() => setPhoto(null)} aria-label="Remove photo" className="u-tap"
              style={{
                position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 999,
                background: "rgba(8,5,4,0.92)", border: "1px solid var(--line-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <X size={12} color="var(--text)" />
            </button>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (nameError) setNameError(false); }}
            placeholder="Product name"
            aria-label="Product name"
            autoFocus={!product}
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)",
              border: `1px solid ${nameError ? "rgba(226,160,141,0.7)" : "var(--line)"}`,
              borderRadius: 12, padding: "13px 14px", color: "var(--text)", fontSize: 14,
            }}
          />
          {nameError && (
            <div style={{ fontSize: 11.5, color: "var(--rose)", marginTop: 7 }}>Give it a name first.</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {["AM", "PM", "Both"].map((t) => (
              <Pill key={t} active={time === t} tone={t === "PM" ? "moon" : "gold"} onClick={() => setTime(t)} style={{ flex: 1, textAlign: "center", padding: "9px 0" }}>
                {t}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) compressProductPhoto(f, setPhoto); e.target.value = ""; }}
      />

      <FieldLabel>Category</FieldLabel>
      <div style={{ display: "flex", gap: 7, marginBottom: 20, flexWrap: "wrap" }}>
        {categoryOptions.map((c) => (
          <Pill key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Pill>
        ))}
      </div>

      <FieldLabel>Status</FieldLabel>
      <div style={{ display: "flex", gap: 7, marginBottom: status === "retired" ? 12 : 20 }}>
        {STATUS_OPTIONS.map((s) => (
          <Pill key={s} active={status === s} onClick={() => setStatus(s)} style={{ flex: 1, textAlign: "center", padding: "10px 0" }}>
            {STATUS_LABEL[s]}
          </Pill>
        ))}
      </div>
      {status === "retired" && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.55 }}>
            Hidden from your routine, but every day you logged it stays in Insights.
          </div>
          <textarea
            value={retiredReason}
            onChange={(e) => setRetiredReason(e.target.value)}
            placeholder="Why retire it? Broke me out, too drying, switched to something else…"
            rows={2}
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 12, padding: "12px 14px", color: "var(--text)", fontSize: 13, resize: "none", lineHeight: 1.55,
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {toggles.map((t) => (
          <button
            key={t.label}
            onClick={() => t.set((v) => !v)}
            role="switch"
            aria-checked={t.on}
            className="u-tap"
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 14,
              border: `1px solid ${t.on ? "var(--line-3)" : "var(--line)"}`,
              background: t.on ? "var(--gold-wash)" : "transparent", textAlign: "left",
            }}
          >
            <t.icon size={15} color={t.on ? "var(--gold)" : "var(--text-3)"} fill={t.on ? "var(--gold)" : "none"} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: t.on ? "var(--text)" : "var(--text-2)", fontWeight: 500 }}>{t.label}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{t.hint}</div>
            </div>
            {/* real switch affordance, not just a tinted button */}
            <span style={{
              width: 34, height: 20, borderRadius: 999, flexShrink: 0, padding: 2,
              background: t.on ? "var(--gold)" : "rgba(255,255,255,0.1)",
              display: "flex", justifyContent: t.on ? "flex-end" : "flex-start",
              transition: "background 0.25s var(--ease)",
            }}>
              <motion.span layout transition={SPRING} style={{ width: 16, height: 16, borderRadius: 999, background: t.on ? "#20150C" : "rgba(255,255,255,0.55)" }} />
            </span>
          </button>
        ))}
      </div>

      <PrimaryButton onClick={submit} style={{ marginBottom: onDelete ? 10 : 0 }}>
        {product ? "Save changes" : "Add to shelf"}
      </PrimaryButton>

      {onDelete && (
        confirmDelete ? (
          <div style={{ display: "flex", gap: 8 }}>
            <GhostButton onClick={() => setConfirmDelete(false)} style={{ flex: 1 }}>Cancel</GhostButton>
            <PrimaryButton tone="danger" onClick={onDelete} style={{ flex: 1 }}>Delete for good</PrimaryButton>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="u-tap" style={{
            width: "100%", padding: "13px 0", borderRadius: 14, border: "1px solid rgba(226,160,141,0.3)",
            background: "transparent", color: "var(--rose)", fontSize: 13, fontWeight: 500,
          }}>
            Delete product
          </button>
        )
      )}
      {onDelete && !confirmDelete && (
        <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
          Deleting removes its history too — retire it instead to keep the record.
        </div>
      )}
    </Sheet>
  );
}

function RetireReasonModal({ productName, usedToday, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet onClose={onClose} z={155} labelledBy="retire-title">
      <SheetHeader
        id="retire-title"
        title={`Retiring ${productName}`}
        subtitle="Worth remembering why — completely optional."
        onClose={onClose}
      />
      {/* say plainly what retiring does to the record, since the old behaviour silently
          rewrote every past day and that's exactly what this is fixing */}
      <div style={{
        display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 14,
        padding: "11px 13px", borderRadius: 14,
        border: "1px solid var(--line)", background: "rgba(255,255,255,0.022)",
      }}>
        <CalendarClock size={13} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
          {usedToday
            ? "You've already used it today, so today stays as it is and it's gone from tomorrow."
            : "It leaves your routine from today."}
          {" "}Every earlier day keeps it, exactly as you logged it. You can still add it back for a single day.
        </span>
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Broke me out, too drying, switched to something else…"
        rows={3}
        autoFocus
        style={{
          width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 14, color: "var(--text)", fontSize: 13.5, resize: "none",
          marginBottom: 16, lineHeight: 1.55,
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={() => onConfirm("")} style={{ flex: 1 }}>Skip</GhostButton>
        <PrimaryButton onClick={() => onConfirm(reason.trim())} style={{ flex: 1 }}>Retire it</PrimaryButton>
      </div>
    </Sheet>
  );
}


/* ------------------------------- insights view ------------------------------- */

function InsightsView({ products, logs, photoIndex = {}, photoCache = {}, loadPhoto, quotaUsedMB = 0, quotaPct = 0, onExport }) {
  const dates = Object.keys(logs).sort();
  const hasAnyLogs = dates.length > 0;
  const todayD = todayStr();
  const thisMonth = monthKey(todayD);
  const [lightbox, setLightbox] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);

  const firstDate = dates[0] || todayD;
  const rangeDays = useMemo(() => {
    if (!hasAnyLogs) return [];
    const out = [];
    for (let c = firstDate; c <= todayD; c = addDays(c, 1)) out.push(c);
    return out;
  }, [firstDate, todayD, hasAnyLogs]);

  const photoEntries = useMemo(() => {
    const list = [];
    Object.keys(photoIndex).forEach((d) => {
      const slot = photoIndex[d];
      (slot.am || []).forEach((id) => list.push({ date: d, period: "am", id }));
      (slot.pm || []).forEach((id) => list.push({ date: d, period: "pm", id }));
    });
    return list.sort((a, b) => (a.date === b.date ? (a.period < b.period ? -1 : 1) : a.date < b.date ? -1 : 1));
  }, [photoIndex]);

  // ---- monthly consistency (current) ----
  const monthDates = dates.filter((d) => monthKey(d) === thisMonth);
  const dayOfMonth = parseDate(todayD).getDate();
  const completeDaysThisMonth = monthDates.filter((d) => dayCompletionPct(d, logs, products) >= 100).length;
  const consistency = dayOfMonth ? Math.round((completeDaysThisMonth / dayOfMonth) * 100) : 0;

  // ---- longest streak ever + current streak (shared helpers — see currentStreakDays) ----
  const longest = longestStreakDays(logs, products);
  const currentStreak = currentStreakDays(logs, products);

  // ---- journey summary: totals + biggest gap ever ----
  let totalCheckins = 0;
  dates.forEach((d) => {
    const l = logs[d];
    totalCheckins += Object.values(l.am || {}).filter(Boolean).length + Object.values(l.pm || {}).filter(Boolean).length;
  });
  let biggestGap = 0, gapRun = 0;
  rangeDays.forEach((d) => {
    const l = logs[d];
    const missed = !(l && (anyChecked(l.am) || anyChecked(l.pm)));
    if (missed) { gapRun++; biggestGap = Math.max(biggestGap, gapRun); } else { gapRun = 0; }
  });

  // ---- partial-day credit breakdown, this month ----
  let fullDays = 0, partialDays = 0, missedDays = 0;
  const monthRangeSoFar = [];
  for (let c = thisMonth + "-01"; c <= todayD; c = addDays(c, 1)) monthRangeSoFar.push(c);
  monthRangeSoFar.forEach((d) => {
    const status = dayStatus(d, logs, products);
    if (status === "full") fullDays++;
    else if (status === "partial") partialDays++;
    else missedDays++;
  });
  const monthTotalDays = fullDays + partialDays + missedDays;

  // ---- mood distribution this month ----
  const moodCounts = {};
  MOODS.forEach((m) => (moodCounts[m] = 0));
  monthDates.forEach((d) => {
    const l = logs[d];
    [l.amMood, l.pmMood].forEach((m) => { if (m && moodCounts[m] !== undefined) moodCounts[m]++; });
  });
  const maxMoodCount = Math.max(1, ...Object.values(moodCounts));
  const totalMoodLogs = Object.values(moodCounts).reduce((a, b) => a + b, 0);

  // ---- 6-month consistency trend ----
  const monthTrend = [];
  for (let i = 5; i >= 0; i--) {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() - i);
    const mk = monthKey(fmtDate(base));
    const daysCounted = mk === thisMonth ? dayOfMonth : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const mDates = dates.filter((d) => monthKey(d) === mk);
    const complete = mDates.filter((d) => dayCompletionPct(d, logs, products) >= 100).length;
    const pct = daysCounted ? Math.round((complete / daysCounted) * 100) : 0;
    monthTrend.push({ label: base.toLocaleDateString(undefined, { month: "short" }), pct, isCurrent: mk === thisMonth, hasData: mDates.length > 0 });
  }
  const prevMonthEntry = monthTrend[4];
  const monthDelta = prevMonthEntry && prevMonthEntry.hasData ? consistency - prevMonthEntry.pct : null;

  // ---- AM vs PM split ----
  const amDays = dates.filter((d) => isPeriodComplete(d, logs, products, "AM")).length;
  const pmDays = dates.filter((d) => isPeriodComplete(d, logs, products, "PM")).length;
  const amPct = dates.length ? Math.round((amDays / dates.length) * 100) : 0;
  const pmPct = dates.length ? Math.round((pmDays / dates.length) * 100) : 0;

  // ---- skip-day pattern by weekday (worst + best) ----
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const missByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const fullByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const totalByWeekday = [0, 0, 0, 0, 0, 0, 0];
  rangeDays.forEach((d) => {
    const wd = parseDate(d).getDay();
    totalByWeekday[wd]++;
    const l = logs[d];
    if (!(l && (anyChecked(l.am) || anyChecked(l.pm)))) missByWeekday[wd]++;
    if (dayCompletionPct(d, logs, products) >= 100) fullByWeekday[wd]++;
  });
  let worstIdx = -1, worstRate = 0;
  missByWeekday.forEach((m, i) => {
    if (totalByWeekday[i] >= 2 && m > 0) {
      const rate = m / totalByWeekday[i];
      if (rate > worstRate) { worstRate = rate; worstIdx = i; }
    }
  });
  let bestIdx = -1, bestRate = 0;
  fullByWeekday.forEach((c, i) => {
    if (totalByWeekday[i] >= 2) {
      const rate = c / totalByWeekday[i];
      if (rate > bestRate) { bestRate = rate; bestIdx = i; }
    }
  });
  const skipPattern = rangeDays.length >= 14 && worstIdx >= 0 && worstRate >= 0.4
    ? `You miss ${weekdayNames[worstIdx]}s most often`
    : null;
  const bestDayPattern = rangeDays.length >= 14 && bestIdx >= 0 && bestRate >= 0.5 && bestIdx !== worstIdx
    ? `You're most consistent on ${weekdayNames[bestIdx]}s`
    : null;

  // ---- cautious correlation: moisturizer presence vs negative mood ----
  const moisturizerIds = new Set(products.filter((p) => p.category === "moisturizer").map((p) => p.id));
  let withMoist = [0, 0], withoutMoist = [0, 0];
  dates.forEach((d) => {
    const l = logs[d];
    if (!l.pmMood) return;
    const hasMoist = Object.keys(l.pm || {}).some((id) => l.pm[id] && moisturizerIds.has(id));
    const negative = NEGATIVE_MOODS.includes(l.pmMood);
    const bucket = hasMoist ? withMoist : withoutMoist;
    bucket[1]++;
    if (negative) bucket[0]++;
  });
  let correlation = null;
  if (withMoist[1] >= 5 && withoutMoist[1] >= 5) {
    const rateWith = withMoist[0] / withMoist[1];
    const rateWithout = withoutMoist[0] / withoutMoist[1];
    if (rateWithout > rateWith + 0.15) {
      correlation = `Nights without a moisturizer checked show more Dry/Irritated logs (${Math.round(rateWithout * 100)}% vs ${Math.round(rateWith * 100)}% with one).`;
    }
  }

  // ---- did the irritation banner actually change behavior? ----
  const exfoliantIds = new Set(products.filter((p) => p.exfoliant).map((p) => p.id));
  let bannerFired = 0, bannerResponded = 0;
  rangeDays.forEach((d) => {
    const last3 = [0, 1, 2].map((i) => { const l = logs[addDays(d, -i)]; return l ? l.pmMood : null; });
    const wouldFire = last3.every((m) => m && NEGATIVE_MOODS.includes(m));
    if (!wouldFire) return;
    const dayBeforeExfoliant = Object.keys(logs[addDays(d, -1)]?.pm || {}).some((id) => logs[addDays(d, -1)].pm[id] && exfoliantIds.has(id));
    const nextDay = addDays(d, 1);
    if (nextDay > todayD) return;
    const nextLog = logs[nextDay];
    if (!nextLog) return;
    bannerFired++;
    const nextExfoliant = Object.keys(nextLog.pm || {}).some((id) => nextLog.pm[id] && exfoliantIds.has(id));
    if (dayBeforeExfoliant && !nextExfoliant) bannerResponded++;
  });
  const bannerInsight = bannerFired >= 3
    ? `The irritation banner has shown ${bannerFired} times — you skipped an active the next night ${Math.round((bannerResponded / bannerFired) * 100)}% of those times.`
    : null;

  // ---- tracked products ----
  // A retired product's day-streak stops meaning anything, but it still stays listed —
  // dropping it entirely would make its whole tracked history look erased, when the logs
  // behind it are untouched. Same treatment as "Every product, by last use" below.
  const trackedInsights = products.filter((p) => p.tracked).map((p) => ({
    id: p.id, name: p.name, photo: p.photo, category: p.category,
    days: productStreakDays(logs, p.id),
    retired: isRetired(p),
    isRetinoid: /tretinoin|retinol|adapalene|retinoid/i.test(p.name),
  }));

  // ---- mood shift after starting a tracked product (speculative, gated) ----
  const moodShifts = products.filter((p) => p.tracked).map((p) => {
    const usedDates = dates.filter((d) => (logs[d].am && logs[d].am[p.id]) || (logs[d].pm && logs[d].pm[p.id]));
    if (usedDates.length === 0) return null;
    const startDate = usedDates[0];
    let beforeTotal = 0, beforeNeg = 0, afterTotal = 0, afterNeg = 0;
    for (let i = 1; i <= 14; i++) {
      const d = addDays(startDate, -i);
      const l = logs[d];
      if (l && l.pmMood) { beforeTotal++; if (NEGATIVE_MOODS.includes(l.pmMood)) beforeNeg++; }
    }
    for (let i = 0; i < 14; i++) {
      const d = addDays(startDate, i);
      if (d > todayD) break;
      const l = logs[d];
      if (l && l.pmMood) { afterTotal++; if (NEGATIVE_MOODS.includes(l.pmMood)) afterNeg++; }
    }
    if (beforeTotal < 5 || afterTotal < 5) return null;
    const beforeRate = beforeNeg / beforeTotal;
    const afterRate = afterNeg / afterTotal;
    const diff = afterRate - beforeRate;
    if (Math.abs(diff) < 0.15) return null;
    return { id: p.id, name: p.name, improved: diff < 0, magnitude: Math.round(Math.abs(diff) * 100) };
  }).filter(Boolean);

  // ---- full-year heatmap (only once there's enough history) ----
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const heatmapDays = [];
  for (let c = yearStart; c <= todayD; c = addDays(c, 1)) {
    heatmapDays.push({ d: c, status: dayStatus(c, logs, products), dow: parseDate(c).getDay() });
  }
  const showHeatmap = rangeDays.length >= 60;
  const heatmapCols = [];
  if (showHeatmap) {
    let col = new Array(7).fill(null);
    heatmapDays.forEach((cell) => {
      if (cell.dow === 0 && col.some((x) => x)) { heatmapCols.push(col); col = new Array(7).fill(null); }
      col[cell.dow] = cell;
    });
    heatmapCols.push(col);
  }

  // ---- ingredient usage history ----
  const stats = usageStats(products, logs);

  // ---- fading usage: quietly abandoned without being retired ----
  const fading = rangeDays.length >= 28 ? products.filter((p) => p.status !== "retired").map((p) => {
    let prior = 0, recent = 0;
    for (let i = 15; i <= 28; i++) {
      const l = logs[addDays(todayD, -i)];
      if (l && ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id]))) prior++;
    }
    for (let i = 0; i <= 13; i++) {
      const l = logs[addDays(todayD, -i)];
      if (l && ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id]))) recent++;
    }
    return { id: p.id, name: p.name, prior, recent };
  }).filter((f) => f.prior >= 4 && f.recent <= 1) : [];

  // ---- habitual skipping: a step deliberately dropped most days is worth naming, since
  // skipping doesn't lower the bar and quietly caps those days below 100%
  const habitualSkips = (() => {
    const counts = {};
    for (let i = 0; i <= 13; i++) {
      const l = logs[addDays(todayD, -i)];
      if (!l) continue;
      ["am", "pm"].forEach((k) => {
        const arr = l.skip && l.skip[k];
        if (Array.isArray(arr)) arr.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      });
    }
    return Object.keys(counts)
      .filter((id) => counts[id] >= 5)
      .map((id) => ({ id, name: (products.find((p) => p.id === id) || {}).name, n: counts[id] }))
      .filter((x) => x.name)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2);
  })();

  // ---- category balance, all-time ----
  const categoryTotals = {};
  CATS.forEach((c) => (categoryTotals[c.id] = 0));
  products.forEach((p) => { categoryTotals[p.category] = (categoryTotals[p.category] || 0) + (stats[p.id]?.count || 0); });
  const categoryGrandTotal = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const categoryBalance = CATS.map((c) => ({ ...c, count: categoryTotals[c.id] || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // ---- weekly reflections ----
  const weeklyEntries = dates.filter((d) => logs[d].weeklyMood || logs[d].weeklyNote).sort((a, b) => (a < b ? 1 : -1));

  // ---- recent nightly/morning check-ins ----
  const noted = dates
    .filter((d) => (logs[d].amNote && logs[d].amNote.trim()) || (logs[d].pmNote && logs[d].pmNote.trim()) || logs[d].amMood || logs[d].pmMood)
    .sort((a, b) => (a < b ? 1 : -1)).slice(0, 6);

  return (
    <div>
      <PageHeader
        image={INSIGHTS_HEADER_IMG}
        eyebrow="Insights"
        icon={ChartNoAxesColumn}
        minHeight={248}
        focus="54% 46%"
        title="What the"
        italic="data says"
        action={<HeaderAction icon={Download} label="Export" onClick={() => setShowExport(true)} />}
      />

      <Body>
        <AnimatePresence>
          {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
        </AnimatePresence>

        {!hasAnyLogs ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing to read yet"
            body="Check off your first morning or night on Routine. Once there are a few days here, this page fills with streaks, patterns and trends."
          />
        ) : (
          <>
            {/* ---------- headline: consistency this month ---------- */}
            <Card style={{ padding: 20, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <ProgressRing pct={consistency} size={112} stroke={5}>
                  <span data-testid="consistency" className="u-display u-num" style={{ fontSize: 32, color: "var(--text)", lineHeight: 1 }}>{consistency}</span>
                  <span className="u-eyebrow" style={{ marginTop: 3, fontSize: 8 }}>percent</span>
                </ProgressRing>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Eyebrow>Consistency this month</Eyebrow>
                  <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8, lineHeight: 1.55 }}>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>{completeDaysThisMonth}</span> full {completeDaysThisMonth === 1 ? "day" : "days"} out of {dayOfMonth} so far.
                  </div>
                  {monthDelta !== null && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 5, marginTop: 12,
                      padding: "5px 10px", borderRadius: 999,
                      background: monthDelta >= 0 ? "var(--gold-wash)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${monthDelta >= 0 ? "var(--line-2)" : "var(--line)"}`,
                    }}>
                      {monthDelta >= 0
                        ? <TrendingUp size={12} color="var(--gold)" />
                        : <TrendingDown size={12} color="var(--text-3)" />}
                      <span className="u-num" style={{ fontSize: 11.5, color: monthDelta >= 0 ? "var(--gold)" : "var(--text-2)", fontWeight: 600 }}>
                        {Math.abs(monthDelta)}%
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>vs last month</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* ---------- streaks ---------- */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <Card tone="gold" style={{ flex: 1, padding: 15 }}>
                <Flame size={15} color="var(--gold)" />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 12 }}>
                  <span data-testid="insights-streak" className="u-display u-num" style={{ fontSize: 28, color: "var(--text)" }}>{currentStreak}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{currentStreak === 1 ? "day" : "days"}</span>
                </div>
                <Eyebrow style={{ marginTop: 5 }}>Current streak</Eyebrow>
              </Card>
              <Card style={{ flex: 1, padding: 15 }}>
                <Trophy size={15} color="var(--gold-2)" />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 12 }}>
                  <span data-testid="insights-best" className="u-display u-num" style={{ fontSize: 28, color: "var(--text)" }}>{longest}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{longest === 1 ? "day" : "days"}</span>
                </div>
                <Eyebrow style={{ marginTop: 5 }}>Best ever</Eyebrow>
              </Card>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 11.5, color: "var(--text-3)", marginBottom: 26, lineHeight: 1.6 }}>
              <span>Since {parseDate(firstDate).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span><span style={{ color: "var(--text-2)" }}>{dates.length}</span> days tracked</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span><span style={{ color: "var(--text-2)" }}>{totalCheckins}</span> check-ins</span>
              {biggestGap > 1 && (<><span style={{ opacity: 0.35 }}>·</span><span>longest gap <span style={{ color: "var(--text-2)" }}>{biggestGap}d</span></span></>)}
            </div>

            {/* ---------- rhythm ---------- */}
            <Section title="Consistency, last 6 months">
              <Card style={{ padding: "18px 16px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 7, height: 152 }}>
                  {monthTrend.map((m, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, height: "100%", justifyContent: "flex-end" }}>
                      <span className="u-num" style={{ fontSize: 9.5, color: m.isCurrent ? "var(--gold)" : "var(--text-3)", fontWeight: m.isCurrent ? 700 : 500 }}>
                        {m.hasData || m.isCurrent ? `${m.pct}%` : ""}
                      </span>
                      <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end", maxWidth: 32 }}>
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${Math.max(m.hasData || m.isCurrent ? 4 : 1.5, m.pct)}%` }}
                          transition={{ duration: 0.75, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                          style={{
                            width: "100%", borderRadius: 6,
                            background: m.isCurrent
                              ? "linear-gradient(180deg, var(--gold), var(--gold-2))"
                              : "rgba(243,201,140,0.26)",
                            boxShadow: m.isCurrent ? "0 0 16px -6px rgba(243,201,140,0.8)" : "none",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 9.5, color: m.isCurrent ? "var(--gold)" : "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            {monthTotalDays > 0 && (
              <Section title="This month, day by day">
                <Card>
                  <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", marginBottom: 14, background: "rgba(255,255,255,0.05)" }}>
                    {[
                      { n: fullDays, bg: "linear-gradient(90deg, var(--gold-2), var(--gold))" },
                      { n: partialDays, bg: "rgba(243,201,140,0.34)" },
                      { n: missedDays, bg: "rgba(255,255,255,0.07)" },
                    ].map((seg, i) => seg.n > 0 && (
                      <motion.div
                        key={i}
                        initial={{ width: 0 }}
                        animate={{ width: `${(seg.n / monthTotalDays) * 100}%` }}
                        transition={{ duration: 0.7, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                        style={{ background: seg.bg }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <LegendDot color="var(--gold)" label={`${fullDays} full`} />
                    <LegendDot color="rgba(243,201,140,0.34)" label={`${partialDays} partial`} />
                    <LegendDot color="rgba(255,255,255,0.14)" label={`${missedDays} missed`} />
                  </div>
                </Card>
              </Section>
            )}

            {showHeatmap && (
              <Section title={`${new Date().getFullYear()}, at a glance`} hint="Every day this year — brighter means a complete day.">
                <Card style={{ overflowX: "auto" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {heatmapCols.map((col, ci) => (
                      <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {col.map((cell, ri) => (
                          <div
                            key={ri}
                            title={cell ? `${cell.d} — ${cell.status}` : undefined}
                            style={{
                              width: 8, height: 8, borderRadius: 2.5,
                              background: !cell ? "transparent"
                                : cell.status === "full" ? "var(--gold)"
                                : cell.status === "partial" ? "rgba(243,201,140,0.36)"
                                : "rgba(255,255,255,0.055)",
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>
            )}

            {/* ---------- morning vs night ---------- */}
            <Section title="Morning vs night" hint="How often each half of the routine gets finished.">
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { label: "Morning", pct: amPct, days: amDays, tone: "gold", img: AM_CARD_IMG, Ico: Sun, focus: "76% 52%" },
                  { label: "Night", pct: pmPct, days: pmDays, tone: "moon", img: PM_CARD_IMG, Ico: Moon, focus: "76% 44%" },
                ].map((c) => (
                  <div key={c.label} style={{
                    position: "relative", flex: 1, minHeight: 150, borderRadius: 18, overflow: "hidden",
                    border: `1px solid ${TONES[c.tone].line}`, background: "var(--ink-2)",
                    padding: 15, display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <img src={c.img} alt="" aria-hidden="true" style={{
                      position: "absolute", inset: 0, width: "100%", height: "100%",
                      objectFit: "cover", objectPosition: c.focus,
                    }} />
                    <div aria-hidden="true" style={{
                      position: "absolute", inset: 0,
                      background: `linear-gradient(160deg, rgba(10,7,5,0.96) 0%, rgba(10,7,5,0.86) 40%, rgba(10,7,5,0.35) 72%, rgba(10,7,5,0.1) 100%)`,
                    }} />
                    <div style={{ position: "relative" }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 999, marginBottom: 12,
                        border: `1px solid ${TONES[c.tone].line}`, background: TONES[c.tone].wash,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <c.Ico size={14} color={TONES[c.tone].fg} />
                      </div>
                      <Eyebrow>{c.label}</Eyebrow>
                      <div className="u-display u-num" style={{ fontSize: 30, color: TONES[c.tone].fg, marginTop: 4 }}>{c.pct}%</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{c.days} of {dates.length} days</div>
                    </div>
                    <div style={{ position: "relative", marginTop: 12 }}>
                      <MetaBar pct={c.pct} tone={c.tone} height={4} track="rgba(255,255,255,0.14)" />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* ---------- photo timeline ---------- */}
            {photoEntries.length > 0 && (
              <Section title="Your timeline" hint={`${plural(photoEntries.length, "photo")}, oldest first.`}>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 20px 6px", margin: "0 -20px" }}>
                  {photoEntries.map((e) => (
                    <LazyPhoto
                      key={`${e.date}:${e.period}:${e.id}`}
                      date={e.date} period={e.period} id={e.id}
                      loadPhoto={loadPhoto}
                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                      size={62} radius={13}
                      tag={e.period.toUpperCase()}
                      onClick={() => setLightbox(e)}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* ---------- patterns ---------- */}
            {(skipPattern || bestDayPattern || correlation || bannerInsight || fading.length > 0 || habitualSkips.length > 0) && (
              <Section title="Patterns worth noticing">
                <Stagger style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {[
                    bestDayPattern && { icon: Sparkles, tone: "gold", text: bestDayPattern },
                    skipPattern && { icon: AlertTriangle, tone: "rose", text: skipPattern },
                    ...fading.map((f) => ({
                      icon: Archive, tone: "rose", key: f.id,
                      text: <>Barely touched lately: <span style={{ color: "var(--gold)" }}>{f.name}</span> — {f.prior}× two weeks ago, just {f.recent}× since. Worth retiring?</>,
                    })),
                    ...habitualSkips.map((s) => ({
                      icon: CircleMinus, tone: "rose", key: `skip-${s.id}`,
                      text: <>You've skipped <span style={{ color: "var(--gold)" }}>{s.name}</span> on {s.n} of the last 14 days. Skipping doesn't lower the bar, so those days can't reach 100% — retire it if it's really out.</>,
                    })),
                    correlation && { icon: Droplet, tone: "gold", text: correlation },
                    bannerInsight && { icon: Info, tone: "gold", text: bannerInsight },
                  ].filter(Boolean).map((p, i) => (
                    <StaggerItem key={p.key || i}>
                      <div style={{
                        borderRadius: 16, padding: "13px 15px", display: "flex", gap: 11,
                        background: p.tone === "rose" ? "var(--rose-wash)" : "var(--gold-wash)",
                        border: `1px solid ${p.tone === "rose" ? "rgba(226,160,141,0.24)" : "var(--line-2)"}`,
                      }}>
                        <p.icon size={13} color={p.tone === "rose" ? "var(--rose)" : "var(--gold)"} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>{p.text}</span>
                      </div>
                    </StaggerItem>
                  ))}
                </Stagger>
              </Section>
            )}

            {/* ---------- where the steps go ---------- */}
            {categoryBalance.length > 0 && (
              <Section title="Where your steps go">
                <Card>
                  {categoryBalance.map((c, i) => {
                    const Icon = c.icon;
                    const pct = Math.round((c.count / categoryGrandTotal) * 100);
                    return (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: i === categoryBalance.length - 1 ? 0 : 11 }}>
                        <Icon size={12} color="var(--gold-2)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "var(--text-2)", width: 76, flexShrink: 0 }}>{c.label}</span>
                        <div style={{ flex: 1 }}>
                          <MetaBar pct={pct} height={5} />
                        </div>
                        <span className="u-num" style={{ fontSize: 10.5, color: "var(--text)", width: 30, textAlign: "right" }}>{pct}%</span>
                      </div>
                    );
                  })}
                </Card>
              </Section>
            )}

            {/* ---------- mood ---------- */}
            {totalMoodLogs > 0 && (
              <Section title="How skin's felt this month" hint={`${plural(totalMoodLogs, "check-in")} logged.`}>
                <Card>
                  {MOODS.map((m, i) => (
                    <div key={m} style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: i === MOODS.length - 1 ? 0 : 11 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-2)", width: 64, flexShrink: 0 }}>{m}</span>
                      <div style={{ flex: 1 }}>
                        <MetaBar pct={(moodCounts[m] / maxMoodCount) * 100} height={5} tone={NEGATIVE_MOODS.includes(m) ? "rose" : "gold"} />
                      </div>
                      <span className="u-num" style={{ fontSize: 10.5, color: moodCounts[m] ? "var(--text)" : "var(--text-3)", width: 18, textAlign: "right" }}>
                        {moodCounts[m]}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            )}

            {/* ---------- tracked products ---------- */}
            {trackedInsights.length > 0 && (
              <Section title="Tracked products">
                <Stagger style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {trackedInsights.map((t) => {
                    const TIcon = (CATS.find((c) => c.id === t.category) || {}).icon || Package;
                    return (
                      <StaggerItem key={t.id}>
                        <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 13 }}>
                          <div style={{
                            width: 42, height: 42, borderRadius: 999, flexShrink: 0, overflow: "hidden",
                            background: "rgba(255,255,255,0.05)", border: "1px solid var(--line-2)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {t.photo
                              ? <img src={t.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <TIcon size={15} color="var(--text-3)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                              <span style={{ fontSize: 13, color: t.retired ? "var(--text-2)" : "var(--text)", fontWeight: 500 }}>{t.name}</span>
                              <span className="u-num" style={{ fontSize: 13, color: t.retired ? "var(--text-3)" : t.days ? "var(--gold)" : "var(--text-3)", fontWeight: 600, flexShrink: 0 }}>
                                {t.retired ? "Retired" : t.days ? `Day ${t.days}` : "Paused"}
                              </span>
                            </div>
                            {!t.retired && t.isRetinoid && (
                              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5, lineHeight: 1.5 }}>
                                Most retinoid adjustment periods ease by week 4–6.
                              </div>
                            )}
                          </div>
                        </Card>
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              </Section>
            )}

            {/* ---------- ingredient history ---------- */}
            {products.length > 0 && (
              <Section title="Every product, by last use" hint="Tap any product for its full calendar.">
                <Card style={{ padding: "4px 16px" }}>
                  {[...products]
                    .sort((a, b) => {
                      const la = stats[a.id]?.last, lb = stats[b.id]?.last;
                      if (!la && !lb) return 0;
                      if (!la) return 1;
                      if (!lb) return -1;
                      return la < lb ? 1 : -1;
                    })
                    .map((p, i, arr) => {
                      const s = stats[p.id] || { count: 0, last: null };
                      const Icon = (CATS.find((c) => c.id === p.category) || {}).icon || Package;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setHistoryProduct(p.id)}
                          className="u-tap"
                          style={{
                            width: "100%", textAlign: "left", background: "none", border: "none",
                            display: "flex", alignItems: "center", gap: 13, padding: "13px 0",
                            borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none",
                          }}
                        >
                          <div style={{
                            width: 42, height: 42, borderRadius: 999, flexShrink: 0, overflow: "hidden",
                            background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: isRetired(p) ? 0.55 : 1,
                          }}>
                            {p.photo
                              ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <Icon size={15} color="var(--text-3)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, lineHeight: 1.35 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                              {s.last ? `last used ${prettyDate(s.last).toLowerCase()}` : "not used yet"}
                              {isRetired(p) && " · retired"}
                            </div>
                          </div>
                          <span className="u-num" style={{ fontSize: 12, color: s.count ? "var(--gold)" : "var(--text-3)", flexShrink: 0, fontWeight: 600 }}>
                            {s.count}×
                          </span>
                          <ChevronRight size={14} color="var(--text-3)" style={{ flexShrink: 0 }} />
                        </button>
                      );
                    })}
                </Card>
              </Section>
            )}

            {/* ---------- speculative mood shifts ---------- */}
            {moodShifts.length > 0 && (
              <Section title="Since starting these" hint="Correlation only — plenty else could explain it.">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {moodShifts.map((m) => (
                    <Card key={m.id} style={{ padding: "13px 15px" }}>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
                        {m.improved ? "Fewer" : "More"} negative mood logs since starting{" "}
                        <span style={{ color: "var(--gold)" }}>{m.name}</span> ({m.magnitude}% shift)
                      </div>
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {/* ---------- reflections ---------- */}
            {weeklyEntries.length > 0 && (
              <Section title="Weekly reflections">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {weeklyEntries.slice(0, 5).map((d) => (
                    <Card key={d} style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: logs[d].weeklyNote ? 7 : 0 }}>
                        <span className="u-eyebrow">{prettyDate(d)}</span>
                        {logs[d].weeklyMood && (
                          <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600 }}>{logs[d].weeklyMood}</span>
                        )}
                      </div>
                      {logs[d].weeklyNote && (
                        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{logs[d].weeklyNote}</div>
                      )}
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {noted.length > 0 && (
              <Section title="Recent check-ins">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {noted.map((d) => (
                    <Card key={d} style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                        <span className="u-eyebrow">{prettyDate(d)}</span>
                        <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                          {logs[d].amMood && (
                            <span style={{ fontSize: 10.5, color: "var(--gold)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Sun size={9} /> {logs[d].amMood}
                            </span>
                          )}
                          {logs[d].pmMood && (
                            <span style={{ fontSize: 10.5, color: "var(--moon)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Moon size={9} /> {logs[d].pmMood}
                            </span>
                          )}
                        </div>
                      </div>
                      {logs[d].amNote && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>{logs[d].amNote}</div>}
                      {logs[d].pmNote && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{logs[d].pmNote}</div>}
                    </Card>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ---------- storage (canonical copy; Journey shows the same component) ---------- */}
        <Section title="Storage">
          <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} hint="Photos are the bulk of this. Clean up old ones from Journey." />
        </Section>
      </Body>

      <AnimatePresence>
        {historyProduct && (
          <ProductHistoryModal
            product={products.find((p) => p.id === historyProduct)}
            logs={logs}
            onClose={() => setHistoryProduct(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightbox && (
          <Lightbox
            entry={lightbox}
            src={photoCache[photoKey(lightbox.date, lightbox.period, lightbox.id)]}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Header pill action, shared by Insights and Journey so the two Export buttons match.
function HeaderAction({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      className="u-tap"
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999,
        background: "rgba(10,7,5,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        border: "1px solid var(--line-2)", color: "var(--text)", fontSize: 12, fontWeight: 600,
      }}
    >
      <Icon size={13} color="var(--gold)" />
      {label}
    </motion.button>
  );
}

// One storage meter, used on both Insights and Journey. These were two different blocks
// with different labels ("Used" vs "Storage used") and different markup.
function StorageMeter({ usedMB, pct, hint }) {
  const tight = pct > 85;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>Used</span>
        <span data-testid="storage-used" className="u-num" style={{ fontSize: 12, color: tight ? "var(--rose)" : "var(--text)", fontWeight: 600 }}>
          {usedMB.toFixed(1)} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>/ {TOTAL_QUOTA_MB} MB</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{
            height: "100%", borderRadius: 999,
            background: tight ? "linear-gradient(90deg, #C98570, var(--rose))" : "linear-gradient(90deg, var(--gold-3), var(--gold))",
          }}
        />
      </div>
      {tight ? (
        <div style={{ fontSize: 11.5, color: "var(--rose)", marginTop: 10, lineHeight: 1.5 }}>
          Getting close to the limit — clean up old photos in Journey.
        </div>
      ) : hint ? (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10, lineHeight: 1.5 }}>{hint}</div>
      ) : null}
    </Card>
  );
}

// Shared full-screen photo viewer — Insights' timeline and Journey's gallery used two
// near-identical copies of this.
function Lightbox({ entry, src, onClose, onDelete, label }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 160, padding: 22,
        background: "rgba(4,2,1,0.94)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}
    >
      {src ? (
        <motion.img
          initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          src={src} alt=""
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "100%", maxHeight: "68vh", borderRadius: 20, boxShadow: "var(--shadow-lift)" }}
        />
      ) : (
        <Loader2 className="animate-spin" size={24} color="var(--gold)" />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
          {label || `${prettyDate(entry.date)} ${entry.period.toUpperCase()}`}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="u-tap"
            style={{
              background: "rgba(226,160,141,0.14)", border: "1px solid rgba(226,160,141,0.32)",
              borderRadius: 999, padding: "8px 14px", display: "flex", alignItems: "center", gap: 7,
              color: "var(--rose)", fontSize: 12, fontWeight: 600,
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
      <button onClick={onClose} className="u-tap" style={{
        position: "absolute", top: 18, right: 18, width: 36, height: 36, borderRadius: 999,
        background: "rgba(255,255,255,0.08)", border: "1px solid var(--line-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <X size={16} color="var(--text)" />
      </button>
    </motion.div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
    </div>
  );
}

function buildProductMonthGrid(logs, productId, year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month, d));
    const l = logs[ds];
    const usedAm = l && l.am && l.am[productId];
    const usedPm = l && l.pm && l.pm[productId];
    let status = "none";
    if (usedAm && usedPm) status = "both"; else if (usedAm) status = "am"; else if (usedPm) status = "pm";
    if (ds > todayStr()) status = "future";
    cells.push({ ds, day: d, status });
  }
  return cells;
}

function ProductHistoryModal({ product, logs, onClose }) {
  const [monthOffset, setMonthOffset] = useState(0);
  if (!product) return null;

  const dates = Object.keys(logs).sort();
  const usedDates = dates.filter((d) => (logs[d].am && logs[d].am[product.id]) || (logs[d].pm && logs[d].pm[product.id]));
  const count = usedDates.length;
  const first = usedDates[0];
  const last = usedDates[usedDates.length - 1];

  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const cells = buildProductMonthGrid(logs, product.id, year, month);
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Sheet onClose={onClose} z={155} labelledBy="history-title">
      <SheetHeader
        id="history-title"
        title={product.name}
        subtitle={count === 0
          // used to render "first Invalid Date · last Invalid Date"
          ? "Never used yet — check it off on Routine and it starts filling in here."
          : `Used ${plural(count, "day")} · first ${prettyDate(first)} · last ${prettyDate(last)}`}
        onClose={onClose}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month" className="u-tap" style={iconBtnStyle}>
          <ChevronLeft size={15} color="var(--text-2)" />
        </button>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{monthLabel}</span>
        <button onClick={() => setMonthOffset((o) => o + 1)} disabled={monthOffset >= 0} aria-label="Next month" className="u-tap"
          style={{ ...iconBtnStyle, opacity: monthOffset >= 0 ? 0.3 : 1 }}>
          <ChevronRight size={15} color="var(--text-2)" />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginBottom: 16 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="u-eyebrow" style={{ textAlign: "center", fontSize: 8.5 }}>{d}</div>
        ))}
        {cells.map((c, i) =>
          c ? (
            <div key={i} style={{
              aspectRatio: "1", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
              background: c.status === "both" ? "var(--gold)"
                : c.status === "am" || c.status === "pm" ? "rgba(243,201,140,0.28)"
                : c.status === "future" ? "transparent" : "rgba(255,255,255,0.045)",
              border: c.status === "future" ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              <span className="u-num" style={{
                fontSize: 10.5, fontWeight: c.status === "both" ? 700 : 500,
                color: c.status === "both" ? "#20150C" : c.status === "future" ? "rgba(255,255,255,0.12)" : "var(--text-2)",
              }}>
                {c.day}
              </span>
            </div>
          ) : <div key={i} />
        )}
      </div>

      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <LegendDot color="var(--gold)" label="AM + PM" />
        <LegendDot color="rgba(243,201,140,0.28)" label="One dose" />
        <LegendDot color="rgba(255,255,255,0.1)" label="Not used" />
      </div>
    </Sheet>
  );
}

function ExportSheet({ onClose, onExportJSON }) {
  const [done, setDone] = useState(false);
  function handleExport() {
    onExportJSON();
    setDone(true);
    setTimeout(() => setDone(false), 2400);
  }
  return (
    <Sheet onClose={onClose} z={155} labelledBy="export-title">
      <SheetHeader
        id="export-title"
        title="Export your data"
        subtitle="It's yours — take it anywhere."
        onClose={onClose}
      />

      <motion.button
        onClick={handleExport}
        whileTap={{ scale: 0.985 }}
        transition={SPRING}
        className="u-tap"
        style={{
          width: "100%", textAlign: "left", borderRadius: 18, padding: 16, marginBottom: 10,
          display: "flex", alignItems: "flex-start", gap: 13,
          border: `1px solid ${done ? "var(--line-3)" : "var(--line-2)"}`,
          background: done ? "var(--gold-wash-2)" : "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))",
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: "var(--gold-wash-2)", border: "1px solid var(--line-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {done ? <Check size={16} color="var(--gold)" strokeWidth={3} /> : <Download size={16} color="var(--gold)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>
            {done ? "Downloaded" : "Everything, as JSON"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>
            Every product, every logged day, moods, notes and computed stats — plus the definitions
            behind each number. Paste it into Claude or ChatGPT and ask anything.
          </div>
        </div>
      </motion.button>

      <div style={{
        borderRadius: 18, padding: 16, display: "flex", alignItems: "flex-start", gap: 13,
        border: "1px dashed var(--line)", opacity: 0.55,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <ImageIcon size={16} color="var(--text-3)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>Photo bundle</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>
            Coming with the standalone version.
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* -------------------------------- journey view -------------------------------- */

function YearOverview({ year, logs, photoIndex, selectedDate, onPickDay, products = [] }) {
  const months = Array.from({ length: 12 }, (_, m) => m);
  return (
    <div style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, paddingTop: 2 }}>
      {months.map((m) => {
        const cells = buildMonthGrid(logs, year, m, photoIndex, products);
        const label = new Date(year, m, 1).toLocaleDateString(undefined, { month: "long" });
        const fullCount = cells.filter((c) => c && c.status === "full").length;
        return (
          <div key={m}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <Eyebrow>{label}</Eyebrow>
              <span className="u-num" style={{ fontSize: 9.5, color: fullCount ? "var(--gold)" : "var(--text-3)" }}>
                {fullCount ? `${fullCount} full` : "—"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {cells.map((c, i) =>
                c ? (
                  <button
                    key={i}
                    onClick={() => c.status !== "future" && onPickDay(c.ds)}
                    disabled={c.status === "future"}
                    aria-label={c.ds}
                    className="u-tap"
                    style={{
                      aspectRatio: "1", borderRadius: 4, padding: 0,
                      background: c.status === "future" ? "transparent" : statusColorFor(c.status),
                      border: c.ds === selectedDate ? "1px solid var(--text)" : "1px solid transparent",
                    }}
                  />
                ) : <div key={i} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One definition of the day-status colours, shared by the month grid, the year overview
// and both calendar legends — these were three separate copies before.
function statusColorFor(status) {
  if (status === "full") return "var(--gold)";
  if (status === "partial") return "rgba(243,201,140,0.34)";
  return "rgba(255,255,255,0.055)";
}

function buildMonthGrid(logs, year, month, photoIndex = {}, products = []) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month, d));
    let status = ds > todayStr() ? "future" : dayStatus(ds, logs, products);
    const ph = photoIndex[ds];
    const hasPhoto = !!(ph && ((ph.am && ph.am.length) || (ph.pm && ph.pm.length)));
    cells.push({ ds, day: d, status, hasPhoto });
  }
  return cells;
}

function JourneyView({ products, logs, selectedDate, setSelectedDate, setTab, photoIndex, photoCache, loadPhoto, onTriggerPhoto, onDelete, onDeleteMany, quotaUsedMB, quotaPct, onExport }) {
  const [showExport, setShowExport] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [calView, setCalView] = useState("month"); // 'month' | 'year'
  const [previewDate, setPreviewDate] = useState(null);
  const [mode, setMode] = useState("grid");
  const [viewing, setViewing] = useState(null); // {date, period, id} | null
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [compareA, setCompareA] = useState(null); // {date, period, id} | null
  const [compareB, setCompareB] = useState(null);
  const [quickDays, setQuickDays] = useState(null); // 30 | 90 | null — which quick-compare preset is active
  const [compareNote, setCompareNote] = useState(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [picking, setPicking] = useState(null); // 'A' | 'B' | null
  const [pickerMode, setPickerMode] = useState("date"); // 'date' | 'all'
  const [pickerDate, setPickerDate] = useState(null); // drill-down date when pickerMode === 'date'
  const [galleryExpanded, setGalleryExpanded] = useState(false);

  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const cells = useMemo(() => buildMonthGrid(logs, year, month, photoIndex, products), [logs, year, month, photoIndex, products]);
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // flattened photo entries, newest first
  const entries = useMemo(() => {
    const list = [];
    Object.keys(photoIndex).forEach((d) => {
      const slot = photoIndex[d];
      (slot.am || []).forEach((id) => list.push({ date: d, period: "am", id }));
      (slot.pm || []).forEach((id) => list.push({ date: d, period: "pm", id }));
    });
    return list.sort((a, b) => (a.date === b.date ? (a.period === b.period ? 0 : a.period < b.period ? -1 : 1) : a.date < b.date ? 1 : -1));
  }, [photoIndex]);

  function entryKey(e) { return `${e.date}:${e.period}:${e.id}`; }
  function entryLabel(e) { return `${prettyDate(e.date)} ${e.period.toUpperCase()}`; }
  function sameEntry(a, b) { return a && b && a.date === b.date && a.period === b.period && a.id === b.id; }

  // dates that have at least one photo, newest first, with AM/PM counts for the date-picker view
  const dateGroups = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, { date: e.date, am: 0, pm: 0 });
      map.get(e.date)[e.period] += 1;
    });
    return Array.from(map.values());
  }, [entries]);

  // entries grouped by month, then by date — used for the expanded "view more" gallery
  const galleryMonthGroups = useMemo(() => {
    const months = [];
    entries.forEach((e) => {
      const mKey = monthKey(e.date);
      let m = months[months.length - 1];
      if (!m || m.key !== mKey) {
        m = { key: mKey, label: parseDate(e.date).toLocaleDateString(undefined, { month: "long", year: "numeric" }), dates: [] };
        months.push(m);
      }
      let d = m.dates[m.dates.length - 1];
      if (!d || d.date !== e.date) {
        d = { date: e.date, items: [] };
        m.dates.push(d);
      }
      d.items.push(e);
    });
    return months;
  }, [entries]);

  function resetCompare() {
    setCompareA(null);
    setCompareB(null);
    setQuickDays(null);
    setCompareNote(null);
  }

  function openPicker(slot) {
    setPicking(slot);
    setPickerMode("date");
    setPickerDate(null);
  }

  function pickPhoto(e) {
    if (picking === "A") setCompareA(e); else setCompareB(e);
    setQuickDays(null);
    setCompareNote(null);
    setPicking(null);
  }

  function toggleSelected(k) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function deleteSelected() {
    const list = entries.filter((e) => selected.has(entryKey(e)));
    await onDeleteMany(list);
    setSelected(new Set());
    setSelectMode(false);
  }

  const cleanupTargets = useMemo(() => {
    const cutoff = addDays(todayStr(), -90);
    return entries.filter((e) => e.date < cutoff);
  }, [entries]);

  async function deleteOlderThan90() {
    if (!cleanupTargets.length) return;
    await onDeleteMany(cleanupTargets);
    setConfirmCleanup(false);
  }

  function applyQuickCompare(daysAgo) {
    const after = entries[0]; // most recent
    if (!after) return;
    // Only photos from an earlier date are valid "before" candidates. Without this the
    // closest match to the target could be the newest photo itself, which put the same
    // image in both panes and reported "0 days apart".
    const candidates = entries.filter((e) => e.date < after.date);
    if (!candidates.length) {
      setCompareNote("Only one day has photos so far — add another to compare against.");
      setCompareA(null);
      setCompareB(after);
      setQuickDays(null);
      return;
    }
    const target = addDays(after.date, -daysAgo);
    let closest = candidates[0];
    let closestDiff = Infinity;
    candidates.forEach((e) => {
      const diff = Math.abs(parseDate(e.date) - parseDate(target));
      if (diff < closestDiff) { closestDiff = diff; closest = e; }
    });
    const gap = Math.round(Math.abs(parseDate(after.date) - parseDate(closest.date)) / 86400000);
    setCompareB(after);
    setCompareA(closest);
    setQuickDays(daysAgo);
    // be honest when the nearest available pair isn't close to what was asked for
    setCompareNote(Math.abs(gap - daysAgo) > Math.max(7, daysAgo * 0.25)
      ? `No photo near ${daysAgo} days back — showing the closest you have, ${plural(gap, "day")} apart.`
      : null);
  }

  const elapsedDays = compareA && compareB ? Math.round(Math.abs(parseDate(compareB.date) - parseDate(compareA.date)) / 86400000) : null;

  // A compare slot can hold a photo that was never scrolled into view, so LazyPhoto's
  // observer never fetched it — the pane then rendered an <img> with no src at all.
  useEffect(() => {
    [compareA, compareB].forEach((e) => {
      if (e && !photoCache[photoKey(e.date, e.period, e.id)]) loadPhoto(e.date, e.period, e.id);
    });
  }, [compareA, compareB, photoCache, loadPhoto]);

  const previewLog = previewDate ? logs[previewDate] : null;
  const previewAmCount = previewLog ? Object.values(previewLog.am || {}).filter(Boolean).length : 0;
  const previewPmCount = previewLog ? Object.values(previewLog.pm || {}).filter(Boolean).length : 0;
  const previewPhotos = previewDate ? entries.filter((e) => e.date === previewDate) : [];

  return (
    <div>
      <PageHeader
        image={JOURNEY_HEADER_IMG}
        eyebrow="Journey"
        icon={Images}
        minHeight={252}
        focus="52% 44%"
        title="Your progress,"
        italic="over time"
        action={<HeaderAction icon={Download} label="Export" onClick={() => setShowExport(true)} />}
      />

      <AnimatePresence>
        {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
      </AnimatePresence>

      <Body>
        {/* ---------- capture: the reason you're on this page ---------- */}
        <Section
          title="Add today's photo"
          hint={`For ${prettyDate(selectedDate).toLowerCase()} — front, side, whatever angle. Up to ${MAX_PHOTOS_PER_PICK} at a time; a new pick replaces that slot.`}
        >
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { label: "Morning", sub: "AM", tone: "gold", Ico: Sun, run: () => onTriggerPhoto("am"), n: (photoIndex[selectedDate]?.am || []).length },
              { label: "Night", sub: "PM", tone: "moon", Ico: Moon, run: () => onTriggerPhoto("pm"), n: (photoIndex[selectedDate]?.pm || []).length },
            ].map((b) => (
              <motion.button
                key={b.sub}
                onClick={b.run}
                whileTap={{ scale: 0.97 }}
                transition={SPRING}
                className="u-tap"
                style={{
                  flex: 1, borderRadius: 18, padding: "16px 14px", textAlign: "left",
                  border: `1px solid ${TONES[b.tone].line}`,
                  background: `linear-gradient(165deg, ${TONES[b.tone].wash2}, rgba(255,255,255,0.014))`,
                  boxShadow: `0 12px 28px -20px ${TONES[b.tone].glow}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 999,
                    border: `1px dashed ${TONES[b.tone].line}`, background: TONES[b.tone].wash,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <b.Ico size={15} color={TONES[b.tone].fg} />
                  </div>
                  {b.n > 0 && (
                    <span className="u-num" style={{
                      fontSize: 10.5, fontWeight: 700, color: TONES[b.tone].fg,
                      background: TONES[b.tone].wash2, border: `1px solid ${TONES[b.tone].line}`,
                      borderRadius: 999, padding: "3px 8px",
                    }}>
                      {b.n}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>{b.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                  <Camera size={11} color="var(--text-3)" />
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{b.n > 0 ? "Replace" : "Capture"}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </Section>

        {/* ---------- gallery / compare ---------- */}
        <Section
          title={mode === "grid" ? "Gallery" : "Compare"}
          hint={mode === "grid"
            ? entries.length ? `${plural(entries.length, "photo")}, newest first.` : undefined
            : "Put two days side by side."}
          action={
            <LayoutGroup id="journey-mode">
              <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 999, background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}>
                {["grid", "compare"].map((m) => (
                  <button
                    key={m}
                    onClick={() => { if (mode === "compare" && m === "grid") resetCompare(); setMode(m); setSelectMode(false); }}
                    className="u-tap"
                    style={{
                      position: "relative", background: "none", border: "none", padding: "6px 13px",
                      borderRadius: 999, fontSize: 11.5, fontWeight: mode === m ? 700 : 500,
                      color: mode === m ? "var(--gold)" : "var(--text-3)",
                      transition: "color 0.25s var(--ease)",
                    }}
                  >
                    {mode === m && (
                      <motion.div
                        layoutId="mode-pill"
                        transition={{ type: "spring", stiffness: 460, damping: 36 }}
                        style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--gold-wash-2)", border: "1px solid var(--line-2)" }}
                      />
                    )}
                    <span style={{ position: "relative" }}>{m === "grid" ? "Gallery" : "Compare"}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          }
        >
          {mode === "grid" && (
            <>
              {entries.length === 0 ? (
                <EmptyState
                  icon={Camera}
                  title="No photos yet"
                  body="Take the first one today. In a month you'll be glad the baseline exists."
                />
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <button onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }} className="u-tap"
                      style={{ background: "none", border: "none", fontSize: 12, fontWeight: 600, color: selectMode ? "var(--gold)" : "var(--text-3)" }}>
                      {selectMode ? "Cancel" : "Select"}
                    </button>
                    {!selectMode && (
                      <button
                        onClick={() => setConfirmCleanup(true)}
                        disabled={cleanupTargets.length === 0}
                        className="u-tap"
                        style={{
                          background: "none", border: "none", fontSize: 12,
                          color: cleanupTargets.length ? "var(--text-3)" : "rgba(141,127,113,0.4)",
                        }}
                      >
                        Clean up 90+ days{cleanupTargets.length ? ` (${cleanupTargets.length})` : ""}
                      </button>
                    )}
                  </div>

                  {!galleryExpanded && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                        {entries.slice(0, GALLERY_PAGE_SIZE).map((e) => {
                          const k = entryKey(e);
                          return (
                            <LazyPhoto
                              key={k}
                              date={e.date} period={e.period} id={e.id}
                              loadPhoto={loadPhoto}
                              cached={photoCache[photoKey(e.date, e.period, e.id)]}
                              aspect="3 / 4"
                              radius={14}
                              tag={`${e.date.slice(5)} ${e.period.toUpperCase()}`}
                              selected={selectMode && selected.has(k)}
                              onClick={() => (selectMode ? toggleSelected(k) : setViewing(e))}
                            />
                          );
                        })}
                      </div>

                      {entries.length > GALLERY_PAGE_SIZE && (
                        <GhostButton onClick={() => setGalleryExpanded(true)}>
                          View all {entries.length} photos
                        </GhostButton>
                      )}
                    </>
                  )}

                  {galleryExpanded && (
                    <>
                      <button onClick={() => setGalleryExpanded(false)} className="u-tap"
                        style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", fontSize: 12, fontWeight: 600, color: "var(--gold)", marginBottom: 18, padding: 0 }}>
                        <ChevronLeft size={13} /> Show less
                      </button>

                      {galleryMonthGroups.map((m) => (
                        <div key={m.key} style={{ marginBottom: 26 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                            <Eyebrow tone="gold">{m.label}</Eyebrow>
                            <div className="u-hairline" style={{ flex: 1 }} />
                          </div>
                          {m.dates.map((d) => (
                            <div key={d.date} style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 9 }}>{prettyDate(d.date)}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                {d.items.map((e) => {
                                  const k = entryKey(e);
                                  return (
                                    <LazyPhoto
                                      key={k}
                                      date={e.date} period={e.period} id={e.id}
                                      loadPhoto={loadPhoto}
                                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                                      aspect="3 / 4"
                                      radius={14}
                                      tag={e.period.toUpperCase()}
                                      selected={selectMode && selected.has(k)}
                                      onClick={() => (selectMode ? toggleSelected(k) : setViewing(e))}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}

                  <AnimatePresence>
                    {selectMode && selected.size > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.24 }}
                        style={{ marginTop: 12 }}
                      >
                        <PrimaryButton tone="danger" onClick={deleteSelected}>
                          Delete {plural(selected.size, "photo")}
                        </PrimaryButton>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </>
          )}

          {mode === "compare" && (
            entries.length === 0 ? (
              <EmptyState
                icon={Camera}
                title="Nothing to compare yet"
                body="Two photos on different days is all it takes to see a difference."
              />
            ) : (
              <>
                <div style={{ display: "flex", gap: 7, marginBottom: 14, alignItems: "center" }}>
                  <Pill active={quickDays === 30} onClick={() => applyQuickCompare(30)}>vs 30 days</Pill>
                  <Pill active={quickDays === 90} onClick={() => applyQuickCompare(90)}>vs 90 days</Pill>
                  {(compareA || compareB) && (
                    <button onClick={resetCompare} className="u-tap"
                      style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 12, color: "var(--rose)", fontWeight: 600 }}>
                      Clear
                    </button>
                  )}
                </div>

                {elapsedDays !== null && (
                  <div style={{ textAlign: "center", marginBottom: 6 }}>
                    <span className="u-display u-num" style={{ fontSize: 26, color: "var(--gold)" }}>{elapsedDays}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 6 }}>{elapsedDays === 1 ? "day" : "days"} apart</span>
                  </div>
                )}
                {compareNote && (
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", marginBottom: 12, lineHeight: 1.55 }}>
                    {compareNote}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: elapsedDays !== null || compareNote ? 8 : 0 }}>
                  {[["Before", compareA, "A"], ["After", compareB, "B"]].map(([label, val, slot]) => (
                    <div key={slot} style={{ flex: 1 }}>
                      <Eyebrow style={{ marginBottom: 7, textAlign: "center" }}>{label}</Eyebrow>
                      <motion.button
                        onClick={() => openPicker(slot)}
                        whileTap={{ scale: 0.98 }}
                        transition={SPRING}
                        className="u-tap"
                        data-testid={`compare-${slot}`}
                        style={{
                          width: "100%", aspectRatio: "0.8", borderRadius: 18, overflow: "hidden",
                          background: "rgba(255,255,255,0.035)", border: `1px solid ${val ? "var(--line-2)" : "var(--line)"}`,
                          display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: 0,
                        }}
                      >
                        {val ? (
                          // used to render <img src={undefined}> for a photo that had never
                          // been scrolled into view; now it loads and shows a spinner meanwhile
                          photoCache[photoKey(val.date, val.period, val.id)] ? (
                            <img src={photoCache[photoKey(val.date, val.period, val.id)]} alt={entryLabel(val)}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <Loader2 className="animate-spin" size={20} color="var(--gold)" />
                          )
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 999, border: "1px dashed var(--line-2)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <Plus size={15} color="var(--text-3)" />
                            </div>
                            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Choose</span>
                          </div>
                        )}
                      </motion.button>
                      {val && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", textAlign: "center", marginTop: 8 }}>
                          {entryLabel(val)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </Section>

        {/* ---------- calendar ---------- */}
        <Section
          title="Your record"
          action={
            <button
              onClick={() => setCalView((v) => (v === "month" ? "year" : "month"))}
              className="u-tap"
              style={{
                background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)", borderRadius: 999,
                padding: "6px 13px", fontSize: 11, fontWeight: 600, color: "var(--text-2)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Calendar size={11} color="var(--gold)" />
              {calView === "month" ? "Year view" : "Month view"}
            </button>
          }
        >
          <Card style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              {calView === "month" ? (
                <>
                  <button onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month" className="u-tap" style={iconBtnStyle}>
                    <ChevronLeft size={15} color="var(--text-2)" />
                  </button>
                  <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>{monthLabel}</span>
                  <button onClick={() => setMonthOffset((o) => o + 1)} disabled={monthOffset >= 0} aria-label="Next month" className="u-tap"
                    style={{ ...iconBtnStyle, opacity: monthOffset >= 0 ? 0.3 : 1 }}>
                    <ChevronRight size={15} color="var(--text-2)" />
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600, margin: "0 auto" }}>{year}</span>
              )}
            </div>

            {calView === "month" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="u-eyebrow" style={{ textAlign: "center", fontSize: 8.5, marginBottom: 2 }}>{d}</div>
                  ))}
                  {cells.map((c, i) =>
                    c ? (
                      <motion.button
                        key={i}
                        onClick={() => { if (c.status === "future") return; setSelectedDate(c.ds); setPreviewDate(c.ds); }}
                        whileTap={c.status === "future" ? undefined : { scale: 0.9 }}
                        transition={SPRING}
                        disabled={c.status === "future"}
                        aria-label={`${c.ds}${c.status === "future" ? "" : ` — ${c.status}`}`}
                        className="u-tap"
                        style={{
                          position: "relative", aspectRatio: "1", borderRadius: 11, padding: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: c.status === "future" ? "transparent" : statusColorFor(c.status),
                          boxShadow: c.status === "full" ? "0 0 14px -5px rgba(243,201,140,0.8)" : "none",
                          border: c.ds === selectedDate
                            ? "1.5px solid var(--text)"
                            : c.status === "future" ? "1px solid rgba(255,255,255,0.03)" : "1px solid transparent",
                        }}
                      >
                        <span className="u-num" style={{
                          fontSize: 11, fontWeight: c.status === "full" ? 700 : 500,
                          color: c.status === "full" ? "#20150C"
                            : c.status === "future" ? "rgba(255,255,255,0.13)" : "var(--text-2)",
                        }}>
                          {c.day}
                        </span>
                        {c.hasPhoto && (
                          <span style={{
                            position: "absolute", bottom: 3, width: 3.5, height: 3.5, borderRadius: 999,
                            background: c.status === "full" ? "#20150C" : "var(--gold)",
                          }} />
                        )}
                      </motion.button>
                    ) : <div key={i} />
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 16, justifyContent: "center", flexWrap: "wrap" }}>
                  {[["full", "Full"], ["partial", "Partial"], ["none", "Missed"]].map(([k, label]) => (
                    <LegendDot key={k} color={statusColorFor(k)} label={label} />
                  ))}
                  <LegendDot color="var(--gold)" label="Photo" />
                </div>
              </>
            ) : (
              <YearOverview year={year} logs={logs} photoIndex={photoIndex} selectedDate={selectedDate}
                onPickDay={(ds) => { setSelectedDate(ds); setPreviewDate(ds); }} products={products} />
            )}
          </Card>

          {/* day preview */}
          <AnimatePresence>
            {previewDate && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 10 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: "hidden" }}
              >
                <Card style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div className="u-display" style={{ fontSize: 20, color: "var(--text)" }}>{prettyDate(previewDate)}</div>
                      <div style={{ display: "flex", gap: 12, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11.5, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Sun size={10} color="var(--gold)" /> {previewAmCount} checked
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Moon size={10} color="var(--moon)" /> {previewPmCount} checked
                        </span>
                        {(previewLog?.amMood || previewLog?.pmMood) && (
                          <span style={{ fontSize: 11.5, color: "var(--gold)" }}>
                            {[previewLog.amMood, previewLog.pmMood].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setPreviewDate(null)} aria-label="Close day preview" className="u-tap"
                      style={{ background: "none", border: "none", padding: 2, display: "flex" }}>
                      <X size={15} color="var(--text-3)" />
                    </button>
                  </div>

                  {previewPhotos.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      {previewPhotos.map((p) => (
                        <LazyPhoto key={entryKey(p)} date={p.date} period={p.period} id={p.id}
                          loadPhoto={loadPhoto} cached={photoCache[photoKey(p.date, p.period, p.id)]}
                          size={54} radius={12} tag={p.period.toUpperCase()} onClick={() => setViewing(p)} />
                      ))}
                    </div>
                  )}

                  <button onClick={() => setTab("today")} className="u-tap"
                    style={{ background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--gold)", fontSize: 12.5, fontWeight: 600 }}>
                    Open this day <ArrowRight size={12} />
                  </button>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        <Section title="Storage">
          <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} hint="Cleaning up old photos above is the quickest way to free space." />
        </Section>
      </Body>

      <AnimatePresence>
        {picking && (
          <Sheet onClose={() => setPicking(null)} z={155} maxHeight="78vh" labelledBy="picker-title">
            <SheetHeader
              id="picker-title"
              title="Choose a photo"
              subtitle={picking === "A" ? "This becomes the “before”." : "This becomes the “after”."}
              onClose={() => setPicking(null)}
            />

            <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
              {["date", "all"].map((pm) => (
                <Pill key={pm} active={pickerMode === pm} onClick={() => { setPickerMode(pm); setPickerDate(null); }}>
                  {pm === "date" ? "By date" : "All photos"}
                </Pill>
              ))}
            </div>

            {pickerMode === "all" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {entries.map((e) => (
                  <LazyPhoto
                    key={entryKey(e)}
                    date={e.date} period={e.period} id={e.id}
                    loadPhoto={loadPhoto}
                    cached={photoCache[photoKey(e.date, e.period, e.id)]}
                    aspect="3 / 4"
                    radius={12}
                    tag={`${e.date.slice(5)} ${e.period.toUpperCase()}`}
                    selected={sameEntry(e, picking === "A" ? compareA : compareB)}
                    onClick={() => pickPhoto(e)}
                  />
                ))}
              </div>
            )}

            {pickerMode === "date" && pickerDate === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dateGroups.map((g) => (
                  <button
                    key={g.date}
                    onClick={() => setPickerDate(g.date)}
                    className="u-tap"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "13px 15px", borderRadius: 14, border: "1px solid var(--line)",
                      background: "rgba(255,255,255,0.03)", textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{prettyDate(g.date)}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                        {g.am > 0 && (
                          <span style={{ fontSize: 10.5, color: "var(--gold)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Sun size={9} /> ×{g.am}
                          </span>
                        )}
                        {g.pm > 0 && (
                          <span style={{ fontSize: 10.5, color: "var(--moon)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Moon size={9} /> ×{g.pm}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-3)" />
                  </button>
                ))}
              </div>
            )}

            {pickerMode === "date" && pickerDate !== null && (
              <>
                <button onClick={() => setPickerDate(null)} className="u-tap"
                  style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16, background: "none", border: "none", padding: 0 }}>
                  <ChevronLeft size={15} color="var(--gold)" />
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{prettyDate(pickerDate)}</span>
                </button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {entries.filter((e) => e.date === pickerDate).map((e) => (
                    <LazyPhoto
                      key={entryKey(e)}
                      date={e.date} period={e.period} id={e.id}
                      loadPhoto={loadPhoto}
                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                      aspect="3 / 4"
                      radius={12}
                      tag={e.period.toUpperCase()}
                      selected={sameEntry(e, picking === "A" ? compareA : compareB)}
                      onClick={() => pickPhoto(e)}
                    />
                  ))}
                </div>
              </>
            )}
          </Sheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmCleanup && (
          <ConfirmModal
            title={`Delete ${plural(cleanupTargets.length, "photo")}?`}
            body="Every progress photo older than 90 days will be permanently removed. This can't be undone."
            confirmLabel="Delete them"
            onCancel={() => setConfirmCleanup(false)}
            onConfirm={deleteOlderThan90}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewing && (
          <Lightbox
            entry={viewing}
            label={entryLabel(viewing)}
            src={photoCache[photoKey(viewing.date, viewing.period, viewing.id)]}
            onClose={() => setViewing(null)}
            onDelete={() => { onDelete(viewing.date, viewing.period, viewing.id); setViewing(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }) {
  return (
    <Sheet onClose={onCancel} z={158} labelledBy="confirm-title">
      <div style={{ display: "flex", gap: 13, marginBottom: 18 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 999, flexShrink: 0,
          background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertTriangle size={17} color="var(--rose)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="confirm-title" className="u-display" style={{ fontSize: 21, color: "var(--text)", margin: 0 }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 7 }}>{body}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Keep them</GhostButton>
        <PrimaryButton tone="danger" onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ------------------------------ account + auth ------------------------------ */

// Google's mark, inline. The whole app is self-hosted and works offline; reaching out
// to a CDN for one 18px logo would be the only thing on the page that doesn't.
function GoogleMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.800000000000001l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 27.7c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5v-.3l-6.8-5.3-.2.1C2.9 16.3 2 20 2 23.9s.9 7.6 2.5 10.8l7-7z" />
      <path fill="#EA4335" d="M24 9.8c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.7 29.9 1.6 24 1.6 15.4 1.6 7.9 6.7 4.5 13.1l7 5.4C13.3 12.6 18.2 9.8 24 9.8z" />
    </svg>
  );
}

// Replaces the inert monogram that used to sit in the Routine header. Same 34px chip,
// now a real control that opens the account page.
function AccountButton({ monogram, avatarUrl, onClick }) {
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      aria-label="Your account"
      className="u-tap"
      style={{
        width: 34, height: 34, borderRadius: 999, border: "1px solid var(--line-3)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        overflow: "hidden", background: "rgba(10,7,5,0.42)", backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)", flexShrink: 0,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span className="u-display" style={{ fontSize: 15, color: "var(--gold)" }}>{monogram || "G"}</span>
      )}
    </motion.button>
  );
}

function SignInScreen({ onGoogle, onGuest, error, onDismissError }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    await onGoogle();
    // A successful sign-in navigates away, so reaching here means it didn't start.
    setBusy(false);
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", isolation: "isolate" }}>
      <img
        src={HERO_IMG} alt="" aria-hidden="true" className="u-hero-img"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "62% 42%" }}
      />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background:
          "radial-gradient(120% 80% at 8% 12%, rgba(10,7,5,0.94) 0%, rgba(10,7,5,0.62) 38%, rgba(10,7,5,0.08) 72%)," +
          "linear-gradient(180deg, rgba(10,7,5,0.55) 0%, rgba(10,7,5,0.10) 22%, rgba(10,7,5,0.72) 58%, var(--ink-0) 88%)",
      }} />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(70% 50% at 88% 6%, rgba(243,201,140,0.16), transparent 70%)",
        mixBlendMode: "screen",
      }} />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 24px calc(38px + env(safe-area-inset-bottom))" }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Droplet size={14} color="var(--gold)" strokeWidth={2} />
            <span className="u-eyebrow" style={{ color: "var(--gold)" }}>Skincare, kept honest</span>
          </div>
          <h1 className="u-display" style={{ fontSize: 46, color: "var(--text)", margin: 0, lineHeight: 1.02 }}>
            Welcome to<br />
            <span style={{ fontStyle: "italic", color: "var(--gold)" }}>Glass.</span>
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "16px 0 0", maxWidth: 280, lineHeight: 1.6 }}>
            Your AM and PM routine, every product on your shelf, and the progress to prove
            it's working — on every device you sign in from.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: 30 }}
        >
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24 }}
                role="alert"
                style={{ overflow: "hidden" }}
              >
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12,
                  padding: "11px 13px", borderRadius: 14,
                  background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.3)",
                }}>
                  <AlertTriangle size={14} color="var(--rose)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, flex: 1 }}>{error}</span>
                  <button onClick={onDismissError} aria-label="Dismiss" className="u-tap" style={{ background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                    <X size={13} color="var(--text-3)" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            onClick={go}
            disabled={busy}
            whileTap={busy ? undefined : { scale: 0.98 }}
            transition={SPRING}
            className="u-tap"
            style={{
              width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
              background: "linear-gradient(180deg, var(--gold), var(--gold-2))",
              color: "#20150C", fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
              boxShadow: "0 10px 24px -12px rgba(243,201,140,0.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <GoogleMark size={17} />}
            {busy ? "Opening Google…" : "Continue with Google"}
          </motion.button>

          <button
            onClick={onGuest}
            className="u-tap"
            style={{
              display: "block", width: "100%", marginTop: 16, padding: "8px 0",
              background: "none", border: "none",
              fontSize: 12.5, color: "var(--text-3)", fontWeight: 500,
            }}
          >
            Continue without an account
          </button>
          <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", margin: "4px 0 0", lineHeight: 1.55, opacity: 0.75 }}>
            Everything stays on this phone until you sign in.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// Settings row, built on the same recipe as the ExportSheet action card so the account
// page reads as part of the app rather than a bolted-on preferences pane.
function SettingRow({ icon: Icon, title, body, value, onClick, tone = "gold", disabled, danger }) {
  const Comp = onClick && !disabled ? motion.button : "div";
  const interactive = !!onClick && !disabled;
  return (
    <Comp
      {...(interactive ? { onClick, whileTap: { scale: 0.985 }, transition: SPRING, className: "u-tap" } : {})}
      style={{
        width: "100%", textAlign: "left", borderRadius: 18, padding: 16, marginBottom: 10,
        display: "flex", alignItems: "center", gap: 13,
        border: `1px solid ${danger ? "rgba(226,160,141,0.28)" : "var(--line)"}`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 999, flexShrink: 0,
        background: danger ? "var(--rose-wash)" : TONES[tone].wash2,
        border: `1px solid ${danger ? "rgba(226,160,141,0.3)" : "var(--line-2)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={16} color={danger ? "var(--rose)" : TONES[tone].fg} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: danger ? "var(--rose)" : "var(--text)", fontWeight: 600 }}>{title}</div>
        {body && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>{body}</div>}
      </div>
      {value && <span className="u-num" style={{ fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{value}</span>}
      {interactive && <ChevronRight size={15} color="var(--text-3)" style={{ flexShrink: 0 }} />}
    </Comp>
  );
}

const SYNC_COPY = {
  syncing: { icon: RefreshCw, tone: "gold", title: "Syncing…", body: "Sending your latest changes." },
  synced: { icon: Cloud, tone: "gold", title: "Everything's synced", body: "Your routine is safe on every device you sign in from." },
  offline: { icon: WifiOff, tone: "moon", title: "Offline", body: "Changes are saved on this phone and will sync when you're back." },
  error: { icon: CloudUpload, tone: "rose", title: "Couldn't sync", body: "Your data is safe here. Tap to try again." },
  idle: { icon: Cloud, tone: "gold", title: "Ready to sync", body: "Your routine syncs automatically as you use the app." },
};

function SyncStatusCard({ status, lastSyncedAt, onSyncNow }) {
  const spec = SYNC_COPY[status] || SYNC_COPY.idle;
  const Icon = spec.icon;
  const when = lastSyncedAt ? timeAgo(lastSyncedAt) : null;
  const body = status === "synced" && when ? `Last synced ${when}.` : spec.body;
  return (
    <SettingRow
      icon={Icon}
      tone={spec.tone}
      title={spec.title}
      body={body}
      onClick={status === "error" || status === "synced" || status === "idle" ? onSyncNow : undefined}
    />
  );
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 5400) return plural(Math.round(s / 60), "minute") + " ago";
  if (s < 86400) return plural(Math.round(s / 3600), "hour") + " ago";
  return plural(Math.round(s / 86400), "day") + " ago";
}

function DisplayNameSheet({ current, onSave, onClose }) {
  const [value, setValue] = useState(current || "");
  return (
    <Sheet onClose={onClose} z={155} labelledBy="name-title">
      <SheetHeader
        id="name-title"
        title="What should we call you?"
        subtitle="This is the name in your morning greeting."
        onClose={onClose}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={24}
        autoFocus
        aria-label="Display name"
        placeholder="Your name"
        style={{
          width: "100%", padding: "13px 14px", borderRadius: 14, marginBottom: 14,
          background: "rgba(255,255,255,0.04)", border: "1px solid var(--line-2)",
          color: "var(--text)", fontSize: 14,
        }}
      />
      <PrimaryButton onClick={() => { onSave(value); onClose(); }}>Save</PrimaryButton>
    </Sheet>
  );
}

/**
 * The guest-data-meets-account-data decision. It only ever appears on the first sign-in
 * from a phone that was already being used signed-out, and merging is offered first
 * because it's the only option that can't lose anything.
 */
function SyncChoiceSheet({ local, remote, onChoose }) {
  const count = (s) => {
    const days = Object.keys(s.logs || {}).length;
    const items = (s.products || []).length;
    return `${plural(items, "product")} · ${plural(days, "logged day")}`;
  };
  return (
    <Sheet onClose={() => onChoose("merge")} z={158} labelledBy="choice-title">
      <SheetHeader
        id="choice-title"
        title="Two sets of data"
        subtitle="This phone has a routine on it, and so does your account. Nothing is deleted until you pick."
        onClose={() => onChoose("merge")}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["On this phone", count(local)], ["In your account", count(remote)]].map(([label, sub]) => (
          <div key={label} style={{
            flex: 1, borderRadius: 16, padding: "12px 13px",
            border: "1px solid var(--line)", background: "rgba(255,255,255,0.03)",
          }}>
            <div className="u-eyebrow">{label}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
          </div>
        ))}
      </div>
      <PrimaryButton onClick={() => onChoose("merge")} style={{ marginBottom: 8 }}>Merge both</PrimaryButton>
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={() => onChoose("local")} style={{ flex: 1 }}>Keep this phone's</GhostButton>
        <GhostButton onClick={() => onChoose("remote")} style={{ flex: 1 }}>Use my account's</GhostButton>
      </div>
    </Sheet>
  );
}

function AccountView({
  profile, isGuest, authEnabled, displayName, greetingName, monogram,
  products, logs, syncStatus, lastSyncedAt, onSyncNow, onSetDisplayName,
  onExport, quotaUsedMB, quotaPct, onClose, onSignIn, onSignOut, onDeleteEverything,
}) {
  const reduce = useReducedMotion();
  const [showExport, setShowExport] = useState(false);
  const [showName, setShowName] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const stats = useMemo(() => {
    const dates = Object.keys(logs || {});
    const scored = dates.map((d) => dayCompletionPct(d, logs, products)).filter((p) => p > 0);
    const rate = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
    return { days: scored.length, streak: currentStreakDays(logs, products), rate };
  }, [logs, products]);

  const since = useMemo(() => {
    const iso = profile?.createdAt || Object.keys(logs || {}).sort()[0];
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [profile, logs]);

  const showAvatar = profile?.avatarUrl && !avatarBroken;

  return (
    <motion.div
      initial={{ x: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
      transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 330, damping: 36 }}
      role="dialog"
      aria-modal="true"
      aria-label="Your account"
      style={{
        position: "fixed", inset: 0, zIndex: 120, maxWidth: 480, margin: "0 auto",
        background: "var(--ink-0)", overflowY: "auto", WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{
        position: "sticky", top: 0, zIndex: 2,
        display: "flex", alignItems: "center", gap: 12,
        padding: "calc(16px + env(safe-area-inset-top)) 20px 14px",
        background: "linear-gradient(180deg, var(--ink-0) 62%, transparent)",
      }}>
        <button onClick={onClose} aria-label="Back" className="u-tap" style={iconBtnStyle}>
          <ArrowLeft size={15} color="var(--text-2)" />
        </button>
        <span className="u-eyebrow">Account</span>
      </div>

      <div style={{ padding: "6px 20px calc(40px + env(safe-area-inset-bottom))" }}>
        <Stagger>
          <StaggerItem>
            <div style={{ textAlign: "center", paddingBottom: 24 }}>
              <div style={{
                width: 78, height: 78, borderRadius: 999, margin: "0 auto 14px", overflow: "hidden",
                border: "1px solid var(--line-3)", background: "var(--gold-wash)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 14px 34px -18px rgba(243,201,140,0.5)",
              }}>
                {showAvatar ? (
                  <img
                    src={profile.avatarUrl} alt="" referrerPolicy="no-referrer"
                    onError={() => setAvatarBroken(true)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span className="u-display" style={{ fontSize: 32, color: "var(--gold)" }}>{monogram || "G"}</span>
                )}
              </div>
              {/* Mirrors the greeting's own fallback ("Good Morning, you.") rather than
                  announcing "Signed out" — the subtitle already says that, warmly. */}
              <div className="u-display" style={{ fontSize: 27, color: "var(--text)" }}>
                {greetingName || profile?.fullName || "You"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 6 }}>
                {isGuest ? "Not signed in — everything is on this phone" : profile?.email}
              </div>
              {since && (
                <div className="u-eyebrow" style={{ marginTop: 12 }}>Since {since}</div>
              )}
            </div>
          </StaggerItem>

          <StaggerItem>
            <div className="u-hairline" style={{ marginBottom: 20 }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 28 }}>
              <Stat value={stats.days} label="Days" size={30} />
              <Stat value={stats.streak} label="Streak" size={30} tone="gold" />
              <Stat value={stats.rate} unit="%" label="Completion" size={30} />
            </div>
          </StaggerItem>

          <StaggerItem>
            <Section title="Sync">
              {isGuest ? (
                <SettingRow
                  icon={CloudUpload}
                  title={authEnabled ? "Sign in with Google" : "Sync isn't set up on this build"}
                  body={authEnabled
                    ? "Back your routine up and pick it up on any other device."
                    : "This copy runs entirely on your device."}
                  onClick={authEnabled ? onSignIn : undefined}
                />
              ) : (
                <SyncStatusCard status={syncStatus} lastSyncedAt={lastSyncedAt} onSyncNow={onSyncNow} />
              )}
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section title="Preferences">
              <SettingRow
                icon={Pencil}
                title="Display name"
                body="The name in your morning greeting."
                value={displayName || greetingName || "Not set"}
                onClick={() => setShowName(true)}
              />
              <SettingRow
                icon={Download}
                title="Export your data"
                body="Every product, day, mood and note as JSON."
                onClick={() => setShowExport(true)}
              />
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section
              title="Storage"
              hint={isGuest
                ? "Photos live on this phone only. Sign in and they're backed up too."
                : "What's cached here for offline use — your photos are safe in the cloud."}
            >
              <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} />
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section title="Account">
              {!isGuest && (
                <SettingRow
                  icon={LogOut}
                  title="Sign out"
                  body="Your data stays on this phone for next time."
                  onClick={onSignOut}
                />
              )}
              <SettingRow
                icon={Trash2}
                danger
                title="Delete everything"
                body={isGuest
                  ? "Wipes every product, day and photo on this phone."
                  : "Wipes your routine here and in your account. This can't be undone."}
                onClick={() => setConfirmWipe(true)}
              />
            </Section>
          </StaggerItem>
        </Stagger>
      </div>

      <AnimatePresence>
        {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
      </AnimatePresence>
      <AnimatePresence>
        {showName && (
          <DisplayNameSheet
            current={displayName || greetingName}
            onSave={onSetDisplayName}
            onClose={() => setShowName(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmWipe && (
          <ConfirmModal
            title="Delete everything?"
            body={wipeError || (isGuest
              ? "Every product, logged day and progress photo on this phone will be permanently removed."
              : "Every product, logged day and progress photo will be permanently removed from this phone and from your account.")}
            confirmLabel={wiping ? "Deleting…" : "Delete it all"}
            onCancel={() => { setConfirmWipe(false); setWipeError(null); }}
            onConfirm={async () => {
              if (wiping) return;
              setWiping(true);
              setWipeError(null);
              const r = await onDeleteEverything();
              // A failed remote wipe leaves everything intact on purpose — say so rather
              // than reporting success and letting the next sync restore it all.
              if (r && r.ok === false) { setWipeError(r.error); setWiping(false); }
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* --------------------------------- tab bar --------------------------------- */

const TABS = [
  { id: "today", icon: Sun, label: "Routine" },
  { id: "shelf", icon: Layers, label: "Shelf" },
  { id: "insights", icon: ChartNoAxesColumn, label: "Insights" },
  // was a bare Circle, which said nothing about what the page is
  { id: "journey", icon: Images, label: "Journey" },
];

function TabBar({ tab, setTab }) {
  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 480, zIndex: 100, pointerEvents: "none",
      padding: "0 14px calc(12px + env(safe-area-inset-bottom))",
    }}>
      {/* fade so content dissolves under the bar instead of colliding with it */}
      <div aria-hidden="true" style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: 128,
        background: "linear-gradient(180deg, transparent, rgba(10,7,5,0.86) 42%, var(--ink-0) 78%)",
      }} />
      <nav
        className="u-frost"
        style={{
          position: "relative", pointerEvents: "auto",
          borderRadius: 22, padding: 6, display: "flex",
          border: "1px solid var(--line-2)",
          boxShadow: "0 18px 40px -18px rgba(0,0,0,0.95), 0 1px 0 rgba(255,255,255,0.05) inset",
        }}
      >
        <LayoutGroup id="tabbar">
          {TABS.map((it) => {
            const Icon = it.icon;
            const active = tab === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setTab(it.id)}
                aria-current={active ? "page" : undefined}
                className="u-tap"
                style={{
                  position: "relative", flex: 1, background: "none", border: "none",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                  padding: "10px 4px 8px", borderRadius: 17,
                  color: active ? "var(--gold)" : "var(--text-3)",
                  transition: "color 0.28s var(--ease)",
                }}
              >
                {/* the selected pill physically slides between tabs */}
                {active && (
                  <motion.div
                    layoutId="tab-pill"
                    transition={{ type: "spring", stiffness: 460, damping: 38 }}
                    style={{
                      position: "absolute", inset: 0, borderRadius: 17,
                      background: "linear-gradient(180deg, rgba(243,201,140,0.20), rgba(243,201,140,0.05))",
                      border: "1px solid rgba(243,201,140,0.28)",
                    }}
                  />
                )}
                <motion.span
                  animate={{ y: active ? -1 : 0, scale: active ? 1.06 : 1 }}
                  transition={SPRING}
                  style={{ position: "relative", display: "flex" }}
                >
                  <Icon size={18} strokeWidth={active ? 2.1 : 1.7}
                    style={active ? { filter: "drop-shadow(0 0 8px rgba(243,201,140,0.55))" } : undefined} />
                </motion.span>
                <span style={{
                  position: "relative", fontSize: 9.5, fontWeight: active ? 700 : 500,
                  letterSpacing: "0.09em", textTransform: "uppercase",
                }}>
                  {it.label}
                </span>
              </button>
            );
          })}
        </LayoutGroup>
      </nav>
    </div>
  );
}
