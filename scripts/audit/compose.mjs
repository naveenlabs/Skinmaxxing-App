// Builds side-by-side before/after composites so the two versions can be judged against
// each other at the real iPhone viewport.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BEFORE = process.argv[2];
const AFTER = process.argv[3];
const OUT = process.argv[4];
const pages = process.argv[5] ? process.argv[5].split(",") : ["routine", "shelf", "insights", "journey"];
const suffix = process.argv[6] || "";

const b64 = (p) => "data:image/png;base64," + fs.readFileSync(p).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 1000 }, deviceScaleFactor: 1 });

for (const name of pages) {
  const bp = path.join(BEFORE, `${name}${suffix}.png`);
  const ap = path.join(AFTER, `${name}${suffix}.png`);
  if (!fs.existsSync(bp) || !fs.existsSync(ap)) { console.log("skip", name); continue; }
  await page.setContent(`
    <style>
      body { margin:0; background:#16181c; font-family:-apple-system,system-ui,sans-serif; display:flex; gap:40px; padding:28px 40px; align-items:flex-start; }
      figure { margin:0; }
      figcaption { color:#9aa3ad; font-size:15px; letter-spacing:.14em; text-transform:uppercase; margin-bottom:12px; font-weight:700; }
      .b figcaption { color:#8d949c; }
      .a figcaption { color:#F3C98C; }
      img { width:393px; display:block; border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,.6); }
      h1 { position:fixed; bottom:10px; right:26px; color:#4c545c; font-size:13px; letter-spacing:.2em; text-transform:uppercase; margin:0; }
    </style>
    <figure class="b"><figcaption>Before</figcaption><img src="${b64(bp)}"></figure>
    <figure class="a"><figcaption>After</figcaption><img src="${b64(ap)}"></figure>
    <h1>${name}${suffix}</h1>
  `);
  await page.waitForTimeout(250);
  const el = await page.locator("body");
  const box = await el.boundingBox();
  await page.setViewportSize({ width: 900, height: Math.ceil(box.height) + 20 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `cmp-${name}${suffix}.png`), fullPage: true });
  console.log("composed", name + suffix);
}
await browser.close();
