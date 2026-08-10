// The Shelf tab: the product catalogue, its editor, and retirement.
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowDownNarrowWide,
  CalendarClock,
  Camera,
  Flame,
  Info,
  Layers,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Sun,
  X,
} from "lucide-react";
import { LEAF_IMG, SHELF_HEADER_IMG } from "../../assets.js";
import {
  Body,
  EmptyState,
  Eyebrow,
  GhostButton,
  MetaBar,
  PageHeader,
  Pill,
  PrimaryButton,
  Section,
  Sheet,
  SheetHeader,
  Stagger,
  StaggerItem,
} from "../../components/primitives.jsx";
import { CATS, FILTERS, STATUS_OPTIONS, matchesFilter } from "../../domain/catalog.js";
import { prettyDate, todayStr } from "../../domain/dates.js";
import { applyStatusChange, stintsOf, usageStats } from "../../domain/routine.js";
import { SPRING, TONES } from "../../styles/theme.js";

// AM/PM presence, in the same two temperatures used everywhere else.
export function TimeBadges({ time }) {
  const includesAM = time === "AM" || time === "Both";
  const includesPM = time === "PM" || time === "Both";
  const chip = (tone, Ico, label) => (
    <span key={label} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999,
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
      background: TONES[tone].wash2, color: TONES[tone].fg, border: `1px solid ${TONES[tone].line}`,
    }}>
      <Ico size={9} /> {label}
    </span>
  );
  return <>{includesAM && chip("gold", Sun, "AM")}{includesPM && chip("moon", Moon, "PM")}</>;
}

