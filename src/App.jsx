/**
 * The application container.
 *
 * Everything stateful lives here: the documents (products, logs, photo index), the
 * boot read, and the wiring between them and the sync engine. The four tabs are
 * presentational — they receive data and callbacks and own no persistence of their
 * own, which is what keeps a rendering change from being able to corrupt stored data.
 *
 * Layers, outermost first:
 *   features/   one folder per tab, plus account
 *   components/ the design system, shared across features
 *   domain/     pure logic: streaks, completion, dates, export. No React.
 *   lib/        infrastructure: auth, sync, merge, storage, photos. No JSX.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useAuth } from "./lib/auth.js";
import { useSync } from "./lib/sync.js";
import { localPhotoKey, pickEvictions, usePhotoSync } from "./lib/photos.js";
import {
  LAST_UID_KEY,
  approxBytes,
  clearNamespace,
  getStore,
  guestDataSummary,
  guestHasData,
  importGuestData,
  loadJSON,
  readDeviceFlag,
  saveJSON,
  writeDeviceFlag,
} from "./lib/store.js";
import {
  clearPhotosForNamespace,
  deleteAvatar,
  deletePhotoKeys,
  importGuestPhotos,
  migrateLegacyPhotos,
  readAvatar,
  readPhoto,
  writeAvatar,
  writePhoto,
} from "./lib/photoStore.js";
import { estimateStorage } from "./lib/idb.js";
import {
  AlertTriangle,
  ChartNoAxesColumn,
  CircleCheck,
  Images,
  Layers,
  Loader2,
  Sun,
  WifiOff,
  X,
} from "lucide-react";
import { Shell } from "./components/primitives.jsx";
import { addDays, plural, todayStr, uid } from "./domain/dates.js";
import { computeExportData } from "./domain/exportData.js";
import { MAX_PHOTOS_PER_PICK, genPhotoId, photoKey } from "./domain/photos.js";
import { migrateProductStints } from "./domain/routine.js";
import {
  AccountView,
  GuestOfferSheet,
  SignInScreen,
  SyncChoiceSheet,
} from "./features/account/AccountView.jsx";
import { InsightsView } from "./features/insights/InsightsView.jsx";
import { JourneyView } from "./features/journey/JourneyView.jsx";
import { ProductsView } from "./features/shelf/ProductsView.jsx";
import { MoodModal, TodayView } from "./features/today/TodayView.jsx";
import { SPRING } from "./styles/theme.js";

// Only a fallback ceiling, used when the browser won't tell us the real one (older
// Safari has no StorageManager). Everywhere else the meter reports what the browser
// actually reports. The previous hardcoded 20MB was inherited from the Claude artifact
// runtime and was four times what localStorage actually allows.
const FALLBACK_QUOTA_MB = 50;

// The real ceiling for a signed-in account: the `limit_bytes` constant in the
// enforce_photo_quota trigger (docs/SETUP.md section 3) — this is what actually refuses
// a write, on Supabase's side, regardless of how much free disk this device has. Keep
// the two in sync if either changes.

// The real ceiling for a signed-in account: the `limit_bytes` constant in the
// enforce_photo_quota trigger (docs/SETUP.md section 3) — this is what actually refuses
// a write, on Supabase's side, regardless of how much free disk this device has. Keep
// the two in sync if either changes.
const ACCOUNT_PHOTO_QUOTA_MB = 200;

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
  const [avatarDataUrl, setAvatarDataUrl] = useState(null);
  const [guestOffer, setGuestOffer] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const avatarInputRef = useRef(null);

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
  const {
    queueUpload, fetchRemote, removeRemote, removeAllRemote, touch: touchPhoto,
    uploadAvatar, fetchAvatar, deleteRemoteAvatar,
  } = photoSync;

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
    setAvatarDataUrl(null);
    setGuestOffer(null);

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

        // Lift any photos an earlier build left in localStorage into IndexedDB. Safe to
        // run every boot: each photo moves independently and it's a no-op once empty.
        migrateLegacyPhotos().then((moved) => {
          if (moved) console.info(`[glass] moved ${moved} photo(s) to IndexedDB`);
        }).catch(() => {});
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
  }, [identityKey, reloadToken]);

  /* --------------------------------- avatar --------------------------------- */

  useEffect(() => {
    if (!identityKey || readyForRef.current !== identityKey) return undefined;
    let alive = true;
    const epoch = identityKey;
    (async () => {
      const local = await readAvatar();
      if (!alive || identityKeyRef.current !== epoch) return;
      if (local) setAvatarDataUrl(local); // instant paint — may be stale, cloud check below corrects it
      if (!cloudEnabled) return;
      const remote = await fetchAvatar();
      if (!alive || identityKeyRef.current !== epoch || !remote) return;
      // A different surface (installed PWA vs. browser tab) can hold its own stale local
      // cache forever if we stop here on a local hit — always trust the cloud once reachable.
      setAvatarDataUrl(remote);
      writeAvatar(remote).catch(() => {}); // refresh the cache so it still renders offline
    })();
    return () => { alive = false; };
  }, [identityKey, ready, cloudEnabled, fetchAvatar]);

  async function applyAvatar(file) {
    const r = await processAvatarFile(file);
    if (!r.ok) { setPhotoError(r.error); return; }
    // Local first so it appears instantly and survives with no network, then upstream.
    await writeAvatar(r.blob);
    setAvatarDataUrl(r.dataUrl);
    if (cloudEnabled) {
      const up = await uploadAvatar(r.blob);
      if (!up.ok) setPhotoError("Saved on this phone — couldn't upload it yet.");
    }
  }

  async function removeAvatarEverywhere() {
    await deleteAvatar();
    setAvatarDataUrl(null);
    if (cloudEnabled) {
      const r = await deleteRemoteAvatar();
      if (!r.ok) setPhotoError("Removed here — couldn't reach your account to remove it there.");
    }
  }

  /* ---------------------- guest data meeting an account ---------------------- */
  // Nothing is copied implicitly. Once the account's own data has loaded we can tell
  // whether this is a brand-new account (offer to bring the guest routine over) or an
  // established one (say plainly that the guest data was left alone).

  useEffect(() => {
    if (!cloudEnabled || !userId) return;
    if (readyForRef.current !== identityKey) return;
    if (guestOffer) return;
    if (readDeviceFlag(LAST_UID_KEY) === userId) return; // already answered on this device
    if (!guestHasData()) return;
    if (sync.status === "syncing" || sync.status === "idle") return; // let the first pull land

    const accountEmpty = products.length === 0 && Object.keys(logs).length === 0;
    setGuestOffer({ mode: accountEmpty ? "new" : "existing", summary: guestDataSummary() });
  }, [cloudEnabled, userId, identityKey, ready, sync.status, products, logs, guestOffer]);

  const answerGuestOffer = useCallback(async (bring) => {
    const uid = userId;
    setGuestOffer(null);
    if (!uid) return;
    if (bring) {
      const r = await importGuestData(uid);
      await importGuestPhotos(uid);
      if (!r.complete) setPhotoError(r.error || "Couldn't bring everything over.");
      setReloadToken((n) => n + 1); // re-read from the account namespace
    }
    // Either way, this device has now answered — don't ask again.
    writeDeviceFlag(LAST_UID_KEY, uid);
  }, [userId]);

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
    a.download = `skinmaxxing-export-${todayStr()}.json`;
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

    const local = await readPhoto(storageKeyFor(date, period, id));
    if (local) return adopt(local);

    // Not on this device — a new phone, or one that evicted it to stay under budget.
    const remote = await fetchRemote(date, period, id);
    if (remote) {
      writePhoto(storageKeyFor(date, period, id), remote).catch(() => {});
      return adopt(remote);
    }
    return null;
  }, [persistJSON, fetchRemote, touchPhoto]);

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
            const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
            // A Blob is what actually gets stored — base64 is a third larger and was the
            // reason photos were fighting the localStorage cap. The data URL is kept only
            // for the in-memory cache so the tile can paint immediately.
            canvas.toBlob(
              (blob) => resolve({ ok: true, dataUrl, blob: blob || null, id: genPhotoId() }),
              "image/jpeg", 0.72
            );
          } catch {
            resolve({ ok: false, error: "Something went wrong preparing that photo." });
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Same decode-then-commit shape as processPhotoFile: an unreadable or hostile file must
  // never be able to destroy the avatar that's already there. Centre-cropped square so the
  // circular frame never distorts, and re-encoded as JPEG so whatever was uploaded — SVG,
  // a renamed executable, an enormous PNG — is discarded rather than stored.
  const MAX_AVATAR_INPUT_BYTES = 12 * 1024 * 1024;
  function processAvatarFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve({ ok: false, error: null });
      if (!file.type || !file.type.startsWith("image/")) {
        return resolve({ ok: false, error: "That doesn't look like an image." });
      }
      if (file.size > MAX_AVATAR_INPUT_BYTES) {
        return resolve({ ok: false, error: "That image is too large — try one under 12MB." });
      }
      const reader = new FileReader();
      reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file — try again." });
      reader.onload = (e) => {
        const img = new window.Image();
        img.onerror = () => resolve({ ok: false, error: "Couldn't process that image." });
        img.onload = () => {
          try {
            const side = Math.min(img.width, img.height);
            const sx = (img.width - side) / 2;
            const sy = (img.height - side) / 2;
            const out = 512;
            const canvas = document.createElement("canvas");
            canvas.width = out; canvas.height = out;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            canvas.toBlob(
              (blob) => blob
                ? resolve({ ok: true, dataUrl, blob })
                : resolve({ ok: false, error: "Couldn't process that image." }),
              "image/jpeg", 0.85
            );
          } catch {
            resolve({ ok: false, error: "Couldn't process that image." });
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Writes already-decoded photos to storage and updates the index in one pass.
  async function commitPhotos(date, period, items) {
    const sizeAdds = {};
    pendingSaves.current += 1;
    setSaveStatus("saving");
    try {
      await Promise.all(items.map(async (it) => {
        const bytes = await writePhoto(`photo:${date}:${period}:${it.id}`, it.blob || it.dataUrl);
        sizeAdds[photoKey(date, period, it.id)] = bytes;
      }));
      finishSave(true);
    } catch (e) {
      console.warn("[glass] photo write failed:", e?.message || e);
      finishSave(false);
      setPhotoError("Couldn't save that photo — this device may be out of space.");
      return;
    }

    const cacheAdds = {};
    items.forEach((it) => { cacheAdds[photoKey(date, period, it.id)] = it.dataUrl; });
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
    await deletePhotoKeys(list.map(({ date, period, id }) => storageKeyFor(date, period, id)));

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

  // ---- storage ----
  // Our own accounting, which is all we can attribute to *this* namespace.
  const photoBytesUsed = Object.values(photoSizes).reduce((a, b) => a + b, 0);
  const dataBytesUsed = approxBytes(JSON.stringify(products)) + approxBytes(JSON.stringify(logs))
    + approxBytes(JSON.stringify(photoIndex)) + approxBytes(JSON.stringify(photoSizes));
  const ownBytes = photoBytesUsed + dataBytesUsed;

  // What the browser says it's actually holding and actually allows. Asking beats
  // guessing: the old meter reported a fixed 20MB ceiling that no browser ever offered.
  const [storageEstimate, setStorageEstimate] = useState(null);
  const refreshStorage = useCallback(async () => {
    const est = await estimateStorage();
    setStorageEstimate(est);
  }, []);
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(refreshStorage, 400);
    return () => clearTimeout(t);
  }, [ready, ownBytes, refreshStorage]);

  const MB = 1024 * 1024;
  // Signed in (or offline with a cached session), the number that matters is the real
  // server-enforced cap, not what this particular device's disk happens to allow —
  // navigator.storage.estimate().quota answers "how much could this origin theoretically
  // use," which on a phone with space free reads in the tens of GB. That mismatch is
  // exactly what showed "38.4 GB" to someone whose account is actually capped at 200MB.
  // Guest data never reaches a server, so for a guest the browser's own grant IS the real
  // ceiling, and asking beats guessing (see FALLBACK_QUOTA_MB above).
  const hasAccount = cloudEnabled || auth.offline;
  const quotaUsedMB = ownBytes / MB;
  const quotaTotalMB = hasAccount
    ? ACCOUNT_PHOTO_QUOTA_MB
    : (storageEstimate ? storageEstimate.quota / MB : FALLBACK_QUOTA_MB);
  const quotaPct = Math.min(100, quotaTotalMB ? (quotaUsedMB / quotaTotalMB) * 100 : 0);

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
    // Target 70% of whatever the browser actually allows, minus the non-photo data.
    const budget = quotaTotalMB * MB * 0.7 - dataBytesUsed;
    const keep = new Set(
      ["am", "pm"].flatMap((p) => (photoIndexRef.current[selectedDate]?.[p] || [])
        .map((id) => photoKey(selectedDate, p, id)))
    );
    const drop = pickEvictions(photoSizesRef.current, photoSync.atimes.current, Math.max(budget, 0), keep);
    if (!drop.length) return;

    (async () => {
      const nextSizes = { ...photoSizesRef.current };
      await deletePhotoKeys(drop.map((ck) => {
        const [date, period, id] = ck.split(":");
        return storageKeyFor(date, period, id);
      }));
      drop.forEach((ck) => { delete nextSizes[ck]; });
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
            SKINMAXXING
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
  const monogram = (greetingName || auth.profile?.email || "S").trim().charAt(0).toUpperCase();
  // A custom upload always wins — this is the same priority AccountView uses, so the
  // Today page's button stops showing Google's photo (or nothing) after someone sets one.
  const avatarUrl = avatarDataUrl || auth.profile?.avatarUrl || "";

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
          quotaTotalMB={quotaTotalMB}
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
          quotaTotalMB={quotaTotalMB}
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
            mode={auth.status === "guest" ? "guest" : (auth.status === "offline-unverified" ? "offline" : "account")}
            authEnabled={auth.authEnabled}
            avatarDataUrl={avatarDataUrl}
            onPickAvatar={() => avatarInputRef.current && avatarInputRef.current.click()}
            onRemoveAvatar={removeAvatarEverywhere}
            onExitGuest={async () => { setAccountOpen(false); await auth.exitGuest(); }}
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
            quotaTotalMB={quotaTotalMB}
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
              await clearPhotosForNamespace();
              await clearNamespace(userId, photoKeys);
              setAccountOpen(false);
              // Wiping the data isn't enough on its own — a live Supabase session survives
              // it, so the reload below would just sign the same account back into its own
              // now-empty namespace instead of returning to the sign-in screen. Awaited so
              // the session is actually cleared from storage before the page unloads.
              if (auth.isGuest) await auth.exitGuest();
              else await auth.signOut();
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

      <AnimatePresence>
        {guestOffer && (
          <GuestOfferSheet mode={guestOffer.mode} summary={guestOffer.summary} onAnswer={answerGuestOffer} />
        )}
      </AnimatePresence>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = (e.target.files || [])[0];
          e.target.value = "";
          if (file) await applyAvatar(file);
        }}
      />

      <PhotoErrorToast message={photoError} onDismiss={() => setPhotoError(null)} />
      <SaveStatus status={saveStatus} />
      {!accountOpen && <TabBar tab={tab} setTab={setTab} />}
    </Shell>
  );
}

// Photo errors used to render only inside JourneyView, so a failed upload started from
// the Routine tab's camera button reported nothing at all. This is app-level.
