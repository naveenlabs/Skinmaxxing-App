// The Routine tab: today's AM and PM lists, and the per-day edits made against them.
import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownNarrowWide,
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Droplet,
  Flame,
  Moon,
  Package,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Sun,
  Undo2,
} from "lucide-react";
import { HERO_IMG } from "../../assets.js";
import {
  Body,
  Card,
  EmptyState,
  Eyebrow,
  GhostButton,
  MetaBar,
  PageHeader,
  Pill,
  PrimaryButton,
  ProgressRing,
  Sheet,
  SheetHeader,
  Stagger,
  StaggerItem,
} from "../../components/primitives.jsx";
import { CATS, MOODS, NEGATIVE_MOODS, QUOTES } from "../../domain/catalog.js";
import {
  addDays,
  dayOfYear,
  greetingWord,
  parseDate,
  prettyDate,
  todayStr,
} from "../../domain/dates.js";
import {
  anyChecked,
  completionRatio,
  currentStreakDays,
  dayStatus,
  mustHaveCategories,
  productStreakDays,
  routineFor,
  statusOn,
  stintCovers,
} from "../../domain/routine.js";
import { AccountButton } from "../account/AccountView.jsx";
import { SPRING, TONES } from "../../styles/theme.js";

export const iconBtnStyle = {
  background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)",
  borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
};

