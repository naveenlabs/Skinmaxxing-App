import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase.js";
import { loadJSON, saveJSON } from "./store.js";
import { emptyMeta, mergeState, normalizeMeta, stampChanges, isEmptyState } from "./merge.js";

/*
  Local-first sync. localStorage stays the source of truth the UI reads and writes;
  Supabase is a replica that catches up in the background. Nothing here is ever
  allowed to block a tap, and every path works with the network off.

  The one ambiguous case — signing in on a phone that already has data, into an
  account that also already has data — isn't guessed at. It's handed back to the app
  as `choice`, which puts a sheet in front of the user.
*/

const META_KEY = "nv-meta";
const PROFILE_KEY = "nv-profile";
const SYNCED_ONCE_KEY = "nv-synced-once";
const PUSH_DEBOUNCE_MS = 1200;
const REPULL_AFTER_MS = 30_000;
const ROW = "user_id, display_name, products, logs, photo_index, meta, updated_at";

const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

function rowToState(row) {
  return {
    products: Array.isArray(row?.products) ? row.products : [],
    logs: row?.logs && typeof row.logs === "object" ? row.logs : {},
    photoIndex: row?.photo_index && typeof row.photo_index === "object" ? row.photo_index : {},
    meta: normalizeMeta(row?.meta),
    displayName: row?.display_name || "",
    displayNameAt: Number(row?.meta?.displayNameAt) || 0,
  };
}

/**
 * @param {boolean} enabled   signed in with a configured Supabase project
 * @param {string}  userId
 * @param {object}  docsRef   ref holding { products, logs, photoIndex } — always current
 * @param {object}  readyRef  ref: false until the app has finished its local boot read
 * @param {func}    applyRemote  writes merged docs to state + local storage WITHOUT
 *                               re-stamping them (that would ping-pong forever)
 */
