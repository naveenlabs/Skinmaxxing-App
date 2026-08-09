/* --------------------------------- merging ---------------------------------- */
/*
  Pure functions, no storage and no network — this is the only genuinely subtle logic
  in the sync path, so it lives on its own where it can be reasoned about (and driven
  from a script) without booting the app.

  The model: `products` and `logs` are documents the app already treats as opaque
  wholes, but merging two devices needs per-entry resolution. So alongside each
  document we keep a `meta` map of when each entry last changed:

    meta = {
      products:   { "<product id>": 1754212345678 },
      logs:       { "2026-08-03":   1754212345678 },
      photoIndex: { "2026-08-03":   1754212345678 },
      deleted:    { products: { "<id>": ts }, logs: {}, photoIndex: {} },
    }

  Those stamps are produced by diffing what's about to be written against the last
  snapshot — see stampChanges. Diffing rather than stamping at each mutation site is
  what lets the ~40 mutation functions in App.jsx stay exactly as they were.
*/

export const KINDS = ["products", "logs", "photoIndex"];

export function emptyMeta() {
  return {
    products: {}, logs: {}, photoIndex: {},
    deleted: { products: {}, logs: {}, photoIndex: {} },
  };
}

/** Tolerate meta from an older row, a fresh install, or garbage. */
export function normalizeMeta(meta) {
  const base = emptyMeta();
  if (!meta || typeof meta !== "object") return base;
  KINDS.forEach((k) => {
    if (meta[k] && typeof meta[k] === "object") base[k] = { ...meta[k] };
    if (meta.deleted && meta.deleted[k] && typeof meta.deleted[k] === "object") {
      base.deleted[k] = { ...meta.deleted[k] };
    }
  });
  return base;
}

/**
 * Entry view of a document. `products` is an array keyed by id; `logs` and
 * `photoIndex` are already date-keyed objects.
 */
export function toEntries(kind, doc) {
  if (kind === "products") {
    const out = {};
    (Array.isArray(doc) ? doc : []).forEach((p) => { if (p && p.id) out[p.id] = p; });
    return out;
  }
  return doc && typeof doc === "object" ? doc : {};
}

/**
 * Inverse of toEntries. Product order follows `order` where given, so a shelf the
 * user reordered survives a merge instead of being silently re-sorted.
 */
export function fromEntries(kind, entries, order) {
  if (kind !== "products") return entries;
  const ids = Object.keys(entries);
  if (!order || !order.length) return ids.map((id) => entries[id]);
  const ranked = new Map();
  order.forEach((id, i) => { if (!ranked.has(id)) ranked.set(id, i); });
  return ids
    .sort((a, b) => (ranked.has(a) ? ranked.get(a) : Infinity) - (ranked.has(b) ? ranked.get(b) : Infinity))
    .map((id) => entries[id]);
}

function sameEntry(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Content equality is all that matters. Key reordering can produce a false
  // "changed", which costs one redundant stamp; it can never produce a false
  // "unchanged", which is the direction that would actually lose data.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compare what's about to be written against the previous snapshot and stamp only
 * the entries that actually moved. Returns a new meta — never mutates its argument.
 */
export function stampChanges(kind, prevDoc, nextDoc, meta, now = Date.now()) {
  const m = normalizeMeta(meta);
  const prev = toEntries(kind, prevDoc);
  const next = toEntries(kind, nextDoc);

  Object.keys(next).forEach((key) => {
    if (!sameEntry(prev[key], next[key])) {
      m[kind][key] = now;
      delete m.deleted[kind][key];
    }
  });

  Object.keys(prev).forEach((key) => {
    if (!(key in next)) {
      m.deleted[kind][key] = now;
      delete m[kind][key];
    }
  });

  return m;
}

/**
 * Merge one document across two devices.
 *
 * Per entry: the newest stamp wins, and a deletion is just another stamp. An entry
 * carrying no stamp at all counts as written at t=0 — it loses to any real deletion
 * but survives when nothing has been deleted, which is what makes pre-sync data
 * safe to merge. Ties resolve to local: that's the device in the user's hand.
 */
export function mergeDoc(kind, localDoc, localMeta, remoteDoc, remoteMeta) {
  const lm = normalizeMeta(localMeta);
  const rm = normalizeMeta(remoteMeta);
  const local = toEntries(kind, localDoc);
  const remote = toEntries(kind, remoteDoc);

  const keys = new Set([
    ...Object.keys(local), ...Object.keys(remote),
    ...Object.keys(lm.deleted[kind]), ...Object.keys(rm.deleted[kind]),
  ]);

  const merged = {};
  const meta = emptyMeta();

  keys.forEach((key) => {
    const lTs = lm[kind][key] || 0;
    const rTs = rm[kind][key] || 0;
    const newestWrite = Math.max(lTs, rTs);
    const newestDelete = Math.max(lm.deleted[kind][key] || 0, rm.deleted[kind][key] || 0);
    const hasLocal = key in local;
    const hasRemote = key in remote;

    if (newestDelete > newestWrite || (!hasLocal && !hasRemote)) {
      if (newestDelete) meta.deleted[kind][key] = newestDelete;
      return;
    }

    if (hasLocal && hasRemote) merged[key] = rTs > lTs ? remote[key] : local[key];
    else merged[key] = hasLocal ? local[key] : remote[key];

    if (newestWrite) meta[kind][key] = newestWrite;
  });

  // Local order first so the device in hand keeps its arrangement; anything only the
  // other device knows about lands after it rather than being dropped.
  const order = kind === "products"
    ? [...(Array.isArray(localDoc) ? localDoc : []), ...(Array.isArray(remoteDoc) ? remoteDoc : [])]
        .map((p) => p && p.id).filter(Boolean)
    : null;

  return { doc: fromEntries(kind, merged, order), meta };
}

/**
 * Merge a whole state bundle. `differsFromLocal` / `differsFromRemote` tell the sync
 * engine whether it needs to write back down, push back up, or neither.
 */
export function mergeState(local, remote) {
  const meta = emptyMeta();
  const out = {};

  KINDS.forEach((kind) => {
    const r = mergeDoc(kind, local[kind], local.meta, remote[kind], remote.meta);
    out[kind] = r.doc;
    meta[kind] = r.meta[kind];
    meta.deleted[kind] = r.meta.deleted[kind];
  });

  const differs = (side) => KINDS.some(
    (kind) => JSON.stringify(toEntries(kind, out[kind])) !== JSON.stringify(toEntries(kind, side[kind]))
  );

  return { ...out, meta, differsFromLocal: differs(local), differsFromRemote: differs(remote) };
}

/** True when a state bundle holds nothing worth syncing. */
export function isEmptyState(s) {
  if (!s) return true;
  const products = Array.isArray(s.products) ? s.products : [];
  const logs = s.logs && typeof s.logs === "object" ? s.logs : {};
  const photoIndex = s.photoIndex && typeof s.photoIndex === "object" ? s.photoIndex : {};
  return products.length === 0 && Object.keys(logs).length === 0 && Object.keys(photoIndex).length === 0;
}
