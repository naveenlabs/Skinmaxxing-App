// Exercises src/lib/merge.js directly — no browser, no network. The merge rules are
// the one place in the sync path where a quiet mistake loses a user's data, so they
// get proved here rather than inferred from the app behaving plausibly.
import { stampChanges, mergeState, mergeDoc, emptyMeta, isEmptyState } from "../../src/lib/merge.js";

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`); }
}

const T1 = 1000, T2 = 2000, T3 = 3000;
const bundle = (products = [], logs = {}, photoIndex = {}, meta = emptyMeta()) =>
  ({ products, logs, photoIndex, meta });

console.log("\nstampChanges");
{
  const prev = [{ id: "a", name: "Cleanser" }];
  const next = [{ id: "a", name: "Cleanser" }, { id: "b", name: "Serum" }];
  const m = stampChanges("products", prev, next, emptyMeta(), T1);
  check("stamps only the added product", m.products, { b: T1 });

  const m2 = stampChanges("products", next, [{ id: "a", name: "Cleanser" }], m, T2);
  check("removal becomes a tombstone", m2.deleted.products, { b: T2 });
  check("removal clears the write stamp", m2.products, {});

  const edited = [{ id: "a", name: "Gentle Cleanser" }];
  const m3 = stampChanges("products", [{ id: "a", name: "Cleanser" }], edited, emptyMeta(), T2);
  check("stamps an edited product", m3.products, { a: T2 });

  const m4 = stampChanges("logs", { d1: { am: {} } }, { d1: { am: {} } }, emptyMeta(), T3);
  check("no-op write stamps nothing", m4.logs, {});
}

console.log("\nmergeState — the everyday paths");
{
  const local = bundle();
  const remote = bundle([{ id: "a", name: "Serum" }], { "2026-08-01": { am: { a: true } } }, {},
    { ...emptyMeta(), products: { a: T1 }, logs: { "2026-08-01": T1 } });
  const r = mergeState(local, remote);
  check("new device adopts remote products", r.products, [{ id: "a", name: "Serum" }]);
  check("new device adopts remote logs", r.logs, { "2026-08-01": { am: { a: true } } });
  check("new device knows it must write locally", r.differsFromLocal, true);
  check("new device has nothing to push", r.differsFromRemote, false);
}
{
  const local = bundle([{ id: "a", name: "Serum" }], { d1: { am: { a: true } } }, {},
    { ...emptyMeta(), products: { a: T1 }, logs: { d1: T1 } });
  const r = mergeState(local, bundle());
  check("empty remote keeps local intact", r.products, [{ id: "a", name: "Serum" }]);
  check("empty remote must be pushed to", r.differsFromRemote, true);
}
{
  const meta = (logs) => ({ ...emptyMeta(), logs });
  const local = bundle([], { d1: { am: { a: true } } }, {}, meta({ d1: T1 }));
  const remote = bundle([], { d2: { pm: { b: true } } }, {}, meta({ d2: T1 }));
  const r = mergeState(local, remote);
  check("different days union", Object.keys(r.logs).sort(), ["d1", "d2"]);
}
{
  const meta = (logs) => ({ ...emptyMeta(), logs });
  const local = bundle([], { d1: { amNote: "older" } }, {}, meta({ d1: T1 }));
  const remote = bundle([], { d1: { amNote: "newer" } }, {}, meta({ d1: T2 }));
  check("same day: newer stamp wins", mergeState(local, remote).logs.d1, { amNote: "newer" });
  check("same day: reversed, newer still wins", mergeState(remote, local).logs.d1, { amNote: "newer" });
}

console.log("\nmergeState — deletions");
{
  const local = bundle([{ id: "a", name: "Serum" }], {}, {}, { ...emptyMeta(), products: { a: T1 } });
  const remote = bundle([], {}, {}, { ...emptyMeta(), deleted: { products: { a: T2 }, logs: {}, photoIndex: {} } });
  check("remote delete after local write removes it", mergeState(local, remote).products, []);
}
{
  const local = bundle([{ id: "a", name: "Renamed" }], {}, {}, { ...emptyMeta(), products: { a: T3 } });
  const remote = bundle([], {}, {}, { ...emptyMeta(), deleted: { products: { a: T2 }, logs: {}, photoIndex: {} } });
  check("local edit after remote delete resurrects it", mergeState(local, remote).products, [{ id: "a", name: "Renamed" }]);
}
{
  const local = bundle([], {}, {}, { ...emptyMeta(), deleted: { products: { a: T2 }, logs: {}, photoIndex: {} } });
  const remote = bundle([], {}, {}, { ...emptyMeta(), deleted: { products: { a: T1 }, logs: {}, photoIndex: {} } });
  const r = mergeState(local, remote);
  check("deleted on both stays deleted", r.products, []);
  check("tombstone is carried forward", r.meta.deleted.products, { a: T2 });
}

console.log("\nmergeState — data that predates stamping");
{
  const local = bundle([{ id: "a", name: "A" }], { d1: { amNote: "local" } });
  const remote = bundle([{ id: "b", name: "B" }], { d2: { amNote: "remote" } });
  const r = mergeState(local, remote);
  check("unstamped products union", r.products.map((p) => p.id).sort(), ["a", "b"]);
  check("unstamped logs union", Object.keys(r.logs).sort(), ["d1", "d2"]);
}
{
  const local = bundle([], { d1: { amNote: "local" } });
  const remote = bundle([], { d1: { amNote: "remote" } });
  check("unstamped tie resolves to local", mergeState(local, remote).logs.d1, { amNote: "local" });
}

console.log("\nproduct ordering");
{
  const local = bundle([{ id: "b" }, { id: "a" }], {}, {}, { ...emptyMeta(), products: { a: T1, b: T1 } });
  const remote = bundle([{ id: "a" }, { id: "b" }, { id: "c" }], {}, {},
    { ...emptyMeta(), products: { a: T1, b: T1, c: T1 } });
  const r = mergeState(local, remote);
  check("local order wins, remote-only appended", r.products.map((p) => p.id), ["b", "a", "c"]);
}

console.log("\nfield-level day merging");
{
  // The real scenario: tick AM on the phone in the morning, PM on the iPad at night,
  // neither having synced in between. A whole-day last-write-wins loses the morning.
  const day = "2026-08-03";
  const phone = bundle([], { [day]: { am: { p1: true }, pm: {}, amNote: "glowy" } }, {},
    { ...emptyMeta(), logs: { [day]: { am: T1, amNote: T1 } } });
  const ipad = bundle([], { [day]: { am: {}, pm: { p3: true }, pmNote: "tret" } }, {},
    { ...emptyMeta(), logs: { [day]: { pm: T2, pmNote: T2 } } });
  const r = mergeState(phone, ipad);
  check("morning ticks survive the evening sync", r.logs[day].am, { p1: true });
  check("evening ticks survive too", r.logs[day].pm, { p3: true });
  check("morning note kept", r.logs[day].amNote, "glowy");
  check("evening note kept", r.logs[day].pmNote, "tret");
}
{
  const day = "d1";
  const a = bundle([], { [day]: { amNote: "older" } }, {}, { ...emptyMeta(), logs: { [day]: { amNote: T1 } } });
  const b = bundle([], { [day]: { amNote: "newer" } }, {}, { ...emptyMeta(), logs: { [day]: { amNote: T2 } } });
  check("same field: newer wins", mergeState(a, b).logs[day].amNote, "newer");
  check("same field reversed: newer still wins", mergeState(b, a).logs[day].amNote, "newer");
}
{
  const day = "d1";
  const a = bundle([], { [day]: { amNote: "written" } }, {}, { ...emptyMeta(), logs: { [day]: { amNote: T1 } } });
  const b = bundle([], { [day]: { amNote: "" } }, {}, { ...emptyMeta(), logs: { [day]: { amNote: T2 } } });
  check("clearing a note from another device sticks", mergeState(a, b).logs[day].amNote, "");
}
{
  // Both devices toggled the same product in the same period — newer decides that id only.
  const day = "d1";
  const a = bundle([], { [day]: { am: { p1: true, p2: true } } }, {}, { ...emptyMeta(), logs: { [day]: { am: T1 } } });
  const b = bundle([], { [day]: { am: { p1: false, p3: true } } }, {}, { ...emptyMeta(), logs: { [day]: { am: T2 } } });
  check("id-level conflict resolves, others preserved",
    mergeState(a, b).logs[day].am, { p1: false, p2: true, p3: true });
}
{
  // Meta written by an older build is a plain number, not a per-field object.
  const day = "d1";
  const legacy = bundle([], { [day]: { am: { p1: true }, amNote: "old" } }, {}, { ...emptyMeta(), logs: { [day]: T1 } });
  const fresh = bundle([], { [day]: { pm: { p3: true } } }, {}, { ...emptyMeta(), logs: { [day]: { pm: T2 } } });
  const r = mergeState(legacy, fresh);
  check("numeric legacy stamp interops", [r.logs[day].am, r.logs[day].pm, r.logs[day].amNote],
    [{ p1: true }, { p3: true }, "old"]);
}
{
  const day = "d1";
  const a = bundle([], {}, { [day]: { am: ["ph1"], pm: [] } }, { ...emptyMeta(), photoIndex: { [day]: { am: T1 } } });
  const b = bundle([], {}, { [day]: { am: [], pm: ["ph2"] } }, { ...emptyMeta(), photoIndex: { [day]: { pm: T2 } } });
  const r = mergeState(a, b);
  check("photo index AM/PM don't clobber each other", [r.photoIndex[day].am, r.photoIndex[day].pm],
    [["ph1"], ["ph2"]]);
}
{
  // A photo deleted on the newer device must not come back via union.
  const day = "d1";
  const a = bundle([], {}, { [day]: { am: ["ph1", "ph2"], pm: [] } }, { ...emptyMeta(), photoIndex: { [day]: { am: T1 } } });
  const b = bundle([], {}, { [day]: { am: ["ph1"], pm: [] } }, { ...emptyMeta(), photoIndex: { [day]: { am: T2 } } });
  check("deleted photo is not resurrected", mergeState(a, b).photoIndex[day].am, ["ph1"]);
}

console.log("\nmisc");
{
  check("isEmptyState on a blank bundle", isEmptyState(bundle()), true);
  check("isEmptyState with one log", isEmptyState(bundle([], { d1: {} })), false);
  const r = mergeDoc("logs", { d1: 1 }, emptyMeta(), { d1: 1 }, emptyMeta());
  check("identical docs merge to themselves", r.doc, { d1: 1 });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
