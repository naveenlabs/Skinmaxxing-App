import { useCallback, useEffect, useRef } from "react";
import { supabase, PHOTO_BUCKET, AVATAR_BUCKET } from "./supabase.js";
import { loadJSON, saveJSON, getStore, approxBytes } from "./store.js";

/*
  Progress photos are the one thing too big to keep in a jsonb document, so they go to
  Supabase Storage while everything else syncs through user_state.

  The device still writes every photo locally first — that's what makes capture feel
  instant and keeps Journey working on a plane. Uploads AND deletes are queued behind it
  and retried on the next boot or reconnect, so closing the app mid-operation costs
  nothing and a delete made offline doesn't leave an orphan in the bucket forever.
*/

const QUEUE_KEY = "nv-photo-pending";
const DELETE_QUEUE_KEY = "nv-photo-deletes";
const ATIME_KEY = "nv-photo-atime";

export function photoPath(uid, date, period, id) {
  return `${uid}/${date}/${period}/${id}.jpg`;
}

/** Local storage key for a photo, including the two pre-multi-photo id shapes. */
export function localPhotoKey(date, period, id) {
  if (id === "__single__") return `photo:${date}:${period}`;
  if (id === "__legacy__") return `photo:${date}`;
  return `photo:${date}:${period}:${id}`;
}

export function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(",");
  const mime = (/data:([^;]+)/.exec(header) || [])[1] || "image/jpeg";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** A downloaded object is only usable if it really is an image with bytes in it. */
