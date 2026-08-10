/**
 * The design system. Nothing here knows what a skincare product is — these are the
 * shapes every feature is drawn with, so a spacing or tone change lands everywhere at
 * once instead of being re-tuned per screen.
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { GLOBAL_CSS, SPRING, TONES } from "../styles/theme.js";

export function Shell({ children }) {
  return (
    <div style={{ background: "var(--ink-0)", minHeight: "100vh", fontFamily: "var(--font-ui)", color: "var(--text)" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 108 }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ design primitives ----------------------------- */

export function Eyebrow({ children, tone, style }) {
  return (
    <div className="u-eyebrow" style={{ color: tone ? TONES[tone].fg : undefined, ...style }}>
      {children}
    </div>
  );
}

// One section header for the whole app, so Insights / Journey / Shelf stop each having
// their own slightly different label treatment.

// One section header for the whole app, so Insights / Journey / Shelf stop each having
// their own slightly different label treatment.
export function Section({ title, hint, action, children, style }) {
  return (
    <section style={{ marginBottom: 26, ...style }}>
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <Eyebrow>{title}</Eyebrow>
            {hint && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Card({ children, style, tone, onClick, interactive, ...rest }) {
  const t = tone ? TONES[tone] : null;
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      onClick={onClick}
      whileTap={onClick || interactive ? { scale: 0.985 } : undefined}
      transition={SPRING}
      className="u-card u-tap"
      style={{
        display: "block", width: onClick ? "100%" : undefined, textAlign: onClick ? "left" : undefined,
        padding: 16, border: t ? `1px solid ${t.line}` : undefined,
        background: t ? `linear-gradient(180deg, ${t.wash}, rgba(255,255,255,0.014))` : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

// Big numeral treatment used for every headline statistic.

// Big numeral treatment used for every headline statistic.
export function Stat({ value, unit, label, tone = "gold", size = 40 }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span className="u-display u-num" style={{ fontSize: size, color: "var(--text)" }}>{value}</span>
        {unit && <span className="u-display" style={{ fontSize: size * 0.48, color: TONES[tone].fg }}>{unit}</span>}
      </div>
      {label && <div className="u-eyebrow" style={{ marginTop: 6 }}>{label}</div>}
    </div>
  );
}

export function ProgressRing({ pct, size = 116, stroke = 6, tone = "gold", children, track = "rgba(255,255,255,0.07)" }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={TONES[tone].fg} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * clamped) / 100 }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 7px ${TONES[tone].glow})` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

export function Pill({ active, tone = "gold", children, onClick, disabled, style }) {
  const t = TONES[tone];
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={SPRING}
      className="u-tap"
      style={{
        padding: "8px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: active ? 600 : 500,
        whiteSpace: "nowrap", border: `1px solid ${active ? t.line : "var(--line)"}`,
        background: active ? t.wash2 : "transparent",
        color: active ? t.fg : "var(--text-2)",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.2s var(--ease), color 0.2s var(--ease), border-color 0.2s var(--ease)",
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

export function PrimaryButton({ children, onClick, tone = "gold", style, disabled }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={SPRING}
      className="u-tap"
      style={{
        width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
        background: tone === "danger"
          ? "linear-gradient(180deg, #E9AC98, #D08571)"
          : "linear-gradient(180deg, var(--gold), var(--gold-2))",
        color: "#20150C", fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
        boxShadow: tone === "danger" ? "0 10px 24px -12px rgba(226,160,141,0.6)" : "0 10px 24px -12px rgba(243,201,140,0.6)",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

export function GhostButton({ children, onClick, style }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={SPRING}
      className="u-tap"
      style={{
        width: "100%", padding: "13px 0", borderRadius: 14,
        border: "1px solid var(--line-2)", background: "transparent",
        color: "var(--text)", fontSize: 13.5, fontWeight: 600, ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// Every bottom sheet in the app funnels through this: one animation, one scroll
// behaviour, one grabber, one safe-area-aware bottom padding so the primary action is
// always reachable.

// Every bottom sheet in the app funnels through this: one animation, one scroll
// behaviour, one grabber, one safe-area-aware bottom padding so the primary action is
// always reachable.
export function Sheet({ children, onClose, maxHeight = "88vh", z = 150, labelledBy }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: z, display: "flex", alignItems: "flex-end", justifyContent: "center",
        background: "rgba(5,3,2,0.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <motion.div
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="u-frost"
        style={{
          width: "100%", maxWidth: 480, maxHeight, overflowY: "auto", WebkitOverflowScrolling: "touch",
          borderRadius: "26px 26px 0 0", border: "1px solid var(--line-2)", borderBottom: "none",
          padding: "10px 20px calc(22px + env(safe-area-inset-bottom))",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.16)" }} />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function SheetHeader({ title, onClose, subtitle, id }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <h2 id={id} className="u-display" style={{ fontSize: 24, color: "var(--text)", margin: 0 }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      <button onClick={onClose} aria-label="Close" className="u-tap" style={{
        background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 999,
        width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <X size={15} color="var(--text-2)" />
      </button>
    </div>
  );
}

// Shared cinematic page header: photograph, dual gradient scrim, ambient drift, and a
// consistent title block. Replaces four hand-rolled header blocks that each had their
// own padding, gradient and type scale.

// Shared cinematic page header: photograph, dual gradient scrim, ambient drift, and a
// consistent title block. Replaces four hand-rolled header blocks that each had their
// own padding, gradient and type scale.
export function PageHeader({ image, eyebrow, icon: Icon, title, italic, subtitle, action, minHeight = 268, focus = "50% 50%", children }) {
  return (
    <div style={{ position: "relative", minHeight, overflow: "hidden", isolation: "isolate" }}>
      <img
        src={image} alt="" aria-hidden="true" className="u-hero-img"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focus }}
      />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background:
          "radial-gradient(120% 80% at 8% 12%, rgba(10,7,5,0.94) 0%, rgba(10,7,5,0.62) 38%, rgba(10,7,5,0.08) 72%)," +
          "linear-gradient(180deg, rgba(10,7,5,0.55) 0%, rgba(10,7,5,0.10) 28%, rgba(10,7,5,0.55) 74%, var(--ink-0) 100%)",
      }} />
      {/* warm light leak, pulled from the champagne highlight in the photography */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(70% 50% at 88% 6%, rgba(243,201,140,0.16), transparent 70%)",
        mixBlendMode: "screen",
      }} />

      <div style={{ position: "relative", padding: "24px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {Icon && <Icon size={14} color="var(--gold)" strokeWidth={2} />}
          <span className="u-eyebrow" style={{ color: "var(--gold)" }}>{eyebrow}</span>
        </div>
        {action}
      </div>

      <div style={{ position: "relative", padding: "18px 20px 22px" }}>
        <h1 className="u-display" style={{ fontSize: 40, color: "var(--text)", margin: 0 }}>
          {title}
          {italic && <><br /><span style={{ fontStyle: "italic", color: "var(--gold)" }}>{italic}</span></>}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "12px 0 0", maxWidth: 268, lineHeight: 1.55 }}>{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  );
}

export function Body({ children, style }) {
  return <div style={{ padding: "22px 20px 8px", ...style }}>{children}</div>;
}

// Staggered entrance for lists — each child rises in sequence rather than the whole
// page appearing at once.

// Staggered entrance for lists — each child rises in sequence rather than the whole
// page appearing at once.
export const listVariants = { show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } }, hide: {} };

export const itemVariants = {
  hide: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1] } },
};

export function Stagger({ children, style, tag = "div" }) {
  const M = motion[tag] || motion.div;
  return (
    <M variants={listVariants} initial="hide" animate="show" style={style}>
      {children}
    </M>
  );
}

export function StaggerItem({ children, style, ...rest }) {
  return <motion.div variants={itemVariants} style={style} {...rest}>{children}</motion.div>;
}

export function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ textAlign: "center", padding: "34px 24px 30px" }}
    >
      <div style={{
        width: 54, height: 54, borderRadius: 999, margin: "0 auto 16px",
        border: "1px solid var(--line-2)", background: "var(--gold-wash)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} color="var(--gold)" strokeWidth={1.7} />
      </div>
      <div className="u-display" style={{ fontSize: 21, color: "var(--text)", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6, maxWidth: 250, margin: "0 auto" }}>{body}</div>
      {action && <div style={{ marginTop: 18, maxWidth: 220, margin: "18px auto 0" }}>{action}</div>}
    </motion.div>
  );
}

export function MetaBar({ pct, tone = "gold", height = 5, track = "rgba(255,255,255,0.08)" }) {
  const reduce = useReducedMotion();
  return (
    <div style={{ height, borderRadius: 999, background: track, overflow: "hidden" }}>
      <motion.div
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${TONES[tone].fgDeep}, ${TONES[tone].fg})` }}
      />
    </div>
  );
}

