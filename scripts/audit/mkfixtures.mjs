import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage();
const urls = await p.evaluate(() => {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 1200;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 900, 1200);
    g.addColorStop(0, `hsl(${i * 47}, 55%, 60%)`);
    g.addColorStop(1, `hsl(${i * 47 + 60}, 45%, 25%)`);
    x.fillStyle = g; x.fillRect(0, 0, 900, 1200);
    x.fillStyle = "#fff"; x.font = "bold 140px sans-serif";
    x.fillText("U" + i, 60, 200);
    out.push(c.toDataURL("image/jpeg", 0.8));
  }
  return out;
});
urls.forEach((u, i) => fs.writeFileSync(path.join(dir, `up${i}.jpg`), Buffer.from(u.split(",")[1], "base64")));
await b.close();
console.log("wrote", urls.length, "valid jpegs to", dir);
