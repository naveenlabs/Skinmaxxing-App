// Audit: does the JSON export produce complete, correct data? Downloads it for real
// and cross-checks against what the UI claims, including a deleted-product reference.
import fs from "node:fs";
import { boot, go } from "./drive.mjs";

const OUT = process.argv[2] || "/tmp";
const { browser, page, messages } = await boot({ days: 150 });

// delete a product that has plenty of logged history, to create a stale reference
await go(page, "SHELF");
await page.evaluate(() => {
  const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
  localStorage.setItem("glass:nv-products", JSON.stringify(ps.filter((p) => p.id !== "p2")));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);

await go(page, "INSIGHTS");
const uiNumbers = await page.evaluate(() => {
  const grab = (label) => {
    const el = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label);
    return el ? el.parentElement.querySelector(".font-display")?.textContent : null;
  };
  const since = [...document.querySelectorAll("div")].find((d) => d.textContent.startsWith("Since "));
  return { currentStreak: grab("current streak"), bestStreak: grab("best streak"), since: since && since.textContent.replace(/\s+/g, " ").trim() };
});
console.log("UI SAYS:", JSON.stringify(uiNumbers));

await page.getByText("Export", { exact: true }).first().click();
await page.waitForTimeout(400);
const dl = page.waitForEvent("download");
await page.getByText("Everything, as JSON").click();
const download = await dl;
const name = download.suggestedFilename();
const path = `${OUT}/${name}`;
await download.saveAs(path);
console.log("DOWNLOADED:", name);

const data = JSON.parse(fs.readFileSync(path, "utf8"));
console.log("\nTOP-LEVEL KEYS:", Object.keys(data).join(", "));
console.log("app:", data.app);
console.log("summary:", data.summary);
console.log("\ninsights:", JSON.stringify({
  totalDaysTracked: data.insights.totalDaysTracked,
  currentOverallStreak: data.insights.currentOverallStreak,
  longestStreakEver: data.insights.longestStreakEver,
  amAdherence: data.insights.amAdherence,
  pmAdherence: data.insights.pmAdherence,
}, null, 1));

const dayKeys = Object.keys(data.dailyLogs);
const sample = data.dailyLogs[dayKeys[dayKeys.length - 1]];
console.log("\nlast dailyLog:", JSON.stringify(sample, null, 1));

// stale reference check: p2 was deleted, so any day that used it should not leak a raw id
const leaked = new Set();
Object.values(data.dailyLogs).forEach((d) => {
  [...d.amProductsUsed, ...d.pmProductsUsed].forEach((n) => {
    if (!/[a-z]/i.test(n) || /^p\d+$/.test(n) || n.length < 6) leaked.add(n);
  });
});
console.log("\nRAW/UNRESOLVED PRODUCT IDS LEAKED INTO dailyLogs:", JSON.stringify([...leaked]));

console.log("\nproduct entry shape:", JSON.stringify(data.products[0], null, 1));
console.log("productStats entry shape:", JSON.stringify(data.productStats[0], null, 1));
console.log("\nphotos:", JSON.stringify({ totalCount: data.photos.totalCount, totalApproxSizeMB: data.photos.totalApproxSizeMB, first: data.photos.entries[0] }, null, 1));
console.log("\nmonthlyTrend last 2:", JSON.stringify(data.insights.monthlyConsistencyTrend.slice(-2), null, 1));
console.log("\ncategoryBalance:", JSON.stringify(data.insights.categoryBalanceAllTime));
console.log("\nzero-size photo entries:", data.photos.entries.filter((e) => !e.approxSizeKB).length, "of", data.photos.entries.length);
console.log("\n--- CONSOLE ---", messages.join("\n") || "(clean)");
await browser.close();
