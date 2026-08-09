// Storage has to be honest and it has to be per-identity.
//
// Photos used to be base64 in localStorage against a hardcoded 20MB ceiling — a number
// inherited from the Claude artifact runtime and roughly four times what a browser
// actually grants. The meter read a quarter full while writes were already failing.
// They're Blobs in IndexedDB now and the meter asks the browser.
//
// Usage: node scripts/audit/storage-check.mjs <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/glass-storage";
mkdirSync(`${OUT}/shots`, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/supabase|Failed to fetch|net::ERR/i.test(m.text())) errors.push(m.text());
});

const idbKeys = () => page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("glass", 1);
    r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  });
  if (!db) return [];
  return new Promise((res) => {
    const req = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
    req.onsuccess = () => res(req.result || []); req.onerror = () => res([]);
  });
});

const lsPhotoKeys = () => page.evaluate(
  () => Object.keys(localStorage).filter((k) => k.includes("photo:")));

/* ------------ 1. legacy localStorage photos migrate into IndexedDB ------------ */

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((res) => { const r = indexedDB.deleteDatabase("glass"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  localStorage.setItem("glass:auth-mode", "guest");

  // A 1x1 JPEG, the shape an older build would have written.
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c96"; ctx.fillRect(0, 0, 40, 40);
  const url = c.toDataURL("image/jpeg", 0.72);

  localStorage.setItem("glass:nv-products", JSON.stringify([
    { id: "p1", name: "Legacy Cleanser", category: "cleanser", time: "Both", status: "active" },
  ]));
  localStorage.setItem("glass:nv-logs", JSON.stringify({}));
  localStorage.setItem("glass:nv-photo-index", JSON.stringify({ "2026-08-01": { am: ["legacy1"], pm: [] } }));
  localStorage.setItem("glass:photo:2026-08-01:am:legacy1", url);
  localStorage.setItem("glass:nv-photo-sizes", JSON.stringify({ "2026-08-01:am:legacy1": new Blob([url]).size }));
});

const beforeLs = await lsPhotoKeys();
check("a legacy localStorage photo is present to begin with", beforeLs.length === 1, JSON.stringify(beforeLs));

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const afterIdb = await idbKeys();
const afterLs = await lsPhotoKeys();
check("legacy photo moved into IndexedDB", afterIdb.some((k) => String(k).includes("legacy1")), JSON.stringify(afterIdb));
check("the localStorage copy was dropped", afterLs.length === 0, JSON.stringify(afterLs));
check("blobs are stored, not base64", await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open("glass", 1); r.onsuccess = () => res(r.result); });
  const keys = await new Promise((res) => {
    const q = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
    q.onsuccess = () => res(q.result);
  });
  const v = await new Promise((res) => {
    const q = db.transaction("photos", "readonly").objectStore("photos").get(keys[0]);
    q.onsuccess = () => res(q.result);
  });
  return v instanceof Blob;
}));

/* --------------------- 2. the photo still renders afterwards --------------------- */

await page.locator("nav button", { hasText: /^Journey$/i }).first().click();
await page.waitForTimeout(2000);
const rendered = await page.evaluate(() =>
  [...document.querySelectorAll("img")].some((i) => (i.src || "").startsWith("data:image")));
check("a migrated photo still renders", rendered);
await page.screenshot({ path: `${OUT}/shots/storage-journey.png` });

/* --------------------------- 3. the meter is honest --------------------------- */

const meter = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="storage-used"]');
  return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
});
check("meter renders", !!meter, String(meter));
check("meter no longer claims a fixed 20 MB ceiling", meter && !/\/\s*20 MB/.test(meter), String(meter));

const est = await page.evaluate(() => navigator.storage?.estimate ? navigator.storage.estimate() : null);
if (est) {
  const quotaMB = est.quota / (1024 * 1024);
  check("browser quota is well beyond the old 20 MB", quotaMB > 100, `${quotaMB.toFixed(0)} MB`);
  const shown = /\/\s*([\d.]+)\s*(MB|GB)/.exec(meter || "");
  if (shown) {
    const shownMB = parseFloat(shown[1]) * (shown[2] === "GB" ? 1024 : 1);
    check("meter's ceiling matches the browser's real quota",
      Math.abs(shownMB - quotaMB) / quotaMB < 0.05, `shown ${shownMB} vs real ${quotaMB.toFixed(0)}`);
  } else {
    check("meter's ceiling matches the browser's real quota", false, `unparseable: ${meter}`);
  }
}

/* ------------------- 4. photos are isolated between identities ------------------- */

const guestKeys = await idbKeys();
check("guest photo keys carry no account prefix",
  guestKeys.every((k) => !String(k).startsWith("u_")), JSON.stringify(guestKeys));

await page.evaluate(async () => {
  // Write a photo under a fake account namespace and confirm the guest can't see it.
  const db = await new Promise((res) => { const r = indexedDB.open("glass", 1); r.onsuccess = () => res(r.result); });
  await new Promise((res) => {
    const t = db.transaction("photos", "readwrite");
    t.objectStore("photos").put(new Blob(["x"]), "u_someone-else:photo:2026-08-01:am:theirs");
    t.oncomplete = () => res();
  });
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const stillIsolated = await page.evaluate(() => document.body.innerText);
check("another namespace's photo doesn't appear for the guest",
  !stillIsolated.includes("theirs"), stillIsolated.slice(0, 100));

check("no page errors", errors.length === 0, errors.join(" | "));

console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
await browser.close();
process.exit(fail ? 1 : 0);
