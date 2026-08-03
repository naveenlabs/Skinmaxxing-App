// Sample dominant colours out of each header photograph so the palette is derived from
// the images rather than guessed.
import { chromium } from "playwright";
import fs from "node:fs";
const imgs = fs.readdirSync("src/assets").filter((f) => /\.(jpg|png)$/.test(f));
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:5173/");
for (const name of imgs) {
  const res = await p.evaluate(async (n) => {
    const img = new Image();
    img.src = "/src/assets/" + n;
    await img.decode();
    const c = document.createElement("canvas");
    const W = 120, H = Math.round((img.height / img.width) * 120);
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    // bucket into coarse HSL bins, weight by saturation*luminance presence
    const bins = new Map();
    const toHsl = (r, g, bl) => {
      r /= 255; g /= 255; bl /= 255;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      let h = 0, s = 0; const l = (mx + mn) / 2;
      const dd = mx - mn;
      if (dd) {
        s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
        if (mx === r) h = ((g - bl) / dd + (g < bl ? 6 : 0));
        else if (mx === g) h = (bl - r) / dd + 2;
        else h = (r - g) / dd + 4;
        h *= 60;
      }
      return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    };
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]);
      const key = `${Math.round(h / 12) * 12},${Math.round(s / 12) * 12},${Math.round(l / 10) * 10}`;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    const top = [...bins.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 7);
    const total = W * H;
    // also the brightest saturated accent (the "glow" in each photo)
    let accent = null, bestScore = -1;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]);
      const score = s * (l > 45 && l < 88 ? 1 : 0.15) + l * 0.35;
      if (score > bestScore) { bestScore = score; accent = [h, s, l]; }
    }
    return {
      top: top.map(([k, v]) => ({ hsl: k, pct: +((v / total) * 100).toFixed(1) })),
      accent,
    };
  }, name);
  console.log(`\n${name}`);
  res.top.forEach((t) => {
    const [h, s, l] = t.hsl.split(",").map(Number);
    console.log(`   hsl(${h} ${s}% ${l}%)  ${String(t.pct).padStart(5)}%`);
  });
  console.log(`   accent -> hsl(${res.accent[0]} ${res.accent[1]}% ${res.accent[2]}%)`);
}
await b.close();
