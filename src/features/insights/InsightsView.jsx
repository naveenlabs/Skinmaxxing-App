// The Insights tab: streaks, consistency, mood and category analysis over all history.
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  ChartNoAxesColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Download,
  Droplet,
  Flame,
  Image as ImageIcon,
  Info,
  Moon,
  Package,
  Sparkles,
  Sun,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { AM_CARD_IMG, INSIGHTS_HEADER_IMG, PM_CARD_IMG } from "../../assets.js";
import { LazyPhoto } from "../../components/LazyPhoto.jsx";
import { Lightbox } from "../../components/Lightbox.jsx";
import { StorageMeter } from "../../components/StorageMeter.jsx";
import {
  Body,
  Card,
  EmptyState,
  Eyebrow,
  HeaderAction,
  LegendDot,
  MetaBar,
  PageHeader,
  ProgressRing,
  Section,
  Sheet,
  SheetHeader,
  Stagger,
  StaggerItem,
} from "../../components/primitives.jsx";
import { buildProductMonthGrid } from "../../domain/calendar.js";
import { CATS, MOODS, NEGATIVE_MOODS } from "../../domain/catalog.js";
import {
  addDays,
  fmtDate,
  monthKey,
  parseDate,
  plural,
  prettyDate,
  todayStr,
} from "../../domain/dates.js";
import { photoKey } from "../../domain/photos.js";
import {
  anyChecked,
  currentStreakDays,
  dayCompletionPct,
  dayStatus,
  isPeriodComplete,
  isRetired,
  longestStreakDays,
  productStreakDays,
  usageStats,
} from "../../domain/routine.js";
import { iconBtnStyle } from "../today/TodayView.jsx";
import { SPRING, TONES } from "../../styles/theme.js";

export function ProductHistoryModal({ product, logs, onClose }) {
  const [monthOffset, setMonthOffset] = useState(0);
  if (!product) return null;

  const dates = Object.keys(logs).sort();
  const usedDates = dates.filter((d) => (logs[d].am && logs[d].am[product.id]) || (logs[d].pm && logs[d].pm[product.id]));
  const count = usedDates.length;
  const first = usedDates[0];
  const last = usedDates[usedDates.length - 1];

  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const cells = buildProductMonthGrid(logs, product.id, year, month);
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Sheet onClose={onClose} z={155} labelledBy="history-title">
      <SheetHeader
        id="history-title"
        title={product.name}
        subtitle={count === 0
          // used to render "first Invalid Date · last Invalid Date"
          ? "Never used yet — check it off on Routine and it starts filling in here."
          : `Used ${plural(count, "day")} · first ${prettyDate(first)} · last ${prettyDate(last)}`}
        onClose={onClose}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month" className="u-tap" style={iconBtnStyle}>
          <ChevronLeft size={15} color="var(--text-2)" />
        </button>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{monthLabel}</span>
        <button onClick={() => setMonthOffset((o) => o + 1)} disabled={monthOffset >= 0} aria-label="Next month" className="u-tap"
          style={{ ...iconBtnStyle, opacity: monthOffset >= 0 ? 0.3 : 1 }}>
          <ChevronRight size={15} color="var(--text-2)" />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginBottom: 16 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="u-eyebrow" style={{ textAlign: "center", fontSize: 8.5 }}>{d}</div>
        ))}
        {cells.map((c, i) =>
          c ? (
            <div key={i} style={{
              aspectRatio: "1", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
              background: c.status === "both" ? "var(--gold)"
                : c.status === "am" || c.status === "pm" ? "rgba(243,201,140,0.28)"
                : c.status === "future" ? "transparent" : "rgba(255,255,255,0.045)",
              border: c.status === "future" ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              <span className="u-num" style={{
                fontSize: 10.5, fontWeight: c.status === "both" ? 700 : 500,
                color: c.status === "both" ? "#20150C" : c.status === "future" ? "rgba(255,255,255,0.12)" : "var(--text-2)",
              }}>
                {c.day}
              </span>
            </div>
          ) : <div key={i} />
        )}
      </div>

      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <LegendDot color="var(--gold)" label="AM + PM" />
        <LegendDot color="rgba(243,201,140,0.28)" label="One dose" />
        <LegendDot color="rgba(255,255,255,0.1)" label="Not used" />
      </div>
    </Sheet>
  );
}

