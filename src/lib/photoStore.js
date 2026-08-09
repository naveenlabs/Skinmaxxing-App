import { getNamespace, getStore, isArtifactRuntime, LS_PREFIX } from "./store.js";
import {
  idbAvailable, idbGet, idbSet, idbDelete, idbDeleteMany, idbKeys, idbBytes,
  blobToDataUrl, dataUrlToBlob,
} from "./idb.js";

/*
  One door for photo bytes, so App.jsx doesn't have to know where they live.

  Signed in or out, in a normal browser, blobs go to IndexedDB under the current
  namespace. Inside the Claude artifact runtime `window.storage` is still the contract
  (and is what scripts/audit/artifact-storage.mjs asserts), so that path is preserved
  exactly as it was, data URLs and all.

  Photos written by earlier builds are sitting in localStorage as base64. They're lifted
  into IndexedDB the first time they're read and the localStorage copy is dropped — a
  migration that costs nothing up front and can't half-apply, because each photo moves
  independently and the source is only removed once the destination write has succeeded.
*/

const useIdb = () => !isArtifactRuntime() && idbAvailable();

const scoped = (key) => getNamespace() + key;

/** Read one photo as a data URL — the shape every consumer in App.jsx expects. */
export async function readPhoto(key) {
  if (isArtifactRuntime()) {
    try {
      const r = await getStore()?.get(key);
      return r?.value || null;
    } catch { return null; }
  }

  if (useIdb()) {
    const blob = await idbGet(scoped(key));
    if (blob) {
      try { return await blobToDataUrl(blob); } catch { return null; }
    }
  }

  // Legacy: base64 in localStorage. Lift it across, then forget the old copy.
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + scoped(key));
    if (!raw) return null;
    if (useIdb()) {
      try {
        await idbSet(scoped(key), dataUrlToBlob(raw));
        window.localStorage.removeItem(LS_PREFIX + scoped(key));
      } catch { /* keep the localStorage copy if the move failed */ }
    }
    return raw;
  } catch { return null; }
}

/**
 * @param {string} key  e.g. "photo:2026-08-01:am:k3f9"
 * @param {Blob|string} value a Blob, or a data URL from the older code path
 * @returns {Promise<number>} bytes actually stored
 */
export async function writePhoto(key, value) {
  const blob = typeof value === "string" ? dataUrlToBlob(value) : value;

  if (isArtifactRuntime()) {
    const dataUrl = typeof value === "string" ? value : await blobToDataUrl(blob);
    const ok = await getStore()?.set(key, dataUrl);
    if (!ok) throw new Error("storage rejected the write");
    return new Blob([dataUrl]).size;
  }

  if (useIdb()) {
    await idbSet(scoped(key), blob);
    return blob.size;
  }

  // No IndexedDB at all (ancient or locked-down browser): fall back to the old scheme.
  const dataUrl = typeof value === "string" ? value : await blobToDataUrl(blob);
  window.localStorage.setItem(LS_PREFIX + scoped(key), dataUrl);
  return new Blob([dataUrl]).size;
}

export async function deletePhotoKeys(keys) {
  if (!keys.length) return;
  if (isArtifactRuntime()) {
    const store = getStore();
    await Promise.all(keys.map((k) => store?.delete(k).catch(() => {})));
    return;
  }
  if (useIdb()) await idbDeleteMany(keys.map(scoped));
  // Clear any legacy copies too, so a re-read can't resurrect a deleted photo.
  keys.forEach((k) => {
    try { window.localStorage.removeItem(LS_PREFIX + scoped(k)); } catch { /* ignore */ }
  });
}

/** Bytes held locally for the current namespace. */
export async function localPhotoBytes() {
  if (isArtifactRuntime() || !useIdb()) return null;
  return idbBytes(scoped("photo:"));
}

/** Every photo key held for the current namespace, unscoped. */
export async function localPhotoKeys() {
  if (isArtifactRuntime() || !useIdb()) return [];
  const prefix = scoped("photo:");
  return (await idbKeys(prefix)).map((k) => k.slice(getNamespace().length));
}

export async function clearPhotosForNamespace() {
  if (isArtifactRuntime() || !useIdb()) return 0;
  const keys = await idbKeys(scoped("photo:"));
  await idbDeleteMany(keys);
  return keys.length;
}

/**
 * Move every legacy localStorage photo for this namespace into IndexedDB in one pass.
 * Safe to call repeatedly; each photo is independent, so an interruption just leaves the
 * remainder for next time.
 */
export async function migrateLegacyPhotos() {
  if (isArtifactRuntime() || !useIdb() || typeof window === "undefined") return 0;
  const ns = getNamespace();
  const prefix = `${LS_PREFIX}${ns}photo:`;
  const keys = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  let moved = 0;
  for (const full of keys) {
    try {
      const raw = window.localStorage.getItem(full);
      if (!raw) continue;
      await idbSet(full.slice(LS_PREFIX.length), dataUrlToBlob(raw));
      window.localStorage.removeItem(full);
      moved++;
    } catch { break; }
  }
  return moved;
}

export { idbDelete };
