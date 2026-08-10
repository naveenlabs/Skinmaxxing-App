// The Journey tab: the calendar, the photo gallery and comparisons.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Images,
  Loader2,
  Moon,
  Plus,
  Sun,
  X,
} from "lucide-react";
import { JOURNEY_HEADER_IMG } from "../../assets.js";
import { LazyPhoto } from "../../components/LazyPhoto.jsx";
import { Lightbox } from "../../components/Lightbox.jsx";
import { StorageMeter } from "../../components/StorageMeter.jsx";
import {
  Body,
  Card,
  ConfirmModal,
  EmptyState,
  Eyebrow,
  GhostButton,
  HeaderAction,
  LegendDot,
  PageHeader,
  Pill,
  PrimaryButton,
  Section,
  Sheet,
  SheetHeader,
} from "../../components/primitives.jsx";
import { buildMonthGrid, statusColorFor } from "../../domain/calendar.js";
import {
  addDays,
  monthKey,
  parseDate,
  plural,
  prettyDate,
  todayStr,
} from "../../domain/dates.js";
import { GALLERY_PAGE_SIZE, MAX_PHOTOS_PER_PICK, photoKey } from "../../domain/photos.js";
import { ExportSheet } from "../insights/InsightsView.jsx";
import { iconBtnStyle } from "../today/TodayView.jsx";
import { SPRING, TONES } from "../../styles/theme.js";

/* -------------------------------- journey view -------------------------------- */

