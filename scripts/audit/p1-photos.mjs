// Audit: photo upload, the "new selection replaces, capped at 5" rule, delete, and
// whether upload errors are visible from the Routine tab.
import fs from "node:fs";
import path from "node:path";
import { boot, go, scrollRoot } from "./drive.mjs";

const OUT = process.argv[2] || "/tmp";
const TMP = path.join(OUT, "fixtures");
fs.mkdirSync(TMP, { recursive: true });

const VALID = process.argv[3] || "/tmp/valid";
const files = [];
for (let i = 0; i < 7; i++) files.push(path.join(VALID, `up${i}.jpg`));

const notImage = path.join(TMP, "notes.txt");
fs.writeFileSync(notImage, "this is not an image");

const { browser, page, messages } = await boot({ days: 20 });

async function photoCounts() {
  return page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index") || "{}");
    const t = new Date();
    const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("glass:photo:" + ds));
    const sizes = JSON.parse(localStorage.getItem("glass:nv-photo-sizes") || "{}");
    return {
      todayAm: (idx[ds]?.am || []).length,
      todayPm: (idx[ds]?.pm || []).length,
      storedKeysForToday: keys.length,
      sizeEntries: Object.keys(sizes).length,
    };
  });
}

console.log("BEFORE:", JSON.stringify(await photoCounts()));

// ---- upload 7 at once to the AM slot (cap should be 5) ----
await go(page, "JOURNEY");
const chooser1 = page.waitForEvent("filechooser");
await page.getByText("Morning", { exact: true }).click();
const fc1 = await chooser1;
await fc1.setFiles(files);
await page.waitForTimeout(1800);
console.log("AFTER selecting 7 files (cap 5 expected):", JSON.stringify(await photoCounts()));
const errText = await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((s) => /up to 5 photos/.test(s.textContent));
  return el ? el.textContent.trim() : null;
});
console.log("  cap warning shown:", JSON.stringify(errText));

// ---- re-upload 3 to the SAME slot: should REPLACE, not stack ----
const chooser2 = page.waitForEvent("filechooser");
await page.getByText("Morning", { exact: true }).click();
const fc2 = await chooser2;
await fc2.setFiles(files.slice(0, 3));
await page.waitForTimeout(1800);
const afterReplace = await photoCounts();
console.log("AFTER re-selecting 3 for the same slot (expect todayAm=3, storedKeys=3):", JSON.stringify(afterReplace));

// ---- orphaned storage keys / size entries? ----
const orphans = await page.evaluate(() => {
  const idx = JSON.parse(localStorage.getItem("glass:nv-photo-index") || "{}");
  const live = new Set();
  Object.keys(idx).forEach((d) => {
    (idx[d].am || []).forEach((id) => live.add(`photo:${d}:am:${id}`));
    (idx[d].pm || []).forEach((id) => live.add(`photo:${d}:pm:${id}`));
  });
  const stored = Object.keys(localStorage).filter((k) => k.startsWith("glass:photo:")).map((k) => k.slice(6));
  const sizes = Object.keys(JSON.parse(localStorage.getItem("glass:nv-photo-sizes") || "{}"));
  return {
    orphanBlobs: stored.filter((k) => !live.has(k)),
    orphanSizes: sizes.filter((k) => !live.has("photo:" + k)),
  };
});
console.log("ORPHANS after replace:", JSON.stringify(orphans));

// ---- non-image file: is the error visible? ----
console.log("\n--- non-image upload from JOURNEY tab ---");
const chooser3 = page.waitForEvent("filechooser");
await page.getByText("Night", { exact: true }).click();
const fc3 = await chooser3;
await fc3.setFiles([notImage]);
await page.waitForTimeout(900);
const journeyErr = await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((s) => /doesn't look like an image/.test(s.textContent));
  return el ? el.textContent.trim() : null;
});
console.log("  error visible on Journey:", JSON.stringify(journeyErr));

console.log("\n--- non-image upload from ROUTINE tab ---");
await go(page, "ROUTINE");
const chooser4 = page.waitForEvent("filechooser");
await page.locator("button:has(svg.lucide-camera)").first().click();
const fc4 = await chooser4;
await fc4.setFiles([notImage]);
await page.waitForTimeout(900);
const routineErr = await page.evaluate(() => {
  const t = document.body.innerText;
  return /doesn't look like an image/.test(t) ? "VISIBLE" : "NOT VISIBLE ANYWHERE ON SCREEN";
});
console.log("  error feedback on Routine:", routineErr);
await page.screenshot({ path: `${OUT}/shots/routine-upload-error.png` });

// ---- delete a photo via lightbox ----
console.log("\n--- delete via lightbox ---");
await go(page, "JOURNEY");
await scrollRoot(page, 1500);
const before = await photoCounts();
await page.locator('[data-testid="lazy-photo"]').first().click();
await page.waitForTimeout(500);
const delBtn = page.getByText("Delete", { exact: true });
console.log("  delete button reachable:", (await delBtn.count()) > 0);
await delBtn.first().click();
await page.waitForTimeout(900);
const after = await photoCounts();
console.log("  before:", JSON.stringify(before), "after:", JSON.stringify(after));

console.log("\n--- CONSOLE ---");
console.log(messages.join("\n") || "(clean)");
await browser.close();
