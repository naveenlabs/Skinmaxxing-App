// Verifies the app is usable with prefers-reduced-motion, and that interactive elements
// carry accessible names.
import { chromium } from "playwright";
import { buildSeed, seedInPage } from "./seed.mjs";
const OUT = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
const page = await ctx.newPage();
const msgs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") msgs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(seedInPage, buildSeed({ days: 150 }));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

for (const t of ["Routine", "Shelf", "Insights", "Journey"]) {
  await page.locator("nav button", { hasText: new RegExp(`^${t}$`, "i") }).first().click();
  await page.waitForTimeout(600);
  const vis = await page.evaluate(() => {
    const b = document.body;
    return { text: b.innerText.length, painted: document.querySelectorAll("img").length };
  });
  console.log(` reduced-motion ${t}: text=${vis.text} imgs=${vis.painted}`);
  await page.screenshot({ path: `${OUT}/rm-${t.toLowerCase()}.png` });
}

// hero drift must be off
const anim = await page.evaluate(() => {
  const el = document.querySelector(".u-hero-img");
  return el ? getComputedStyle(el).animationName : "no-hero";
});
console.log(" hero drift animation under reduced motion:", anim);

// buttons without accessible names
const unnamed = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").trim();
    return !t && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby");
  }).length
);
console.log(" buttons with no accessible name:", unnamed);
console.log(" CONSOLE:", msgs.join("\n") || "(clean)");
await browser.close();
