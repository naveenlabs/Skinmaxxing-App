import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase.js";
import { loadJSON, saveJSON } from "./store.js";
import { emptyMeta, mergeState, normalizeMeta, stampChanges, isEmptyState } from "./merge.js";

/*
  Local-first sync. localStorage stays the source of truth the UI reads and writes;
  Supabase is a replica that catches up in the background. Nothing here is ever allowed
  to block a tap, and every path works with the network off.

  Two invariants earn their keep:

  1. IDENTITY EPOCHS. Every piece of state here belongs to exactly one identity, and the
     hook refuses to do anything until the app confirms its local boot read finished *for
     that same identity* (`readyForRef.current === identityKey`). Without this, signing
     out of A and into B pushed A's documents into B's row — React state outlives the
     session change, and `ready` was never reset.

  2. OPTIMISTIC CONCURRENCY. A push is a conditional update keyed on the `updated_at` we
     last read. If another device wrote in between, the update matches no rows and we
     re-pull and merge instead of clobbering. A blind full-document upsert could erase a
     tombstone written elsewhere and resurrect a deleted product forever.
*/

const META_KEY = "nv-meta";
const PROFILE_KEY = "nv-profile";
const SYNCED_ONCE_KEY = "nv-synced-once";
const PUSH_DEBOUNCE_MS = 1200;
const REPULL_AFTER_MS = 30_000;
const MAX_CONFLICT_RETRIES = 3;
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
 * @param {boolean} enabled       signed in with a configured Supabase project
 * @param {string}  userId
 * @param {string}  identityKey   the epoch: userId, or "guest"
 * @param {object}  docsRef       ref holding { products, logs, photoIndex }
 * @param {object}  readyForRef   ref holding the identityKey the boot read completed for
 * @param {func}    applyRemote   writes merged docs to state + local storage WITHOUT
 *                                re-stamping them (that would ping-pong forever)
 */
