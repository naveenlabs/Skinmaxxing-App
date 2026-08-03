// Seeds the localStorage backend with a realistic multi-month dataset so the app can be
// exercised the way a real user's install behaves. Exported as a function so audit
// scripts can call it right after page load.
export const SEED_PRODUCTS = [
  { id: "p1", name: "COSRX Salicylic Acid Cleanser", category: "cleanser", time: "Both", tracked: false, exfoliant: true, status: "active" },
  { id: "p2", name: "Anua Rice 70 Glow Milky Toner", category: "toner", time: "Both", tracked: false, exfoliant: false, status: "active" },
  { id: "p3", name: "Tretinoin 0.025%", category: "treatment", time: "PM", tracked: true, exfoliant: true, status: "active" },
  { id: "p4", name: "COSRX Oil Free Moisturizing Lotion", category: "moisturizer", time: "Both", tracked: false, exfoliant: false, status: "active" },
  { id: "p5", name: "COSRX Hyaluronic Acid Intensive Cream", category: "moisturizer", time: "Both", tracked: false, exfoliant: false, status: "active" },
  { id: "p6", name: "COSRX Ultra Light Invisible Sunscreen", category: "sunscreen", time: "AM", tracked: false, exfoliant: false, status: "active" },
  { id: "p7", name: "Beauty of Joseon Glow Serum Propolis + Niacinamide", category: "serum", time: "AM", tracked: true, exfoliant: false, status: "active" },
  { id: "p8", name: "Laneige Lip Sleeping Mask", category: "lipcare", time: "PM", tracked: false, exfoliant: false, status: "trying" },
  { id: "p9", name: "The Ordinary Granactive Retinoid 2%", category: "treatment", time: "PM", tracked: false, exfoliant: true, status: "retired", retiredReason: "Too much on top of tret — pilled under moisturizer." },
  { id: "p10", name: "Kiehl's Creamy Eye Treatment with Avocado", category: "eyecream", time: "Both", tracked: false, exfoliant: false, status: "active" },
];

export function buildSeed({ days = 150, today }) {
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const base = today ? new Date(today + "T00:00:00") : new Date();
  const MOODS = ["Great", "Okay", "Dry", "Breakout", "Irritated"];
  const logs = {};
  // deterministic pseudo-random so runs are comparable
  let s = 20260730;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const ds = fmt(d);
    const roll = rnd();
    // ~12% of days entirely skipped, ~22% partial, rest full
    if (roll < 0.12) continue;
    const partial = roll < 0.34;
    const am = {};
    const pm = {};
    am.p1 = true; am.p2 = true; am.p7 = true;
    if (!partial || rnd() > 0.5) am.p4 = true;
    if (!partial || rnd() > 0.4) am.p6 = true;
    am.p10 = rnd() > 0.6;
    if (!partial) {
      pm.p1 = true; pm.p2 = true; pm.p5 = true;
      pm.p3 = rnd() > 0.45;
      pm.p8 = rnd() > 0.7;
      pm.p10 = rnd() > 0.5;
    } else if (rnd() > 0.5) {
      pm.p1 = true;
      pm.p5 = rnd() > 0.5;
    }
    const entry = { am, pm, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    if (rnd() > 0.45) entry.amMood = MOODS[Math.floor(rnd() * MOODS.length)];
    if (rnd() > 0.35) entry.pmMood = MOODS[Math.floor(rnd() * MOODS.length)];
    if (rnd() > 0.85) entry.pmNote = "Cheeks felt tight after cleansing — went heavier on the ceramide cream.";
    if (rnd() > 0.9) entry.amNote = "Woke up genuinely glowy.";
    if (d.getDay() === 0 && rnd() > 0.4) {
      entry.weeklyMood = ["Great week", "Steady", "Rough week", "Barely kept up"][Math.floor(rnd() * 4)];
      entry.weeklyNote = "Kept the PM routine every night except Friday. Skin's calmer than last week.";
    }
    logs[ds] = entry;
  }

  // three consecutive irritated nights ending today, to fire the irritation banner
  [0, 1, 2].forEach((i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const ds = fmt(d);
    if (!logs[ds]) logs[ds] = { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    logs[ds].pmMood = i === 1 ? "Dry" : "Irritated";
  });

  // photo dates: spread across the window so 30d/90d quick-compare has real targets
  const photoOffsets = [0, 0, 1, 3, 7, 12, 18, 26, 29, 31, 44, 58, 61, 72, 88, 91, 96, 104, 119, 133, 148];
  const photoIndex = {};
  const photoPlan = [];
  photoOffsets.forEach((off, n) => {
    const d = new Date(base);
    d.setDate(d.getDate() - off);
    const ds = fmt(d);
    const period = n % 3 === 0 ? "pm" : "am";
    const id = `seed${n}`;
    if (!photoIndex[ds]) photoIndex[ds] = { am: [], pm: [] };
    photoIndex[ds][period].push(id);
    photoPlan.push({ ds, period, id, hue: (n * 37) % 360 });
  });

  return { logs, photoIndex, photoPlan, products: SEED_PRODUCTS };
}

// Runs inside the page: writes everything into localStorage, generating real JPEG
// data URLs for photos via canvas.
export const seedInPage = async ({ products, logs, photoIndex, photoPlan }) => {
  const P = "glass:";
  localStorage.clear();
  localStorage.setItem(P + "nv-products", JSON.stringify(products));
  localStorage.setItem(P + "nv-logs", JSON.stringify(logs));
  localStorage.setItem(P + "nv-photo-index", JSON.stringify(photoIndex));

  const sizes = {};
  for (const { ds, period, id, hue } of photoPlan) {
    const c = document.createElement("canvas");
    c.width = 360; c.height = 480;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 360, 480);
    g.addColorStop(0, `hsl(${hue}, 42%, 62%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360}, 38%, 28%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 360, 480);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(ds.slice(5), 20, 60);
    ctx.font = "bold 54px sans-serif";
    ctx.fillText(period.toUpperCase(), 20, 130);
    ctx.beginPath();
    ctx.arc(180, 300, 90, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill();
    const url = c.toDataURL("image/jpeg", 0.72);
    localStorage.setItem(`${P}photo:${ds}:${period}:${id}`, url);
    sizes[`${ds}:${period}:${id}`] = new Blob([url]).size;
  }
  localStorage.setItem(P + "nv-photo-sizes", JSON.stringify(sizes));
  return Object.keys(sizes).length;
};
