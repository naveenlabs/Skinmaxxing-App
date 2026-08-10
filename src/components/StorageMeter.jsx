// Storage gauge, shared by Insights, Journey and Account.
import { motion } from "framer-motion";
import { Card } from "./primitives.jsx";

// One storage meter, used on both Insights and Journey. These were two different blocks
// with different labels ("Used" vs "Storage used") and different markup.
export function StorageMeter({ usedMB, pct, hint, totalMB = 0 }) {
  const tight = pct > 85;
  // Browser quotas run to gigabytes; showing "0.1 / 39321.6 MB" helps nobody.
  const fmt = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>Used</span>
        <span data-testid="storage-used" className="u-num" style={{ fontSize: 12, color: tight ? "var(--rose)" : "var(--text)", fontWeight: 600 }}>
          {fmt(usedMB)} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>/ {fmt(totalMB)}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{
            height: "100%", borderRadius: 999,
            background: tight ? "linear-gradient(90deg, #C98570, var(--rose))" : "linear-gradient(90deg, var(--gold-3), var(--gold))",
          }}
        />
      </div>
      {tight ? (
        <div style={{ fontSize: 11.5, color: "var(--rose)", marginTop: 10, lineHeight: 1.5 }}>
          Getting close to the limit — clean up old photos in Journey.
        </div>
      ) : hint ? (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10, lineHeight: 1.5 }}>{hint}</div>
      ) : null}
    </Card>
  );
}

// Shared full-screen photo viewer — Insights' timeline and Journey's gallery used two
// near-identical copies of this.