export function useSync({ enabled, userId, identityKey, docsRef, readyForRef, applyRemote }) {
  const [status, setStatus] = useState("idle"); // idle | syncing | synced | offline | error
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [choice, setChoice] = useState(null); // { local, remote } while the user decides
  const [displayName, setDisplayNameState] = useState("");

  const metaRef = useRef(emptyMeta());
  const displayNameAtRef = useRef(0);
  const profileLoaded = useRef(false);
  const remoteUpdatedAt = useRef(null);
  const rowExists = useRef(false);
  const pushTimer = useRef(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const lastPullAt = useRef(0);
  const pendingChoice = useRef(null);
  const epochRef = useRef(identityKey);
  epochRef.current = identityKey;

  /** Nothing may touch the network until the local read for THIS identity has landed. */
  const inEpoch = useCallback(
    () => !!identityKey && readyForRef.current === identityKey,
    [identityKey, readyForRef]
  );

  /* ------------------------------- local meta ------------------------------- */

  useEffect(() => {
    let alive = true;
    // Reset first: everything below belongs to the previous identity until proven otherwise.
    profileLoaded.current = false;
    metaRef.current = emptyMeta();
    displayNameAtRef.current = 0;
    remoteUpdatedAt.current = null;
    rowExists.current = false;
    pendingChoice.current = null;
    setDisplayNameState("");
    setChoice(null);
    setLastSyncedAt(null);
    setStatus("idle");
    if (!identityKey) return undefined;

    (async () => {
      const [m, p] = await Promise.all([loadJSON(META_KEY, null), loadJSON(PROFILE_KEY, null)]);
      if (!alive || epochRef.current !== identityKey) return;
      metaRef.current = normalizeMeta(m);
      displayNameAtRef.current = Number(m?.displayNameAt) || 0;
      setDisplayNameState(p?.displayName || "");
      profileLoaded.current = true;
    })();
    return () => { alive = false; };
  }, [identityKey]);

  const saveMeta = useCallback(() => {
    saveJSON(META_KEY, { ...metaRef.current, displayNameAt: displayNameAtRef.current });
  }, []);

  /* --------------------------------- pushing -------------------------------- */

  const pullRef = useRef(null);

  /**
   * @param {object} [snapshot] documents to send. Defaults to the live ref, but callers
   *   that have just merged pass the merged result explicitly: applyRemote's setState
   *   has not re-rendered yet, so docsRef still holds the pre-merge documents and a
   *   blind read here would upload only half the merge.
   */
  const push = useCallback(async (snapshot, attempt = 0) => {
    if (!enabled || !userId || !supabase || !inEpoch()) return;
    if (pendingChoice.current) return; // the user hasn't decided what this device owns yet
    if (!isOnline()) { dirty.current = true; setStatus("offline"); return; }
    if (inFlight.current) { dirty.current = true; return; }

    const epoch = identityKey;
    inFlight.current = true;
    dirty.current = false;
    setStatus("syncing");

    const docs = snapshot || docsRef.current || {};
    const payload = {
      user_id: userId,
      products: docs.products ?? [],
      logs: docs.logs ?? {},
      photo_index: docs.photoIndex ?? {},
      meta: { ...metaRef.current, displayNameAt: displayNameAtRef.current },
    };
    // Only claim the display name once we've actually read it, or a push racing the
    // profile load would write null over the name stored in the account.
    if (profileLoaded.current) payload.display_name = displayName || null;

    try {
      let written;
      if (rowExists.current && remoteUpdatedAt.current) {
        const { data, error } = await supabase
          .from("user_state").update(payload)
          .eq("user_id", userId).eq("updated_at", remoteUpdatedAt.current)
          .select("updated_at").maybeSingle();
        if (error) throw error;
        if (!data) {
          // Another device wrote since our last read. Re-pull, merge, and let that push.
          inFlight.current = false;
          if (attempt >= MAX_CONFLICT_RETRIES) { setStatus("error"); return; }
          await pullRef.current?.({ force: true, conflictAttempt: attempt + 1 });
          return;
        }
        written = data;
      } else {
        const { data, error } = await supabase
          .from("user_state").upsert(payload, { onConflict: "user_id" })
          .select("updated_at").maybeSingle();
        if (error) throw error;
        written = data;
      }

      if (epochRef.current !== epoch) return;
      if (written?.updated_at) remoteUpdatedAt.current = written.updated_at;
      rowExists.current = true;
      setLastSyncedAt(Date.now());
      setStatus("synced");
    } catch (e) {
      console.warn("[glass] push failed:", e?.message || e);
      // Keep it dirty so the next online/visibility/edit event retries it, instead of
      // silently dropping the write until the user happens to touch something.
      dirty.current = true;
      setStatus(isOnline() ? "error" : "offline");
    } finally {
      inFlight.current = false;
      if (dirty.current && isOnline() && inEpoch()) {
        dirty.current = false;
        setTimeout(() => push(undefined, attempt), 800);
      }
    }
  }, [enabled, userId, identityKey, docsRef, displayName, inEpoch]);

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

  const pull = useCallback(async ({ force = false, conflictAttempt = 0 } = {}) => {
    if (!enabled || !userId || !supabase || !inEpoch()) return;
    if (!isOnline()) { setStatus("offline"); return; }
    if (!force && Date.now() - lastPullAt.current < REPULL_AFTER_MS) return;
    if (pendingChoice.current) return;

    const epoch = identityKey;
    setStatus("syncing");
    try {
      const { data, error } = await supabase
        .from("user_state").select(ROW).eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (epochRef.current !== epoch) return;

      // Only mark the pull successful once it actually succeeded, so a failure isn't
      // throttled for 30s as though it had worked.
      lastPullAt.current = Date.now();

      const docs = docsRef.current || {};
      const local = {
        products: docs.products ?? [],
        logs: docs.logs ?? {},
        photoIndex: docs.photoIndex ?? {},
        meta: metaRef.current,
      };

      if (!data) {
        rowExists.current = false;
        remoteUpdatedAt.current = null;
        await push(local, conflictAttempt);
        await saveJSON(SYNCED_ONCE_KEY, true);
        return;
      }

      rowExists.current = true;
      remoteUpdatedAt.current = data.updated_at;
      const remote = rowToState(data);
      const syncedBefore = await loadJSON(SYNCED_ONCE_KEY, false);
      if (epochRef.current !== epoch) return;

      // Guest data meeting account data for the first time is never merged silently —
      // App decides what to do with it (see the conversion flow).
      if (!syncedBefore && !isEmptyState(local) && !isEmptyState(remote)) {
        pendingChoice.current = { local, remote };
        setChoice({ local, remote });
        setStatus("idle");
        return;
      }

      if (remote.displayName && remote.displayNameAt >= displayNameAtRef.current) {
        displayNameAtRef.current = remote.displayNameAt;
        setDisplayNameState(remote.displayName);
        profileLoaded.current = true;
        saveJSON(PROFILE_KEY, { displayName: remote.displayName });
      }

      const merged = mergeState(local, remote);
      if (merged.differsFromLocal) await applyMerged(merged);
      else { metaRef.current = normalizeMeta(merged.meta); saveMeta(); }

      await saveJSON(SYNCED_ONCE_KEY, true);
      if (epochRef.current !== epoch) return;

      // Pass the merged documents explicitly — applyRemote's setState hasn't re-rendered
      // yet, so docsRef is still pre-merge.
      if (merged.differsFromRemote) {
        await push({ products: merged.products, logs: merged.logs, photoIndex: merged.photoIndex }, conflictAttempt);
      } else {
        setLastSyncedAt(Date.now());
        setStatus("synced");
      }
    } catch (e) {
      console.warn("[glass] pull failed:", e?.message || e);
      setStatus(isOnline() ? "error" : "offline");
    }
  }, [enabled, userId, identityKey, docsRef, push, applyMerged, saveMeta, inEpoch]);

  pullRef.current = pull;

  /** Resolve the guest-data-meets-account-data decision. */
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
      await saveJSON(SYNCED_ONCE_KEY, true);
      await push(pending.local);
      return;
    }
    const merged = mergeState(pending.local, pending.remote);
    if (merged.differsFromLocal) await applyMerged(merged);
    else { metaRef.current = normalizeMeta(merged.meta); saveMeta(); }
    await saveJSON(SYNCED_ONCE_KEY, true);
    await push({ products: merged.products, logs: merged.logs, photoIndex: merged.photoIndex });
  }, [applyMerged, push, saveMeta]);

  const setDisplayName = useCallback((name) => {
    const value = (name || "").trim();
    displayNameAtRef.current = Date.now();
    profileLoaded.current = true;
    setDisplayNameState(value);
    saveJSON(PROFILE_KEY, { displayName: value });
    saveMeta();
    schedulePush();
  }, [saveMeta, schedulePush]);

  /* -------------------------------- lifecycle ------------------------------- */

  // First pull once the session and the local boot read for THIS identity have settled.
  const firstPullFor = useRef(null);
  useEffect(() => {
    if (!enabled || !userId || !identityKey) return undefined;
    if (firstPullFor.current === identityKey) return undefined;
    let alive = true;
    const tick = setInterval(() => {
      if (!alive) return;
      if (readyForRef.current !== identityKey) return;
      clearInterval(tick);
      firstPullFor.current = identityKey;
      pullRef.current?.({ force: true });
    }, 60);
    return () => { alive = false; clearInterval(tick); };
  }, [enabled, userId, identityKey, readyForRef]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
      else {
        if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
        if (dirty.current || pushTimer.current) push();
      }
    };
    // Pull before pushing. The other order lets a device that was offline through a
    // deletion upload its stale documents first, erasing the tombstone and resurrecting
    // the deleted item everywhere.
    const onOnline = async () => { setStatus("syncing"); await pull({ force: true }); if (dirty.current) push(); };
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

  /** Wipe the account's row. Throws on failure so the caller can abort the local wipe. */
  const deleteRemote = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    const { error } = await supabase.from("user_state").delete().eq("user_id", userId);
    if (error) throw error;
    metaRef.current = emptyMeta();
    remoteUpdatedAt.current = null;
    rowExists.current = false;
    await saveJSON(META_KEY, emptyMeta());
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