export function useSync({ enabled, userId, docsRef, readyRef, applyRemote }) {
  const [status, setStatus] = useState("idle"); // idle | syncing | synced | offline | error
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [choice, setChoice] = useState(null); // { local, remote } while the user decides
  const [displayName, setDisplayNameState] = useState("");

  const metaRef = useRef(emptyMeta());
  const displayNameAtRef = useRef(0);
  const pushTimer = useRef(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const lastPullAt = useRef(0);
  const pendingChoice = useRef(null);

  /* ------------------------------- local meta ------------------------------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      const [m, p] = await Promise.all([loadJSON(META_KEY, null), loadJSON(PROFILE_KEY, null)]);
      if (!alive) return;
      metaRef.current = normalizeMeta(m);
      displayNameAtRef.current = Number(m?.displayNameAt) || 0;
      if (p?.displayName) setDisplayNameState(p.displayName);
    })();
    return () => { alive = false; };
  }, [userId]);

  const saveMeta = useCallback(() => {
    saveJSON(META_KEY, { ...metaRef.current, displayNameAt: displayNameAtRef.current });
  }, []);

  /* --------------------------------- pushing -------------------------------- */

  const push = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    if (!isOnline()) { setStatus("offline"); return; }
    if (inFlight.current) { dirty.current = true; return; }

    inFlight.current = true;
    dirty.current = false;
    setStatus("syncing");
    const docs = docsRef.current || {};
    try {
      const { error } = await supabase.from("user_state").upsert({
        user_id: userId,
        products: docs.products ?? [],
        logs: docs.logs ?? {},
        photo_index: docs.photoIndex ?? {},
        meta: { ...metaRef.current, displayNameAt: displayNameAtRef.current },
        display_name: displayName || null,
      }, { onConflict: "user_id" });
      if (error) throw error;
      setLastSyncedAt(Date.now());
      setStatus("synced");
    } catch (e) {
      console.warn("[glass] push failed:", e?.message || e);
      setStatus(isOnline() ? "error" : "offline");
    } finally {
      inFlight.current = false;
      if (dirty.current) { dirty.current = false; push(); }
    }
  }, [enabled, userId, docsRef, displayName]);

  const schedulePush = useCallback(() => {
    if (!enabled) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => { pushTimer.current = null; push(); }, PUSH_DEBOUNCE_MS);
  }, [enabled, push]);

  /**
   * Called by the app right after it writes a document locally. Diffing against the
   * previous value is what keeps every mutation site in App.jsx untouched.
   */
  const recordChange = useCallback((kind, prevDoc, nextDoc) => {
    metaRef.current = stampChanges(kind, prevDoc, nextDoc, metaRef.current);
    saveMeta();
    schedulePush();
  }, [saveMeta, schedulePush]);

  /* --------------------------------- pulling -------------------------------- */

  const applyMerged = useCallback(async (merged) => {
    metaRef.current = normalizeMeta(merged.meta);
    saveMeta();
    await applyRemote({ products: merged.products, logs: merged.logs, photoIndex: merged.photoIndex });
  }, [applyRemote, saveMeta]);

  const pull = useCallback(async ({ force = false } = {}) => {
    if (!enabled || !userId || !supabase) return;
    if (!readyRef.current) return;
    if (!isOnline()) { setStatus("offline"); return; }
    if (!force && Date.now() - lastPullAt.current < REPULL_AFTER_MS) return;
    if (pendingChoice.current) return;

    lastPullAt.current = Date.now();
    setStatus("syncing");
    try {
      const { data, error } = await supabase
        .from("user_state").select(ROW).eq("user_id", userId).maybeSingle();
      if (error) throw error;

      const docs = docsRef.current || {};
      const local = {
        products: docs.products ?? [],
        logs: docs.logs ?? {},
        photoIndex: docs.photoIndex ?? {},
        meta: metaRef.current,
      };

      if (!data) {
        // First device on this account: seed the row from what's already here.
        await push();
        await saveJSON(SYNCED_ONCE_KEY, true);
        return;
      }

      const remote = rowToState(data);
      const syncedBefore = await loadJSON(SYNCED_ONCE_KEY, false);

      // Guest data meeting account data for the first time is the one case where
      // merging silently could surprise someone. Ask instead.
      if (!syncedBefore && !isEmptyState(local) && !isEmptyState(remote)) {
        const merged = mergeState(local, remote);
        if (merged.differsFromLocal || merged.differsFromRemote) {
          pendingChoice.current = { local, remote };
          setChoice({ local, remote });
          setStatus("idle");
          return;
        }
      }

      if (remote.displayName && remote.displayNameAt >= displayNameAtRef.current) {
        displayNameAtRef.current = remote.displayNameAt;
        setDisplayNameState(remote.displayName);
        saveJSON(PROFILE_KEY, { displayName: remote.displayName });
      }

      const merged = mergeState(local, remote);
      if (merged.differsFromLocal) await applyMerged(merged);
      else { metaRef.current = normalizeMeta(merged.meta); saveMeta(); }

      await saveJSON(SYNCED_ONCE_KEY, true);

      if (merged.differsFromRemote) await push();
      else { setLastSyncedAt(Date.now()); setStatus("synced"); }
    } catch (e) {
      console.warn("[glass] pull failed:", e?.message || e);
      setStatus(isOnline() ? "error" : "offline");
    }
  }, [enabled, userId, docsRef, readyRef, push, applyMerged, saveMeta]);

  /** Resolve the guest-data-meets-account-data sheet. */
  const resolveChoice = useCallback(async (mode) => {
    const pending = pendingChoice.current;
    pendingChoice.current = null;
    setChoice(null);
    if (!pending) return;

    if (mode === "remote") {
      await applyMerged({ ...pending.remote, meta: pending.remote.meta });
      await saveJSON(SYNCED_ONCE_KEY, true);
      setLastSyncedAt(Date.now());
      setStatus("synced");
      return;
    }
    if (mode === "local") {
      // Keep this phone's data and make the account match it.
      await saveJSON(SYNCED_ONCE_KEY, true);
      await push();
      return;
    }
    const merged = mergeState(pending.local, pending.remote);
    if (merged.differsFromLocal) await applyMerged(merged);
    else { metaRef.current = normalizeMeta(merged.meta); saveMeta(); }
    await saveJSON(SYNCED_ONCE_KEY, true);
    await push();
  }, [applyMerged, push, saveMeta]);

  const setDisplayName = useCallback((name) => {
    const value = (name || "").trim();
    displayNameAtRef.current = Date.now();
    setDisplayNameState(value);
    saveJSON(PROFILE_KEY, { displayName: value });
    saveMeta();
    schedulePush();
  }, [saveMeta, schedulePush]);

  /* -------------------------------- lifecycle ------------------------------- */

  // First pull once both the session and the local boot read have settled. Guarded by a
  // ref rather than the effect's own deps: `pull` changes identity whenever the display
  // name does, and without this the first pull would re-arm every time it adopted one.
  const firstPullFor = useRef(null);
  const pullRef = useRef(pull);
  pullRef.current = pull;

  useEffect(() => {
    if (!enabled || !userId) return;
    if (firstPullFor.current === userId) return;
    let alive = true;
    const tick = setInterval(() => {
      if (!alive) return;
      if (!readyRef.current) return;
      clearInterval(tick);
      firstPullFor.current = userId;
      pullRef.current({ force: true });
    }, 60);
    return () => { alive = false; clearInterval(tick); };
  }, [enabled, userId, readyRef]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
      else if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; push(); }
    };
    const onOnline = () => { setStatus("syncing"); push(); pull({ force: true }); };
    const onOffline = () => setStatus("offline");

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!isOnline()) setStatus("offline");
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled, pull, push]);

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current); }, []);

  /** Wipe the account's row. Local wiping is the app's job. */
  const deleteRemote = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    metaRef.current = emptyMeta();
    await saveJSON(META_KEY, emptyMeta());
    await supabase.from("user_state").delete().eq("user_id", userId);
  }, [enabled, userId]);

  return {
    status: enabled ? status : "off",
    lastSyncedAt,
    choice,
    resolveChoice,
    recordChange,
    displayName,
    setDisplayName,
    syncNow: useCallback(() => pull({ force: true }), [pull]),
    deleteRemote,
  };
}
