import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5173/";
const out = process.argv[3] || "/tmp/screenshot.png";
// full page vs viewport-only
const fullPage = process.argv.includes("--full");
const scrollArg = process.argv.find((a) => a.startsWith("--scroll="));
const scrollY = scrollArg ? Number(scrollArg.split("=")[1]) : 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
if (scrollY) {
  await page.evaluate((y) => document.getElementById("root").scrollTo(0, y), scrollY);
  await page.waitForTimeout(200);
}
await page.screenshot({ path: out, fullPage });
await browser.close();
console.log("saved to", out);