export function compressProductPhoto(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new window.Image();
    img.onload = () => {
      const maxW = 480;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

export function FieldLabel({ children, style }) {
  return <Eyebrow style={{ marginBottom: 9, ...style }}>{children}</Eyebrow>;
}

export function ProductEditor({ product, onClose, onSave, onDelete }) {
  const [name, setName] = useState(product ? product.name : "");
  const [category, setCategory] = useState(product ? product.category : "moisturizer");
  const [time, setTime] = useState(product ? product.time : "Both");
  const [tracked, setTracked] = useState(product ? !!product.tracked : false);
  const [exfoliant, setExfoliant] = useState(product ? !!product.exfoliant : false);
  const [status, setStatus] = useState(product ? product.status || "active" : "active");
  const [retiredReason, setRetiredReason] = useState(product ? product.retiredReason || "" : "");
  const [photo, setPhoto] = useState(product ? product.photo || null : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState(false);
  const photoInputRef = useRef(null);

  function submit() {
    if (!name.trim()) { setNameError(true); return; }
    onSave({ name: name.trim(), category, time, tracked, exfoliant, status, retiredReason: status === "retired" ? retiredReason.trim() : "", photo: photo || null });
  }

  const STATUS_LABEL = { active: "Active", trying: "Trying", retired: "Retired" };
  // a category id that no longer exists still needs to be offered back, or opening the
  // editor would silently reassign the product to whatever happened to be selected
  const categoryOptions = CATS.some((c) => c.id === category)
    ? CATS
    : [...CATS, { id: category, label: category, icon: Info }];

  const toggles = [
    { on: tracked, set: setTracked, icon: Star, label: "Count the days I use this", hint: "Shows a running day counter on Routine" },
    { on: exfoliant, set: setExfoliant, icon: Flame, label: "Exfoliant or strong active", hint: "Warns you if two are checked in one period" },
  ];

  return (
    <Sheet onClose={onClose} labelledBy="editor-title">
      <SheetHeader id="editor-title" title={product ? "Edit product" : "Add product"} onClose={onClose} />

      <div style={{ display: "flex", gap: 14, marginBottom: 20, alignItems: "flex-start" }}>
        {/* the clear-photo button lives inside this relative wrapper — as a bare sibling
            its position:absolute escaped to the viewport */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <motion.button
            onClick={() => photoInputRef.current && photoInputRef.current.click()}
            whileTap={{ scale: 0.96 }}
            transition={SPRING}
            aria-label={photo ? "Replace product photo" : "Add product photo"}
            className="u-tap"
            style={{
              display: "block", width: 84, height: 84, borderRadius: 18, overflow: "hidden", padding: 0,
              background: "rgba(255,255,255,0.04)", border: photo ? "1px solid var(--line-2)" : "1px dashed var(--line-2)",
            }}
          >
            {photo ? (
              <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Camera size={17} color="var(--text-3)" />
                <span style={{ fontSize: 9, color: "var(--text-3)" }}>Photo</span>
              </div>
            )}
          </motion.button>
          {photo && (
            <button onClick={() => setPhoto(null)} aria-label="Remove photo" className="u-tap"
              style={{
                position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 999,
                background: "rgba(8,5,4,0.92)", border: "1px solid var(--line-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <X size={12} color="var(--text)" />
            </button>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (nameError) setNameError(false); }}
            placeholder="Product name"
            aria-label="Product name"
            autoFocus={!product}
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)",
              border: `1px solid ${nameError ? "rgba(226,160,141,0.7)" : "var(--line)"}`,
              borderRadius: 12, padding: "13px 14px", color: "var(--text)", fontSize: 14,
            }}
          />
          {nameError && (
            <div style={{ fontSize: 11.5, color: "var(--rose)", marginTop: 7 }}>Give it a name first.</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {["AM", "PM", "Both"].map((t) => (
              <Pill key={t} active={time === t} tone={t === "PM" ? "moon" : "gold"} onClick={() => setTime(t)} style={{ flex: 1, textAlign: "center", padding: "9px 0" }}>
                {t}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) compressProductPhoto(f, setPhoto); e.target.value = ""; }}
      />

      <FieldLabel>Category</FieldLabel>
      <div style={{ display: "flex", gap: 7, marginBottom: 20, flexWrap: "wrap" }}>
        {categoryOptions.map((c) => (
          <Pill key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Pill>
        ))}
      </div>

      <FieldLabel>Status</FieldLabel>
      <div style={{ display: "flex", gap: 7, marginBottom: status === "retired" ? 12 : 20 }}>
        {STATUS_OPTIONS.map((s) => (
          <Pill key={s} active={status === s} onClick={() => setStatus(s)} style={{ flex: 1, textAlign: "center", padding: "10px 0" }}>
            {STATUS_LABEL[s]}
          </Pill>
        ))}
      </div>
      {status === "retired" && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.55 }}>
            Hidden from your routine, but every day you logged it stays in Insights.
          </div>
          <textarea
            value={retiredReason}
            onChange={(e) => setRetiredReason(e.target.value)}
            placeholder="Why retire it? Broke me out, too drying, switched to something else…"
            rows={2}
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 12, padding: "12px 14px", color: "var(--text)", fontSize: 13, resize: "none", lineHeight: 1.55,
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {toggles.map((t) => (
          <button
            key={t.label}
            onClick={() => t.set((v) => !v)}
            role="switch"
            aria-checked={t.on}
            className="u-tap"
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 14,
              border: `1px solid ${t.on ? "var(--line-3)" : "var(--line)"}`,
              background: t.on ? "var(--gold-wash)" : "transparent", textAlign: "left",
            }}
          >
            <t.icon size={15} color={t.on ? "var(--gold)" : "var(--text-3)"} fill={t.on ? "var(--gold)" : "none"} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: t.on ? "var(--text)" : "var(--text-2)", fontWeight: 500 }}>{t.label}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{t.hint}</div>
            </div>
            {/* real switch affordance, not just a tinted button */}
            <span style={{
              width: 34, height: 20, borderRadius: 999, flexShrink: 0, padding: 2,
              background: t.on ? "var(--gold)" : "rgba(255,255,255,0.1)",
              display: "flex", justifyContent: t.on ? "flex-end" : "flex-start",
              transition: "background 0.25s var(--ease)",
            }}>
              <motion.span layout transition={SPRING} style={{ width: 16, height: 16, borderRadius: 999, background: t.on ? "#20150C" : "rgba(255,255,255,0.55)" }} />
            </span>
          </button>
        ))}
      </div>

      <PrimaryButton onClick={submit} style={{ marginBottom: onDelete ? 10 : 0 }}>
        {product ? "Save changes" : "Add to shelf"}
      </PrimaryButton>

      {onDelete && (
        confirmDelete ? (
          <div style={{ display: "flex", gap: 8 }}>
            <GhostButton onClick={() => setConfirmDelete(false)} style={{ flex: 1 }}>Cancel</GhostButton>
            <PrimaryButton tone="danger" onClick={onDelete} style={{ flex: 1 }}>Delete for good</PrimaryButton>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="u-tap" style={{
            width: "100%", padding: "13px 0", borderRadius: 14, border: "1px solid rgba(226,160,141,0.3)",
            background: "transparent", color: "var(--rose)", fontSize: 13, fontWeight: 500,
          }}>
            Delete product
          </button>
        )
      )}
      {onDelete && !confirmDelete && (
        <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
          Deleting removes its history too — retire it instead to keep the record.
        </div>
      )}
    </Sheet>
  );
}

