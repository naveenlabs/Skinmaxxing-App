// A progress photo that only reads its blob out of IndexedDB once it's on screen.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Image as ImageIcon } from "lucide-react";
import { prettyDate } from "../domain/dates.js";
import { SPRING } from "../styles/theme.js";

export function LazyPhoto({ date, period, id, loadPhoto, cached, size = 56, aspect = null, radius = 10, onClick, selected, tag }) {
  const ref = useRef(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!ref.current || cached) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setRequested(true);
        loadPhoto(date, period, id);
        obs.disconnect();
      }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [date, period, id, cached, loadPhoto]);

  const Wrap = onClick ? motion.button : motion.div;
  return (
    <Wrap
      ref={ref}
      onClick={onClick}
      whileTap={onClick ? { scale: 0.96 } : undefined}
      transition={SPRING}
      className="u-tap"
      data-testid="lazy-photo"
      data-loaded={cached ? "1" : "0"}
      style={{
        position: "relative", flexShrink: 0, borderRadius: radius, overflow: "hidden", padding: 0,
        // Grid tiles get a fixed ratio instead of height:100%. Without it the tile had no
        // intrinsic height, so the skeleton collapsed to nothing and rows went ragged as
        // photos of different shapes loaded in.
        ...(aspect ? { width: "100%", aspectRatio: aspect } : { width: size, height: size }),
        border: selected ? "2px solid var(--gold)" : "1px solid var(--line)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      {cached ? (
        <motion.img
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          src={cached}
          alt={`Progress photo, ${prettyDate(date)} ${period.toUpperCase()}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        /* backgroundColor/backgroundImage rather than the `background` shorthand: mixing
           the shorthand with backgroundSize makes React warn whenever this element
           re-renders between placeholder states, which it now does while the blob is
           fetched from IndexedDB. */
        <div style={{
          width: "100%", height: "100%",
          backgroundColor: requested ? "transparent" : "rgba(255,255,255,0.035)",
          backgroundImage: requested
            ? "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(243,201,140,0.09) 37%, rgba(255,255,255,0.03) 63%)"
            : "none",
          backgroundSize: "400% 100%", animation: requested ? "shimmer 1.5s ease infinite" : "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {!requested && <ImageIcon size={14} color="var(--text-3)" />}
        </div>
      )}
      {tag && (
        <div style={{
          position: "absolute", top: 5, left: 5, fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--text)", background: "rgba(6,4,3,0.6)", backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)", borderRadius: 6, padding: "3px 6px",
        }}>
          {tag}
        </div>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ position: "absolute", inset: 0, background: "rgba(243,201,140,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <motion.div
              initial={{ scale: 0.5 }} animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
              style={{ width: 22, height: 22, borderRadius: 999, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Check size={13} color="#20150C" strokeWidth={3.4} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Wrap>
  );
}

// Each period is now a full-bleed tinted band rather than a hairline-separated list, so
// morning and night read as two distinct places instead of one long scroll. Tone comes
// from the AM/PM photography: honey for morning, moonlight for night.
