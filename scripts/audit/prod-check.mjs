import { chromium } from "playwright";
import { buildSeed, seedInPage } from "./seed.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
const msgs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") msgs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.evaluate(seedInPage, buildSeed({ days: 150 }));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  const probe = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "") : null;
  };
  return {
    families: [...new Set(loaded)],
    displayEl: probe(".u-display"),
    bodyEl: getComputedStyle(document.body.firstElementChild).fontFamily.split(",")[0].replace(/["']/g, ""),
  };
});
console.log("FONTS:", JSON.stringify(fonts, null, 1));

for (const t of ["Routine", "Shelf", "Insights", "Journey"]) {
  await page.locator("nav button", { hasText: new RegExp(`^${t}$`, "i") }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${process.argv[2]}/prod-${t.toLowerCase()}.png` });
}
console.log("PROD CONSOLE:", msgs.join("\n") || "(clean)");
await browser.close();