/* -------------------------------- today view -------------------------------- */

// the "must-have" categories that count toward Today's Progress — cleanser + moisturizer always,
// sunscreen only for AM (actives/toners/serums are tracked but optional, not part of the base).
// Having multiple products in a must-have category (e.g. two moisturizers) only requires ONE of them checked.

export function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }) {
  return (
    <Sheet onClose={onCancel} z={158} labelledBy="confirm-title">
      <div style={{ display: "flex", gap: 13, marginBottom: 18 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 999, flexShrink: 0,
          background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertTriangle size={17} color="var(--rose)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="confirm-title" className="u-display" style={{ fontSize: 21, color: "var(--text)", margin: 0 }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 7 }}>{body}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Keep them</GhostButton>
        <PrimaryButton tone="danger" onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</PrimaryButton>
      </div>
    </Sheet>
  );
}

/* ------------------------------ account + auth ------------------------------ */

// Google's mark, inline. The whole app is self-hosted and works offline; reaching out
// to a CDN for one 18px logo would be the only thing on the page that doesn't.

export function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
    </div>
  );
}

// Header pill action, shared by Insights and Journey so the two Export buttons match.
export function HeaderAction({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      className="u-tap"
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999,
        background: "rgba(10,7,5,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        border: "1px solid var(--line-2)", color: "var(--text)", fontSize: 12, fontWeight: 600,
      }}
    >
      <Icon size={13} color="var(--gold)" />
      {label}
    </motion.button>
  );
}

// One storage meter, used on both Insights and Journey. These were two different blocks
// with different labels ("Used" vs "Storage used") and different markup.
