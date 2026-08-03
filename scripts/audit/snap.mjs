import { boot, go, scrollRoot } from "./drive.mjs";
const OUT = process.argv[2];
const tabs = process.argv[3] ? process.argv[3].split(",") : ["ROUTINE","SHELF","INSIGHTS","JOURNEY"];
const { browser, page, messages } = await boot({ days: 150 });
for (const t of tabs) {
  await go(page, t);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${t.toLowerCase()}.png` });
  const h = await page.evaluate(() => document.getElementById("root").scrollHeight);
  for (const [i, y] of [Math.round(h*0.33), Math.round(h*0.62), Math.max(0,h-852)].entries()) {
    await scrollRoot(page, y);
    await page.screenshot({ path: `${OUT}/${t.toLowerCase()}-${i+2}.png` });
  }
  await scrollRoot(page, 0);
}
console.log("CONSOLE:", messages.join("\n") || "(clean)");
await browser.close();
