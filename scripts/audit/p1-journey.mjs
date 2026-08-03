// Audit: Journey — gallery grid sizing/pagination/grouping, compare tool (quick compare,
// clear, mode reset, date picker), lightbox, clean-up action.
import { boot, go, scrollRoot } from "./drive.mjs";

const OUT = process.argv[2] || "/tmp";
const { browser, page, messages } = await boot({ days: 150 });
await go(page, "JOURNEY");

// ---------- gallery grid sizing ----------
await scrollRoot(page, 1400);
const grid = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll("img")]
    .map((i) => i.parentElement)
    .filter((d) => d && d.dataset && d.dataset.testid === "lazy-photo");
  return tiles.slice(0, 6).map((t) => {
    const r = t.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
});
console.log("GALLERY TILE SIZES:", JSON.stringify(grid));

// ---------- pagination ----------
const viewAll = page.getByText(/^View all \d+ photos$/);
const hasViewAll = await viewAll.count();
console.log("View-all button present:", hasViewAll > 0, hasViewAll ? await viewAll.first().textContent() : "");
const tileCountCollapsed = await page.evaluate(() => document.querySelectorAll('[data-testid="lazy-photo"]').length);
console.log("collapsed tile count (approx):", tileCountCollapsed);

if (hasViewAll) {
  await viewAll.first().click();
  await page.waitForTimeout(600);
  const groups = await page.evaluate(() => {
    const months = [...document.querySelectorAll(".u-eyebrow, span, div")]
      .map((e) => e.textContent.trim())
      .filter((t) => /^[A-Z]+ \d{4}$/.test(t.toUpperCase()) && /\d{4}/.test(t));
    return months;
  });
  console.log("expanded month group headers:", JSON.stringify(groups));
  const showLess = page.getByText("Show less");
  console.log("Show less present:", (await showLess.count()) > 0);
  await showLess.first().click();
  await page.waitForTimeout(400);
}

// ---------- compare mode ----------
await page.getByText("Compare", { exact: true }).first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/compare-empty.png` });

async function compareState() {
  return page.evaluate(() => {
    const slots = ["A","B"].map((s)=>document.querySelector(`[data-testid="compare-${s}"]`)).filter(Boolean).map((d) => {
      const img = d.querySelector("img");
      return { hasImg: !!img, src: img ? (img.getAttribute("src") || "MISSING") .slice(0, 30) : null, w: Math.round(d.getBoundingClientRect().width) };
    });
    const labels = [...document.querySelectorAll(".u-eyebrow, span, div")]
      .map((e) => e.textContent.trim())
      .filter((t) => /\d+ days apart|AM$|PM$/.test(t));
    const btn = (txt) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === txt);
      return b ? { border: b.style.border, bg: b.style.background, color: b.style.color } : null;
    };
    return { slots, labels, b30: btn("vs 30 days"), b90: btn("vs 90 days"), clear: !!btn("Clear") };
  });
}

console.log("\n--- quick compare: vs 30d ---");
await page.getByText("vs 30 days").click();
await page.waitForTimeout(700);
console.log(JSON.stringify(await compareState(), null, 1));
await page.screenshot({ path: `${OUT}/compare-30.png` });

console.log("\n--- quick compare: vs 90d ---");
await page.getByText("vs 90 days").click();
await page.waitForTimeout(700);
console.log(JSON.stringify(await compareState(), null, 1));
await page.screenshot({ path: `${OUT}/compare-90.png` });

console.log("\n--- Clear ---");
await page.getByText("Clear", { exact: true }).click();
await page.waitForTimeout(500);
console.log(JSON.stringify(await compareState(), null, 1));

// ---------- date-based picker ----------
console.log("\n--- picker (by date) ---");
await page.locator('[data-testid="compare-A"]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/picker-date.png` });
const pickerDates = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="lazy-photo"]')].map((d) => d.textContent.trim()).filter((t) => t.length && t.length < 60).slice(0, 6)
);
console.log("picker date rows:", JSON.stringify(pickerDates));
await page.getByText("All photos").click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/picker-all.png` });
// pick the first photo
await page.locator('[data-testid="lazy-photo"]').first().click();
await page.waitForTimeout(600);
console.log("after manual pick:", JSON.stringify(await compareState(), null, 1));

// ---------- leaving and returning to compare ----------
console.log("\n--- switch to Gallery then back to Compare ---");
await page.getByText("Gallery", { exact: true }).click();
await page.waitForTimeout(400);
await page.getByText("Compare", { exact: true }).first().click();
await page.waitForTimeout(500);
console.log("state after round trip:", JSON.stringify(await compareState(), null, 1));

console.log("\n--- CONSOLE ---");
console.log(messages.join("\n") || "(clean)");
await browser.close();
