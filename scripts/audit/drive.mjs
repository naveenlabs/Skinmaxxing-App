// Shared Playwright harness: boots the app with a seeded dataset and returns a page.
import { chromium } from "playwright";
import { buildSeed, seedInPage } from "./seed.mjs";

export const VIEWPORT = { width: 393, height: 852 };

export async function boot({ seed = true, days = 150, today = null, headless = true, empty = false, products = null } = {}) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const messages = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") messages.push(`[${t}] ${m.text()}`);
  });
  page.on("pageerror", (e) => messages.push(`[pageerror] ${e.message}\n${e.stack || ""}`));

  // Runs before the app on every navigation, so the account gate never stands between
  // an audit and the screen it's checking.
  await page.addInitScript(() => { try { localStorage.setItem("glass:auth-mode", "guest"); } catch {} });

  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  if (empty) {
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("glass:auth-mode", "guest"); });
  } else if (seed) {
    const data = buildSeed({ days, today });
    if (products) data.products = products;
    const n = await page.evaluate(seedInPage, data);
    if (!n) throw new Error("seed wrote no photos");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  return { browser, page, messages };
}

export async function go(page, tab) {
  // tab labels are uppercased in CSS, so match the DOM text case-insensitively
  const name = tab.charAt(0).toUpperCase() + tab.slice(1).toLowerCase();
  await page.locator("nav button", { hasText: new RegExp(`^${name}$`, "i") }).first().click();
  await page.waitForTimeout(650);
}

export async function scrollRoot(page, y) {
  await page.evaluate((v) => document.getElementById("root").scrollTo(0, v), y);
  await page.waitForTimeout(350);
}

export async function shot(page, path) {
  await page.screenshot({ path });
}

// Opens an arbitrary past date on the Routine page via the Journey calendar. Walks back
// a month at a time (up to 6) since the calendar only renders one month at once, so a
// date from a prior month isn't on screen until you navigate to it.
export async function openPastDate(page, dateStr) {
  await go(page, "JOURNEY");
  await scrollRoot(page, 900);
  for (let i = 0; i < 6; i++) {
    const found = await page.evaluate((d) => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith(d));
      if (btn) { btn.click(); return true; }
      return false;
    }, dateStr);
    if (found) { await page.waitForTimeout(500); await go(page, "ROUTINE"); await page.waitForTimeout(400); return true; }
    const prevMonth = page.getByLabel("Previous month").first();
    if (!(await prevMonth.count())) break;
    await prevMonth.click();
    await page.waitForTimeout(350);
  }
  return false;
}

// Reads the app's own computed numbers straight off the DOM by text probing.
export async function textOf(page, selectorText) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll("*")].find((n) => n.textContent.trim() === t);
    return el ? el.textContent : null;
  }, selectorText);
}
