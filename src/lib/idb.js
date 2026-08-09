/* ------------------------------ photo blob store ----------------------------- */
/*
  Progress photos used to live in localStorage as base64 data URLs. Two problems with
  that: browsers cap localStorage at roughly 5 MB per origin (the app was advertising
  20 MB, a number inherited from the Claude artifact runtime), and base64 inflates every
  photo by a third. Somewhere around 20-40 photos the app would start throwing
  QuotaExceededError while its own meter still read about a quarter full.

  IndexedDB stores Blobs natively, has orders of magnitude more room, and reports real
  usage through the StorageManager API — so the meter can stop guessing.

  No dependency: this is the ~80 lines of IndexedDB that this app actually needs.
*/

const DB_NAME = "glass";
const DB_VERSION = 1;
const STORE = "photos";

let dbPromise = null;

export function idbAvailable() {
  try { return typeof indexedDB !== "undefined" && indexedDB !== null; } catch { return false; }
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    // Private browsing in some engines opens and then never fires either handler.
    setTimeout(() => reject(new Error("indexedDB open timed out")), 5000);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  }));
}

const wrap = (req) => ({ __req: req });

/** @returns {Promise<Blob|null>} */
export async function idbGet(key) {
  try { return (await tx("readonly", (s) => wrap(s.get(key)))) || null; }
  catch { return null; }
}

export async function idbSet(key, blob) {
  await tx("readwrite", (s) => { s.put(blob, key); });
  return true;
}

export async function idbDelete(key) {
  try { await tx("readwrite", (s) => { s.delete(key); }); } catch { /* already gone */ }
}

export async function idbDeleteMany(keys) {
  if (!keys.length) return;
  try { await tx("readwrite", (s) => { keys.forEach((k) => s.delete(k)); }); } catch { /* ignore */ }
}

/** Every key, or just those under a prefix (used to scope a wipe to one namespace). */
export async function idbKeys(prefix = "") {
  try {
    const all = await tx("readonly", (s) => wrap(s.getAllKeys()));
    const list = Array.isArray(all) ? all : [];
    return prefix ? list.filter((k) => typeof k === "string" && k.startsWith(prefix)) : list;
  } catch { return []; }
}

export async function idbClear(prefix = "") {
  const keys = await idbKeys(prefix);
  await idbDeleteMany(keys);
  return keys.length;
}

/** Total bytes held under a prefix. Used for the per-namespace share of the meter. */
export async function idbBytes(prefix = "") {
  const keys = await idbKeys(prefix);
  let total = 0;
  for (const k of keys) {
    const b = await idbGet(k);
    if (b && typeof b.size === "number") total += b.size;
  }
  return total;
}

/**
 * What the browser says, not what we hope. Returns null where StorageManager isn't
 * available (older Safari), and callers fall back to their own accounting.
 */
export async function estimateStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number" || !quota) return null;
    return { usage, quota };
  } catch { return null; }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(",");
  const mime = (/data:([^;]+)/.exec(header) || [])[1] || "image/jpeg";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
