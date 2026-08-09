/* ------------------------------- storage layer ------------------------------ */
/*
  Lifted out of App.jsx so the sync engine can sit under the same seam the app already
  writes through. Behaviour is unchanged in the case that matters most: `window.storage`
  (the Claude artifact API) still wins over localStorage whenever it exists, and keys
  reach it exactly as before — scripts/audit/artifact-storage.mjs asserts both.

  What's new is the namespace. Signed out, keys are written where they always were, so
  an existing install keeps its data with no migration at all. Signed in, they move
  under `u_<uid>:`, so two accounts on one phone can't read each other.
*/

export const LS_PREFIX = "glass:";

// Device-level, deliberately outside the namespace: which mode this browser is in and
// who it last belonged to. Reading these must never depend on knowing the user yet.
export const AUTH_MODE_KEY = `${LS_PREFIX}auth-mode`;
export const LAST_UID_KEY = `${LS_PREFIX}last-uid`;

let namespace = "";
let warnedFallback = false;

export function nsFor(uid) { return uid ? `u_${uid}:` : ""; }
export function setNamespace(uid) { namespace = nsFor(uid); }
export function getNamespace() { return namespace; }

export function approxBytes(str) { return new Blob([str]).size; }

function backend() {
  if (typeof window === "undefined") return null;
  if (window.storage && typeof window.storage.get === "function") return window.storage;
  if (!warnedFallback) {
    warnedFallback = true;
    console.info("[glass] window.storage unavailable — using localStorage.");
  }
  return {
    async get(key) {
      const v = window.localStorage.getItem(LS_PREFIX + key);
      return v == null ? null : { value: v };
    },
    async set(key, value) {
      // a thrown QuotaExceededError here is the honest signal the save failed
      window.localStorage.setItem(LS_PREFIX + key, value);
      return true;
    },
    async delete(key) {
      window.localStorage.removeItem(LS_PREFIX + key);
      return true;
    },
  };
}

/** True when reads and writes are going to the artifact API rather than localStorage. */
export function isArtifactRuntime() {
  return typeof window !== "undefined" && !!(window.storage && typeof window.storage.get === "function");
}

export function getStore() {
  const b = backend();
  if (!b) return null;
  return {
    get: (key) => b.get(namespace + key),
    set: (key, value) => b.set(namespace + key, value),
    delete: (key) => b.delete(namespace + key),
  };
}

export async function loadJSON(key, fallback) {
  try {
    const store = getStore();
    if (!store) return fallback;
    const r = await store.get(key);
    if (!r || r.value == null) return fallback;
    return JSON.parse(r.value);
  } catch { return fallback; }
}

export async function saveJSON(key, value) {
  const store = getStore();
  if (!store) return false;
  return !!(await store.set(key, JSON.stringify(value)));
}

/**
 * App-level keys currently readable in `ns`, with the prefix and namespace stripped.
 * localStorage only — the artifact API has no enumeration, and never needs one
 * (it's always the signed-out namespace).
 */
export function listKeys(ns = namespace) {
  if (typeof window === "undefined" || isArtifactRuntime()) return [];
  const full = LS_PREFIX + ns;
  const out = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(full)) continue;
    const rest = k.slice(full.length);
    // `glass:` keys of a *different* namespace also start with `glass:` when ns is "",
    // so exclude anything that is itself namespaced.
    if (ns === "" && /^u_[^:]+:/.test(rest)) continue;
    out.push(rest);
  }
  return out;
}

/**
 * Move every key from one namespace to another, one at a time. Renaming rather than
 * copying the whole store matters: a shelf full of progress photos can be most of the
 * localStorage budget, and duplicating it wholesale would blow the quota mid-migration.
 * Peak overhead here is a single photo.
 */
export async function migrateNamespace(fromUid, toUid) {
  if (typeof window === "undefined" || isArtifactRuntime()) return 0;
  const from = nsFor(fromUid);
  const to = nsFor(toUid);
  if (from === to) return 0;

  const keys = listKeys(from);
  let moved = 0;
  for (const key of keys) {
    const src = LS_PREFIX + from + key;
    const dst = LS_PREFIX + to + key;
    try {
      const v = window.localStorage.getItem(src);
      if (v == null) continue;
      if (window.localStorage.getItem(dst) == null) window.localStorage.setItem(dst, v);
      window.localStorage.removeItem(src);
      moved++;
    } catch {
      // out of room mid-move: stop rather than half-delete the rest
      break;
    }
  }
  return moved;
}

/** Wipe everything belonging to one namespace. Used by "Delete all data". */
export async function clearNamespace(uid) {
  const ns = nsFor(uid);
  if (isArtifactRuntime()) {
    const store = getStore();
    if (!store) return;
    await Promise.all(
      ["nv-products", "nv-logs", "nv-photo-index", "nv-photo-sizes", "nv-photo-dates", "nv-meta", "nv-profile"]
        .map((k) => store.delete(k).catch(() => {}))
    );
    return;
  }
  listKeys(ns).forEach((k) => {
    try { window.localStorage.removeItem(LS_PREFIX + ns + k); } catch { /* ignore */ }
  });
}

/* ------------------------------- device flags ------------------------------- */

export function readDeviceFlag(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function writeDeviceFlag(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private mode — the app still works, it just won't remember the choice */ }
}