export function RetireReasonModal({ productName, usedToday, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet onClose={onClose} z={155} labelledBy="retire-title">
      <SheetHeader
        id="retire-title"
        title={`Retiring ${productName}`}
        subtitle="Worth remembering why — completely optional."
        onClose={onClose}
      />
      {/* say plainly what retiring does to the record, since the old behaviour silently
          rewrote every past day and that's exactly what this is fixing */}
      <div style={{
        display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 14,
        padding: "11px 13px", borderRadius: 14,
        border: "1px solid var(--line)", background: "rgba(255,255,255,0.022)",
      }}>
        <CalendarClock size={13} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
          {usedToday
            ? "You've already used it today, so today stays as it is and it's gone from tomorrow."
            : "It leaves your routine from today."}
          {" "}Every earlier day keeps it, exactly as you logged it. You can still add it back for a single day.
        </span>
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Broke me out, too drying, switched to something else…"
        rows={3}
        autoFocus
        style={{
          width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
          borderRadius: 14, padding: 14, color: "var(--text)", fontSize: 13.5, resize: "none",
          marginBottom: 16, lineHeight: 1.55,
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={() => onConfirm("")} style={{ flex: 1 }}>Skip</GhostButton>
        <PrimaryButton onClick={() => onConfirm(reason.trim())} style={{ flex: 1 }}>Retire it</PrimaryButton>
      </div>
    </Sheet>
  );
}


/* ------------------------------- insights view ------------------------------- */

export function ProductsView({ products, logs, onAdd, onUpdate, onDelete, onReorder }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null); // null | 'new' | productId
  const [retiring, setRetiring] = useState(null);
  const [menuFor, setMenuFor] = useState(null); // productId whose kebab menu is open
  const [menuPos, setMenuPos] = useState(null); // {top, left} for the open kebab menu
  const listWrapRef = useRef(null);

  function openMenu(e, productId) {
    e.stopPropagation();
    if (menuFor === productId) { setMenuFor(null); setMenuPos(null); return; }
    const btnRect = e.currentTarget.getBoundingClientRect();
    const wrapRect = listWrapRef.current.getBoundingClientRect();
    const menuWidth = 198;
    const menuHeight = 130;
    const gap = 6;
    const tabBarBuffer = 96; // tab bar height + safe margin
    // window.innerHeight is the browser window, which is not the app's visible area when
    // it renders inside the phone-frame mockup. Measure against the scroll container.
    const scroller = document.getElementById("root");
    const viewportBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const spaceBelow = viewportBottom - tabBarBuffer - btnRect.bottom;
    const openUp = spaceBelow < menuHeight;
    const top = openUp
      ? btnRect.top - wrapRect.top - menuHeight - gap
      : btnRect.bottom - wrapRect.top + gap;
    const left = Math.max(4, Math.min(btnRect.right - wrapRect.left - menuWidth, wrapRect.width - menuWidth - 16));
    setMenuPos({ top, left, openUp });
    setMenuFor(productId);
  }

  const stats = usageStats(products, logs);

  const visible = products.filter((p) => matchesFilter(p, filter) && p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const grouped = CATS.map((c) => ({ ...c, items: visible.filter((p) => p.category === c.id) })).filter((g) => g.items.length > 0);
  // A product whose category id isn't in CATS any more (renamed/removed category, or data
  // from an older build) matched no group and vanished from this screen entirely — while
  // still showing up in Routine and Insights, so it couldn't be edited, retired or deleted.
  const knownCats = new Set(CATS.map((c) => c.id));
  const orphans = visible.filter((p) => !knownCats.has(p.category));
  if (orphans.length) grouped.push({ id: "__uncategorized__", label: "Uncategorized", icon: Info, items: orphans });

  const editingProduct = editing && editing !== "new" ? products.find((p) => p.id === editing) : null;
  const menuProduct = menuFor ? products.find((p) => p.id === menuFor) : null;

  const counts = {
    active: products.filter((p) => (p.status || "active") === "active").length,
    trying: products.filter((p) => p.status === "trying").length,
    retired: products.filter((p) => p.status === "retired").length,
  };
  const mostUsed = Math.max(1, ...products.map((p) => stats[p.id]?.count || 0));

  return (
    <div>
      <PageHeader
        image={SHELF_HEADER_IMG}
        eyebrow="Shelf"
        icon={Layers}
        minHeight={252}
        focus="52% 34%"
        title="Your products"
        subtitle="Everything in the rotation, and how hard each one is working."
      />

      <Body>
        {/* ---- shelf at a glance: new, and it answers the first question you'd ask ---- */}
        <Stagger style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { k: "active", label: "Active", n: counts.active, tone: "gold" },
            { k: "trying", label: "Trying", n: counts.trying, tone: "gold" },
            { k: "retired", label: "Retired", n: counts.retired },
          ].map((c) => (
            <StaggerItem key={c.k} style={{ flex: 1 }}>
              <div className="u-card" style={{ padding: "13px 14px" }}>
                <div className="u-display u-num" style={{ fontSize: 26, color: c.n ? "var(--text)" : "var(--text-3)" }}>{c.n}</div>
                <Eyebrow style={{ marginTop: 4 }}>{c.label}</Eyebrow>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        {/* ---- toolbar ---- */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your shelf…"
            aria-label="Search products"
            style={{
              width: "100%", background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)",
              borderRadius: 999, padding: "13px 16px 13px 40px", color: "var(--text)", fontSize: 13.5,
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="u-tap"
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", display: "flex" }}>
              <X size={14} color="var(--text-3)" />
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, marginBottom: 18, overflowX: "auto", paddingBottom: 4, margin: "0 -20px 18px", padding: "0 20px 4px" }}>
          {FILTERS.map((f) => (
            <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Pill>
          ))}
        </div>

        <motion.button
          onClick={() => setEditing("new")}
          whileTap={{ scale: 0.985 }}
          transition={SPRING}
          className="u-tap"
          style={{
            position: "relative", width: "100%", borderRadius: 18, padding: "17px 18px", marginBottom: 24,
            overflow: "hidden", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
            border: "1px solid var(--line-3)",
            background: "linear-gradient(100deg, rgba(243,201,140,0.13), rgba(243,201,140,0.03))",
            boxShadow: "0 12px 30px -18px rgba(243,201,140,0.5)",
          }}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 999, flexShrink: 0,
            background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 18px -4px rgba(243,201,140,0.7)",
          }}>
            <Plus size={17} color="#20150C" strokeWidth={2.6} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Add a product</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>It'll appear in your routine straight away</div>
          </div>
          <img src={LEAF_IMG} alt="" aria-hidden="true" style={{ position: "absolute", right: -8, bottom: -26, width: 124, opacity: 0.5, pointerEvents: "none" }} />
        </motion.button>
      </Body>

      <div ref={listWrapRef} style={{ position: "relative", padding: "0 20px 8px" }}>
        {grouped.map((g) => {
          const Icon = g.icon;
          return (
            <Section
              key={g.id}
              title={g.label}
              action={<span className="u-num" style={{ fontSize: 11, color: "var(--text-3)" }}>{g.items.length}</span>}
            >
              <Stagger style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.items.map((p) => {
                  const s = stats[p.id] || { count: 0, last: null };
                  const retired = p.status === "retired";
                  return (
                    <StaggerItem key={p.id}>
                      <div className="u-card" style={{
                        position: "relative", display: "flex", alignItems: "stretch",
                        padding: 0, overflow: "hidden", opacity: retired ? 0.6 : 1,
                      }}>
                        <button
                          onClick={() => setEditing(p.id)}
                          className="u-tap"
                          aria-label={`Edit ${p.name}`}
                          style={{
                            width: 86, height: 86, flexShrink: 0, alignSelf: "flex-start", margin: 10,
                            borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "none",
                            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                          }}
                        >
                          {p.photo
                            ? <img src={p.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <Icon size={20} color="var(--text-3)" strokeWidth={1.5} />}
                        </button>

                        <button
                          onClick={() => setEditing(p.id)}
                          className="u-tap"
                          style={{ flex: 1, minWidth: 0, background: "none", border: "none", textAlign: "left", padding: "13px 12px 13px 14px" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600, lineHeight: 1.35 }}>{p.name}</span>
                            {p.tracked && <Star size={10} color="var(--gold)" fill="var(--gold)" />}
                            {p.exfoliant && <Flame size={10} color="var(--rose)" fill="var(--rose)" />}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <TimeBadges time={p.time} />
                            {p.status === "trying" && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--gold)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "3px 8px" }}>TRYING</span>
                            )}
                            {retired && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 8px" }}>RETIRED</span>
                            )}
                          </div>

                          {/* how hard this product is actually working, relative to the shelf */}
                          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 9 }}>
                            <div style={{ flex: 1, maxWidth: 96 }}>
                              <MetaBar pct={(s.count / mostUsed) * 100} height={3} tone="gold" />
                            </div>
                            <span className="u-num" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                              {s.count > 0 ? `${s.count}× · ${prettyDate(s.last).toLowerCase()}` : "not used yet"}
                            </span>
                          </div>

                          {/* the timeline is the point now — when it was in the routine, not
                              just that it currently isn't */}
                          {retired && (() => {
                            const last = [...stintsOf(p)].reverse().find((st) => st.to);
                            if (!last) return null;
                            return (
                              <div data-testid="retired-timeline" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 7 }}>
                                in your routine {prettyDate(last.from).toLowerCase()} – {prettyDate(last.to).toLowerCase()}
                              </div>
                            );
                          })()}

                          {retired && p.retiredReason && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, fontStyle: "italic", lineHeight: 1.5 }}>
                              “{p.retiredReason}”
                            </div>
                          )}
                        </button>

                        <div style={{ display: "flex", alignItems: "flex-start", padding: "8px 6px 0 0" }}>
                          <button
                            onClick={(e) => openMenu(e, p.id)}
                            aria-label={`More options for ${p.name}`}
                            aria-expanded={menuFor === p.id}
                            className="u-tap"
                            style={{ background: "none", border: "none", padding: 7, color: "var(--text-3)", display: "flex" }}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </Section>
          );
        })}

        {visible.length === 0 && products.length > 0 && filter === "retired" && (
          <EmptyState
            icon={Archive}
            title="Nothing retired"
            body="Retire something from its “…” menu — it leaves your routine but keeps all its history."
          />
        )}
        {visible.length === 0 && products.length > 0 && filter !== "retired" && (
          <EmptyState
            icon={Search}
            title="No matches"
            body="Nothing on your shelf matches that search or filter."
            action={<GhostButton onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</GhostButton>}
          />
        )}
        {products.length === 0 && (
          <EmptyState
            icon={Layers}
            title="Your shelf is empty"
            body="Add what you're using and your morning and night routines build themselves."
            action={<PrimaryButton onClick={() => setEditing("new")}>Add your first product</PrimaryButton>}
          />
        )}

        <AnimatePresence>
          {menuProduct && menuPos && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => { setMenuFor(null); setMenuPos(null); }}
                style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(5,3,2,0.55)" }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: menuPos.openUp ? 6 : -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: menuPos.openUp ? 4 : -4 }}
                transition={{ type: "spring", stiffness: 520, damping: 36 }}
                onClick={(e) => e.stopPropagation()}
                role="menu"
                data-testid="kebab-menu"
                className="u-frost"
                style={{
                  position: "absolute", top: menuPos.top, left: menuPos.left, zIndex: 141,
                  borderRadius: 16, padding: 6, width: 198,
                  border: "1px solid var(--line-2)", boxShadow: "var(--shadow-lift)",
                  transformOrigin: menuPos.openUp ? "bottom right" : "top right",
                }}
              >
                {[
                  { label: "Edit", icon: Pencil, run: () => setEditing(menuProduct.id) },
                  {
                    label: menuProduct.status === "retired" ? "Restore to active" : "Retire",
                    icon: menuProduct.status === "retired" ? RotateCcw : Archive,
                    run: () => {
                      if (menuProduct.status === "retired") onUpdate(menuProduct.id, applyStatusChange(menuProduct, "active", logs));
                      else setRetiring(menuProduct.id);
                    },
                  },
                  { label: "Move down", icon: ArrowDownNarrowWide, run: () => onReorder(menuProduct.category, menuProduct.id) },
                ].map((it) => (
                  <button
                    key={it.label}
                    role="menuitem"
                    onClick={() => { it.run(); setMenuFor(null); setMenuPos(null); }}
                    className="u-tap"
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      padding: "11px 12px", borderRadius: 11, fontSize: 13, color: "var(--text)",
                      display: "flex", alignItems: "center", gap: 10,
                    }}
                  >
                    <it.icon size={14} color="var(--text-3)" />
                    {it.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editing && (
          <ProductEditor
            product={editingProduct}
            onClose={() => setEditing(null)}
            onSave={(data) => {
              if (editing === "new") {
                onAdd(data);
                setFilter("all");
                setQuery("");
              } else {
                // route status through the one stint writer rather than letting the
                // editor set the flag directly
                const patch = editingProduct
                  ? { ...data, ...applyStatusChange(editingProduct, data.status, logs, data.retiredReason) }
                  : data;
                onUpdate(editing, patch);
              }
              setEditing(null);
            }}
            onDelete={editingProduct ? () => { onDelete(editingProduct.id); setEditing(null); } : null}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {retiring && (
          <RetireReasonModal
            productName={products.find((p) => p.id === retiring)?.name || ""}
            usedToday={!!(logs[todayStr()] && ((logs[todayStr()].am || {})[retiring] || (logs[todayStr()].pm || {})[retiring]))}
            onClose={() => setRetiring(null)}
            onConfirm={(reason) => {
              const p = products.find((x) => x.id === retiring);
              if (p) onUpdate(retiring, applyStatusChange(p, "retired", logs, reason));
              setRetiring(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