// Each period is now a full-bleed tinted band rather than a hairline-separated list, so
// morning and night read as two distinct places instead of one long scroll. Tone comes
// from the AM/PM photography: honey for morning, moonlight for night.
export function RoutineSection({ title, subtitle, period, tone, icon: Icon, products, dayLog, toggleProduct, moveProduct, moodLabel, onMood, moodSaved, moodNote, setTab, conflictCount = 0, onTriggerPhoto, photoCount = 0, ratio, addedIds, skipped = [], addedLabel = "TODAY ONLY", onAddStep, onUnskipStep }) {
  const key = period.toLowerCase();
  const t = TONES[tone];
  const done = products.filter((p) => dayLog[key][p.id]).length;
  const allDone = products.length > 0 && done === products.length;

  return (
    <section style={{ position: "relative", marginTop: 8, padding: "26px 20px 30px" }}>
      {/* tonal wash keyed to the period */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(180deg, transparent, ${t.wash} 30%, ${t.wash} 70%, transparent)`,
      }} />
      <div aria-hidden="true" className="u-hairline" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />

      <div style={{ position: "relative" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <motion.div
              animate={allDone ? { scale: [1, 1.12, 1] } : {}}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{
                width: 40, height: 40, borderRadius: 999, flexShrink: 0,
                border: `1px solid ${t.line}`, background: allDone ? t.wash2 : "rgba(255,255,255,0.03)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: allDone ? `0 0 20px -6px ${t.glow}` : "none",
              }}
            >
              <Icon size={17} color={t.fg} strokeWidth={1.8} />
            </motion.div>
            <div>
              <h2 className="u-display" style={{ fontSize: 26, color: "var(--text)", margin: 0 }}>{title}</h2>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
            {onTriggerPhoto && (
              <motion.button
                onClick={onTriggerPhoto}
                whileTap={{ scale: 0.9 }}
                transition={SPRING}
                aria-label={`Add ${period} progress photo`}
                className="u-tap"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "7px 11px", borderRadius: 999,
                  border: `1px solid ${photoCount > 0 ? t.line : "var(--line)"}`,
                  background: photoCount > 0 ? t.wash2 : "rgba(255,255,255,0.03)",
                }}
              >
                <Camera size={13} color={photoCount > 0 ? t.fg : "var(--text-3)"} />
                {photoCount > 0 && <span className="u-num" style={{ fontSize: 10.5, color: t.fg, fontWeight: 600 }}>{photoCount}</span>}
              </motion.button>
            )}
            <span className="u-num" style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
              <span style={{ color: t.fg }}>{done}</span>/{products.length}
            </span>
          </div>
        </header>

        {conflictCount >= 2 && (
          <div style={{
            marginBottom: 14, borderRadius: 14, padding: "11px 13px", display: "flex", gap: 9, alignItems: "flex-start",
            background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.28)",
          }}>
            <AlertTriangle size={13} color="var(--rose)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {conflictCount} exfoliating steps checked — that may be more than skin can handle at once.
            </span>
          </div>
        )}

        {products.length > 0 && (
          <Stagger style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.map((p) => {
              const checked = !!dayLog[key][p.id];
              return (
                <StaggerItem key={p.id}>
                  <motion.div
                    className="u-tap"
                    onClick={() => toggleProduct(key, p.id)}
                    whileTap={{ scale: 0.99 }}
                    transition={SPRING}
                    data-testid="check-row"
                    data-checked={checked ? "1" : "0"}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProduct(key, p.id); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 13, padding: "11px 13px", borderRadius: 16,
                      background: checked ? t.wash2 : "rgba(255,255,255,0.028)",
                      border: `1px solid ${checked ? t.line : "var(--line)"}`,
                      transition: "background 0.3s var(--ease), border-color 0.3s var(--ease)",
                    }}
                  >
                    {/* checkbox with a spring pop + drawn tick */}
                    <motion.div
                      animate={checked ? { scale: [1, 1.22, 1] } : { scale: 1 }}
                      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                        background: checked ? t.fg : "transparent",
                        border: `1.5px solid ${checked ? t.fg : t.line}`,
                        boxShadow: checked ? `0 0 14px -3px ${t.glow}` : "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.25s var(--ease), border-color 0.25s var(--ease)",
                      }}
                    >
                      <AnimatePresence>
                        {checked && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 620, damping: 26 }}
                            style={{ display: "flex" }}
                          >
                            <Check size={13} color="#20150C" strokeWidth={3.4} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.div>

                    <div style={{
                      width: 60, height: 60, borderRadius: 16, flexShrink: 0, overflow: "hidden",
                      background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {p.photo
                        ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <Package size={19} color="var(--text-3)" strokeWidth={1.6} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, lineHeight: 1.35, fontWeight: 500,
                        color: checked ? "var(--text)" : "var(--text-2)",
                      }}>
                        {p.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {(CATS.find((c) => c.id === p.category) || { label: "Other" }).label}
                        </span>
                        {p.tracked && <Star size={10} color="var(--gold)" fill="var(--gold)" />}
                        {p.exfoliant && <Flame size={10} color="var(--rose)" fill="var(--rose)" />}
                        {p.status === "trying" && (
                          <span style={{
                            fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: "var(--gold)",
                            border: "1px solid var(--line-2)", borderRadius: 999, padding: "2px 7px",
                          }}>TRYING</span>
                        )}
                        {addedIds && addedIds.has(p.id) && (
                          <span data-testid="added-chip" style={{
                            fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: t.fg,
                            border: `1px solid ${t.line}`, background: t.wash, borderRadius: 999, padding: "2px 7px",
                          }}>{addedLabel}</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); moveProduct(period, p.id); }}
                      aria-label={`Move ${p.name} down`}
                      className="u-tap"
                      style={{ background: "none", border: "none", padding: 6, flexShrink: 0, display: "flex" }}
                    >
                      <ArrowDownNarrowWide size={14} color="var(--text-3)" />
                    </button>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}

        {products.length === 0 && (
          <EmptyState
            icon={Package}
            title={`No ${title.toLowerCase()} steps yet`}
            body="Add what you're using and this list builds itself."
            action={<GhostButton onClick={() => setTab && setTab("shelf")}>Go to Shelf</GhostButton>}
          />
        )}

        {/* A step you deliberately skipped is data, not an absence — so it stays on screen
            and stays reversible instead of silently vanishing from the day. */}
        {skipped.length > 0 && (
          <div
            data-testid={`skipped-${key}`}
            style={{
              marginTop: 10, padding: "10px 13px", borderRadius: 14,
              border: "1px solid var(--line)", background: "rgba(255,255,255,0.022)",
              display: "flex", alignItems: "flex-start", gap: 9,
            }}
          >
            <CircleMinus size={13} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, flex: 1, minWidth: 0 }}>
              Skipped: {skipped.map((p) => p.name).join(" · ")}
              {/* skipping doesn't lower the bar, so say so rather than let the number
                  look broken when it can no longer reach 100% */}
              {skipped.some((p) => mustHaveCategories(period).includes(p.category)
                && !products.some((x) => x.category === p.category))
                && ` — ${title.toLowerCase()} can't reach 100% today.`}
            </span>
            <button
              onClick={() => skipped.forEach((p) => onUnskipStep && onUnskipStep(period, p.id))}
              className="u-tap"
              style={{
                background: "none", border: "none", padding: 0, flexShrink: 0,
                fontSize: 11.5, fontWeight: 600, color: t.fg,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Undo2 size={12} /> Undo
            </button>
          </div>
        )}

        {onAddStep && (
          <motion.button
            onClick={onAddStep}
            whileTap={{ scale: 0.99 }}
            transition={SPRING}
            className="u-tap"
            data-testid={`edit-steps-${key}`}
            style={{
              width: "100%", textAlign: "left", marginTop: 10, padding: "13px 15px", borderRadius: 16,
              border: "1px dashed var(--line-2)", background: "transparent",
              display: "flex", alignItems: "center", gap: 11,
            }}
          >
            <Plus size={14} color="var(--text-3)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1 }}>Add a step for this day</span>
          </motion.button>
        )}

        {/* mood check-in */}
        <motion.button
          onClick={onMood}
          whileTap={{ scale: 0.99 }}
          transition={SPRING}
          className="u-tap"
          style={{
            width: "100%", textAlign: "left", marginTop: 14, padding: "14px 15px", borderRadius: 16,
            border: `1px dashed ${moodSaved ? t.line : "var(--line-2)"}`,
            background: moodSaved ? t.wash : "transparent",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <Sparkles size={14} color={moodSaved ? t.fg : "var(--text-3)"} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {moodSaved ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>Felt {moodSaved.toLowerCase()}</div>
                {moodNote && (
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {moodNote}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{moodLabel}</div>
            )}
          </div>
          <ChevronRight size={15} color="var(--text-3)" style={{ flexShrink: 0 }} />
        </motion.button>
      </div>
    </section>
  );
}

// One sheet for a single day's step list. Add and skip live together because they're the
// same question — "what am I actually doing today" — and keeping them here means the
// checklist rows stay uncluttered instead of growing a second menu system.
//
// Nothing in here touches a product's status: using a retired product for one day is a
// property of the day, not a change to the shelf.

// One sheet for a single day's step list. Add and skip live together because they're the
// same question — "what am I actually doing today" — and keeping them here means the
// checklist rows stay uncluttered instead of growing a second menu system.
//
// Nothing in here touches a product's status: using a retired product for one day is a
// property of the day, not a change to the shelf.
export function DayStepsSheet({ period, date, products, routine, onClose, onAdd, onSkip, onUnskip }) {
  const [query, setQuery] = useState("");
  const t = TONES[period === "AM" ? "gold" : "moon"];
  const isToday = date === todayStr();
  const onIds = new Set([...routine.list, ...routine.skipped].map((p) => p.id));
  const q = query.trim().toLowerCase();
  const candidates = products.filter((p) => !onIds.has(p.id) && p.name.toLowerCase().includes(q));

  // anything not already on the day falls into exactly one of these
  const groupOf = (p) => (stintCovers(p, date) ? "other" : statusOn(p, date) === "not-yet" ? "later" : "retired");
  const GROUPS = [
    { id: "other", label: period === "AM" ? "From your night routine" : "From your morning routine" },
    { id: "retired", label: "Retired" },
    { id: "later", label: "Added to your shelf later" },
  ];

  const catLabel = (p) => (CATS.find((c) => c.id === p.category) || { label: "Other" }).label;

  const row = (p, { onClick, icon: ActionIcon, aria, dim, note }) => (
    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0, overflow: "hidden",
        background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
        display: "flex", alignItems: "center", justifyContent: "center", opacity: dim ? 0.5 : 1,
      }}>
        {p.photo
          ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Package size={14} color="var(--text-3)" strokeWidth={1.6} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, lineHeight: 1.35,
          color: dim ? "var(--text-3)" : "var(--text)",
          textDecoration: dim ? "line-through" : "none",
        }}>{p.name}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {catLabel(p)}{note ? ` · ${note}` : ""}
        </div>
      </div>
      <motion.button
        onClick={onClick}
        whileTap={{ scale: 0.9 }}
        transition={SPRING}
        className="u-tap"
        aria-label={aria}
        style={{
          width: 32, height: 32, borderRadius: 999, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid ${t.line}`, background: t.wash,
        }}
      >
        <ActionIcon size={14} color={t.fg} />
      </motion.button>
    </div>
  );

  return (
    <Sheet onClose={onClose} z={152} labelledBy="steps-title">
      <SheetHeader
        id="steps-title"
        title={`${period === "AM" ? "Morning" : "Night"} steps`}
        subtitle={isToday ? "Just for today — your shelf stays as it is." : `Just for ${prettyDate(date).toLowerCase()} — your shelf stays as it is.`}
        onClose={onClose}
      />

      {routine.list.length + routine.skipped.length > 0 && (
        <>
          <Eyebrow style={{ marginBottom: 2 }}>On this day</Eyebrow>
          <div data-testid="steps-on-day" style={{ marginBottom: 20 }}>
            {routine.list.map((p) =>
              row(p, {
                onClick: () => onSkip(p.id, routine.addedIds.has(p.id)),
                icon: CircleMinus,
                aria: `Remove ${p.name} from this day`,
                note: routine.addedIds.has(p.id) ? "added for this day" : null,
              })
            )}
            {routine.skipped.map((p) =>
              row(p, {
                onClick: () => onUnskip(p.id),
                icon: Undo2,
                aria: `Put ${p.name} back on this day`,
                dim: true,
                note: "skipped",
              })
            )}
          </div>
        </>
      )}

      <Eyebrow style={{ marginBottom: 2 }}>Add from your shelf</Eyebrow>

      {products.length > 12 && (
        <div style={{ position: "relative", marginTop: 10, marginBottom: 2 }}>
          <Search size={14} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your shelf…"
            aria-label="Search your shelf"
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 999, padding: "11px 15px 11px 37px", color: "var(--text)", fontSize: 13,
            }}
          />
        </div>
      )}

      {candidates.length === 0 ? (
        <div style={{ padding: "18px 0 6px", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6 }}>
          {products.length === 0
            ? "Your shelf is empty — add a product there first."
            : query.trim()
              ? "Nothing on your shelf matches that."
              : "Everything on your shelf is already on this day."}
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = candidates.filter((p) => groupOf(p) === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} style={{ marginTop: 14 }} data-testid={`steps-group-${g.id}`}>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em" }}>{g.label}</div>
              {items.map((p) =>
                row(p, {
                  onClick: () => onAdd(p.id),
                  icon: Plus,
                  aria: `Add ${p.name} to this day`,
                  note: g.id === "retired" ? (p.retiredReason || "retired") : null,
                })
              )}
            </div>
          );
        })
      )}
    </Sheet>
  );
}

export function MoodModal({ period, current, onClose, onSave }) {
  const [mood, setMood] = useState(current.mood || "");
  const [note, setNote] = useState(current.note || "");
  const isWeekly = period === "weekly";
  const tone = period === "pm" ? "moon" : "gold";
  const options = isWeekly ? ["Great week", "Steady", "Rough week", "Barely kept up"] : MOODS;
  return (
    <Sheet onClose={onClose} maxHeight="86vh" labelledBy="mood-title">
      <SheetHeader
        id="mood-title"
        title={isWeekly ? "This week, overall" : period === "am" ? "This morning" : "Tonight"}
        subtitle="How does your skin actually feel? One tap is enough."
        onClose={onClose}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {options.map((m) => (
          <Pill key={m} active={mood === m} tone={tone} onClick={() => setMood(mood === m ? "" : m)}>
            {m}
          </Pill>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else worth remembering…"
        rows={3}
        style={{
          width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 14, color: "var(--text)", fontSize: 13.5, lineHeight: 1.55,
          resize: "none", marginBottom: 16,
        }}
      />
      <PrimaryButton onClick={() => onSave(mood, note)}>Save</PrimaryButton>
    </Sheet>
  );
}

/* ------------------------------- products view ------------------------------- */

export function TodayView({ products, selectedDate, setSelectedDate, dayLog, logs, toggleProduct, moveProduct, setMoodModal, setTab, onTriggerPhoto, photoIndex, onCopyYesterday, onAddStep, onSkipStep, onUnskipStep, greetingName, monogram, avatarUrl, onOpenAccount }) {
  // the routine as it stood on the selected date, plus that day's own tweaks — never
  // today's product list projected backwards
  const amRoutine = routineFor(selectedDate, dayLog, products, "AM");
  const pmRoutine = routineFor(selectedDate, dayLog, products, "PM");
  const [stepsFor, setStepsFor] = useState(null); // "AM" | "PM" | null
  const am = completionRatio(selectedDate, dayLog, products, "AM");
  const pm = completionRatio(selectedDate, dayLog, products, "PM");
  const totalDone = am.done + pm.done;
  const totalAll = am.total + pm.total;
  const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  const activeNight = pmRoutine.list.some((p) => p.category === "treatment" && dayLog.pm[p.id]);

  // irritation pattern: 3 consecutive nights logged as Dry or Irritated
  const last3PM = [0, 1, 2].map((i) => {
    const l = logs[addDays(todayStr(), -i)];
    return l ? l.pmMood : null;
  });
  const irritationFlag = last3PM.every((m) => m && NEGATIVE_MOODS.includes(m))
    ? (last3PM[0] === last3PM[1] && last3PM[1] === last3PM[2] ? last3PM[0] : "reactive")
    : null;

  // exfoliant conflict — 2+ exfoliating steps checked in the same period
  const amExfoliantCount = amRoutine.list.filter((p) => p.exfoliant && dayLog.am[p.id]).length;
  const pmExfoliantCount = pmRoutine.list.filter((p) => p.exfoliant && dayLog.pm[p.id]).length;

  const streak = currentStreakDays(logs, products);

  // tracked-product day counters (consecutive days used, ending today)
  const trackedCounters = products.filter((p) => p.tracked && stintCovers(p, selectedDate)).map((p) => ({
    id: p.id, name: p.name, days: productStreakDays(logs, p.id),
  }));

  const quote = QUOTES[dayOfYear(new Date()) % QUOTES.length];
  const isToday = selectedDate === todayStr();
  const isSunday = new Date().getDay() === 0;
  const showWeekly = isToday && isSunday;
  // Copying forward is most useful on the day you forgot, not on today — so it's offered on
  // any past day too. Only while the day is still blank, which is both the case that needs
  // it and the only way it can't quietly overwrite something.
  const prevHasLog = !!logs[addDays(selectedDate, -1)];
  const dayIsBlank = !anyChecked(dayLog.am) && !anyChecked(dayLog.pm);
  const canCopyPrev = prevHasLog && dayIsBlank && selectedDate <= todayStr();

  // The week rail is the 7 days ending on whatever's selected — not hardcoded to today —
  // so paging a week back genuinely reaches earlier days instead of snapping back to the
  // same trailing week every time. Selecting today keeps the familiar "last 7 days" view.
  const railDays = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(selectedDate, -i);
      out.push({
        d,
        status: dayStatus(d, logs, products),
        dow: parseDate(d).toLocaleDateString(undefined, { weekday: "narrow" }),
        dom: parseDate(d).getDate(),
      });
    }
    return out;
  }, [selectedDate, logs, products]);

  const weekRangeLabel = (() => {
    const first = parseDate(railDays[0].d), last = parseDate(railDays[6].d);
    const fmt = (d, withYear) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: withYear ? "numeric" : undefined });
    const sameYear = first.getFullYear() === last.getFullYear();
    return `${fmt(first, !sameYear)} – ${fmt(last, true)}`;
  })();
  const canGoNextWeek = !isToday;
  const goPrevWeek = () => setSelectedDate(addDays(selectedDate, -7));
  const goNextWeek = () => setSelectedDate(addDays(selectedDate, 7) > todayStr() ? todayStr() : addDays(selectedDate, 7));

  const dateLine = (() => {
    const d = parseDate(selectedDate);
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  })();

  const headline = pct >= 100
    ? "Everything's checked off."
    : pct === 0
      ? (isToday ? "Nothing logged yet today." : "Nothing was logged this day.")
      : `${totalDone} of ${totalAll} essentials done.`;

  const advisories = [
    activeNight && {
      key: "active", icon: Moon, tone: "moon",
      title: "Active night",
      body: "Barrier's under more stress — favour your richest ceramide moisturiser tonight.",
    },
    isToday && irritationFlag && {
      key: "irritation", icon: AlertTriangle, tone: "gold",
      title: irritationFlag === "reactive" ? "Skin's been reactive lately" : `Logged "${irritationFlag}" three nights running`,
      body: "Consider skipping an active tonight, or doubling up on ceramide moisturiser.",
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        image={HERO_IMG}
        eyebrow="Routine"
        icon={Droplet}
        minHeight={330}
        focus="62% 42%"
        action={<AccountButton monogram={monogram} avatarUrl={avatarUrl} onClick={onOpenAccount} />}
        title={<>{greetingWord()},<br /><span style={{ fontStyle: "italic", color: "var(--gold)" }}>{greetingName ? `${greetingName}.` : "you."}</span></>}
      >
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: "14px 0 0", maxWidth: 224, lineHeight: 1.65, fontStyle: "italic" }}>
          {quote}
        </p>
      </PageHeader>

      <Body style={{ paddingTop: 4 }}>
        {/* ---- week rail: status + navigation in one control ---- */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button onClick={goPrevWeek} aria-label="Previous week" className="u-tap" style={iconBtnStyle}>
            <ChevronLeft size={15} color="var(--text-2)" />
          </button>
          <span className="u-num" style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{weekRangeLabel}</span>
          <button onClick={goNextWeek} disabled={!canGoNextWeek} aria-label="Next week" className="u-tap"
            style={{ ...iconBtnStyle, opacity: canGoNextWeek ? 1 : 0.3 }}>
            <ChevronRight size={15} color="var(--text-2)" />
          </button>
        </div>
        <LayoutGroup id="week-rail">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 2, marginBottom: 22 }}>
            {railDays.map((r) => {
              const selected = r.d === selectedDate;
              const today = r.d === todayStr();
              return (
                <motion.button
                  key={r.d}
                  onClick={() => setSelectedDate(r.d)}
                  whileTap={{ scale: 0.9 }}
                  transition={SPRING}
                  aria-label={`${prettyDate(r.d)} — ${r.status === "full" ? "complete" : r.status === "partial" ? "partial" : "nothing logged"}`}
                  aria-pressed={selected}
                  className="u-tap"
                  style={{
                    position: "relative", flex: 1, background: "none", border: "none",
                    padding: "7px 0 9px", borderRadius: 14,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  }}
                >
                  {selected && (
                    <motion.div
                      layoutId="day-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      style={{
                        position: "absolute", inset: 0, borderRadius: 14,
                        background: "rgba(255,255,255,0.055)", border: "1px solid var(--line-2)",
                      }}
                    />
                  )}
                  <span style={{
                    position: "relative", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                    color: selected ? "var(--gold)" : "var(--text-3)",
                  }}>
                    {r.dow}
                  </span>
                  <span className="u-num" style={{
                    position: "relative", fontSize: 13.5, fontWeight: selected ? 700 : 500,
                    color: selected ? "var(--text)" : today ? "var(--text-2)" : "var(--text-3)",
                  }}>
                    {r.dom}
                  </span>
                  {/* status is a quiet indicator, not a filled tile */}
                  <span style={{ position: "relative", display: "flex", height: 5, alignItems: "center" }}>
                    {r.status === "full" ? (
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--gold)", boxShadow: "0 0 7px rgba(243,201,140,0.8)" }} />
                    ) : r.status === "partial" ? (
                      <span style={{ width: 5, height: 5, borderRadius: 999, border: "1.5px solid var(--gold-3)" }} />
                    ) : (
                      <span style={{ width: 5, height: 1.5, borderRadius: 999, background: "rgba(255,255,255,0.16)" }} />
                    )}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* ---- the day's progress ---- */}
        <Card style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <ProgressRing pct={pct} size={104} stroke={5}>
              <span data-testid="day-pct" className="u-display u-num" style={{ fontSize: 30, color: "var(--text)", lineHeight: 1 }}>{pct}</span>
              <span className="u-eyebrow" style={{ marginTop: 3, fontSize: 8 }}>complete</span>
            </ProgressRing>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* honest label — this used to always read "TODAY'S PROGRESS" even when
                  showing a past date's numbers */}
              <Eyebrow>{isToday ? "Today" : dateLine}</Eyebrow>
              <div style={{ fontSize: 14, color: "var(--text)", marginTop: 7, lineHeight: 1.45, fontWeight: 500 }}>
                {headline}
              </div>

              <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
                {[["AM", am, "gold", Sun], ["PM", pm, "moon", Moon]].map(([label, r, tone, Ico]) => (
                  <div key={label} style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                      <Ico size={11} color={TONES[tone].fg} />
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-3)" }}>{label}</span>
                      <span data-testid={`ratio-${label}`} className="u-num" style={{ fontSize: 10.5, color: TONES[tone].fg, marginLeft: "auto" }}>
                        {r.done}/{r.total}
                      </span>
                    </div>
                    <MetaBar pct={r.total ? (r.done / r.total) * 100 : 0} tone={tone} height={3} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ---- streak + tracked counters ---- */}
        <div style={{ display: "flex", gap: 10, marginBottom: advisories.length || showWeekly ? 14 : 22 }}>
          <Card onClick={() => setTab("journey")} tone="gold" style={{ flex: 1, padding: 15 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Flame size={15} color="var(--gold)" />
              <ArrowRight size={13} color="var(--text-3)" />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 12 }}>
              <span data-testid="routine-streak" className="u-display u-num" style={{ fontSize: 30, color: "var(--text)" }}>{streak}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{streak === 1 ? "day" : "days"}</span>
            </div>
            <Eyebrow style={{ marginTop: 5 }}>Current streak</Eyebrow>
          </Card>

          {trackedCounters.length > 0 ? (
            <Card style={{ flex: 1.25, padding: 15, minWidth: 0 }}>
              <Eyebrow>Tracking</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 11 }}>
                {trackedCounters.slice(0, 2).map((t) => (
                  <div key={t.id} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.name}
                    </div>
                    <div className="u-num" style={{ fontSize: 15, color: t.days > 0 ? "var(--gold)" : "var(--text-3)", fontWeight: 600, marginTop: 2 }}>
                      {t.days > 0 ? `Day ${t.days}` : "Paused"}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card style={{ flex: 1.25, padding: 15, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <Eyebrow>Tracking</Eyebrow>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
                Star a product on the Shelf to count its days here.
              </div>
            </Card>
          )}
        </div>

        {/* ---- advisories ---- */}
        <AnimatePresence initial={false}>
          {advisories.map((a) => (
            <motion.div
              key={a.key}
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 10 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div style={{
                borderRadius: 16, padding: "13px 15px", display: "flex", gap: 11,
                background: TONES[a.tone].wash, border: `1px solid ${TONES[a.tone].line}`,
              }}>
                <a.icon size={14} color={TONES[a.tone].fg} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 3, lineHeight: 1.55 }}>{a.body}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {showWeekly && (
          <Card onClick={() => setMoodModal("weekly")} style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="u-display" style={{ fontSize: 19, color: "var(--text)", fontStyle: "italic" }}>This week, overall</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>
                  {dayLog.weeklyMood ? `You said: ${dayLog.weeklyMood}` : "A quick Sunday check-in"}
                </div>
              </div>
              <ChevronRight size={17} color="var(--gold)" />
            </div>
          </Card>
        )}

        {canCopyPrev && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 22, marginTop: 4 }}>
            <motion.button
              onClick={() => onCopyYesterday(selectedDate)}
              whileTap={{ scale: 0.96 }}
              transition={SPRING}
              className="u-tap"
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 999,
                background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", color: "var(--text-2)", fontSize: 12,
              }}
            >
              <RotateCcw size={12} color="var(--gold)" />
              {isToday ? "Same as yesterday" : "Same as the day before"}
            </motion.button>
          </div>
        )}
      </Body>

      <RoutineSection
        title="Morning"
        subtitle="After waking"
        period="AM"
        tone="gold"
        icon={Sun}
        products={amRoutine.list}
        addedIds={amRoutine.addedIds}
        skipped={amRoutine.skipped}
        addedLabel={isToday ? "TODAY ONLY" : "THIS DAY"}
        onAddStep={() => setStepsFor("AM")}
        onUnskipStep={onUnskipStep}
        dayLog={dayLog}
        toggleProduct={toggleProduct}
        moveProduct={moveProduct}
        moodLabel="How did your skin feel this morning?"
        onMood={() => setMoodModal("am")}
        moodSaved={dayLog.amMood}
        moodNote={dayLog.amNote}
        setTab={setTab}
        conflictCount={amExfoliantCount}
        onTriggerPhoto={selectedDate <= todayStr() ? () => onTriggerPhoto("am") : null}
        photoCount={(photoIndex[selectedDate]?.am || []).length}
        ratio={am}
      />

      <RoutineSection
        title="Night"
        subtitle="Before bed"
        period="PM"
        tone="moon"
        icon={Moon}
        products={pmRoutine.list}
        addedIds={pmRoutine.addedIds}
        skipped={pmRoutine.skipped}
        addedLabel={isToday ? "TODAY ONLY" : "THIS DAY"}
        onAddStep={() => setStepsFor("PM")}
        onUnskipStep={onUnskipStep}
        dayLog={dayLog}
        toggleProduct={toggleProduct}
        moveProduct={moveProduct}
        moodLabel="How did your skin feel tonight?"
        onMood={() => setMoodModal("pm")}
        moodSaved={dayLog.pmMood}
        moodNote={dayLog.pmNote}
        setTab={setTab}
        conflictCount={pmExfoliantCount}
        onTriggerPhoto={selectedDate <= todayStr() ? () => onTriggerPhoto("pm") : null}
        photoCount={(photoIndex[selectedDate]?.pm || []).length}
        ratio={pm}
      />

      <AnimatePresence>
        {stepsFor && (
          <DayStepsSheet
            period={stepsFor}
            date={selectedDate}
            products={products}
            routine={stepsFor === "AM" ? amRoutine : pmRoutine}
            onClose={() => setStepsFor(null)}
            onAdd={(id) => onAddStep(stepsFor, id)}
            onSkip={(id, isAdded) => onSkipStep(stepsFor, id, isAdded)}
            onUnskip={(id) => onUnskipStep(stepsFor, id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
