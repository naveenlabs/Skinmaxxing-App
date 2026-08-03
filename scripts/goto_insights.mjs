import { chromium } from "playwright";
const out = process.argv[2];
const scrollArg = process.argv.find((a) => a.startsWith("--scroll="));
const scrollY = scrollArg ? Number(scrollArg.split("=")[1]) : 0;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator("nav button", { hasText: /^Insights$/i }).first().click();
await page.waitForTimeout(300);
if (scrollY) {
  await page.evaluate((y) => document.getElementById("root").scrollTo(0, y), scrollY);
  await page.waitForTimeout(200);
}
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });
await page.screenshot({ path: out });
await browser.close();