export function YearOverview({ year, logs, photoIndex, selectedDate, onPickDay, products = [] }) {
  const months = Array.from({ length: 12 }, (_, m) => m);
  return (
    <div style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, paddingTop: 2 }}>
      {months.map((m) => {
        const cells = buildMonthGrid(logs, year, m, photoIndex, products);
        const label = new Date(year, m, 1).toLocaleDateString(undefined, { month: "long" });
        const fullCount = cells.filter((c) => c && c.status === "full").length;
        return (
          <div key={m}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <Eyebrow>{label}</Eyebrow>
              <span className="u-num" style={{ fontSize: 9.5, color: fullCount ? "var(--gold)" : "var(--text-3)" }}>
                {fullCount ? `${fullCount} full` : "—"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {cells.map((c, i) =>
                c ? (
                  <button
                    key={i}
                    onClick={() => c.status !== "future" && onPickDay(c.ds)}
                    disabled={c.status === "future"}
                    aria-label={c.ds}
                    className="u-tap"
                    style={{
                      aspectRatio: "1", borderRadius: 4, padding: 0,
                      background: c.status === "future" ? "transparent" : statusColorFor(c.status),
                      border: c.ds === selectedDate ? "1px solid var(--text)" : "1px solid transparent",
                    }}
                  />
                ) : <div key={i} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One definition of the day-status colours, shared by the month grid, the year overview
// and both calendar legends — these were three separate copies before.

export function JourneyView({ products, logs, selectedDate, setSelectedDate, setTab, photoIndex, photoCache, loadPhoto, onTriggerPhoto, onDelete, onDeleteMany, quotaUsedMB, quotaPct, quotaTotalMB, onExport }) {
  const [showExport, setShowExport] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [calView, setCalView] = useState("month"); // 'month' | 'year'
  const [previewDate, setPreviewDate] = useState(null);
  const [mode, setMode] = useState("grid");
  const [viewing, setViewing] = useState(null); // {date, period, id} | null
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [compareA, setCompareA] = useState(null); // {date, period, id} | null
  const [compareB, setCompareB] = useState(null);
  const [quickDays, setQuickDays] = useState(null); // 30 | 90 | null — which quick-compare preset is active
  const [compareNote, setCompareNote] = useState(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [picking, setPicking] = useState(null); // 'A' | 'B' | null
  const [pickerMode, setPickerMode] = useState("date"); // 'date' | 'all'
  const [pickerDate, setPickerDate] = useState(null); // drill-down date when pickerMode === 'date'
  const [galleryExpanded, setGalleryExpanded] = useState(false);

  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const cells = useMemo(() => buildMonthGrid(logs, year, month, photoIndex, products), [logs, year, month, photoIndex, products]);
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // flattened photo entries, newest first
  const entries = useMemo(() => {
    const list = [];
    Object.keys(photoIndex).forEach((d) => {
      const slot = photoIndex[d];
      (slot.am || []).forEach((id) => list.push({ date: d, period: "am", id }));
      (slot.pm || []).forEach((id) => list.push({ date: d, period: "pm", id }));
    });
    return list.sort((a, b) => (a.date === b.date ? (a.period === b.period ? 0 : a.period < b.period ? -1 : 1) : a.date < b.date ? 1 : -1));
  }, [photoIndex]);

  function entryKey(e) { return `${e.date}:${e.period}:${e.id}`; }
  function entryLabel(e) { return `${prettyDate(e.date)} ${e.period.toUpperCase()}`; }
  function sameEntry(a, b) { return a && b && a.date === b.date && a.period === b.period && a.id === b.id; }

  // dates that have at least one photo, newest first, with AM/PM counts for the date-picker view
  const dateGroups = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, { date: e.date, am: 0, pm: 0 });
      map.get(e.date)[e.period] += 1;
    });
    return Array.from(map.values());
  }, [entries]);

  // entries grouped by month, then by date — used for the expanded "view more" gallery
  const galleryMonthGroups = useMemo(() => {
    const months = [];
    entries.forEach((e) => {
      const mKey = monthKey(e.date);
      let m = months[months.length - 1];
      if (!m || m.key !== mKey) {
        m = { key: mKey, label: parseDate(e.date).toLocaleDateString(undefined, { month: "long", year: "numeric" }), dates: [] };
        months.push(m);
      }
      let d = m.dates[m.dates.length - 1];
      if (!d || d.date !== e.date) {
        d = { date: e.date, items: [] };
        m.dates.push(d);
      }
      d.items.push(e);
    });
    return months;
  }, [entries]);

  function resetCompare() {
    setCompareA(null);
    setCompareB(null);
    setQuickDays(null);
    setCompareNote(null);
  }

  function openPicker(slot) {
    setPicking(slot);
    setPickerMode("date");
    setPickerDate(null);
  }

  function pickPhoto(e) {
    if (picking === "A") setCompareA(e); else setCompareB(e);
    setQuickDays(null);
    setCompareNote(null);
    setPicking(null);
  }

  function toggleSelected(k) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function deleteSelected() {
    const list = entries.filter((e) => selected.has(entryKey(e)));
    await onDeleteMany(list);
    setSelected(new Set());
    setSelectMode(false);
  }

  const cleanupTargets = useMemo(() => {
    const cutoff = addDays(todayStr(), -90);
    return entries.filter((e) => e.date < cutoff);
  }, [entries]);

  async function deleteOlderThan90() {
    if (!cleanupTargets.length) return;
    await onDeleteMany(cleanupTargets);
    setConfirmCleanup(false);
  }

  function applyQuickCompare(daysAgo) {
    const after = entries[0]; // most recent
    if (!after) return;
    // Only photos from an earlier date are valid "before" candidates. Without this the
    // closest match to the target could be the newest photo itself, which put the same
    // image in both panes and reported "0 days apart".
    const candidates = entries.filter((e) => e.date < after.date);
    if (!candidates.length) {
      setCompareNote("Only one day has photos so far — add another to compare against.");
      setCompareA(null);
      setCompareB(after);
      setQuickDays(null);
      return;
    }
    const target = addDays(after.date, -daysAgo);
    let closest = candidates[0];
    let closestDiff = Infinity;
    candidates.forEach((e) => {
      const diff = Math.abs(parseDate(e.date) - parseDate(target));
      if (diff < closestDiff) { closestDiff = diff; closest = e; }
    });
    const gap = Math.round(Math.abs(parseDate(after.date) - parseDate(closest.date)) / 86400000);
    setCompareB(after);
    setCompareA(closest);
    setQuickDays(daysAgo);
    // be honest when the nearest available pair isn't close to what was asked for
    setCompareNote(Math.abs(gap - daysAgo) > Math.max(7, daysAgo * 0.25)
      ? `No photo near ${daysAgo} days back — showing the closest you have, ${plural(gap, "day")} apart.`
      : null);
  }

  const elapsedDays = compareA && compareB ? Math.round(Math.abs(parseDate(compareB.date) - parseDate(compareA.date)) / 86400000) : null;

  // A compare slot can hold a photo that was never scrolled into view, so LazyPhoto's
  // observer never fetched it — the pane then rendered an <img> with no src at all.
  useEffect(() => {
    [compareA, compareB].forEach((e) => {
      if (e && !photoCache[photoKey(e.date, e.period, e.id)]) loadPhoto(e.date, e.period, e.id);
    });
  }, [compareA, compareB, photoCache, loadPhoto]);

  const previewLog = previewDate ? logs[previewDate] : null;
  const previewAmCount = previewLog ? Object.values(previewLog.am || {}).filter(Boolean).length : 0;
  const previewPmCount = previewLog ? Object.values(previewLog.pm || {}).filter(Boolean).length : 0;
  const previewPhotos = previewDate ? entries.filter((e) => e.date === previewDate) : [];

  return (
    <div>
      <PageHeader
        image={JOURNEY_HEADER_IMG}
        eyebrow="Journey"
        icon={Images}
        minHeight={252}
        focus="52% 44%"
        title="Your progress,"
        italic="over time"
        action={<HeaderAction icon={Download} label="Export" onClick={() => setShowExport(true)} />}
      />

      <AnimatePresence>
        {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
      </AnimatePresence>

      <Body>
        {/* ---------- capture: the reason you're on this page ---------- */}
        <Section
          title="Add today's photo"
          hint={`For ${prettyDate(selectedDate).toLowerCase()} — front, side, whatever angle. Up to ${MAX_PHOTOS_PER_PICK} at a time; a new pick replaces that slot.`}
        >
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { label: "Morning", sub: "AM", tone: "gold", Ico: Sun, run: () => onTriggerPhoto("am"), n: (photoIndex[selectedDate]?.am || []).length },
              { label: "Night", sub: "PM", tone: "moon", Ico: Moon, run: () => onTriggerPhoto("pm"), n: (photoIndex[selectedDate]?.pm || []).length },
            ].map((b) => (
              <motion.button
                key={b.sub}
                onClick={b.run}
                whileTap={{ scale: 0.97 }}
                transition={SPRING}
                className="u-tap"
                style={{
                  flex: 1, borderRadius: 18, padding: "16px 14px", textAlign: "left",
                  border: `1px solid ${TONES[b.tone].line}`,
                  background: `linear-gradient(165deg, ${TONES[b.tone].wash2}, rgba(255,255,255,0.014))`,
                  boxShadow: `0 12px 28px -20px ${TONES[b.tone].glow}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 999,
                    border: `1px dashed ${TONES[b.tone].line}`, background: TONES[b.tone].wash,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <b.Ico size={15} color={TONES[b.tone].fg} />
                  </div>
                  {b.n > 0 && (
                    <span className="u-num" style={{
                      fontSize: 10.5, fontWeight: 700, color: TONES[b.tone].fg,
                      background: TONES[b.tone].wash2, border: `1px solid ${TONES[b.tone].line}`,
                      borderRadius: 999, padding: "3px 8px",
                    }}>
                      {b.n}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>{b.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                  <Camera size={11} color="var(--text-3)" />
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{b.n > 0 ? "Replace" : "Capture"}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </Section>

        {/* ---------- gallery / compare ---------- */}
        <Section
          title={mode === "grid" ? "Gallery" : "Compare"}
          hint={mode === "grid"
            ? entries.length ? `${plural(entries.length, "photo")}, newest first.` : undefined
            : "Put two days side by side."}
          action={
            <LayoutGroup id="journey-mode">
              <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 999, background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}>
                {["grid", "compare"].map((m) => (
                  <button
                    key={m}
                    onClick={() => { if (mode === "compare" && m === "grid") resetCompare(); setMode(m); setSelectMode(false); }}
                    className="u-tap"
                    style={{
                      position: "relative", background: "none", border: "none", padding: "6px 13px",
                      borderRadius: 999, fontSize: 11.5, fontWeight: mode === m ? 700 : 500,
                      color: mode === m ? "var(--gold)" : "var(--text-3)",
                      transition: "color 0.25s var(--ease)",
                    }}
                  >
                    {mode === m && (
                      <motion.div
                        layoutId="mode-pill"
                        transition={{ type: "spring", stiffness: 460, damping: 36 }}
                        style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--gold-wash-2)", border: "1px solid var(--line-2)" }}
                      />
                    )}
                    <span style={{ position: "relative" }}>{m === "grid" ? "Gallery" : "Compare"}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          }
        >
          {mode === "grid" && (
            <>
              {entries.length === 0 ? (
                <EmptyState
                  icon={Camera}
                  title="No photos yet"
                  body="Take the first one today. In a month you'll be glad the baseline exists."
                />
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <button onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }} className="u-tap"
                      style={{ background: "none", border: "none", fontSize: 12, fontWeight: 600, color: selectMode ? "var(--gold)" : "var(--text-3)" }}>
                      {selectMode ? "Cancel" : "Select"}
                    </button>
                    {!selectMode && (
                      <button
                        onClick={() => setConfirmCleanup(true)}
                        disabled={cleanupTargets.length === 0}
                        className="u-tap"
                        style={{
                          background: "none", border: "none", fontSize: 12,
                          color: cleanupTargets.length ? "var(--text-3)" : "rgba(141,127,113,0.4)",
                        }}
                      >
                        Clean up 90+ days{cleanupTargets.length ? ` (${cleanupTargets.length})` : ""}
                      </button>
                    )}
                  </div>

                  {!galleryExpanded && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                        {entries.slice(0, GALLERY_PAGE_SIZE).map((e) => {
                          const k = entryKey(e);
                          return (
                            <LazyPhoto
                              key={k}
                              date={e.date} period={e.period} id={e.id}
                              loadPhoto={loadPhoto}
                              cached={photoCache[photoKey(e.date, e.period, e.id)]}
                              aspect="3 / 4"
                              radius={14}
                              tag={`${e.date.slice(5)} ${e.period.toUpperCase()}`}
                              selected={selectMode && selected.has(k)}
                              onClick={() => (selectMode ? toggleSelected(k) : setViewing(e))}
                            />
                          );
                        })}
                      </div>

                      {entries.length > GALLERY_PAGE_SIZE && (
                        <GhostButton onClick={() => setGalleryExpanded(true)}>
                          View all {entries.length} photos
                        </GhostButton>
                      )}
                    </>
                  )}

                  {galleryExpanded && (
                    <>
                      <button onClick={() => setGalleryExpanded(false)} className="u-tap"
                        style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", fontSize: 12, fontWeight: 600, color: "var(--gold)", marginBottom: 18, padding: 0 }}>
                        <ChevronLeft size={13} /> Show less
                      </button>

                      {galleryMonthGroups.map((m) => (
                        <div key={m.key} style={{ marginBottom: 26 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                            <Eyebrow tone="gold">{m.label}</Eyebrow>
                            <div className="u-hairline" style={{ flex: 1 }} />
                          </div>
                          {m.dates.map((d) => (
                            <div key={d.date} style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 9 }}>{prettyDate(d.date)}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                {d.items.map((e) => {
                                  const k = entryKey(e);
                                  return (
                                    <LazyPhoto
                                      key={k}
                                      date={e.date} period={e.period} id={e.id}
                                      loadPhoto={loadPhoto}
                                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                                      aspect="3 / 4"
                                      radius={14}
                                      tag={e.period.toUpperCase()}
                                      selected={selectMode && selected.has(k)}
                                      onClick={() => (selectMode ? toggleSelected(k) : setViewing(e))}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}

                  <AnimatePresence>
                    {selectMode && selected.size > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.24 }}
                        style={{ marginTop: 12 }}
                      >
                        <PrimaryButton tone="danger" onClick={deleteSelected}>
                          Delete {plural(selected.size, "photo")}
                        </PrimaryButton>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </>
          )}

          {mode === "compare" && (
            entries.length === 0 ? (
              <EmptyState
                icon={Camera}
                title="Nothing to compare yet"
                body="Two photos on different days is all it takes to see a difference."
              />
            ) : (
              <>
                <div style={{ display: "flex", gap: 7, marginBottom: 14, alignItems: "center" }}>
                  <Pill active={quickDays === 30} onClick={() => applyQuickCompare(30)}>vs 30 days</Pill>
                  <Pill active={quickDays === 90} onClick={() => applyQuickCompare(90)}>vs 90 days</Pill>
                  {(compareA || compareB) && (
                    <button onClick={resetCompare} className="u-tap"
                      style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 12, color: "var(--rose)", fontWeight: 600 }}>
                      Clear
                    </button>
                  )}
                </div>

                {elapsedDays !== null && (
                  <div style={{ textAlign: "center", marginBottom: 6 }}>
                    <span className="u-display u-num" style={{ fontSize: 26, color: "var(--gold)" }}>{elapsedDays}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 6 }}>{elapsedDays === 1 ? "day" : "days"} apart</span>
                  </div>
                )}
                {compareNote && (
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", marginBottom: 12, lineHeight: 1.55 }}>
                    {compareNote}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: elapsedDays !== null || compareNote ? 8 : 0 }}>
                  {[["Before", compareA, "A"], ["After", compareB, "B"]].map(([label, val, slot]) => (
                    <div key={slot} style={{ flex: 1 }}>
                      <Eyebrow style={{ marginBottom: 7, textAlign: "center" }}>{label}</Eyebrow>
                      <motion.button
                        onClick={() => openPicker(slot)}
                        whileTap={{ scale: 0.98 }}
                        transition={SPRING}
                        className="u-tap"
                        data-testid={`compare-${slot}`}
                        style={{
                          width: "100%", aspectRatio: "0.8", borderRadius: 18, overflow: "hidden",
                          background: "rgba(255,255,255,0.035)", border: `1px solid ${val ? "var(--line-2)" : "var(--line)"}`,
                          display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: 0,
                        }}
                      >
                        {val ? (
                          // used to render <img src={undefined}> for a photo that had never
                          // been scrolled into view; now it loads and shows a spinner meanwhile
                          photoCache[photoKey(val.date, val.period, val.id)] ? (
                            <img src={photoCache[photoKey(val.date, val.period, val.id)]} alt={entryLabel(val)}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <Loader2 className="animate-spin" size={20} color="var(--gold)" />
                          )
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 999, border: "1px dashed var(--line-2)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <Plus size={15} color="var(--text-3)" />
                            </div>
                            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Choose</span>
                          </div>
                        )}
                      </motion.button>
                      {val && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", textAlign: "center", marginTop: 8 }}>
                          {entryLabel(val)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </Section>

        {/* ---------- calendar ---------- */}
        <Section
          title="Your record"
          action={
            <button
              onClick={() => setCalView((v) => (v === "month" ? "year" : "month"))}
              className="u-tap"
              style={{
                background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)", borderRadius: 999,
                padding: "6px 13px", fontSize: 11, fontWeight: 600, color: "var(--text-2)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Calendar size={11} color="var(--gold)" />
              {calView === "month" ? "Year view" : "Month view"}
            </button>
          }
        >
          <Card style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              {calView === "month" ? (
                <>
                  <button onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month" className="u-tap" style={iconBtnStyle}>
                    <ChevronLeft size={15} color="var(--text-2)" />
                  </button>
                  <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>{monthLabel}</span>
                  <button onClick={() => setMonthOffset((o) => o + 1)} disabled={monthOffset >= 0} aria-label="Next month" className="u-tap"
                    style={{ ...iconBtnStyle, opacity: monthOffset >= 0 ? 0.3 : 1 }}>
                    <ChevronRight size={15} color="var(--text-2)" />
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600, margin: "0 auto" }}>{year}</span>
              )}
            </div>

            {calView === "month" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="u-eyebrow" style={{ textAlign: "center", fontSize: 8.5, marginBottom: 2 }}>{d}</div>
                  ))}
                  {cells.map((c, i) =>
                    c ? (
                      <motion.button
                        key={i}
                        onClick={() => { if (c.status === "future") return; setSelectedDate(c.ds); setPreviewDate(c.ds); }}
                        whileTap={c.status === "future" ? undefined : { scale: 0.9 }}
                        transition={SPRING}
                        disabled={c.status === "future"}
                        aria-label={`${c.ds}${c.status === "future" ? "" : ` — ${c.status}`}`}
                        className="u-tap"
                        style={{
                          position: "relative", aspectRatio: "1", borderRadius: 11, padding: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: c.status === "future" ? "transparent" : statusColorFor(c.status),
                          boxShadow: c.status === "full" ? "0 0 14px -5px rgba(243,201,140,0.8)" : "none",
                          border: c.ds === selectedDate
                            ? "1.5px solid var(--text)"
                            : c.status === "future" ? "1px solid rgba(255,255,255,0.03)" : "1px solid transparent",
                        }}
                      >
                        <span className="u-num" style={{
                          fontSize: 11, fontWeight: c.status === "full" ? 700 : 500,
                          color: c.status === "full" ? "#20150C"
                            : c.status === "future" ? "rgba(255,255,255,0.13)" : "var(--text-2)",
                        }}>
                          {c.day}
                        </span>
                        {c.hasPhoto && (
                          <span style={{
                            position: "absolute", bottom: 3, width: 3.5, height: 3.5, borderRadius: 999,
                            background: c.status === "full" ? "#20150C" : "var(--gold)",
                          }} />
                        )}
                      </motion.button>
                    ) : <div key={i} />
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 16, justifyContent: "center", flexWrap: "wrap" }}>
                  {[["full", "Full"], ["partial", "Partial"], ["none", "Missed"]].map(([k, label]) => (
                    <LegendDot key={k} color={statusColorFor(k)} label={label} />
                  ))}
                  <LegendDot color="var(--gold)" label="Photo" />
                </div>
              </>
            ) : (
              <YearOverview year={year} logs={logs} photoIndex={photoIndex} selectedDate={selectedDate}
                onPickDay={(ds) => { setSelectedDate(ds); setPreviewDate(ds); }} products={products} />
            )}
          </Card>

          {/* day preview */}
          <AnimatePresence>
            {previewDate && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 10 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: "hidden" }}
              >
                <Card style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div className="u-display" style={{ fontSize: 20, color: "var(--text)" }}>{prettyDate(previewDate)}</div>
                      <div style={{ display: "flex", gap: 12, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11.5, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Sun size={10} color="var(--gold)" /> {previewAmCount} checked
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Moon size={10} color="var(--moon)" /> {previewPmCount} checked
                        </span>
                        {(previewLog?.amMood || previewLog?.pmMood) && (
                          <span style={{ fontSize: 11.5, color: "var(--gold)" }}>
                            {[previewLog.amMood, previewLog.pmMood].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setPreviewDate(null)} aria-label="Close day preview" className="u-tap"
                      style={{ background: "none", border: "none", padding: 2, display: "flex" }}>
                      <X size={15} color="var(--text-3)" />
                    </button>
                  </div>

                  {previewPhotos.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      {previewPhotos.map((p) => (
                        <LazyPhoto key={entryKey(p)} date={p.date} period={p.period} id={p.id}
                          loadPhoto={loadPhoto} cached={photoCache[photoKey(p.date, p.period, p.id)]}
                          size={54} radius={12} tag={p.period.toUpperCase()} onClick={() => setViewing(p)} />
                      ))}
                    </div>
                  )}

                  <button onClick={() => setTab("today")} className="u-tap"
                    style={{ background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--gold)", fontSize: 12.5, fontWeight: 600 }}>
                    Open this day <ArrowRight size={12} />
                  </button>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        <Section title="Storage">
          <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} totalMB={quotaTotalMB} hint="Cleaning up old photos above is the quickest way to free space." />
        </Section>
      </Body>

      <AnimatePresence>
        {picking && (
          <Sheet onClose={() => setPicking(null)} z={155} maxHeight="78vh" labelledBy="picker-title">
            <SheetHeader
              id="picker-title"
              title="Choose a photo"
              subtitle={picking === "A" ? "This becomes the “before”." : "This becomes the “after”."}
              onClose={() => setPicking(null)}
            />

            <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
              {["date", "all"].map((pm) => (
                <Pill key={pm} active={pickerMode === pm} onClick={() => { setPickerMode(pm); setPickerDate(null); }}>
                  {pm === "date" ? "By date" : "All photos"}
                </Pill>
              ))}
            </div>

            {pickerMode === "all" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {entries.map((e) => (
                  <LazyPhoto
                    key={entryKey(e)}
                    date={e.date} period={e.period} id={e.id}
                    loadPhoto={loadPhoto}
                    cached={photoCache[photoKey(e.date, e.period, e.id)]}
                    aspect="3 / 4"
                    radius={12}
                    tag={`${e.date.slice(5)} ${e.period.toUpperCase()}`}
                    selected={sameEntry(e, picking === "A" ? compareA : compareB)}
                    onClick={() => pickPhoto(e)}
                  />
                ))}
              </div>
            )}

            {pickerMode === "date" && pickerDate === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dateGroups.map((g) => (
                  <button
                    key={g.date}
                    onClick={() => setPickerDate(g.date)}
                    className="u-tap"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "13px 15px", borderRadius: 14, border: "1px solid var(--line)",
                      background: "rgba(255,255,255,0.03)", textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{prettyDate(g.date)}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                        {g.am > 0 && (
                          <span style={{ fontSize: 10.5, color: "var(--gold)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Sun size={9} /> ×{g.am}
                          </span>
                        )}
                        {g.pm > 0 && (
                          <span style={{ fontSize: 10.5, color: "var(--moon)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Moon size={9} /> ×{g.pm}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-3)" />
                  </button>
                ))}
              </div>
            )}

            {pickerMode === "date" && pickerDate !== null && (
              <>
                <button onClick={() => setPickerDate(null)} className="u-tap"
                  style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16, background: "none", border: "none", padding: 0 }}>
                  <ChevronLeft size={15} color="var(--gold)" />
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{prettyDate(pickerDate)}</span>
                </button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {entries.filter((e) => e.date === pickerDate).map((e) => (
                    <LazyPhoto
                      key={entryKey(e)}
                      date={e.date} period={e.period} id={e.id}
                      loadPhoto={loadPhoto}
                      cached={photoCache[photoKey(e.date, e.period, e.id)]}
                      aspect="3 / 4"
                      radius={12}
                      tag={e.period.toUpperCase()}
                      selected={sameEntry(e, picking === "A" ? compareA : compareB)}
                      onClick={() => pickPhoto(e)}
                    />
                  ))}
                </div>
              </>
            )}
          </Sheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmCleanup && (
          <ConfirmModal
            title={`Delete ${plural(cleanupTargets.length, "photo")}?`}
            body="Every progress photo older than 90 days will be permanently removed. This can't be undone."
            confirmLabel="Delete them"
            onCancel={() => setConfirmCleanup(false)}
            onConfirm={deleteOlderThan90}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewing && (
          <Lightbox
            entry={viewing}
            label={entryLabel(viewing)}
            src={photoCache[photoKey(viewing.date, viewing.period, viewing.id)]}
            onClose={() => setViewing(null)}
            onDelete={() => { onDelete(viewing.date, viewing.period, viewing.id); setViewing(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
