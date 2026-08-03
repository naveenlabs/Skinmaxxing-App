// Audit: compare tool with 1 photo, 2 photos, and with photos that were never
// scrolled into view (so never pulled into photoCache).
import { boot, go } from "./drive.mjs";

async function state(page) {
  return page.evaluate(() => {
    const slots = ["A","B"].map((s)=>document.querySelector(`[data-testid="compare-${s}"]`)).filter(Boolean).map((d) => {
      const img = d.querySelector("img");
      return img ? (img.getAttribute("src") ? "img:" + img.getAttribute("src").slice(-12) : "IMG_WITH_NO_SRC") : "empty";
    });
    const apart = [...document.querySelectorAll(".u-eyebrow, span, div")].map((e) => e.textContent.trim()).find((t) => /days apart/.test(t));
    const caps = [...document.querySelectorAll(".u-eyebrow, span, div")].map((e) => e.textContent.trim()).filter((t) => /(AM|PM)$/.test(t) && t.length < 24);
    return { slots, apart, caps };
  });
}

// ---- case 1: compare without ever rendering the gallery tiles for that photo ----
{
  const { browser, page, messages } = await boot({ days: 150 });
  await go(page, "JOURNEY");
  // straight into compare before scrolling the gallery at all
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText("vs 90 days").click();
  await page.waitForTimeout(1200);
  console.log("CASE A — vs 90d immediately after load (photo likely uncached):");
  console.log(" ", JSON.stringify(await state(page)));
  await page.screenshot({ path: process.argv[2] + "/compare-uncached.png" });
  console.log("  console:", messages.join(" | ") || "(clean)");
  await browser.close();
}

// ---- case 2: exactly one photo ----
{
  const { browser, page, messages } = await boot({ days: 20 });
  await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index"));
    const dates = Object.keys(idx).sort();
    const keep = dates[dates.length - 1];
    const kept = { [keep]: { am: idx[keep].am.slice(0, 1), pm: [] } };
    if (!kept[keep].am.length) { kept[keep].am = idx[keep].pm.slice(0, 1); }
    localStorage.setItem("glass:nv-photo-index", JSON.stringify(kept));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await go(page, "JOURNEY");
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText("vs 30 days").click();
  await page.waitForTimeout(900);
  console.log("\nCASE B — exactly ONE photo, clicked 'vs 30d ago':");
  console.log(" ", JSON.stringify(await state(page)));
  await page.screenshot({ path: process.argv[2] + "/compare-onephoto.png" });
  console.log("  console:", messages.join(" | ") || "(clean)");
  await browser.close();
}

// ---- case 3: exactly two photos, 2 days apart, asked for 90d ----
{
  const { browser, page, messages } = await boot({ days: 20 });
  await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index"));
    const dates = Object.keys(idx).sort();
    const a = dates[dates.length - 1], b = dates[dates.length - 2];
    const kept = {};
    kept[a] = { am: idx[a].am.slice(0, 1), pm: idx[a].am.length ? [] : idx[a].pm.slice(0, 1) };
    kept[b] = { am: idx[b].am.slice(0, 1), pm: idx[b].am.length ? [] : idx[b].pm.slice(0, 1) };
    localStorage.setItem("glass:nv-photo-index", JSON.stringify(kept));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await go(page, "JOURNEY");
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText("vs 90 days").click();
  await page.waitForTimeout(900);
  console.log("\nCASE C — TWO photos a few days apart, clicked 'vs 90d ago':");
  console.log(" ", JSON.stringify(await state(page)));
  console.log("  console:", messages.join(" | ") || "(clean)");
  await browser.close();
}
