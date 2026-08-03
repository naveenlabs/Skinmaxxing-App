// Audit: deliberate edge cases — zero data, one product, a product whose category no
// longer exists, very long names, 0/1/50+ photos, and the never-used product history modal.
import { boot, go, scrollRoot } from "./drive.mjs";

const OUT = process.argv[2] || "/tmp";

async function pageErrors(page, messages, label) {
  const tabs = ["ROUTINE", "SHELF", "INSIGHTS", "JOURNEY"];
  for (const t of tabs) {
    await go(page, t);
    await scrollRoot(page, 500);
    await scrollRoot(page, 0);
  }
  console.log(` [${label}] console:`, messages.join(" | ") || "(clean)");
}

// ---------- 1. completely empty ----------
{
  const { browser, page, messages } = await boot({ empty: true });
  await pageErrors(page, messages, "zero-data");
  for (const t of ["ROUTINE", "SHELF", "INSIGHTS", "JOURNEY"]) {
    await go(page, t);
    await page.screenshot({ path: `${OUT}/shots/edge-empty-${t.toLowerCase()}.png` });
  }
  const insights = await (async () => { await go(page, "INSIGHTS"); return page.evaluate(() => document.body.innerText.slice(0, 400)); })();
  console.log(" insights text (empty):", JSON.stringify(insights.replace(/\s+/g, " ").slice(0, 260)));
  await browser.close();
}

// ---------- 2. one product only, no logs ----------
{
  const { browser, page, messages } = await boot({
    days: 0,
    products: [{ id: "solo", name: "CeraVe Foaming Cleanser", category: "cleanser", time: "Both", tracked: false, exfoliant: false, status: "active" }],
  });
  await page.evaluate(() => { localStorage.setItem("glass:nv-logs", "{}"); localStorage.setItem("glass:nv-photo-index", "{}"); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await pageErrors(page, messages, "one-product-no-logs");
  await go(page, "ROUTINE");
  const r = await page.evaluate(() => {
    const pctEl = document.querySelector('[data-testid="day-pct"]');
    const counts = [...document.querySelectorAll("span")].filter((s) => /^\d+ \/ \d+$/.test(s.textContent.trim())).map((s) => s.textContent.trim());
    return { pct: pctEl && pctEl.textContent, counts };
  });
  console.log(" one product, nothing checked:", JSON.stringify(r));
  // check it and see if 100% is reachable with only a cleanser (no moisturizer/sunscreen)
  await page.locator('[data-testid="check-row"]').first().click();
  await page.waitForTimeout(500);
  const r2 = await page.evaluate(() => {
    const pctEl = document.querySelector('[data-testid="day-pct"]');
    return pctEl && pctEl.textContent;
  });
  console.log(" after checking the only (AM+PM cleanser) product, pct =", r2);
  await page.screenshot({ path: `${OUT}/shots/edge-oneproduct.png` });
  await browser.close();
}

// ---------- 3. product with a category id that no longer exists ----------
{
  const { browser, page, messages } = await boot({ days: 30 });
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    ps.push({ id: "ghost", name: "Mystery Ampoule From A Deleted Category", category: "essence-legacy", time: "Both", tracked: true, exfoliant: false, status: "active" });
    localStorage.setItem("glass:nv-products", JSON.stringify(ps));
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    Object.keys(logs).slice(0, 12).forEach((d) => { logs[d].am.ghost = true; });
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "SHELF");
  const found = await page.evaluate(() => document.body.innerText.includes("Mystery Ampoule"));
  console.log("\n [orphan-category] visible on SHELF (editable/deletable)?", found ? "YES" : "NO — product is unreachable");
  await page.screenshot({ path: `${OUT}/shots/edge-orphan-shelf.png` });
  await go(page, "ROUTINE");
  console.log(" [orphan-category] appears in ROUTINE checklist?", await page.evaluate(() => document.body.innerText.includes("Mystery Ampoule")) ? "YES" : "NO");
  await go(page, "INSIGHTS");
  console.log(" [orphan-category] appears in INSIGHTS ingredient history?", await page.evaluate(() => document.body.innerText.includes("Mystery Ampoule")) ? "YES" : "NO");
  await pageErrors(page, messages, "orphan-category");
  await browser.close();
}

// ---------- 4. never-used product -> history modal ----------
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
  const modalText = await page.evaluate(() => {
    const m = document.querySelector('[role="dialog"]');
    return m ? m.innerText.replace(/\s+/g, " ").slice(0, 160) : "NO MODAL";
  });
  console.log("\n [never-used product] history modal header:", JSON.stringify(modalText));
  await page.screenshot({ path: `${OUT}/shots/edge-neverused-history.png` });
  console.log(" console:", messages.join(" | ") || "(clean)");
  await browser.close();
}

// ---------- 5. 50+ photos ----------
{
  const { browser, page, messages } = await boot({ days: 150 });
  const n = await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index"));
    const sizes = JSON.parse(localStorage.getItem("glass:nv-photo-sizes"));
    // clone the existing blobs into many more dates
    const src = Object.keys(idx)[0];
    const srcId = idx[src].am[0] || idx[src].pm[0];
    const srcPeriod = idx[src].am[0] ? "am" : "pm";
    const blob = localStorage.getItem(`glass:photo:${src}:${srcPeriod}:${srcId}`);
    let count = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!idx[ds]) idx[ds] = { am: [], pm: [] };
      const id = "bulk" + i;
      idx[ds].am.push(id);
      localStorage.setItem(`glass:photo:${ds}:am:${id}`, blob);
      sizes[`${ds}:am:${id}`] = new Blob([blob]).size;
      count++;
    }
    localStorage.setItem("glass:nv-photo-index", JSON.stringify(idx));
    localStorage.setItem("glass:nv-photo-sizes", JSON.stringify(sizes));
    return count;
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await go(page, "JOURNEY");
  await scrollRoot(page, 1400);
  const info = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^View all \d+ photos$/.test(b.textContent.trim()));
    const tiles = [...document.querySelectorAll("img")].filter((i) => i.parentElement && i.parentElement.dataset && i.parentElement.dataset.testid === "lazy-photo").length;
    return { viewAll: btn && btn.textContent.trim(), renderedTiles: tiles };
  });
  console.log(`\n [50+ photos] added ${n}; ${JSON.stringify(info)}`);
  await page.screenshot({ path: `${OUT}/shots/edge-manyphotos.png` });
  // storage quota with lots of photos
  await go(page, "INSIGHTS");
  const quota = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="storage-used"]');
    const warn = /close to the limit/.test(document.body.innerText);
    return { text: el && el.textContent.trim(), warn };
  });
  console.log(" [50+ photos] quota:", JSON.stringify(quota));
  console.log(" console:", messages.join(" | ") || "(clean)");
  await browser.close();
}