export function ExportSheet({ onClose, onExportJSON }) {
  const [done, setDone] = useState(false);
  function handleExport() {
    onExportJSON();
    setDone(true);
    setTimeout(() => setDone(false), 2400);
  }
  return (
    <Sheet onClose={onClose} z={155} labelledBy="export-title">
      <SheetHeader
        id="export-title"
        title="Export your data"
        subtitle="It's yours — take it anywhere."
        onClose={onClose}
      />

      <motion.button
        onClick={handleExport}
        whileTap={{ scale: 0.985 }}
        transition={SPRING}
        className="u-tap"
        style={{
          width: "100%", textAlign: "left", borderRadius: 18, padding: 16, marginBottom: 10,
          display: "flex", alignItems: "flex-start", gap: 13,
          border: `1px solid ${done ? "var(--line-3)" : "var(--line-2)"}`,
          background: done ? "var(--gold-wash-2)" : "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))",
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: "var(--gold-wash-2)", border: "1px solid var(--line-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {done ? <Check size={16} color="var(--gold)" strokeWidth={3} /> : <Download size={16} color="var(--gold)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>
            {done ? "Downloaded" : "Everything, as JSON"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>
            Every product, every logged day, moods, notes and computed stats — plus the definitions
            behind each number. Paste it into Claude or ChatGPT and ask anything.
          </div>
        </div>
      </motion.button>

      <div style={{
        borderRadius: 18, padding: 16, display: "flex", alignItems: "flex-start", gap: 13,
        border: "1px dashed var(--line)", opacity: 0.55,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <ImageIcon size={16} color="var(--text-3)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>Photo bundle</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>
            Coming with the standalone version.
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* -------------------------------- journey view -------------------------------- */

/* ------------------------------- insights view ------------------------------- */

export function InsightsView({ products, logs, photoIndex = {}, photoCache = {}, loadPhoto, quotaUsedMB = 0, quotaPct = 0, quotaTotalMB = 0, onExport }) {
  const dates = Object.keys(logs).sort();
  const hasAnyLogs = dates.length > 0;
  const todayD = todayStr();
  const thisMonth = monthKey(todayD);
  const [lightbox, setLightbox] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);

  const firstDate = dates[0] || todayD;
  const rangeDays = useMemo(() => {
    if (!hasAnyLogs) return [];
    const out = [];
    for (let c = firstDate; c <= todayD; c = addDays(c, 1)) out.push(c);
    return out;
  }, [firstDate, todayD, hasAnyLogs]);

  const photoEntries = useMemo(() => {
    const list = [];
    Object.keys(photoIndex).forEach((d) => {
      const slot = photoIndex[d];
      (slot.am || []).forEach((id) => list.push({ date: d, period: "am", id }));
      (slot.pm || []).forEach((id) => list.push({ date: d, period: "pm", id }));
    });
    return list.sort((a, b) => (a.date === b.date ? (a.period < b.period ? -1 : 1) : a.date < b.date ? -1 : 1));
  }, [photoIndex]);

  // ---- monthly consistency (current) ----
  const monthDates = dates.filter((d) => monthKey(d) === thisMonth);
  const dayOfMonth = parseDate(todayD).getDate();
  const completeDaysThisMonth = monthDates.filter((d) => dayCompletionPct(d, logs, products) >= 100).length;
  const consistency = dayOfMonth ? Math.round((completeDaysThisMonth / dayOfMonth) * 100) : 0;

  // ---- longest streak ever + current streak (shared helpers — see currentStreakDays) ----
  const longest = longestStreakDays(logs, products);
  const currentStreak = currentStreakDays(logs, products);

  // ---- journey summary: totals + biggest gap ever ----
  let totalCheckins = 0;
  dates.forEach((d) => {
    const l = logs[d];
    totalCheckins += Object.values(l.am || {}).filter(Boolean).length + Object.values(l.pm || {}).filter(Boolean).length;
  });
  let biggestGap = 0, gapRun = 0;
  rangeDays.forEach((d) => {
    const l = logs[d];
    const missed = !(l && (anyChecked(l.am) || anyChecked(l.pm)));
    if (missed) { gapRun++; biggestGap = Math.max(biggestGap, gapRun); } else { gapRun = 0; }
  });

  // ---- partial-day credit breakdown, this month ----
  let fullDays = 0, partialDays = 0, missedDays = 0;
  const monthRangeSoFar = [];
  for (let c = thisMonth + "-01"; c <= todayD; c = addDays(c, 1)) monthRangeSoFar.push(c);
  monthRangeSoFar.forEach((d) => {
    const status = dayStatus(d, logs, products);
    if (status === "full") fullDays++;
    else if (status === "partial") partialDays++;
    else missedDays++;
  });
  const monthTotalDays = fullDays + partialDays + missedDays;

  // ---- mood distribution this month ----
  const moodCounts = {};
  MOODS.forEach((m) => (moodCounts[m] = 0));
  monthDates.forEach((d) => {
    const l = logs[d];
    [l.amMood, l.pmMood].forEach((m) => { if (m && moodCounts[m] !== undefined) moodCounts[m]++; });
  });
  const maxMoodCount = Math.max(1, ...Object.values(moodCounts));
  const totalMoodLogs = Object.values(moodCounts).reduce((a, b) => a + b, 0);

  // ---- 6-month consistency trend ----
  const monthTrend = [];
  for (let i = 5; i >= 0; i--) {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() - i);
    const mk = monthKey(fmtDate(base));
    const daysCounted = mk === thisMonth ? dayOfMonth : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const mDates = dates.filter((d) => monthKey(d) === mk);
    const complete = mDates.filter((d) => dayCompletionPct(d, logs, products) >= 100).length;
    const pct = daysCounted ? Math.round((complete / daysCounted) * 100) : 0;
    monthTrend.push({ label: base.toLocaleDateString(undefined, { month: "short" }), pct, isCurrent: mk === thisMonth, hasData: mDates.length > 0 });
  }
  const prevMonthEntry = monthTrend[4];
  const monthDelta = prevMonthEntry && prevMonthEntry.hasData ? consistency - prevMonthEntry.pct : null;

  // ---- AM vs PM split ----
  const amDays = dates.filter((d) => isPeriodComplete(d, logs, products, "AM")).length;
  const pmDays = dates.filter((d) => isPeriodComplete(d, logs, products, "PM")).length;
  const amPct = dates.length ? Math.round((amDays / dates.length) * 100) : 0;
  const pmPct = dates.length ? Math.round((pmDays / dates.length) * 100) : 0;

  // ---- skip-day pattern by weekday (worst + best) ----
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const missByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const fullByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const totalByWeekday = [0, 0, 0, 0, 0, 0, 0];
  rangeDays.forEach((d) => {
    const wd = parseDate(d).getDay();
    totalByWeekday[wd]++;
    const l = logs[d];
    if (!(l && (anyChecked(l.am) || anyChecked(l.pm)))) missByWeekday[wd]++;
    if (dayCompletionPct(d, logs, products) >= 100) fullByWeekday[wd]++;
  });
  let worstIdx = -1, worstRate = 0;
  missByWeekday.forEach((m, i) => {
    if (totalByWeekday[i] >= 2 && m > 0) {
      const rate = m / totalByWeekday[i];
      if (rate > worstRate) { worstRate = rate; worstIdx = i; }
    }
  });
  let bestIdx = -1, bestRate = 0;
  fullByWeekday.forEach((c, i) => {
    if (totalByWeekday[i] >= 2) {
      const rate = c / totalByWeekday[i];
      if (rate > bestRate) { bestRate = rate; bestIdx = i; }
    }
  });
  const skipPattern = rangeDays.length >= 14 && worstIdx >= 0 && worstRate >= 0.4
    ? `You miss ${weekdayNames[worstIdx]}s most often`
    : null;
  const bestDayPattern = rangeDays.length >= 14 && bestIdx >= 0 && bestRate >= 0.5 && bestIdx !== worstIdx
    ? `You're most consistent on ${weekdayNames[bestIdx]}s`
    : null;

  // ---- cautious correlation: moisturizer presence vs negative mood ----
  const moisturizerIds = new Set(products.filter((p) => p.category === "moisturizer").map((p) => p.id));
  let withMoist = [0, 0], withoutMoist = [0, 0];
  dates.forEach((d) => {
    const l = logs[d];
    if (!l.pmMood) return;
    const hasMoist = Object.keys(l.pm || {}).some((id) => l.pm[id] && moisturizerIds.has(id));
    const negative = NEGATIVE_MOODS.includes(l.pmMood);
    const bucket = hasMoist ? withMoist : withoutMoist;
    bucket[1]++;
    if (negative) bucket[0]++;
  });
  let correlation = null;
  if (withMoist[1] >= 5 && withoutMoist[1] >= 5) {
    const rateWith = withMoist[0] / withMoist[1];
    const rateWithout = withoutMoist[0] / withoutMoist[1];
    if (rateWithout > rateWith + 0.15) {
      correlation = `Nights without a moisturizer checked show more Dry/Irritated logs (${Math.round(rateWithout * 100)}% vs ${Math.round(rateWith * 100)}% with one).`;
    }
  }

  // ---- did the irritation banner actually change behavior? ----
  const exfoliantIds = new Set(products.filter((p) => p.exfoliant).map((p) => p.id));
  let bannerFired = 0, bannerResponded = 0;
  rangeDays.forEach((d) => {
    const last3 = [0, 1, 2].map((i) => { const l = logs[addDays(d, -i)]; return l ? l.pmMood : null; });
    const wouldFire = last3.every((m) => m && NEGATIVE_MOODS.includes(m));
    if (!wouldFire) return;
    const dayBeforeExfoliant = Object.keys(logs[addDays(d, -1)]?.pm || {}).some((id) => logs[addDays(d, -1)].pm[id] && exfoliantIds.has(id));
    const nextDay = addDays(d, 1);
    if (nextDay > todayD) return;
    const nextLog = logs[nextDay];
    if (!nextLog) return;
    bannerFired++;
    const nextExfoliant = Object.keys(nextLog.pm || {}).some((id) => nextLog.pm[id] && exfoliantIds.has(id));
    if (dayBeforeExfoliant && !nextExfoliant) bannerResponded++;
  });
  const bannerInsight = bannerFired >= 3
    ? `The irritation banner has shown ${bannerFired} times — you skipped an active the next night ${Math.round((bannerResponded / bannerFired) * 100)}% of those times.`
    : null;

  // ---- tracked products ----
  // A retired product's day-streak stops meaning anything, but it still stays listed —
  // dropping it entirely would make its whole tracked history look erased, when the logs
  // behind it are untouched. Same treatment as "Every product, by last use" below.
  const trackedInsights = products.filter((p) => p.tracked).map((p) => ({
    id: p.id, name: p.name, photo: p.photo, category: p.category,
    days: productStreakDays(logs, p.id),
    retired: isRetired(p),
    isRetinoid: /tretinoin|retinol|adapalene|retinoid/i.test(p.name),
  }));

  // ---- mood shift after starting a tracked product (speculative, gated) ----
  const moodShifts = products.filter((p) => p.tracked).map((p) => {
    const usedDates = dates.filter((d) => (logs[d].am && logs[d].am[p.id]) || (logs[d].pm && logs[d].pm[p.id]));
    if (usedDates.length === 0) return null;
    const startDate = usedDates[0];
    let beforeTotal = 0, beforeNeg = 0, afterTotal = 0, afterNeg = 0;
    for (let i = 1; i <= 14; i++) {
      const d = addDays(startDate, -i);
      const l = logs[d];
      if (l && l.pmMood) { beforeTotal++; if (NEGATIVE_MOODS.includes(l.pmMood)) beforeNeg++; }
    }
    for (let i = 0; i < 14; i++) {
      const d = addDays(startDate, i);
      if (d > todayD) break;
      const l = logs[d];
      if (l && l.pmMood) { afterTotal++; if (NEGATIVE_MOODS.includes(l.pmMood)) afterNeg++; }
    }
    if (beforeTotal < 5 || afterTotal < 5) return null;
    const beforeRate = beforeNeg / beforeTotal;
    const afterRate = afterNeg / afterTotal;
    const diff = afterRate - beforeRate;
    if (Math.abs(diff) < 0.15) return null;
    return { id: p.id, name: p.name, improved: diff < 0, magnitude: Math.round(Math.abs(diff) * 100) };
  }).filter(Boolean);

  // ---- full-year heatmap (only once there's enough history) ----
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const heatmapDays = [];
  for (let c = yearStart; c <= todayD; c = addDays(c, 1)) {
    heatmapDays.push({ d: c, status: dayStatus(c, logs, products), dow: parseDate(c).getDay() });
  }
  const showHeatmap = rangeDays.length >= 60;
  const heatmapCols = [];
  if (showHeatmap) {
    let col = new Array(7).fill(null);
    heatmapDays.forEach((cell) => {
      if (cell.dow === 0 && col.some((x) => x)) { heatmapCols.push(col); col = new Array(7).fill(null); }
      col[cell.dow] = cell;
    });
    heatmapCols.push(col);
  }

  // ---- ingredient usage history ----
  const stats = usageStats(products, logs);

  // ---- fading usage: quietly abandoned without being retired ----
  const fading = rangeDays.length >= 28 ? products.filter((p) => p.status !== "retired").map((p) => {
    let prior = 0, recent = 0;
    for (let i = 15; i <= 28; i++) {
      const l = logs[addDays(todayD, -i)];
      if (l && ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id]))) prior++;
    }
    for (let i = 0; i <= 13; i++) {
      const l = logs[addDays(todayD, -i)];
      if (l && ((l.am && l.am[p.id]) || (l.pm && l.pm[p.id]))) recent++;
    }
    return { id: p.id, name: p.name, prior, recent };
  }).filter((f) => f.prior >= 4 && f.recent <= 1) : [];

  // ---- habitual skipping: a step deliberately dropped most days is worth naming, since
  // skipping doesn't lower the bar and quietly caps those days below 100%
  const habitualSkips = (() => {
    const counts = {};
    for (let i = 0; i <= 13; i++) {
      const l = logs[addDays(todayD, -i)];
      if (!l) continue;
      ["am", "pm"].forEach((k) => {
        const arr = l.skip && l.skip[k];
        if (Array.isArray(arr)) arr.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      });
    }
    return Object.keys(counts)
      .filter((id) => counts[id] >= 5)
      .map((id) => ({ id, name: (products.find((p) => p.id === id) || {}).name, n: counts[id] }))
      .filter((x) => x.name)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2);
  })();

  // ---- category balance, all-time ----
  const categoryTotals = {};
  CATS.forEach((c) => (categoryTotals[c.id] = 0));
  products.forEach((p) => { categoryTotals[p.category] = (categoryTotals[p.category] || 0) + (stats[p.id]?.count || 0); });
  const categoryGrandTotal = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const categoryBalance = CATS.map((c) => ({ ...c, count: categoryTotals[c.id] || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // ---- weekly reflections ----
  const weeklyEntries = dates.filter((d) => logs[d].weeklyMood || logs[d].weeklyNote).sort((a, b) => (a < b ? 1 : -1));

  // ---- recent nightly/morning check-ins ----
  const noted = dates
    .filter((d) => (logs[d].amNote && logs[d].amNote.trim()) || (logs[d].pmNote && logs[d].pmNote.trim()) || logs[d].amMood || logs[d].pmMood)
    .sort((a, b) => (a < b ? 1 : -1)).slice(0, 6);

  return (
    <div>
      <PageHeader
        image={INSIGHTS_HEADER_IMG}
        eyebrow="Insights"
        icon={ChartNoAxesColumn}
        minHeight={248}
        focus="54% 46%"
        title="What the"
        italic="data says"
        action={<HeaderAction icon={Download} label="Export" onClick={() => setShowExport(true)} />}
      />

      <Body>
        <AnimatePresence>
          {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
        </AnimatePresence>

        {!hasAnyLogs ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing to read yet"
            body="Check off your first morning or night on Routine. Once there are a few days here, this page fills with streaks, patterns and trends."
          />
        ) : (
          <>
            {/* ---------- headline: consistency this month ---------- */}
            <Card style={{ padding: 20, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <ProgressRing pct={consistency} size={112} stroke={5}>
                  <span data-testid="consistency" className="u-display u-num" style={{ fontSize: 32, color: "var(--text)", lineHeight: 1 }}>{consistency}</span>
                  <span className="u-eyebrow" style={{ marginTop: 3, fontSize: 8 }}>percent</span>
                </ProgressRing>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Eyebrow>Consistency this month</Eyebrow>
                  <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8, lineHeight: 1.55 }}>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>{completeDaysThisMonth}</span> full {completeDaysThisMonth === 1 ? "day" : "days"} out of {dayOfMonth} so far.
                  </div>
                  {monthDelta !== null && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 5, marginTop: 12,
                      padding: "5px 10px", borderRadius: 999,
                      background: monthDelta >= 0 ? "var(--gold-wash)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${monthDelta >= 0 ? "var(--line-2)" : "var(--line)"}`,
                    }}>
                      {monthDelta >= 0
                        ? <TrendingUp size={12} color="var(--gold)" />
                        : <TrendingDown size={12} color="var(--text-3)" />}
                      <span className="u-num" style={{ fontSize: 11.5, color: monthDelta >= 0 ? "var(--gold)" : "var(--text-2)", fontWeight: 600 }}>
                        {Math.abs(monthDelta)}%
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>vs last month</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* ---------- streaks ---------- */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <Card tone="gold" style={{ flex: 1, padding: 15 }}>
                <Flame size={15} color="var(--gold)" />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 12 }}>
                  <span data-testid="insights-streak" className="u-display u-num" style={{ fontSize: 28, color: "var(--text)" }}>{currentStreak}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{currentStreak === 1 ? "day" : "days"}</span>
                </div>
                <Eyebrow style={{ marginTop: 5 }}>Current streak</Eyebrow>
              </Card>
              <Card style={{ flex: 1, padding: 15 }}>
                <Trophy size={15} color="var(--gold-2)" />
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 12 }}>
                  <span data-testid="insights-best" className="u-display u-num" style={{ fontSize: 28, color: "var(--text)" }}>{longest}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{longest === 1 ? "day" : "days"}</span>
                </div>
                <Eyebrow style={{ marginTop: 5 }}>Best ever</Eyebrow>
              </Card>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 11.5, color: "var(--text-3)", marginBottom: 26, lineHeight: 1.6 }}>
              <span>Since {parseDate(firstDate).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span><span style={{ color: "var(--text-2)" }}>{dates.length}</span> days tracked</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span><span style={{ color: "var(--text-2)" }}>{totalCheckins}</span> check-ins</span>
              {biggestGap > 1 && (<><span style={{ opacity: 0.35 }}>·</span><span>longest gap <span style={{ color: "var(--text-2)" }}>{biggestGap}d</span></span></>)}
            </div>

            {/* ---------- rhythm ---------- */}
            <Section title="Consistency, last 6 months">
              <Card style={{ padding: "18px 16px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 7, height: 152 }}>
                  {monthTrend.map((m, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, height: "100%", justifyContent: "flex-end" }}>
                      <span className="u-num" style={{ fontSize: 9.5, color: m.isCurrent ? "var(--gold)" : "var(--text-3)", fontWeight: m.isCurrent ? 700 : 500 }}>
                        {m.hasData || m.isCurrent ? `${m.pct}%` : ""}
                      </span>
                      <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end", maxWidth: 32 }}>
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${Math.max(m.hasData || m.isCurrent ? 4 : 1.5, m.pct)}%` }}
                          transition={{ duration: 0.75, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                          style={{
                            width: "100%", borderRadius: 6,
                            background: m.isCurrent
                              ? "linear-gradient(180deg, var(--gold), var(--gold-2))"
                              : "rgba(243,201,140,0.26)",
                            boxShadow: m.isCurrent ? "0 0 16px -6px rgba(243,201,140,0.8)" : "none",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 9.5, color: m.isCurrent ? "var(--gold)" : "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            {monthTotalDays > 0 && (
              <Section title="This month, day by day">
                <Card>
                  <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", marginBottom: 14, background: "rgba(255,255,255,0.05)" }}>
                    {[
                      { n: fullDays, bg: "linear-gradient(90deg, var(--gold-2), var(--gold))" },
                      { n: partialDays, bg: "rgba(243,201,140,0.34)" },
                      { n: missedDays, bg: "rgba(255,255,255,0.07)" },
                    ].map((seg, i) => seg.n > 0 && (
                      <motion.div
                        key={i}
                        initial={{ width: 0 }}
                        animate={{ width: `${(seg.n / monthTotalDays) * 100}%` }}
                        transition={{ duration: 0.7, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                        style={{ background: seg.bg }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <LegendDot color="var(--gold)" label={`${fullDays} full`} />
                    <LegendDot color="rgba(243,201,140,0.34)" label={`${partialDays} partial`} />
                    <LegendDot color="rgba(255,255,255,0.14)" label={`${missedDays} missed`} />
                  </div>
                </Card>
              </Section>
            )}

            {showHeatmap && (
              <Section title={`${new Date().getFullYear()}, at a glance`} hint="Every day this year — brighter means a complete day.">
                <Card style={{ overflowX: "auto" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {heatmapCols.map((col, ci) => (
                      <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {col.map((cell, ri) => (
                          <div
                            key={ri}
                            title={cell ? `${cell.d} — ${cell.status}` : undefined}
                            style={{
                              width: 8, height: 8, borderRadius: 2.5,
                              background: !cell ? "transparent"
                                : cell.status === "full" ? "var(--gold)"
                                : cell.status === "partial" ? "rgba(243,201,140,0.36)"
                                : "rgba(255,255,255,0.055)",
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>
            )}

            {/* ---------- morning vs night ---------- */}
            <Section title="Morning vs night" hint="How often each half of the routine gets finished.">
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { label: "Morning", pct: amPct, days: amDays, tone: "gold", img: AM_CARD_IMG, Ico: Sun, focus: "76% 52%" },
                  { label: "Night", pct: pmPct, days: pmDays, tone: "moon", img: PM_CARD_IMG, Ico: Moon, focus: "76% 44%" },
                ].map((c) => (
                  <div key={c.label} style={{
                    position: "relative", flex: 1, minHeight: 150, borderRadius: 18, overflow: "hidden",
                    border: `1px solid ${TONES[c.tone].line}`, background: "var(--ink-2)",
                    padding: 15, display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <img src={c.img} alt="" aria-hidden="true" style={{
                      position: "absolute", inset: 0, width: "100%", height: "100%",
                      objectFit: "cover", objectPosition: c.focus,
                    }} />
                    <div aria-hidden="true" style={{
                      position: "absolute", inset: 0,
                      background: `linear-gradient(160deg, rgba(10,7,5,0.96) 0%, rgba(10,7,5,0.86) 40%, rgba(10,7,5,0.35) 72%, rgba(10,7,5,0.1) 100%)`,
                    }} />
                    <div style={{ position: "relative" }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 999, marginBottom: 12,
                        border: `1px solid ${TONES[c.tone].line}`, background: TONES[c.tone].wash,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <c.Ico size={14} color={TONES[c.tone].fg} />
                      </div>
                      <Eyebrow>{c.label}</Eyebrow>
                      <div className="u-display u-num" style={{ fontSize: 30, color: TONES[c.tone].fg, marginTop: 4 }}>{c.pct}%</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{c.days} of {dates.length} days</div>
                    </div>
                    <div style={{ position: "relative", marginTop: 12 }}>
                      <MetaBar pct={c.pct} tone={c.tone} height={4} track="rgba(255,255,255,0.14)" />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* ---------- photo timeline ---------- */}
            {photoEntries.length > 0 && (
              <Section title="Your timeline" hint={`${plural(photoEntries.length, "photo")}, oldest first.`}>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 20px 6px", margin: "0 -20px" }}>
                  {photoEntries.map((e) => (
                    <LazyPhoto
                      key={`${e.date}:${e.period}:${e.id}`}
                      date={e.date} period={e.period} id={e.id}
                      loadPhoto={loadPhoto}
                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                      size={62} radius={13}
                      tag={e.period.toUpperCase()}
                      onClick={() => setLightbox(e)}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* ---------- patterns ---------- */}
            {(skipPattern || bestDayPattern || correlation || bannerInsight || fading.length > 0 || habitualSkips.length > 0) && (
              <Section title="Patterns worth noticing">
                <Stagger style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {[
                    bestDayPattern && { icon: Sparkles, tone: "gold", text: bestDayPattern },
                    skipPattern && { icon: AlertTriangle, tone: "rose", text: skipPattern },
                    ...fading.map((f) => ({
                      icon: Archive, tone: "rose", key: f.id,
                      text: <>Barely touched lately: <span style={{ color: "var(--gold)" }}>{f.name}</span> — {f.prior}× two weeks ago, just {f.recent}× since. Worth retiring?</>,
                    })),
                    ...habitualSkips.map((s) => ({
                      icon: CircleMinus, tone: "rose", key: `skip-${s.id}`,
                      text: <>You've skipped <span style={{ color: "var(--gold)" }}>{s.name}</span> on {s.n} of the last 14 days. Skipping doesn't lower the bar, so those days can't reach 100% — retire it if it's really out.</>,
                    })),
                    correlation && { icon: Droplet, tone: "gold", text: correlation },
                    bannerInsight && { icon: Info, tone: "gold", text: bannerInsight },
                  ].filter(Boolean).map((p, i) => (
                    <StaggerItem key={p.key || i}>
                      <div style={{
                        borderRadius: 16, padding: "13px 15px", display: "flex", gap: 11,
                        background: p.tone === "rose" ? "var(--rose-wash)" : "var(--gold-wash)",
                        border: `1px solid ${p.tone === "rose" ? "rgba(226,160,141,0.24)" : "var(--line-2)"}`,
                      }}>
                        <p.icon size={13} color={p.tone === "rose" ? "var(--rose)" : "var(--gold)"} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>{p.text}</span>
                      </div>
                    </StaggerItem>
                  ))}
                </Stagger>
              </Section>
            )}

            {/* ---------- where the steps go ---------- */}
            {categoryBalance.length > 0 && (
              <Section title="Where your steps go">
                <Card>
                  {categoryBalance.map((c, i) => {
                    const Icon = c.icon;
                    const pct = Math.round((c.count / categoryGrandTotal) * 100);
                    return (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: i === categoryBalance.length - 1 ? 0 : 11 }}>
                        <Icon size={12} color="var(--gold-2)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "var(--text-2)", width: 76, flexShrink: 0 }}>{c.label}</span>
                        <div style={{ flex: 1 }}>
                          <MetaBar pct={pct} height={5} />
                        </div>
                        <span className="u-num" style={{ fontSize: 10.5, color: "var(--text)", width: 30, textAlign: "right" }}>{pct}%</span>
                      </div>
                    );
                  })}
                </Card>
              </Section>
            )}

            {/* ---------- mood ---------- */}
            {totalMoodLogs > 0 && (
              <Section title="How skin's felt this month" hint={`${plural(totalMoodLogs, "check-in")} logged.`}>
                <Card>
                  {MOODS.map((m, i) => (
                    <div key={m} style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: i === MOODS.length - 1 ? 0 : 11 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-2)", width: 64, flexShrink: 0 }}>{m}</span>
                      <div style={{ flex: 1 }}>
                        <MetaBar pct={(moodCounts[m] / maxMoodCount) * 100} height={5} tone={NEGATIVE_MOODS.includes(m) ? "rose" : "gold"} />
                      </div>
                      <span className="u-num" style={{ fontSize: 10.5, color: moodCounts[m] ? "var(--text)" : "var(--text-3)", width: 18, textAlign: "right" }}>
                        {moodCounts[m]}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            )}

            {/* ---------- tracked products ---------- */}
            {trackedInsights.length > 0 && (
              <Section title="Tracked products">
                <Stagger style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {trackedInsights.map((t) => {
                    const TIcon = (CATS.find((c) => c.id === t.category) || {}).icon || Package;
                    return (
                      <StaggerItem key={t.id}>
                        <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 13 }}>
                          <div style={{
                            width: 42, height: 42, borderRadius: 999, flexShrink: 0, overflow: "hidden",
                            background: "rgba(255,255,255,0.05)", border: "1px solid var(--line-2)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {t.photo
                              ? <img src={t.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <TIcon size={15} color="var(--text-3)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                              <span style={{ fontSize: 13, color: t.retired ? "var(--text-2)" : "var(--text)", fontWeight: 500 }}>{t.name}</span>
                              <span className="u-num" style={{ fontSize: 13, color: t.retired ? "var(--text-3)" : t.days ? "var(--gold)" : "var(--text-3)", fontWeight: 600, flexShrink: 0 }}>
                                {t.retired ? "Retired" : t.days ? `Day ${t.days}` : "Paused"}
                              </span>
                            </div>
                            {!t.retired && t.isRetinoid && (
                              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5, lineHeight: 1.5 }}>
                                Most retinoid adjustment periods ease by week 4–6.
                              </div>
                            )}
                          </div>
                        </Card>
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              </Section>
            )}

            {/* ---------- ingredient history ---------- */}
            {products.length > 0 && (
              <Section title="Every product, by last use" hint="Tap any product for its full calendar.">
                <Card style={{ padding: "4px 16px" }}>
                  {[...products]
                    .sort((a, b) => {
                      const la = stats[a.id]?.last, lb = stats[b.id]?.last;
                      if (!la && !lb) return 0;
                      if (!la) return 1;
                      if (!lb) return -1;
                      return la < lb ? 1 : -1;
                    })
                    .map((p, i, arr) => {
                      const s = stats[p.id] || { count: 0, last: null };
                      const Icon = (CATS.find((c) => c.id === p.category) || {}).icon || Package;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setHistoryProduct(p.id)}
                          className="u-tap"
                          style={{
                            width: "100%", textAlign: "left", background: "none", border: "none",
                            display: "flex", alignItems: "center", gap: 13, padding: "13px 0",
                            borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none",
                          }}
                        >
                          <div style={{
                            width: 42, height: 42, borderRadius: 999, flexShrink: 0, overflow: "hidden",
                            background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: isRetired(p) ? 0.55 : 1,
                          }}>
                            {p.photo
                              ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <Icon size={15} color="var(--text-3)" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, lineHeight: 1.35 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                              {s.last ? `last used ${prettyDate(s.last).toLowerCase()}` : "not used yet"}
                              {isRetired(p) && " · retired"}
                            </div>
                          </div>
                          <span className="u-num" style={{ fontSize: 12, color: s.count ? "var(--gold)" : "var(--text-3)", flexShrink: 0, fontWeight: 600 }}>
                            {s.count}×
                          </span>
                          <ChevronRight size={14} color="var(--text-3)" style={{ flexShrink: 0 }} />
                        </button>
                      );
                    })}
                </Card>
              </Section>
            )}

            {/* ---------- speculative mood shifts ---------- */}
            {moodShifts.length > 0 && (
              <Section title="Since starting these" hint="Correlation only — plenty else could explain it.">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {moodShifts.map((m) => (
                    <Card key={m.id} style={{ padding: "13px 15px" }}>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
                        {m.improved ? "Fewer" : "More"} negative mood logs since starting{" "}
                        <span style={{ color: "var(--gold)" }}>{m.name}</span> ({m.magnitude}% shift)
                      </div>
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {/* ---------- reflections ---------- */}
            {weeklyEntries.length > 0 && (
              <Section title="Weekly reflections">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {weeklyEntries.slice(0, 5).map((d) => (
                    <Card key={d} style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: logs[d].weeklyNote ? 7 : 0 }}>
                        <span className="u-eyebrow">{prettyDate(d)}</span>
                        {logs[d].weeklyMood && (
                          <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600 }}>{logs[d].weeklyMood}</span>
                        )}
                      </div>
                      {logs[d].weeklyNote && (
                        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{logs[d].weeklyNote}</div>
                      )}
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {noted.length > 0 && (
              <Section title="Recent check-ins">
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {noted.map((d) => (
                    <Card key={d} style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                        <span className="u-eyebrow">{prettyDate(d)}</span>
                        <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                          {logs[d].amMood && (
                            <span style={{ fontSize: 10.5, color: "var(--gold)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Sun size={9} /> {logs[d].amMood}
                            </span>
                          )}
                          {logs[d].pmMood && (
                            <span style={{ fontSize: 10.5, color: "var(--moon)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Moon size={9} /> {logs[d].pmMood}
                            </span>
                          )}
                        </div>
                      </div>
                      {logs[d].amNote && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>{logs[d].amNote}</div>}
                      {logs[d].pmNote && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{logs[d].pmNote}</div>}
                    </Card>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ---------- storage (canonical copy; Journey shows the same component) ---------- */}
        <Section title="Storage">
          <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} totalMB={quotaTotalMB} hint="Photos are the bulk of this. Clean up old ones from Journey." />
        </Section>
      </Body>

      <AnimatePresence>
        {historyProduct && (
          <ProductHistoryModal
            product={products.find((p) => p.id === historyProduct)}
            logs={logs}
            onClose={() => setHistoryProduct(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightbox && (
          <Lightbox
            entry={lightbox}
            src={photoCache[photoKey(lightbox.date, lightbox.period, lightbox.id)]}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Header pill action, shared by Insights and Journey so the two Export buttons match.
