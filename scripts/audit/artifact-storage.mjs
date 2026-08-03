// The user's real data lives in window.storage (the Claude artifact API). The localStorage
// fallback must never take precedence over it, or a real install would silently read/write
// the wrong store.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const msgs = [];
page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));

// install a fake artifact storage API BEFORE the app boots, pre-populated with data
await page.addInitScript(() => {
  const mem = new Map();
  window.__calls = { get: [], set: [], delete: [] };
  mem.set("nv-products", JSON.stringify([
    { id: "art1", name: "Artifact-Stored Cleanser", category: "cleanser", time: "Both", status: "active" },
    { id: "art2", name: "Artifact-Stored Moisturiser", category: "moisturizer", time: "Both", status: "active" },
  ]));
  const t = new Date();
  const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  mem.set("nv-logs", JSON.stringify({ [ds]: { am: { art1: true, art2: true }, pm: { art1: true, art2: true }, amNote: "", pmNote: "", amMood: "Great", pmMood: "", weeklyMood: "", weeklyNote: "" } }));
  window.storage = {
    async get(k) { window.__calls.get.push(k); return mem.has(k) ? { value: mem.get(k) } : null; },
    async set(k, v) { window.__calls.set.push(k); mem.set(k, v); return true; },
    async delete(k) { window.__calls.delete.push(k); mem.delete(k); return true; },
  };
  // poison localStorage so using it would be obvious
  localStorage.setItem("glass:nv-products", JSON.stringify([{ id: "WRONG", name: "LOCALSTORAGE LEAK", category: "serum", time: "AM", status: "active" }]));
});

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });

await page.waitForTimeout(1400);

const body = await page.evaluate(() => document.body.innerText);
const calls = await page.evaluate(() => window.__calls);
console.log("window.storage.get called with:", JSON.stringify(calls.get));
console.log("reads artifact data:", /Artifact-Stored Cleanser/.test(body) ? "YES" : "NO");
console.log("localStorage leaked in:", /LOCALSTORAGE LEAK/.test(body) ? "YES — BUG" : "no");
console.log("no 'Couldn't save' banner:", !/Couldn't save/.test(body));

// a write must go to window.storage, not localStorage
await page.locator('[data-testid="check-row"]').first().click();
await page.waitForTimeout(900);
const after = await page.evaluate(() => ({
  sets: window.__calls.set,
  lsKeys: Object.keys(localStorage).filter((k) => k.startsWith("glass:")),
}));
console.log("writes went to window.storage:", after.sets.length > 0 ? "YES " + JSON.stringify(after.sets.slice(0, 3)) : "NO — BUG");
console.log("localStorage keys touched beyond the poison:", JSON.stringify(after.lsKeys));
console.log("errors:", msgs.join(" | ") || "(none)");
await browser.close();
