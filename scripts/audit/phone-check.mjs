// Confirms the app served over the LAN renders correctly on a real phone: the desktop
// mockup chrome must drop away, nothing may scroll horizontally, console must be clean.
// Usage: node scripts/audit/phone-check.mjs <outDir> <url>
import { chromium, devices } from "playwright";

const OUT = process.argv[2];
const URL = process.argv[3];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
// Skip the account gate — this audit is about layout on a real phone viewport.
await page.addInitScript(() => { try { localStorage.setItem("glass:auth-mode", "guest"); } catch {} });
const msgs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const geom = await page.evaluate(() => {
  const f = document.querySelector(".phone-frame");
  return {
    innerW: window.innerWidth,
    frameW: f.getBoundingClientRect().width,
    frameRadius: getComputedStyle(f).borderRadius,
    mockupChromeHidden:
      getComputedStyle(document.querySelector(".dynamic-island")).display === "none",
    horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    tabs: [...document.querySelectorAll("nav button")].map((b) => b.textContent.trim()),
  };
});
console.log(JSON.stringify(geom));

for (const t of ["Routine", "Shelf", "Insights", "Journey"]) {
  await page.locator("nav button", { hasText: new RegExp(`^${t}$`, "i") }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/phone-${t.toLowerCase()}.png` });
}

console.log("CONSOLE:", msgs.join(" | ") || "(clean)");
await browser.close();
