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

// Device-level, deliberately outside the namespace: which mode this browser is in, which
// account has converted this device's guest data, and supabase's own session blob.
// Reading these must never depend on knowing the user yet, and — critically — clearing a
// namespace must never delete them. A guest tapping "Delete everything" used to wipe
// `auth-mode` too and land on the sign-in wall they had explicitly opted out of.
export const AUTH_MODE_KEY = `${LS_PREFIX}auth-mode`;
export const LAST_UID_KEY = `${LS_PREFIX}last-uid`;
export const SB_AUTH_KEY = `${LS_PREFIX}sb-auth`;

const DEVICE_SUFFIXES = new Set(["auth-mode", "last-uid", "sb-auth"]);

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
    // so exclude anything that is itself namespaced — and never report the device flags,
    // which belong to the browser rather than to any one identity.
    if (ns === "") {
      if (/^u_[^:]+:/.test(rest)) continue;
      if (DEVICE_SUFFIXES.has(rest)) continue;
    }
    out.push(rest);
  }
  return out;
}

const MIGRATION_JOURNAL = `${LS_PREFIX}migration`;

function readJournal() {
  try { return JSON.parse(window.localStorage.getItem(MIGRATION_JOURNAL) || "null"); }
  catch { return null; }
}
function writeJournal(v) {
  try {
    if (v == null) window.localStorage.removeItem(MIGRATION_JOURNAL);
    else window.localStorage.setItem(MIGRATION_JOURNAL, JSON.stringify(v));
  } catch { /* ignore */ }
}

/**
 * Copy every key from one namespace into another, resumably.
 *
 * Copy, not move: the source is the user's guest data, and the previous version renamed
 * keys out from under them *before* the UI asked what they wanted — so choosing "use my
 * account's data" destroyed a routine they had never agreed to give up. The source is
 * left completely intact here; deciding whether to retire it is the caller's business.
 *
 * A journal records which keys have landed, so an interruption (closed tab, quota, dead
 * battery) resumes on the next attempt instead of leaving a half-applied merge with no
 * way to tell what made it across.
 *
 * @returns {{copied: number, total: number, complete: boolean, error: string|null}}
 */
export async function copyNamespace(fromUid, toUid, { overwrite = false } = {}) {
  if (typeof window === "undefined" || isArtifactRuntime()) {
    return { copied: 0, total: 0, complete: true, error: null };
  }
  const from = nsFor(fromUid);
  const to = nsFor(toUid);
  if (from === to) return { copied: 0, total: 0, complete: true, error: null };

  const keys = listKeys(from);
  const journal = readJournal();
  const done = new Set(journal?.from === from && journal?.to === to ? journal.done || [] : []);

  let copied = 0;
  let error = null;
  for (const key of keys) {
    if (done.has(key)) { copied++; continue; }
    try {
      const v = window.localStorage.getItem(LS_PREFIX + from + key);
      if (v == null) { done.add(key); continue; }
      const dst = LS_PREFIX + to + key;
      if (overwrite || window.localStorage.getItem(dst) == null) {
        window.localStorage.setItem(dst, v);
      }
      done.add(key);
      copied++;
      writeJournal({ from, to, done: [...done], total: keys.length });
    } catch (e) {
      // Out of room or storage disabled. Stop cleanly with the journal intact so the
      // next attempt picks up exactly where this one stopped. Nothing is deleted.
      error = e?.name === "QuotaExceededError"
        ? "Ran out of space on this device partway through."
        : (e?.message || "Copy failed.");
      break;
    }
  }

  const complete = !error && copied >= keys.length;
  if (complete) writeJournal(null);
  return { copied, total: keys.length, complete, error };
}

/** Is a guest→account copy sitting half-finished? */
export function pendingMigration() {
  const j = readJournal();
  return j && j.to ? j : null;
}

/** Forget everything in one namespace once the user has confirmed it's been carried over. */
export async function retireNamespace(uid) {
  return clearNamespace(uid);
}

/**
 * Wipe everything belonging to one namespace, leaving the device flags alone.
 *
 * @param {string|null} uid
 * @param {string[]} extraKeys keys the caller knows about that enumeration can't reach.
 *   The artifact API has no way to list keys, so App passes the photo keys it can derive
 *   from the photo index. Without this, "Delete everything" left every progress photo in
 *   storage while deleting the index that could have found them again.
 */
export async function clearNamespace(uid, extraKeys = []) {
  const ns = nsFor(uid);
  const store = getStore();

  if (isArtifactRuntime()) {
    if (!store) return;
    const known = [
      "nv-products", "nv-logs", "nv-photo-index", "nv-photo-sizes", "nv-photo-dates",
      "nv-meta", "nv-profile", "nv-synced-once", "nv-photos-backfilled",
      "nv-photo-pending", "nv-photo-atime", "nv-avatar",
    ];
    await Promise.all([...known, ...extraKeys].map((k) => store.delete(k).catch(() => {})));
    return;
  }

  // localStorage can be enumerated, so take everything under the namespace rather than
  // trusting a hardcoded list to stay in step with the app.
  listKeys(ns).forEach((k) => {
    try { window.localStorage.removeItem(LS_PREFIX + ns + k); } catch { /* ignore */ }
  });
  if (store) {
    await Promise.all(extraKeys.map((k) => store.delete(k).catch(() => {})));
  }
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
