import { useCallback, useEffect, useRef } from "react";
import { supabase, PHOTO_BUCKET } from "./supabase.js";
import { loadJSON, saveJSON, getStore, approxBytes } from "./store.js";

/*
  Progress photos are the one thing too big to keep in a jsonb document, so they go to
  Supabase Storage while everything else syncs through user_state.

  The device still writes every photo locally first — that's what makes capture feel
  instant and keeps Journey working on a plane. The upload is queued behind it and
  retried on the next boot or the next time the network returns, so closing the app
  mid-upload costs nothing.
*/

const QUEUE_KEY = "nv-photo-pending";
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

export function usePhotoSync({ enabled, userId }) {
  const queueRef = useRef({});
  const flushing = useRef(false);
  const atimeRef = useRef({});
  const loadedFor = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [q, a] = await Promise.all([loadJSON(QUEUE_KEY, {}), loadJSON(ATIME_KEY, {})]);
      if (!alive) return;
      queueRef.current = q && typeof q === "object" ? q : {};
      atimeRef.current = a && typeof a === "object" ? a : {};
      loadedFor.current = userId || "guest";
    })();
    return () => { alive = false; };
  }, [userId]);

  const touch = useCallback((key) => {
    atimeRef.current = { ...atimeRef.current, [key]: Date.now() };
    saveJSON(ATIME_KEY, atimeRef.current);
  }, []);

  const flush = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    if (flushing.current) return;
    const pending = Object.keys(queueRef.current);
    if (!pending.length) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    flushing.current = true;
    try {
      const store = getStore();
      for (const key of pending) {
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
      await saveJSON(QUEUE_KEY, queueRef.current);
    } finally {
      flushing.current = false;
    }
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
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
      if (error || !data) return null;
      return await blobToDataUrl(data);
    } catch { return null; }
  }, [enabled, userId]);

  const removeRemote = useCallback(async (list) => {
    if (!enabled || !userId || !supabase || !list.length) return;
    let changed = false;
    list.forEach(({ date, period, id }) => {
      const k = `${date}:${period}:${id}`;
      if (queueRef.current[k]) { delete queueRef.current[k]; changed = true; }
    });
    if (changed) await saveJSON(QUEUE_KEY, queueRef.current);
    try {
      await supabase.storage.from(PHOTO_BUCKET)
        .remove(list.map(({ date, period, id }) => photoPath(userId, date, period, id)));
    } catch (e) { console.warn("[glass] remote photo delete failed:", e?.message || e); }
  }, [enabled, userId]);

  const removeAllRemote = useCallback(async () => {
    if (!enabled || !userId || !supabase) return;
    queueRef.current = {};
    await saveJSON(QUEUE_KEY, {});
    try {
      // Storage has no recursive delete, so walk the user's folder a level at a time.
      const paths = [];
      const { data: dates } = await supabase.storage.from(PHOTO_BUCKET).list(userId, { limit: 1000 });
      for (const d of dates || []) {
        for (const period of ["am", "pm"]) {
          const { data: files } = await supabase.storage
            .from(PHOTO_BUCKET).list(`${userId}/${d.name}/${period}`, { limit: 1000 });
          (files || []).forEach((f) => paths.push(`${userId}/${d.name}/${period}/${f.name}`));
        }
      }
      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
      }
    } catch (e) { console.warn("[glass] bulk photo delete failed:", e?.message || e); }
  }, [enabled, userId]);

  const pendingCount = useCallback(() => Object.keys(queueRef.current).length, []);

  return { queueUpload, fetchRemote, removeRemote, removeAllRemote, touch, atimes: atimeRef, pendingCount, flush };
}

export { approxBytes };
