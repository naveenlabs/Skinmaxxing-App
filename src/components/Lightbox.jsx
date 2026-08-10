// Full-screen photo viewer, shared by the Insights timeline and the Journey gallery.
import { motion } from "framer-motion";
import { Loader2, Trash2, X } from "lucide-react";
import { prettyDate } from "../domain/dates.js";

// Shared full-screen photo viewer — Insights' timeline and Journey's gallery used two
// near-identical copies of this.
export function Lightbox({ entry, src, onClose, onDelete, label }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 160, padding: 22,
        background: "rgba(4,2,1,0.94)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}
    >
      {src ? (
        <motion.img
          initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          src={src} alt=""
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "100%", maxHeight: "68vh", borderRadius: 20, boxShadow: "var(--shadow-lift)" }}
        />
      ) : (
        <Loader2 className="animate-spin" size={24} color="var(--gold)" />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
          {label || `${prettyDate(entry.date)} ${entry.period.toUpperCase()}`}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="u-tap"
            style={{
              background: "rgba(226,160,141,0.14)", border: "1px solid rgba(226,160,141,0.32)",
              borderRadius: 999, padding: "8px 14px", display: "flex", alignItems: "center", gap: 7,
              color: "var(--rose)", fontSize: 12, fontWeight: 600,
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
      <button onClick={onClose} className="u-tap" style={{
        position: "absolute", top: 18, right: 18, width: 36, height: 36, borderRadius: 999,
        background: "rgba(255,255,255,0.08)", border: "1px solid var(--line-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <X size={16} color="var(--text)" />
      </button>
    </motion.div>
  );
}