export function isImageBlob(b) {
  return !!b && typeof b.size === "number" && b.size > 0
    && typeof b.type === "string" && b.type.startsWith("image/");
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Which locally cached photos to drop to get back under budget: oldest touched first,
 * never anything still waiting to upload. Only safe to call when signed in — the cloud
 * copy is what makes eviction lossless.
 */
export function pickEvictions(sizes, atimes, budgetBytes, keep = new Set()) {
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  if (total <= budgetBytes) return [];
  const candidates = Object.keys(sizes)
    .filter((k) => !keep.has(k))
    .sort((a, b) => (atimes[a] || 0) - (atimes[b] || 0));
  const drop = [];
  let freed = 0;
  for (const k of candidates) {
    if (total - freed <= budgetBytes) break;
    drop.push(k);
    freed += sizes[k] || 0;
  }
  return drop;
}

export function usePhotoSync({ enabled, userId, identityKey }) {
  const queueRef = useRef({});
  const deleteQueueRef = useRef([]);
  const atimeRef = useRef({});
  const flushing = useRef(false);
  const epochRef = useRef(identityKey);
  epochRef.current = identityKey;

  useEffect(() => {
    let alive = true;
    // Reset before loading: these queues belong to one identity's namespace.
    queueRef.current = {};
    deleteQueueRef.current = [];
    atimeRef.current = {};
    if (!identityKey) return undefined;

    (async () => {
      const [q, d, a] = await Promise.all([
        loadJSON(QUEUE_KEY, {}), loadJSON(DELETE_QUEUE_KEY, []), loadJSON(ATIME_KEY, {}),
      ]);
      if (!alive || epochRef.current !== identityKey) return;
      // Merge rather than replace: a photo saved while this read was in flight has
      // already put itself in the queue, and overwriting would drop it silently — with
      // the backfill flag set, nothing would ever rescan it.
      queueRef.current = { ...(q && typeof q === "object" ? q : {}), ...queueRef.current };
      deleteQueueRef.current = [...(Array.isArray(d) ? d : []), ...deleteQueueRef.current];
      atimeRef.current = { ...(a && typeof a === "object" ? a : {}), ...atimeRef.current };
    })();
    return () => { alive = false; };
  }, [identityKey]);

  const touch = useCallback((key) => {
    atimeRef.current = { ...atimeRef.current, [key]: Date.now() };
    saveJSON(ATIME_KEY, atimeRef.current);
  }, []);

  const flush = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    if (flushing.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const epoch = identityKey;

    flushing.current = true;
    try {
      // Deletes first: they free quota and can't be undone by a later upload.
      const pendingDeletes = [...deleteQueueRef.current];
      if (pendingDeletes.length) {
        try {
          const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(pendingDeletes);
          if (error) throw error;
          if (epochRef.current !== epoch) return;
          deleteQueueRef.current = deleteQueueRef.current.filter((p) => !pendingDeletes.includes(p));
          await saveJSON(DELETE_QUEUE_KEY, deleteQueueRef.current);
        } catch (e) {
          console.warn("[glass] photo delete deferred:", e?.message || e);
        }
      }

      const store = getStore();
      for (const key of Object.keys(queueRef.current)) {
        if (epochRef.current !== epoch) return;
        const [date, period, id] = key.split(":");
        try {
          const r = store ? await store.get(localPhotoKey(date, period, id)) : null;
          if (!r || !r.value) { delete queueRef.current[key]; continue; }
          const { error } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(photoPath(userId, date, period, id), dataUrlToBlob(r.value), {
              contentType: "image/jpeg", upsert: true,
            });
          if (error) throw error;
          delete queueRef.current[key];
        } catch (e) {
          // Leave it queued and stop; the next boot or reconnect picks it up.
          console.warn("[glass] photo upload deferred:", e?.message || e);
          break;
        }
      }
      if (epochRef.current === epoch) await saveJSON(QUEUE_KEY, queueRef.current);
    } finally {
      flushing.current = false;
    }
  }, [enabled, userId, identityKey]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const t = setTimeout(flush, 1500);
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    return () => { clearTimeout(t); window.removeEventListener("online", onOnline); };
  }, [enabled, userId, flush]);

  const queueUpload = useCallback((date, period, id) => {
    if (!enabled || !userId) return;
    queueRef.current = { ...queueRef.current, [`${date}:${period}:${id}`]: 1 };
    saveJSON(QUEUE_KEY, queueRef.current);
    setTimeout(flush, 250);
  }, [enabled, userId, flush]);

  /** Pull one photo down from Storage. Returns a data URL, or null if it isn't there. */
  const fetchRemote = useCallback(async (date, period, id) => {
    if (!enabled || !userId || !supabase) return null;
    try {
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET).download(photoPath(userId, date, period, id));
      if (error || !isImageBlob(data)) return null;
      return await blobToDataUrl(data);
    } catch { return null; }
  }, [enabled, userId]);

  const removeRemote = useCallback(async (list) => {
    if (!enabled || !userId || !supabase || !list.length) return;
    let queueChanged = false;
    list.forEach(({ date, period, id }) => {
      const k = `${date}:${period}:${id}`;
      if (queueRef.current[k]) { delete queueRef.current[k]; queueChanged = true; }
    });
    if (queueChanged) await saveJSON(QUEUE_KEY, queueRef.current);

    const paths = list.map(({ date, period, id }) => photoPath(userId, date, period, id));
    try {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
      if (error) throw error;
    } catch (e) {
      // Queue it. Previously this was a bare console.warn, so a photo deleted offline
      // stayed in the bucket forever with nothing left pointing at it.
      console.warn("[glass] remote photo delete deferred:", e?.message || e);
      deleteQueueRef.current = [...new Set([...deleteQueueRef.current, ...paths])];
      await saveJSON(DELETE_QUEUE_KEY, deleteQueueRef.current);
    }
  }, [enabled, userId]);

  /** Throws on failure so "Delete everything" can abort before wiping local. */
  const removeAllRemote = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    const paths = [];
    let offset = 0;
    // Storage has no recursive delete, so walk the user's folder a level at a time.
    for (;;) {
      const { data: dates, error } = await supabase.storage
        .from(PHOTO_BUCKET).list(userId, { limit: 100, offset });
      if (error) throw error;
      if (!dates || !dates.length) break;
      for (const d of dates) {
        for (const period of ["am", "pm"]) {
          const { data: files, error: e2 } = await supabase.storage
            .from(PHOTO_BUCKET).list(`${userId}/${d.name}/${period}`, { limit: 1000 });
          if (e2) throw e2;
          (files || []).forEach((f) => paths.push(`${userId}/${d.name}/${period}/${f.name}`));
        }
      }
      if (dates.length < 100) break;
      offset += dates.length;
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
    queueRef.current = {};
    deleteQueueRef.current = [];
    await Promise.all([saveJSON(QUEUE_KEY, {}), saveJSON(DELETE_QUEUE_KEY, [])]);
  }, [enabled, userId]);

  /* ---------------------------------- avatar ---------------------------------- */
  // Its own bucket with its own size and MIME limits, and a path keyed on the user id so
  // storage RLS can enforce that nobody can read or overwrite anyone else's.

  const avatarPath = useCallback(() => `${userId}/avatar.jpg`, [userId]);

  const uploadAvatar = useCallback(async (blob) => {
    if (!enabled || !userId || !supabase) return { ok: true, local: true };
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(avatarPath(), blob, { contentType: "image/jpeg", upsert: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, [enabled, userId, avatarPath]);

  const fetchAvatar = useCallback(async () => {
    if (!enabled || !userId || !supabase) return null;
    try {
      const { data, error } = await supabase.storage.from(AVATAR_BUCKET).download(avatarPath());
      // Don't trust the response to be an image just because it was a 200 — an error
      // body would otherwise be turned into a data URL and rendered as a broken avatar.
      if (error || !isImageBlob(data)) return null;
      return await blobToDataUrl(data);
    } catch { return null; }
  }, [enabled, userId, avatarPath]);

  const deleteRemoteAvatar = useCallback(async () => {
    if (!enabled || !userId || !supabase) return { ok: true };
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath()]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, [enabled, userId, avatarPath]);

  const pendingCount = useCallback(
    () => Object.keys(queueRef.current).length + deleteQueueRef.current.length, []
  );

  return {
    queueUpload, fetchRemote, removeRemote, removeAllRemote, touch, atimes: atimeRef,
    pendingCount, flush, uploadAvatar, fetchAvatar, deleteRemoteAvatar,
  };
}

export { approxBytes };
