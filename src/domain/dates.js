

export function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s) { return new Date(s + "T00:00:00"); }

export function todayStr() { return fmtDate(new Date()); }

export function prettyDate(s) {
  const d = parseDate(s);
  const t = todayStr();
  const yest = addDays(t, -1);
  if (s === t) return "Today";
  if (s === yest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }

export function monthKey(s) { return s.slice(0, 7); }

export function uid() { return Math.random().toString(36).slice(2, 10); }

export function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / 86400000);
}

export function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/* ------------------------------- storage layer ------------------------------ */

// Only a fallback ceiling, used when the browser won't tell us the real one (older
// Safari has no StorageManager). Everywhere else the meter reports what the browser
// actually reports. The previous hardcoded 20MB was inherited from the Claude artifact
// runtime and was four times what localStorage actually allows.

export function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 5400) return plural(Math.round(s / 60), "minute") + " ago";
  if (s < 86400) return plural(Math.round(s / 3600), "hour") + " ago";
  return plural(Math.round(s / 86400), "day") + " ago";
}

export function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
