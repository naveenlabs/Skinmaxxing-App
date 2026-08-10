import { fmtDate, todayStr } from "./dates.js";
import { dayStatus } from "./routine.js";

// One definition of the day-status colours, shared by the month grid, the year overview
// and both calendar legends — these were three separate copies before.
export function statusColorFor(status) {
  if (status === "full") return "var(--gold)";
  if (status === "partial") return "rgba(243,201,140,0.34)";
  return "rgba(255,255,255,0.055)";
}

export function buildMonthGrid(logs, year, month, photoIndex = {}, products = []) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month, d));
    let status = ds > todayStr() ? "future" : dayStatus(ds, logs, products);
    const ph = photoIndex[ds];
    const hasPhoto = !!(ph && ((ph.am && ph.am.length) || (ph.pm && ph.pm.length)));
    cells.push({ ds, day: d, status, hasPhoto });
  }
  return cells;
}

export function buildProductMonthGrid(logs, productId, year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(new Date(year, month, d));
    const l = logs[ds];
    const usedAm = l && l.am && l.am[productId];
    const usedPm = l && l.pm && l.pm[productId];
    let status = "none";
    if (usedAm && usedPm) status = "both"; else if (usedAm) status = "am"; else if (usedPm) status = "pm";
    if (ds > todayStr()) status = "future";
    cells.push({ ds, day: d, status });
  }
  return cells;
}
