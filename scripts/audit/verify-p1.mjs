// Verification pass for every Phase 1 fix. Each block re-runs the exact scenario that
// exposed a bug and asserts the corrected behaviour.
import fs from "node:fs";
import path from "node:path";
import { boot, go, scrollRoot } from "./drive.mjs";
import { SEED_PRODUCTS } from "./seed.mjs";

const OUT = process.argv[2] || "/tmp";
const VALID = process.argv[3] || "/tmp/valid";
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

// ============ 1. storage backend works; no permanent save error ============
{
  const { browser, page, messages } = await boot({ days: 30 });
  await go(page, "ROUTINE");
  const errVisible = await page.evaluate(() => /Couldn't save/.test(document.body.innerText));
  check("no 'Couldn't save' banner in a plain browser", !errVisible);
  // toggle a product and confirm it survives a reload
  await page.locator('[data-testid="check-row"]').first().click();
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  check("a check-off persists across reload", before === after, `${before} -> ${after}`);
  check("console clean (storage)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 2. retired product no longer blocks 100% ============
{
  const products = SEED_PRODUCTS.map((p) => (p.category === "sunscreen" ? { ...p, status: "retired", retiredReason: "Ran out" } : p));
  const { browser, page, messages } = await boot({ days: 10, products });
  await page.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    const t = new Date();
    const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    logs[ds] = { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "ROUTINE");
  const n = await page.locator('[data-testid="check-row"]').count();
  for (let i = 0; i < n; i++) await page.locator('[data-testid="check-row"]').nth(i).click();
  await page.waitForTimeout(700);
  const pct = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  check("100% reachable with the only sunscreen retired", pct === "100", `got ${pct}%`);
  await page.screenshot({ path: `${OUT}/shots/fix-retired-100.png` });
  check("console clean (retired)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 3. streak survives an unfinished today; all screens agree ============
{
  const { browser, page, messages } = await boot({ days: 40 });
  // make the last 6 full days complete, then blank today
  await page.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    const d = (n) => { const t = new Date(); t.setDate(t.getDate() - n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
    const full = { am: { p1: true, p4: true, p6: true }, pm: { p1: true, p5: true }, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    for (let i = 1; i <= 6; i++) logs[d(i)] = JSON.parse(JSON.stringify(full));
    // hard boundary so the streak is exactly 6, not however far the seed happens to run
    logs[d(7)] = { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    logs[d(0)] = { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "ROUTINE");
  const routineStreak = await page.evaluate(() => document.querySelector('[data-testid="routine-streak"]')?.textContent);
  await go(page, "INSIGHTS");
  const insightsStreak = await page.evaluate(() => document.querySelector('[data-testid="insights-streak"]')?.textContent);
  check("streak holds through an unfinished today (expect 6)", routineStreak === "6", `routine=${routineStreak}`);
  check("Routine and Insights report the same streak", routineStreak === insightsStreak, `${routineStreak} vs ${insightsStreak}`);
  // and the export agrees
  await page.getByText("Export", { exact: true }).first().click();
  await page.waitForTimeout(300);
  const dl = page.waitForEvent("download");
  await page.getByText("Everything, as JSON").click();
  const f = await dl;
  const jp = `${OUT}/streak-export.json`;
  await f.saveAs(jp);
  const j = JSON.parse(fs.readFileSync(jp, "utf8"));
  check("export agrees with the UI streak", String(j.insights.currentOverallStreak) === routineStreak, `export=${j.insights.currentOverallStreak}`);
  check("export filename uses the app name", f.suggestedFilename().startsWith("glass-export-"), f.suggestedFilename());
  check("export documents its own definitions", !!j.definitions && !!j.definitions.dayCompletion);
  check("console clean (streak)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 4. export no longer leaks raw ids for deleted products ============
{
  const { browser, page, messages } = await boot({ days: 60 });
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    localStorage.setItem("glass:nv-products", JSON.stringify(ps.filter((p) => p.id !== "p2")));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "INSIGHTS");
  await page.getByText("Export", { exact: true }).first().click();
  await page.waitForTimeout(300);
  const dl = page.waitForEvent("download");
  await page.getByText("Everything, as JSON").click();
  const f = await dl;
  const jp = `${OUT}/deleted-export.json`;
  await f.saveAs(jp);
  const j = JSON.parse(fs.readFileSync(jp, "utf8"));
  const names = new Set();
  Object.values(j.dailyLogs).forEach((d) => [...d.amProductsUsed, ...d.pmProductsUsed].forEach((n) => names.add(n)));
  check("no bare product id in dailyLogs", !names.has("p2"), [...names].filter((n) => n.length < 8).join(","));
  check("deleted product labelled explicitly", [...names].some((n) => n.includes("deleted product")), [...names].find((n) => n.includes("deleted")) || "none");
  check("export records product photo presence", "hasProductPhoto" in j.products[0]);
  check("photo entries carry ids", j.photos.entries.length === 0 || "id" in j.photos.entries[0]);
  check("console clean (export)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 5. photo replace no longer destroys existing photos on a bad pick ============
{
  const files = [];
  for (let i = 0; i < 7; i++) files.push(path.join(VALID, `up${i}.jpg`));
  const bad = path.join(OUT, "not-an-image.txt");
  fs.writeFileSync(bad, "nope");

  const { browser, page, messages } = await boot({ days: 20 });
  const counts = () => page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index") || "{}");
    const t = new Date();
    const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return { am: (idx[ds]?.am || []).length, pm: (idx[ds]?.pm || []).length };
  });
  await go(page, "JOURNEY");
  // seed 3 good AM photos
  let ch = page.waitForEvent("filechooser");
  await page.getByText("Morning", { exact: true }).click();
  (await ch).setFiles(files.slice(0, 3));
  await page.waitForTimeout(2000);
  const seeded = await counts();
  check("uploaded 3 AM photos", seeded.am === 3, JSON.stringify(seeded));

  // now pick a non-image for the SAME slot
  ch = page.waitForEvent("filechooser");
  await page.getByText("Morning", { exact: true }).click();
  (await ch).setFiles([bad]);
  await page.waitForTimeout(1500);
  const survived = await counts();
  check("a non-image pick does NOT destroy existing photos", survived.am === 3, JSON.stringify(survived));
  const errShown = await page.evaluate(() => /doesn't look like an image/.test(document.body.innerText));
  check("error surfaced for the bad pick", errShown);
  await page.screenshot({ path: `${OUT}/shots/fix-photo-badpick.png` });

  // cap still enforced, and replace still replaces
  ch = page.waitForEvent("filechooser");
  await page.getByText("Morning", { exact: true }).click();
  (await ch).setFiles(files);
  await page.waitForTimeout(2600);
  const capped = await counts();
  check("7 files -> capped at 5 (replacing the 3)", capped.am === 5, JSON.stringify(capped));

  // errors visible from the ROUTINE tab too
  await go(page, "ROUTINE");
  ch = page.waitForEvent("filechooser");
  await page.locator("button:has(svg.lucide-camera)").first().click();
  (await ch).setFiles([bad]);
  await page.waitForTimeout(1200);
  const routineErr = await page.evaluate(() => /doesn't look like an image/.test(document.body.innerText));
  check("upload error visible from the Routine tab", routineErr);
  const stillFive = await counts();
  check("Routine-tab bad pick also preserved photos", stillFive.am === 5, JSON.stringify(stillFive));
  await page.screenshot({ path: `${OUT}/shots/fix-routine-error-toast.png` });
  check("console clean (photos)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 6. compare tool ============
{
  // 6a: uncached photo now loads into the pane
  const { browser, page, messages } = await boot({ days: 150 });
  await go(page, "JOURNEY");
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText("vs 90 days").click();
  await page.waitForTimeout(1800);
  const panes = await page.evaluate(() =>
    ["A", "B"].map((slot) => {
      const d = document.querySelector(`[data-testid="compare-${slot}"]`);
      if (!d) return "missing";
      const img = d.querySelector("img");
      if (img) return img.getAttribute("src") ? "loaded" : "IMG_WITH_NO_SRC";
      return d.querySelector("svg.lucide-loader-circle") ? "loading" : "empty";
    })
  );
  check("no src-less <img> in compare panes", !panes.includes("IMG_WITH_NO_SRC"), JSON.stringify(panes));
  check("both compare panes resolved", panes.every((p) => p === "loaded"), JSON.stringify(panes));
  await page.screenshot({ path: `${OUT}/shots/fix-compare-uncached.png` });
  await browser.close();

  // 6b: a single photo must not be paired with itself
  const b2 = await boot({ days: 20 });
  await b2.page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index"));
    const dates = Object.keys(idx).sort();
    const keep = dates[dates.length - 1];
    const ids = idx[keep].am.length ? { am: idx[keep].am.slice(0, 1), pm: [] } : { am: [], pm: idx[keep].pm.slice(0, 1) };
    localStorage.setItem("glass:nv-photo-index", JSON.stringify({ [keep]: ids }));
  });
  await b2.page.reload({ waitUntil: "networkidle" });
  await b2.page.waitForTimeout(700);
  await go(b2.page, "JOURNEY");
  await b2.page.getByText("Compare", { exact: true }).first().click();
  await b2.page.waitForTimeout(400);
  await b2.page.getByText("vs 30 days").click();
  await b2.page.waitForTimeout(900);
  const one = await b2.page.evaluate(() => ({
    apart: /\b0\s+days apart/.test(document.body.innerText),
    note: /add another to compare against/.test(document.body.innerText),
    filled: ["A", "B"].filter((slot) => document.querySelector(`[data-testid="compare-${slot}"] img`)).length,
  }));
  check("one photo: not paired with itself", one.filled < 2, JSON.stringify(one));
  check("one photo: explains why", one.note, JSON.stringify(one));
  check("one photo: no '0 days apart'", !one.apart);
  await b2.page.screenshot({ path: `${OUT}/shots/fix-compare-onephoto.png` });
  await b2.browser.close();

  // 6c: preset must not claim 90d when the pair is 1 day apart
  const b3 = await boot({ days: 20 });
  await b3.page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index"));
    const dates = Object.keys(idx).sort();
    const a = dates[dates.length - 1], b = dates[dates.length - 2];
    const pick = (d) => (idx[d].am.length ? { am: idx[d].am.slice(0, 1), pm: [] } : { am: [], pm: idx[d].pm.slice(0, 1) });
    localStorage.setItem("glass:nv-photo-index", JSON.stringify({ [a]: pick(a), [b]: pick(b) }));
  });
  await b3.page.reload({ waitUntil: "networkidle" });
  await b3.page.waitForTimeout(700);
  await go(b3.page, "JOURNEY");
  await b3.page.getByText("Compare", { exact: true }).first().click();
  await b3.page.waitForTimeout(400);
  await b3.page.getByText("vs 90 days").click();
  await b3.page.waitForTimeout(900);
  const two = await b3.page.evaluate(() => document.body.innerText);
  check("far-off preset is disclosed", /No photo near 90 days back/.test(two), two.match(/No photo.*apart\./)?.[0] || "no note");
  check("day pluralised correctly", /1 day apart/.test(two) && !/1 days apart/.test(two));
  await b3.page.screenshot({ path: `${OUT}/shots/fix-compare-farpreset.png` });
  await b3.browser.close();
  check("console clean (compare)", messages.length === 0, messages.join(" | "));
}

// ============ 7. orphan category is reachable on Shelf ============
{
  const { browser, page, messages } = await boot({ days: 30 });
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    ps.push({ id: "ghost", name: "Mystery Ampoule From A Deleted Category", category: "essence-legacy", time: "Both", tracked: false, exfoliant: false, status: "active" });
    localStorage.setItem("glass:nv-products", JSON.stringify(ps));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "SHELF");
  const found = await page.evaluate(() => document.body.innerText.includes("Mystery Ampoule"));
  const group = await page.evaluate(() => document.body.innerText.includes("UNCATEGORIZED") || document.body.innerText.includes("Uncategorized"));
  check("orphan-category product visible on Shelf", found);
  check("shown under an Uncategorized group", group);
  await page.screenshot({ path: `${OUT}/shots/fix-orphan-category.png` });
  check("console clean (orphan)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 8. never-used product history modal ============
{
  const { browser, page, messages } = await boot({ days: 30 });
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    ps.push({ id: "unused", name: "Brand New Never Opened Serum", category: "serum", time: "AM", tracked: false, exfoliant: false, status: "active" });
    localStorage.setItem("glass:nv-products", JSON.stringify(ps));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "INSIGHTS");
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Brand New Never Opened Serum");
    if (el) el.closest("button").click();
  });
  await page.waitForTimeout(600);
  const txt = await page.evaluate(() => {
    const m = document.querySelector('[role="dialog"]');
    return m ? m.innerText : "";
  });
  check("no 'Invalid Date' for a never-used product", !/Invalid Date/.test(txt), txt.slice(0, 80));
  check("empty history explained", /Never used yet/.test(txt));
  await page.screenshot({ path: `${OUT}/shots/fix-neverused.png` });
  check("console clean (history)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 9. cleanup confirmation ============
{
  const { browser, page, messages } = await boot({ days: 150 });
  await go(page, "JOURNEY");
  await scrollRoot(page, 1300);
  const btn = page.getByText(/^Clean up 90\+ days/);
  const label = await btn.first().textContent();
  check("cleanup button shows how many it will delete", /\(\d+\)/.test(label), label);
  const beforeCount = await page.evaluate(() => (async () => {
    // Photos live in IndexedDB now, not localStorage.
    const db = await new Promise((res) => { const r = indexedDB.open("glass", 1); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    if (!db) return 0;
    return await new Promise((res) => {
      const req = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
      req.onsuccess = () => res((req.result || []).filter((k) => String(k).startsWith("photo:")).length);
      req.onerror = () => res(0);
    });
  })());
  await btn.first().click();
  await page.waitForTimeout(500);
  const confirmShown = await page.evaluate(() => /can't be undone/.test(document.body.innerText));
  check("cleanup asks for confirmation", confirmShown);
  await page.screenshot({ path: `${OUT}/shots/fix-cleanup-confirm.png` });
  await page.getByText("Keep them").click();
  await page.waitForTimeout(500);
  const afterCancel = await page.evaluate(() => (async () => {
    // Photos live in IndexedDB now, not localStorage.
    const db = await new Promise((res) => { const r = indexedDB.open("glass", 1); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    if (!db) return 0;
    return await new Promise((res) => {
      const req = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
      req.onsuccess = () => res((req.result || []).filter((k) => String(k).startsWith("photo:")).length);
      req.onerror = () => res(0);
    });
  })());
  check("cancelling keeps every photo", beforeCount === afterCancel, `${beforeCount} -> ${afterCancel}`);
  await btn.first().click();
  await page.waitForTimeout(400);
  await page.getByText("Delete them").click();
  await page.waitForTimeout(1200);
  const afterConfirm = await page.evaluate(() => (async () => {
    // Photos live in IndexedDB now, not localStorage.
    const db = await new Promise((res) => { const r = indexedDB.open("glass", 1); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    if (!db) return 0;
    return await new Promise((res) => {
      const req = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
      req.onsuccess = () => res((req.result || []).filter((k) => String(k).startsWith("photo:")).length);
      req.onerror = () => res(0);
    });
  })());
  check("confirming actually deletes", afterConfirm < beforeCount, `${beforeCount} -> ${afterConfirm}`);
  check("console clean (cleanup)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 10. gallery tiles have a stable shape ============
{
  const { browser, page, messages } = await boot({ days: 150 });
  await go(page, "JOURNEY");
  await scrollRoot(page, 1400);
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="lazy-photo"]')]
      .filter((d) => d.parentElement && d.parentElement.style.display === "grid")
      .slice(0, 6)
      .map((t) => { const b = t.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), r: +(b.width / b.height).toFixed(2) }; })
  );
  const uniform = tiles.length > 1 && tiles.every((t) => Math.abs(t.r - tiles[0].r) < 0.02);
  check("gallery tiles share one aspect ratio", uniform, JSON.stringify(tiles));
  check("tiles have real height", tiles.every((t) => t.h > 40), JSON.stringify(tiles));
  check("console clean (tiles)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 11. empty-name validation ============
{
  const { browser, page, messages } = await boot({ days: 10 });
  await go(page, "SHELF");
  await page.getByText("Add a product").click();
  await page.waitForTimeout(400);
  await page.getByText("Add to shelf").click();
  await page.waitForTimeout(400);
  const msg = await page.evaluate(() => /Give it a name first/.test(document.body.innerText));
  check("empty-name submit explains itself", msg);
  await page.screenshot({ path: `${OUT}/shots/fix-name-validation.png` });
  check("console clean (validation)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 12. all four pages clean with zero data ============
{
  const { browser, page, messages } = await boot({ empty: true });
  for (const t of ["ROUTINE", "SHELF", "INSIGHTS", "JOURNEY"]) {
    await go(page, t);
    await scrollRoot(page, 600);
    await scrollRoot(page, 0);
  }
  check("zero-data: no console errors on any page", messages.length === 0, messages.join(" | "));
  await browser.close();
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
